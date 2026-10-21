-- Web Push do mural: somente INSERT novo de recado, sem conteúdo no payload.
-- Os dois usuários autorizados devem ser cadastrados manualmente pelo administrador:
-- INSERT INTO public.push_members(user_id, nome) VALUES ('<auth.users UUID>', 'Renato/Vanessa');
-- Nome é apenas informativo; identidade/autoria é sempre auth.uid().

create table if not exists public.push_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null
);
alter table public.push_members enable row level security;
revoke all on public.push_members from public, anon, authenticated;

create table if not exists public.mural_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_hash text not null unique,
  endpoint text unique,
  p256dh text,
  auth_key text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mural_push_subscription_fields check (
    (active and endpoint is not null and p256dh is not null and auth_key is not null)
    or (not active and endpoint is null and p256dh is null and auth_key is null)
  )
);
alter table public.mural_push_subscriptions enable row level security;
revoke all on public.mural_push_subscriptions from public, anon, authenticated;

create table if not exists public.mural_push_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind = 'recado'),
  record_id text not null,
  sender_id uuid not null,
  recipient_id uuid not null,
  subscription_id uuid not null,
  status text not null default 'pending' check (status in ('pending','claimed','sent','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint mural_push_outbox_once unique (kind, record_id, subscription_id)
);
alter table public.mural_push_outbox enable row level security;
revoke all on public.mural_push_outbox from public, anon, authenticated;
create index if not exists mural_push_outbox_pending_idx
  on public.mural_push_outbox (available_at, created_at) where status in ('pending','claimed');

-- Endpoint seguro: providers conhecidos, HTTPS, sem userinfo/fragment/credenciais de usuário
-- na query, sem portas não padrão. Query de token WNS é aceita, pois faz parte do endpoint.
create or replace function public._mural_push_endpoint_ok(p_endpoint text)
returns boolean language sql immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_endpoint ~* '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|notify\.windows\.com|[a-z0-9-]+\.notify\.windows\.com)(:443)?(/[a-z0-9._~!$&''()*+,;=:@%/-]*)?(\?[a-z0-9._~!$&''()*+,;=:@%/?-]*)?$', false
  ) and p_endpoint !~* '[?&](user(name)?|pass(word)?|credential|authorization|api[_-]?key)='
$$;
revoke all on function public._mural_push_endpoint_ok(text) from public, anon, authenticated;

create or replace function public._mural_push_uid_member(p_user_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1 from auth.users u join public.membros m on lower(m.email) = lower(coalesce(u.email, ''))
    where u.id = p_user_id
  )
$$;
revoke all on function public._mural_push_uid_member(uuid) from public, anon, authenticated;

-- POST /rest/v1/rpc/push_subscribe {"p_subscription":{"endpoint":"https://…","keys":{"p256dh":"…","auth":"…"}}}
create or replace function public.push_subscribe(p_subscription jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_endpoint text := p_subscription->>'endpoint';
  v_p256dh text := p_subscription#>>'{keys,p256dh}';
  v_auth text := p_subscription#>>'{keys,auth}';
  v_id uuid;
begin
  if v_uid is null or not public.is_membro()
     or not exists (select 1 from public.push_members pm where pm.user_id = v_uid) then
    raise exception 'push não autorizado' using errcode = '42501';
  end if;
  if jsonb_typeof(p_subscription) is distinct from 'object'
     or not public._mural_push_endpoint_ok(v_endpoint)
     or coalesce(v_p256dh, '') !~ '^[A-Za-z0-9_-]{40,200}$'
     or coalesce(v_auth, '') !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception 'subscription Web Push inválida' using errcode = '22023';
  end if;
  insert into public.mural_push_subscriptions as s (user_id, endpoint_hash, endpoint, p256dh, auth_key, active, updated_at)
  values (v_uid, encode(extensions.digest(v_endpoint, 'sha256'), 'hex'), v_endpoint, v_p256dh, v_auth, true, now())
  on conflict (endpoint_hash) do update
    set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
        active = true, updated_at = now()
    where s.user_id = excluded.user_id
  returning id into v_id;
  if v_id is null then
    raise exception 'subscription pertence a outro usuário' using errcode = '42501';
  end if;
  return v_id;
end $$;

-- POST /rest/v1/rpc/push_unsubscribe {"p_endpoint":"https://…"}; remoção somente pelo dono.
create or replace function public.push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_membro()
     or not exists (select 1 from public.push_members pm where pm.user_id = v_uid) then
    raise exception 'push não autorizado' using errcode = '42501';
  end if;
  if not public._mural_push_endpoint_ok(p_endpoint) then
    raise exception 'endpoint inválido' using errcode = '22023';
  end if;
  update public.mural_push_subscriptions
     set active = false, endpoint = null, p256dh = null, auth_key = null, updated_at = now()
   where user_id = v_uid and endpoint_hash = encode(extensions.digest(p_endpoint, 'sha256'), 'hex') and active;
end $$;

-- POST /rest/v1/rpc/push_status {"p_endpoint":"https://…"}; não revela se outro usuário possui endpoint.
create or replace function public.push_status(p_endpoint text)
returns boolean language plpgsql security definer stable
set search_path = pg_catalog, public, auth, extensions
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_membro()
     or not exists (select 1 from public.push_members pm where pm.user_id = v_uid)
     or not public._mural_push_endpoint_ok(p_endpoint) then return false; end if;
  return exists (select 1 from public.mural_push_subscriptions s
    where s.user_id = v_uid and s.endpoint_hash = encode(extensions.digest(p_endpoint, 'sha256'), 'hex') and s.active);
end $$;

revoke all on function public.push_subscribe(jsonb) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.push_status(text) from public, anon;
grant execute on function public.push_subscribe(jsonb), public.push_unsubscribe(text), public.push_status(text) to authenticated;

-- Apenas inserção. Não lê autor/data para identificar o emissor; auth.uid() é a autoridade.
create or replace function public._mural_push_enqueue_new_recado()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_sender uuid := auth.uid();
begin
  if coalesce(current_setting('app.mural_publish', true), '') <> 'on'
     or v_sender is null or not public.is_membro()
     or not exists (select 1 from public.push_members pm where pm.user_id = v_sender) then
    return new;
  end if;
  insert into public.mural_push_outbox (kind, record_id, sender_id, recipient_id, subscription_id)
  select 'recado', new.id, v_sender, s.user_id, s.id
    from public.mural_push_subscriptions s
   where s.active and s.user_id <> v_sender
     and exists (select 1 from public.push_members pm where pm.user_id = s.user_id)
     and public._mural_push_uid_member(s.user_id)
  on conflict (kind, record_id, subscription_id) do nothing;
  return new;
end $$;
revoke all on function public._mural_push_enqueue_new_recado() from public, anon, authenticated;
drop trigger if exists mural_push_new_recado on public.registros;
create trigger mural_push_new_recado after insert on public.registros
  for each row when (new.kind = 'recado') execute function public._mural_push_enqueue_new_recado();

-- Publicação explícita pelo app. Importação/restauração e agente continuam usando INSERT/UPSERT
-- normal, sem a flag transacional, e portanto nunca geram Web Push. Só cria; conflito não atualiza.
-- POST /rest/v1/rpc/push_publish_recado {"p_id":"…","p_data":{"texto":"…", ...}}
create or replace function public.push_publish_recado(p_id text, p_data jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_old text := coalesce(current_setting('app.mural_publish', true), '');
begin
  if v_uid is null or not public.is_membro() then
    raise exception 'publicação não autorizada' using errcode = '42501';
  end if;
  if coalesce(trim(p_id), '') = '' or length(p_id) > 500 or jsonb_typeof(p_data) is distinct from 'object'
     or coalesce(trim(p_data->>'texto'), '') = '' then
    raise exception 'recado inválido' using errcode = '22023';
  end if;
  p_data := p_data || jsonb_build_object('id', p_id);
  perform set_config('app.mural_publish', 'on', true);
  insert into public.registros(kind, id, data) values ('recado', p_id, p_data);
  perform set_config('app.mural_publish', v_old, true);
end $$;
revoke all on function public.push_publish_recado(text,jsonb) from public, anon;
grant execute on function public.push_publish_recado(text,jsonb) to authenticated;

-- RPCs abaixo somente service_role: execute grants são a fronteira de autorização.
-- Claim com SKIP LOCKED, lease de 90s, no máximo 8 tentativas e lotes até 50.
-- Expiração absoluta de 1h desde a criação; jobs esgotados/expirados terminam como dead.
create or replace function public.mural_push_claim(p_limit integer default 20)
returns table (outbox_id uuid, lease_token uuid, subscription_id uuid, endpoint text, p256dh text, auth_key text)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare r record; v_token uuid;
begin
  update public.mural_push_outbox set status='dead', lease_until=null, lease_token=null,
    last_error='expired after 1 hour'
   where status in ('pending','claimed') and created_at <= now()-interval '1 hour';
  update public.mural_push_outbox set status='dead', lease_until=null, lease_token=null,
    last_error='retry limit reached'
   where attempts >= 8 and (status='pending' or (status='claimed' and lease_until <= now()));
  for r in
    select o.id, o.subscription_id, s.endpoint, s.p256dh, s.auth_key
      from public.mural_push_outbox o
      join public.mural_push_subscriptions s on s.id = o.subscription_id and s.user_id = o.recipient_id and s.active
     where o.attempts < 8
       and ((o.status = 'pending' and o.available_at <= now()) or (o.status = 'claimed' and o.lease_until <= now()))
       and o.created_at > now()-interval '1 hour'
       and o.sender_id <> o.recipient_id
       and exists (select 1 from public.push_members pm where pm.user_id = o.recipient_id)
       and public._mural_push_uid_member(o.recipient_id)
       and exists (select 1 from public.push_members pm where pm.user_id = o.sender_id)
       and public._mural_push_uid_member(o.sender_id)
     order by o.available_at, o.created_at
     for update of o skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 50))
  loop
    v_token := gen_random_uuid();
    update public.mural_push_outbox o set status='claimed', lease_until=now()+interval '90 seconds', lease_token=v_token,
      attempts=o.attempts+1 where o.id=r.id;
    outbox_id := r.id; lease_token := v_token; subscription_id := r.subscription_id;
    endpoint := r.endpoint; p256dh := r.p256dh; auth_key := r.auth_key;
    return next;
  end loop;
end $$;

-- Revalida imediatamente antes do envio; revoke membership/unsubscribe após claim cancela a entrega.
create or replace function public.mural_push_delivery(p_outbox_id uuid, p_lease_token uuid)
returns table (endpoint text, p256dh text, auth_key text)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  return query
    select s.endpoint, s.p256dh, s.auth_key
      from public.mural_push_outbox o
      join public.mural_push_subscriptions s on s.id=o.subscription_id and s.user_id=o.recipient_id and s.active
     where o.id=p_outbox_id and o.status='claimed' and o.lease_token=p_lease_token and o.lease_until>now()
       and o.sender_id <> o.recipient_id
       and exists (select 1 from public.push_members pm where pm.user_id=o.recipient_id)
       and public._mural_push_uid_member(o.recipient_id)
       and exists (select 1 from public.push_members pm where pm.user_id=o.sender_id)
       and public._mural_push_uid_member(o.sender_id);
  if not found then
    update public.mural_push_outbox set status='dead', lease_until=null, lease_token=null,
      last_error='suppressed: sender/recipient no longer authorized or subscription inactive'
      where id=p_outbox_id and status='claimed' and lease_token=p_lease_token;
  end if;
end $$;

-- result: sent | retry | gone | suppressed. Error string is bounded and contains no payload.
create or replace function public.mural_push_finish(p_outbox_id uuid, p_lease_token uuid, p_result text, p_error text default null)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_sub uuid; v_attempts integer;
begin
  if p_result is null or p_result not in ('sent','retry','gone','suppressed') then raise exception 'invalid result'; end if;
  select subscription_id, attempts into v_sub, v_attempts from public.mural_push_outbox
   where id=p_outbox_id and status='claimed' and lease_token=p_lease_token for update;
  if not found then return; end if;
  if p_result='sent' then
    update public.mural_push_outbox set status='sent', sent_at=now(), lease_until=null, lease_token=null, last_error=null where id=p_outbox_id;
  elsif p_result='gone' then
    update public.mural_push_subscriptions set active=false, endpoint=null, p256dh=null, auth_key=null, updated_at=now() where id=v_sub;
    update public.mural_push_outbox set status='dead', lease_until=null, lease_token=null, last_error='subscription expired (404/410)' where id=p_outbox_id;
  elsif p_result='suppressed' then
    update public.mural_push_outbox set status='dead', lease_until=null, lease_token=null, last_error='suppressed' where id=p_outbox_id;
  elsif v_attempts >= 8 then
    update public.mural_push_outbox set status='dead', lease_until=null, lease_token=null, last_error=left(coalesce(p_error,'delivery failed'),500) where id=p_outbox_id;
  else
    update public.mural_push_outbox set status='pending', available_at=now()+make_interval(secs => least(21600, 30 * (2 ^ greatest(v_attempts-1,0))::integer)),
      lease_until=null, lease_token=null, last_error=left(coalesce(p_error,'delivery failed'),500) where id=p_outbox_id;
  end if;
end $$;

revoke all on function public.mural_push_claim(integer), public.mural_push_delivery(uuid,uuid), public.mural_push_finish(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.mural_push_claim(integer), public.mural_push_delivery(uuid,uuid), public.mural_push_finish(uuid,uuid,text,text) to service_role;
