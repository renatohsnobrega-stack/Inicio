-- Casa Organizada — banco de dados no Supabase.
-- Cole tudo no "SQL Editor" do seu projeto Supabase e clique em "Run".
-- ANTES, troque os dois e-mails abaixo pelos de vocês.

-- 1) Quem pode acessar (só estes e-mails conseguem ler/gravar).
create table if not exists public.membros (
  email text primary key
);
alter table public.membros enable row level security; -- sem políticas: ninguém lê pelo app

insert into public.membros (email) values
  ('seu-email@exemplo.com'),
  ('email-da-esposa@exemplo.com')
on conflict do nothing;

create or replace function public.is_membro()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membros
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2) Todos os dados do app (contas, remédios, tarefas…) ficam nesta tabela.
create table if not exists public.registros (
  kind       text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by uuid        default auth.uid(),
  primary key (kind, id)
);

create or replace function public.registros_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists registros_touch on public.registros;
create trigger registros_touch before insert or update on public.registros
  for each row execute function public.registros_touch();

-- 3) Segurança: só membros autenticados.
alter table public.registros enable row level security;

drop policy if exists "membros leem" on public.registros;
drop policy if exists "membros inserem" on public.registros;
drop policy if exists "membros alteram" on public.registros;
drop policy if exists "membros apagam" on public.registros;

create policy "membros leem"    on public.registros for select to authenticated using (public.is_membro());
create policy "membros inserem" on public.registros for insert to authenticated with check (public.is_membro());
create policy "membros alteram" on public.registros for update to authenticated using (public.is_membro()) with check (public.is_membro());
create policy "membros apagam"  on public.registros for delete to authenticated using (public.is_membro());

-- 4) Tempo real: quando um altera, a tela do outro atualiza sozinha.
do $$
begin
  alter publication supabase_realtime add table public.registros;
exception when duplicate_object then null;
end $$;

-- =====================================================================
-- 5) AUTOMAÇÃO: acesso para agentes de IA (Claude, Gemini, Manus, n8n…)
--    Os agentes usam uma CHAVE criada no app (Automação → Chaves de acesso).
--    A chave fica guardada só como hash; pode ser revogada a qualquer momento.
--    Este arquivo pode ser executado de novo sem perder dados.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.chaves_api (
  id         uuid        primary key default gen_random_uuid(),
  nome       text        not null,
  hash       text        not null unique,
  prefixo    text        not null,
  criada_em  timestamptz not null default now(),
  ultimo_uso timestamptz,
  revogada   boolean     not null default false
);
alter table public.chaves_api enable row level security; -- sem políticas: só pelas funções abaixo
-- Escopo da chave: tipos = null → todos os tipos; ex.: {conta} → só contas a pagar.
alter table public.chaves_api add column if not exists tipos text[];
alter table public.chaves_api add column if not exists pode_remover boolean not null default true;

create or replace function public._hash_chave(p text)
returns text language sql immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex') $$;

-- Devolve a chave (com o escopo) se for válida; null se não existir ou estiver revogada.
create or replace function public._chave(p_chave text)
returns public.chaves_api language plpgsql security definer
set search_path = public, extensions
as $$
declare v public.chaves_api;
begin
  select c.* into v from public.chaves_api c
   where c.hash = public._hash_chave(p_chave) and not c.revogada;
  if v.id is null then
    raise exception 'chave inválida ou revogada' using errcode = '28000';
  end if;
  update public.chaves_api set ultimo_uso = now() where id = v.id;
  return v;
end $$;

-- Garante que a chave pode usar o tipo pedido.
create or replace function public._chave_permite(v public.chaves_api, p_kind text)
returns void language plpgsql immutable
as $$
begin
  if v.tipos is not null and not (p_kind = any (v.tipos)) then
    raise exception 'esta chave só tem acesso a: %', array_to_string(v.tipos, ', ') using errcode = '42501';
  end if;
end $$;

create or replace function public._chave_ok(p_chave text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._chave(p_chave);
  return true;
exception when sqlstate '28000' then
  return false;
end $$;

-- Gerenciamento das chaves (só vocês, logados no app)
-- p_tipos: null = acesso a tudo; ex.: array['conta'] = só contas a pagar.
drop function if exists public.criar_chave_api(text);
create or replace function public.criar_chave_api(p_nome text, p_tipos text[] default null, p_pode_remover boolean default true)
returns text language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_chave text;
  v_validos text[] := array['conta','remedio','evento','tarefa','refeicao','recado','lista','item','contato'];
begin
  if not public.is_membro() then raise exception 'acesso negado'; end if;
  if p_tipos is not null and cardinality(p_tipos) = 0 then p_tipos := null; end if;
  if p_tipos is not null and not (p_tipos <@ v_validos) then
    raise exception 'tipos inválidos (use: %)', array_to_string(v_validos, ', ');
  end if;
  v_chave := 'casa_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.chaves_api (nome, hash, prefixo, tipos, pode_remover)
  values (coalesce(nullif(trim(p_nome), ''), 'Agente'), public._hash_chave(v_chave), left(v_chave, 13),
          p_tipos, coalesce(p_pode_remover, true));
  return v_chave; -- mostrada uma única vez
end $$;

drop function if exists public.listar_chaves_api();
create or replace function public.listar_chaves_api()
returns table (id uuid, nome text, prefixo text, criada_em timestamptz, ultimo_uso timestamptz, revogada boolean,
               tipos text[], pode_remover boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_membro() then raise exception 'acesso negado'; end if;
  return query select c.id, c.nome, c.prefixo, c.criada_em, c.ultimo_uso, c.revogada, c.tipos, c.pode_remover
                 from public.chaves_api c order by c.criada_em desc;
end $$;

create or replace function public.revogar_chave_api(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_membro() then raise exception 'acesso negado'; end if;
  update public.chaves_api set revogada = true where id = p_id;
end $$;

-- API dos agentes ---------------------------------------------------------
-- POST /rest/v1/rpc/agente_salvar  { "chave": "...", "registros": [ { "tipo": "conta", "id": "opcional", "dados": { … } } ] }
-- Se "id" se repetir, o registro é ATUALIZADO (os campos enviados são mesclados) — use ids estáveis,
-- ex.: "gmail-<id da mensagem>" ou "gcal-<id do evento>", para rodar a automação várias vezes sem duplicar.
create or replace function public.agente_salvar(chave text, registros jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  r       jsonb;
  v_kind  text;
  v_id    text;
  v_data  jsonb;
  v_lista text;
  v_out   jsonb := '[]'::jsonb;
  v_kinds text[] := array['conta','remedio','evento','tarefa','refeicao','recado','lista','item','contato'];
  v_c     public.chaves_api := public._chave(chave);
begin
  if jsonb_typeof(registros) = 'object' then registros := jsonb_build_array(registros); end if;
  if jsonb_typeof(registros) is distinct from 'array' then raise exception '"registros" deve ser uma lista'; end if;
  if jsonb_array_length(registros) > 500 then raise exception 'máximo de 500 registros por chamada'; end if;

  for r in select value from jsonb_array_elements(registros) loop
    v_kind := coalesce(r->>'tipo', r->>'kind');
    v_data := coalesce(r->'dados', r->'data', '{}'::jsonb);
    if v_kind is null or not (v_kind = any (v_kinds)) then
      raise exception 'tipo inválido: % (use: %)', coalesce(v_kind, '(vazio)'), array_to_string(v_kinds, ', ');
    end if;
    perform public._chave_permite(v_c, v_kind);
    if jsonb_typeof(v_data) <> 'object' then raise exception '"dados" deve ser um objeto'; end if;

    -- Item de lista: aceita o nome da lista e cria a lista se precisar.
    if v_kind = 'item' and coalesce(v_data->>'lista', '') = '' and coalesce(v_data->>'lista_nome', '') <> '' then
      select t.id into v_lista from public.registros t
       where t.kind = 'lista' and lower(t.data->>'nome') = lower(v_data->>'lista_nome') limit 1;
      if v_lista is null then
        v_lista := gen_random_uuid()::text;
        insert into public.registros (kind, id, data)
        values ('lista', v_lista, jsonb_build_object('id', v_lista, 'nome', v_data->>'lista_nome', 'icone', '📝', 'criadaEm', now()));
      end if;
      v_data := (v_data - 'lista_nome') || jsonb_build_object('lista', v_lista);
    end if;
    v_lista := null;

    v_id := coalesce(nullif(r->>'id', ''), nullif(v_data->>'id', ''), case v_kind
      when 'conta'    then 'auto-' || md5(lower(coalesce(v_data->>'nome', '')) || '|' || coalesce(v_data->>'data', v_data->>'dia', ''))
      when 'remedio'  then 'auto-' || md5(lower(coalesce(v_data->>'nome', '')) || '|' || lower(coalesce(v_data->>'pessoa', '')))
      when 'evento'   then 'auto-' || md5(lower(coalesce(v_data->>'titulo', '')) || '|' || coalesce(v_data->>'data', '') || '|' || coalesce(v_data->>'hora', ''))
      when 'tarefa'   then 'auto-' || md5(lower(coalesce(v_data->>'titulo', '')))
      when 'contato'  then 'auto-' || md5(lower(coalesce(v_data->>'nome', '')))
      when 'refeicao' then coalesce(nullif(v_data->>'dia', ''), '?') || '-' || coalesce(nullif(v_data->>'refeicao', ''), '?')
      else gen_random_uuid()::text end);

    v_data := jsonb_build_object('origem', 'agente', 'revisado', false, 'criadoEm', now())
              || v_data || jsonb_build_object('id', v_id);

    insert into public.registros as t (kind, id, data) values (v_kind, v_id, v_data)
    on conflict (kind, id) do update
      set data = t.data || (excluded.data - 'revisado' - 'criadoEm');

    v_out := v_out || jsonb_build_object('tipo', v_kind, 'id', v_id);
  end loop;
  return jsonb_build_object('ok', true, 'salvos', v_out);
end $$;

-- POST /rest/v1/rpc/agente_listar  { "chave": "...", "tipo": "conta" (opcional), "desde": "2026-10-01" (opcional) }
-- Sem "tipo", devolve tudo menos "dose" (remédios tomados) e "config"; esses dois vêm quando pedidos pelo tipo.
create or replace function public.agente_listar(chave text, tipo text default null, desde timestamptz default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_c public.chaves_api := public._chave(chave);
begin
  if agente_listar.tipo is not null then perform public._chave_permite(v_c, agente_listar.tipo); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('tipo', t.kind, 'id', t.id, 'dados', t.data, 'atualizado_em', t.updated_at)
                     order by t.kind, t.id)
      from public.registros t
     -- doses tomadas e configurações só vêm quando pedidas pelo tipo
     where (case when agente_listar.tipo is null then t.kind not in ('dose', 'config')
                 else t.kind = agente_listar.tipo end)
       and (agente_listar.desde is null or t.updated_at >= agente_listar.desde)
       and (v_c.tipos is null or t.kind = any (v_c.tipos))
  ), '[]'::jsonb);
end $$;

-- POST /rest/v1/rpc/agente_remover  { "chave": "...", "tipo": "conta", "id": "..." }
create or replace function public.agente_remover(chave text, tipo text, id text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  n   int;
  v_c public.chaves_api := public._chave(chave);
begin
  perform public._chave_permite(v_c, agente_remover.tipo);
  if not v_c.pode_remover then raise exception 'esta chave não pode remover registros' using errcode = '42501'; end if;
  delete from public.registros t where t.kind = agente_remover.tipo and t.id = agente_remover.id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removidos', n);
end $$;

-- POST /rest/v1/rpc/agente_pagar  { "chave": "...", "id": "<id da conta>", "mes": "2026-10", "data": "2026-10-09", "valor": 287.45 }
-- Marca a conta como paga naquele mês (o mês do vencimento). "data" e "valor" são opcionais
-- (padrão: hoje e o valor cadastrado). Não mexe nos pagamentos de outros meses.
create or replace function public.agente_pagar(chave text, id text, mes text, data date default null, valor numeric default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_c public.chaves_api := public._chave(chave);
  n   int;
begin
  perform public._chave_permite(v_c, 'conta');
  if mes is null or mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception '"mes" deve ser AAAA-MM'; end if;
  update public.registros t
     set data = t.data || jsonb_build_object('pagos',
           coalesce(t.data->'pagos', '{}'::jsonb) || jsonb_build_object(agente_pagar.mes, jsonb_build_object(
             'data', to_char(coalesce(agente_pagar.data, current_date), 'YYYY-MM-DD'),
             'valor', coalesce(agente_pagar.valor, (t.data->>'valor')::numeric, 0),
             'por', 'agente')))
   where t.kind = 'conta' and t.id = agente_pagar.id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'conta não encontrada: %', agente_pagar.id; end if;
  return jsonb_build_object('ok', true, 'id', agente_pagar.id, 'mes', agente_pagar.mes);
end $$;

-- Permissões: funções internas fechadas; API dos agentes aberta só para quem tem a chave.
revoke all on function public._hash_chave(text) from public, anon, authenticated;
revoke all on function public._chave(text) from public, anon, authenticated;
revoke all on function public._chave_permite(public.chaves_api, text) from public, anon, authenticated;
revoke all on function public._chave_ok(text) from public, anon, authenticated;
revoke all on function public.criar_chave_api(text, text[], boolean) from public, anon;
revoke all on function public.listar_chaves_api() from public, anon;
revoke all on function public.revogar_chave_api(uuid) from public, anon;
grant execute on function public.criar_chave_api(text, text[], boolean), public.listar_chaves_api(),
  public.revogar_chave_api(uuid) to authenticated;
grant execute on function public.agente_salvar(text, jsonb), public.agente_listar(text, text, timestamptz),
  public.agente_remover(text, text, text), public.agente_pagar(text, text, text, date, numeric) to anon, authenticated;

-- Avisa a API do Supabase que as funções mudaram.
notify pgrst, 'reload schema';
