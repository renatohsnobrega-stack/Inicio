import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { banco, q, erro } from './base.mjs';

const root = new URL('../../', import.meta.url);
const db = await banco(new URL('supabase/schema.sql', root));
await db.exec(`
  create table auth.users(id uuid primary key);
  create table public.push_members(user_id uuid primary key references auth.users(id), nome text not null);
  alter table public.push_members enable row level security;
  revoke all on public.push_members from public, anon, authenticated;
  insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
  insert into public.push_members values
    ('00000000-0000-0000-0000-000000000001', 'Renato'),
    ('00000000-0000-0000-0000-000000000002', 'Vanessa'),
    ('00000000-0000-0000-0000-000000000003', 'Visitante');
`);
const migration = fs.readFileSync(new URL('supabase/migrations/202610210002_account_profile.sql', root), 'utf8');
await db.exec(migration);
await db.exec(migration);
const as = (id, email) => `set role authenticated; set request.jwt.claims = '${JSON.stringify({ sub: `00000000-0000-0000-0000-00000000000${id}`, email })}';`;

test('cada login recebe só o próprio nome e não aceita parâmetro de outra conta', async () => {
  assert.deepEqual(await q(db, as(1, 'renato@x.com'), 'select public.current_member_profile() as nome'), [{ nome: 'Renato' }]);
  assert.deepEqual(await q(db, as(2, 'vanessa@x.com'), 'select public.current_member_profile() as nome'), [{ nome: 'Vanessa' }]);
  assert.match(await erro(db, as(2, 'vanessa@x.com'), "select public.current_member_profile('00000000-0000-0000-0000-000000000001')"), /does not exist/);
  assert.match(await erro(db, as(2, 'vanessa@x.com'), 'select * from public.push_members'), /permission denied/);
});
test('anônimo não pode executar e conta não membro não recebe perfil', async () => {
  assert.match(await erro(db, 'set role anon;', 'select public.current_member_profile()'), /permission denied/);
  assert.deepEqual(await q(db, as(3, 'visitante@x.com'), 'select public.current_member_profile() as nome'), [{ nome: null }]);
});
test('ausência de vínculo ou de sessão retorna null', async () => {
  assert.deepEqual(await q(db, as(4, 'renato@x.com'), 'select public.current_member_profile() as nome'), [{ nome: null }]);
  assert.deepEqual(await q(db, "set role authenticated; set request.jwt.claims = '{}';", 'select public.current_member_profile() as nome'), [{ nome: null }]);
});
process.on('beforeExit', async () => { await db.close(); });
