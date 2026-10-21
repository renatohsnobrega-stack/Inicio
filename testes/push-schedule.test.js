// Sem rede ou envio de notificações. Verificações do contrato do SQL de operação.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/ops/mural-push-schedule.sql', 'utf8');
const code = sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');

test('cron por minuto usa somente helper fixo, sem Bearer armazenado no comando', () => {
  assert.match(code, /cron\.schedule\(\s*'mural-push-every-minute',\s*'\* \* \* \* \*',\s*'select public\._mural_push_dispatch_tick\(\);'/);
  assert.match(code, /function public\._mural_push_dispatch_tick\(\)/);
  assert.match(code, /revoke all on function public\._mural_push_dispatch_tick\(\) from public, anon, authenticated, service_role/);
});

test('segredo vem do Vault em tempo de execução, URL é fixa e não há fila de headers', () => {
  assert.match(code, /from vault\.decrypted_secrets where name = 'mural_push_dispatch_secret'/);
  assert.match(code, /http_header\('Authorization', 'Bearer ' \|\| v_secret\)/);
  assert.match(code, /https:\/\/qsbrlqxuyjqrpaoalfon\.supabase\.co\/functions\/v1\/mural-push/);
  assert.doesNotMatch(code, /net\.http_post|http_request_queue|sbp_|SUPABASE_SERVICE_ROLE_KEY/);
});

test('timeout limitado, search_path seguro e falha HTTP não é tratada como sucesso', () => {
  assert.match(code, /set search_path = pg_catalog, extensions, vault/);
  assert.match(code, /CURLOPT_CONNECTTIMEOUT_MS', '5000'/);
  assert.match(code, /CURLOPT_TIMEOUT_MS', '55000'/);
  assert.match(code, /if v_response\.status <> 200 then/);
  assert.match(code, /raise exception 'Mural dispatcher HTTP %', v_response\.status/);
  assert.doesNotMatch(code, /raise[^;]*(v_secret|v_response\.content)/i);
});
