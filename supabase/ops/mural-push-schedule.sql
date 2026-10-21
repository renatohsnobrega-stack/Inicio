-- Operação administrativa: executar só na ativação aprovada, após migração,
-- VAPID/secrets, Edge Function e Vault mural_push_dispatch_secret preparados.
-- Não contém valores secretos. Não altera registros domésticos.
-- Usa HTTP síncrono: não persiste Authorization em net.http_request_queue.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists http with schema extensions;

create or replace function public._mural_push_dispatch_tick()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, extensions, vault
as $$
declare
  v_secret text;
  v_response extensions.http_response;
begin
  select decrypted_secret into strict v_secret
    from vault.decrypted_secrets where name = 'mural_push_dispatch_secret';
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '55000');
  select * into v_response from extensions.http((
    'POST',
    'https://qsbrlqxuyjqrpaoalfon.supabase.co/functions/v1/mural-push',
    array[extensions.http_header('Authorization', 'Bearer ' || v_secret)],
    'application/json',
    '{}'
  )::extensions.http_request);
  if v_response.status <> 200 then
    raise exception 'Mural dispatcher HTTP %', v_response.status;
  end if;
  return v_response.content::jsonb;
end $$;
revoke all on function public._mural_push_dispatch_tick() from public, anon, authenticated, service_role;

select cron.schedule(
  'mural-push-every-minute',
  '* * * * *',
  'select public._mural_push_dispatch_tick();'
);
select cron.alter_job(jobid, active := true)
  from cron.job where jobname = 'mural-push-every-minute';
