-- Identificação pessoal da conta para o painel; não altera as permissões dos dados familiares.
-- Reutiliza o vínculo de usuário/nome já cadastrado para as notificações.
-- Aplicar antes de publicar a correção do frontend.
begin;

create or replace function public.current_member_profile()
returns text
language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select pm.nome
  from public.push_members pm
  where pm.user_id = auth.uid()
    and public.is_membro()
$$;

revoke all on function public.current_member_profile() from public, anon;
grant execute on function public.current_member_profile() to authenticated;

commit;
