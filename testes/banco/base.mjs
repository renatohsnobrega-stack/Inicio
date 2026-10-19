// Sobe um Postgres (PGlite) com o "esqueleto" do Supabase e aplica o schema do app.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
export async function banco(schemaPath) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema extensions;
    grant usage on schema public, extensions, auth to anon, authenticated;
    create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant execute on all functions in schema auth to anon, authenticated;
    create publication supabase_realtime;`);
  const sql = fs.readFileSync(schemaPath, 'utf8').replace('seu-email@exemplo.com', 'renato@x.com').replace('email-da-esposa@exemplo.com', 'vanessa@x.com');
  await db.exec(sql);
  await db.exec(sql); // precisa ser seguro rodar duas vezes
  await db.exec(`grant select, insert, update, delete on public.registros to anon, authenticated;`);
  return db;
}
export const comoMembro = `set role authenticated; set request.jwt.claims = '{"email":"renato@x.com"}';`;
export const comoAnon = `reset role; set role anon;`;
export async function q(db, pre, sql, params) {
  await db.exec('reset role;' + pre);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role;'); }
}
export async function erro(db, pre, sql, params) {
  try { await q(db, pre, sql, params); return null; } catch (e) { return e.message; }
}
