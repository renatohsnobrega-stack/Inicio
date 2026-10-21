-- Daily, grouped task reminders. This is deliberately separate from the Mural push pipeline.
-- The outbox contains no task title, task data, or notification payload.
create table if not exists public.task_push_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.mural_push_subscriptions(id) on delete cascade,
  scheduled_date date not null,
  cycle_hour smallint not null check (cycle_hour in (8,10,12,14,16,18,20)),
  status text not null default 'pending' check (status in ('pending','claimed','sent','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint task_push_outbox_once unique (user_id, scheduled_date, cycle_hour)
);
alter table public.task_push_outbox enable row level security;
revoke all on public.task_push_outbox from public, anon, authenticated;
create index if not exists task_push_outbox_pending_idx
  on public.task_push_outbox (available_at, created_at) where status in ('pending','claimed');

-- Match JavaScript taskApplies/taskDone, but reject malformed dates, unknown types,
-- and invalid recurrence definitions without aborting a batch. Monday is index 0.
create or replace function public._task_push_due(p_data jsonb, p_day date)
returns boolean language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  v_type text;
  v_date text;
  v_day integer;
  v_last integer;
  v_month_day integer;
  v_done jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_day is null then return false; end if;
  v_type := p_data->>'tipo';
  if v_type = 'unica' then
    v_date := p_data->>'data';
    if v_date is null or v_date !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    begin
      if to_char(v_date::date, 'YYYY-MM-DD') <> v_date then return false; end if;
    exception when others then return false;
    end;
    return v_date = to_char(p_day, 'YYYY-MM-DD') and not public._task_push_json_truthy(p_data->'feito');
  elsif v_type in ('diaria','semanal','mensal') then
    v_done := p_data->'feitos';
    if jsonb_typeof(v_done) = 'object' and public._task_push_json_truthy(v_done->to_char(p_day, 'YYYY-MM-DD')) then return false; end if;
    if v_type = 'diaria' then return true; end if;
    if v_type = 'semanal' then
      if jsonb_typeof(p_data->'dias') is distinct from 'array' then return false; end if;
      v_day := extract(isodow from p_day)::integer - 1;
      return exists (select 1 from jsonb_array_elements(p_data->'dias') d(value) where d.value = to_jsonb(v_day));
    end if;
    -- JavaScript's Number(dia) || 1: accept integer JSON numbers or numeric strings;
    -- reject malformed, non-integral, or out-of-range values rather than guessing.
    if not (p_data ? 'dia') or p_data->'dia' = 'null'::jsonb or p_data->>'dia' = '' or p_data->>'dia' = '0' then
      v_month_day := 1;
    else
      begin
        if (p_data->>'dia') !~ '^\d{1,2}$' then return false; end if;
        v_month_day := (p_data->>'dia')::integer;
        if v_month_day < 1 or v_month_day > 31 then return false; end if;
      exception when others then return false;
      end;
    end if;
    v_last := extract(day from (date_trunc('month', p_day)::date + interval '1 month - 1 day'))::integer;
    return least(v_month_day, v_last) = extract(day from p_day)::integer;
  end if;
  return false;
end $$;

-- JSONB equivalent of JavaScript !! for completion markers.
create or replace function public._task_push_json_truthy(p_value jsonb)
returns boolean language sql immutable
set search_path = pg_catalog
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb or p_value = 'false'::jsonb then false
    when jsonb_typeof(p_value) = 'number' then (p_value::text)::numeric <> 0
    when jsonb_typeof(p_value) = 'string' then p_value #>> '{}' <> ''
    else true
  end
$$;

-- A subscription owner is eligible only while both its verified UUID mapping and
-- the actual application membership (auth.users.email -> public.membros) remain valid.
create or replace function public._task_push_uid_member(p_user_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from auth.users u
    join public.membros m on lower(m.email) = lower(coalesce(u.email, ''))
    join public.push_members pm on pm.user_id = u.id
    where u.id = p_user_id
  )
$$;

-- True when at least one current task due today is assigned unambiguously to this
-- verified owner, or explicitly to Ambos (which includes every verified push member).
create or replace function public._task_push_user_has_due(p_user_id uuid, p_day date)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select public._task_push_uid_member(p_user_id) and exists (
    select 1 from public.registros r
    where r.kind = 'tarefa'
      and public._task_push_due(r.data, p_day)
      and case
        when r.data->>'responsavel' = 'Ambos' then true
        when nullif(r.data->>'responsavel', '') is null then false
        else (
          select count(*) = 1 and min(pm.user_id::text)::uuid = p_user_id
          from public.push_members pm
          where pm.nome = r.data->>'responsavel'
        )
      end
  )
$$;

-- Internal time-injected worker used by prepare_daily; only the table owner can call it.
-- Creates at most one job per account in each eligible local-hour cycle.
create or replace function public._task_push_prepare_at(p_now timestamptz)
returns integer language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_day date;
  v_count integer;
begin
  if p_now is null then return 0; end if;
  v_day := (p_now at time zone 'America/Sao_Paulo')::date;
  if extract(hour from p_now at time zone 'America/Sao_Paulo')::integer not in (8,10,12,14,16,18,20) then return 0; end if;
  insert into public.task_push_outbox(user_id, subscription_id, scheduled_date, cycle_hour)
  select s.user_id, s.id, v_day, extract(hour from p_now at time zone 'America/Sao_Paulo')::smallint
    from (
      select distinct on (user_id) id, user_id, active, endpoint, p256dh, auth_key
        from public.mural_push_subscriptions
       where active and endpoint is not null and p256dh is not null and auth_key is not null
       order by user_id, updated_at desc, created_at desc, id desc
    ) s
   where public._task_push_user_has_due(s.user_id, v_day)
  on conflict (user_id, scheduled_date, cycle_hour) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Uses server clock only; caller cannot choose a date or user.
create or replace function public.task_push_prepare_daily()
returns integer language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  return public._task_push_prepare_at(clock_timestamp());
end $$;

-- Internal time-injected claim worker; jobs and retries are valid only in their
-- exact two-hour cycle. Leases never extend past the end of that local hour.
create or replace function public._task_push_claim_at(p_now timestamptz, p_limit integer default 20)
returns table (outbox_id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth_key text)
language plpgsql security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  r record;
  v_token uuid;
  v_day date;
  v_hour smallint;
  v_hour_end timestamptz;
begin
  if p_now is null then return; end if;
  v_day := (p_now at time zone 'America/Sao_Paulo')::date;
  v_hour := extract(hour from p_now at time zone 'America/Sao_Paulo')::smallint;
  v_hour_end := ((v_day::timestamp + make_interval(hours => v_hour + 1)) at time zone 'America/Sao_Paulo');
  update public.task_push_outbox o set status='dead', lease_until=null, lease_token=null,
    last_error='scheduled cycle expired'
   where o.status in ('pending','claimed') and (o.scheduled_date <> v_day or o.cycle_hour < v_hour);
  if v_hour not in (8,10,12,14,16,18,20) then return; end if;
  update public.task_push_outbox o set status='dead', lease_until=null, lease_token=null,
    last_error='retry limit reached'
   where o.scheduled_date = v_day and o.cycle_hour = v_hour and o.attempts >= 8
     and (o.status='pending' or (o.status='claimed' and o.lease_until <= p_now));
  update public.task_push_outbox o set status='dead', lease_until=null, lease_token=null,
    last_error='suppressed: no current eligible task or subscription'
   where o.scheduled_date = v_day and o.cycle_hour = v_hour
     and ((o.status='pending' and o.available_at <= p_now) or (o.status='claimed' and o.lease_until <= p_now))
     and (not public._task_push_user_has_due(o.user_id, v_day) or not exists (
       select 1 from public.mural_push_subscriptions s where s.id=o.subscription_id and s.user_id=o.user_id and s.active
         and s.endpoint is not null and s.p256dh is not null and s.auth_key is not null));
  for r in
    select o.id, o.subscription_id, o.user_id, s.endpoint, s.p256dh, s.auth_key
      from public.task_push_outbox o
      join public.mural_push_subscriptions s on s.id=o.subscription_id and s.user_id=o.user_id and s.active
     where o.scheduled_date=v_day and o.cycle_hour=v_hour and o.attempts < 8
       and ((o.status='pending' and o.available_at <= p_now) or (o.status='claimed' and o.lease_until <= p_now))
       and s.endpoint is not null and s.p256dh is not null and s.auth_key is not null
       and public._task_push_user_has_due(o.user_id, v_day)
     order by o.available_at, o.created_at
     for update of o skip locked
     limit greatest(1, least(coalesce(p_limit,20),50))
  loop
    v_token := gen_random_uuid();
    update public.task_push_outbox o set status='claimed', lease_until=least(p_now+interval '90 seconds',v_hour_end),
      lease_token=v_token, attempts=o.attempts+1 where o.id=r.id;
    outbox_id:=r.id; lease_token:=v_token; subscription_id:=r.subscription_id;
    endpoint:=r.endpoint; p256dh:=r.p256dh; auth_key:=r.auth_key;
    return next;
  end loop;
end $$;

-- Public RPC uses the server clock only; caller cannot choose a cycle or user.
create or replace function public.task_push_claim(p_limit integer default 20)
returns table (outbox_id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth_key text)
language plpgsql security definer
set search_path = pg_catalog, public, auth, extensions
as $$
begin
  return query select * from public._task_push_claim_at(clock_timestamp(), p_limit);
end $$;

-- Private time-injected delivery check, with no task content in its result.
create or replace function public._task_push_delivery_at(p_outbox_id uuid, p_lease_token uuid, p_now timestamptz)
returns table (endpoint text, p256dh text, auth_key text)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_day date;
  v_hour smallint;
begin
  if p_now is null then return; end if;
  v_day := (p_now at time zone 'America/Sao_Paulo')::date;
  v_hour := extract(hour from p_now at time zone 'America/Sao_Paulo')::smallint;
  return query
    select s.endpoint, s.p256dh, s.auth_key
      from public.task_push_outbox o
      join public.mural_push_subscriptions s on s.id=o.subscription_id and s.user_id=o.user_id and s.active
     where o.id=p_outbox_id and o.status='claimed' and o.lease_token=p_lease_token
       and o.lease_until>p_now and o.scheduled_date=v_day and o.cycle_hour=v_hour
       and v_hour in (8,10,12,14,16,18,20)
       and public._task_push_user_has_due(o.user_id, v_day)
       and s.endpoint is not null and s.p256dh is not null and s.auth_key is not null;
  if not found then
    update public.task_push_outbox set status='dead', lease_until=null, lease_token=null,
      last_error='suppressed: task, owner, date, or subscription no longer eligible'
     where id=p_outbox_id and status='claimed' and lease_token=p_lease_token;
  end if;
end $$;

-- Public delivery RPC is server-clock-only; the dispatcher never supplies a time.
create or replace function public.task_push_delivery(p_outbox_id uuid, p_lease_token uuid)
returns table (endpoint text, p256dh text, auth_key text)
language sql security definer
set search_path = pg_catalog, public, auth
as $$
  select * from public._task_push_delivery_at(p_outbox_id, p_lease_token, clock_timestamp())
$$;

-- result: sent | retry | gone | suppressed, matching the Mural dispatcher contract.
create or replace function public._task_push_finish_at(p_outbox_id uuid, p_lease_token uuid, p_result text, p_error text, p_now timestamptz)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_sub uuid;
  v_attempts integer;
  v_day date;
  v_hour smallint;
  v_next timestamptz;
  v_cycle_end timestamptz;
begin
  if p_result is null or p_result not in ('sent','retry','gone','suppressed') then raise exception 'invalid result'; end if;
  select subscription_id, attempts, scheduled_date, cycle_hour into v_sub, v_attempts, v_day, v_hour from public.task_push_outbox
   where id=p_outbox_id and status='claimed' and lease_token=p_lease_token for update;
  if not found then return; end if;
  if p_result='sent' then
    update public.task_push_outbox set status='sent', sent_at=p_now, lease_until=null, lease_token=null, last_error=null where id=p_outbox_id;
  elsif p_result='gone' then
    update public.mural_push_subscriptions set active=false, endpoint=null, p256dh=null, auth_key=null, updated_at=clock_timestamp() where id=v_sub;
    update public.task_push_outbox set status='dead', lease_until=null, lease_token=null, last_error='subscription expired (404/410)' where id=p_outbox_id;
  elsif p_result='suppressed' then
    update public.task_push_outbox set status='dead', lease_until=null, lease_token=null, last_error='suppressed' where id=p_outbox_id;
  elsif v_attempts >= 8 then
    update public.task_push_outbox set status='dead', lease_until=null, lease_token=null, last_error=left(coalesce(p_error,'delivery failed'),500) where id=p_outbox_id;
  else
    v_next := p_now+make_interval(secs => least(21600,30*(2^greatest(v_attempts-1,0))::integer));
    v_cycle_end := ((v_day::timestamp + make_interval(hours => v_hour + 1)) at time zone 'America/Sao_Paulo');
    if (p_now at time zone 'America/Sao_Paulo')::date <> v_day
       or extract(hour from p_now at time zone 'America/Sao_Paulo')::integer <> v_hour
       or v_next >= v_cycle_end then
      update public.task_push_outbox set status='dead', lease_until=null, lease_token=null,
        last_error=left(coalesce(p_error,'delivery retry expired outside scheduled cycle'),500) where id=p_outbox_id;
    else
      update public.task_push_outbox set status='pending', available_at=v_next,
        lease_until=null, lease_token=null, last_error=left(coalesce(p_error,'delivery failed'),500) where id=p_outbox_id;
    end if;
  end if;
end $$;

-- Public RPC uses the server clock only; the dispatcher cannot extend a cycle.
create or replace function public.task_push_finish(p_outbox_id uuid, p_lease_token uuid, p_result text, p_error text default null)
returns void language sql security definer
set search_path = pg_catalog, public, auth
as $$
  select public._task_push_finish_at(p_outbox_id, p_lease_token, p_result, p_error, clock_timestamp())
$$;

-- Helpers are inaccessible even to the dispatcher role; public RPCs are service-only.
revoke all on function public._task_push_due(jsonb,date), public._task_push_json_truthy(jsonb),
  public._task_push_uid_member(uuid), public._task_push_user_has_due(uuid,date),
  public._task_push_prepare_at(timestamptz),
  public._task_push_claim_at(timestamptz,integer),
  public._task_push_delivery_at(uuid,uuid,timestamptz),
  public._task_push_finish_at(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.task_push_prepare_daily(), public.task_push_claim(integer),
  public.task_push_delivery(uuid,uuid), public.task_push_finish(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.task_push_prepare_daily(), public.task_push_claim(integer),
  public.task_push_delivery(uuid,uuid), public.task_push_finish(uuid,uuid,text,text) to service_role;
