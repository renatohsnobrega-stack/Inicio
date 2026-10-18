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
