import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { banco, q, erro, comoAnon } from './base.mjs';

const schema = process.argv[2];
const migration = process.argv[3];
const db = await banco(schema);
await db.exec(`
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (bucket_id text not null, name text not null, primary key(bucket_id,name));
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to anon, authenticated;
  create function storage.foldername(p_name text) returns text[] language sql immutable
    as $$ select string_to_array(p_name, '/') $$;
`);
const migrationSql = fs.readFileSync(migration, 'utf8');
await db.exec(migrationSql);
await db.exec(migrationSql); // Reexecução segura: bucket, funções e políticas são idempotentes.

const authAs = email => `set role authenticated; set request.jwt.claims = '${JSON.stringify({ email, sub: '10000000-0000-0000-0000-000000000001' })}';`;
const membro = authAs('renato@x.com');
const intruso = authAs('intruso@x.com');
const compra = (id, sourceIds = ['item-1']) => ({
  id, lista: 'mercado', listaNome: 'Mercado', data: '2026-10-22', loja: 'Mercadinho', total: 9.5,
  itens: sourceIds.map((itemId, i) => ({ itemId, texto: `Produto ${i + 1}`, quantidade: 1, unidade: '', preco: 9.5 })),
  criadoEm: '2026-10-22T12:00:00.000Z',
});
const item = (id, texto = 'Produto 1') => ({ id, texto, lista: 'mercado', feito: true, criadoEm: '2026-10-22T11:00:00.000Z' });
const source = value => [{ id: value.id, snapshot: value }];
const savePurchase = (pre, data, snapshots) => q(db, pre,
  `select public.finalize_purchase($1::jsonb,$2::jsonb) as saved`, [JSON.stringify(data), JSON.stringify(snapshots)]);

await db.query(`insert into public.registros(kind,id,data) values ('item','item-1',$1::jsonb)`, [JSON.stringify(item('item-1'))]);

test('purchase RPC grants are member-only, and anon/non-member cannot finalize', async () => {
  const anonError = await erro(db, comoAnon, `select public.finalize_purchase('{}'::jsonb,'[]'::jsonb)`);
  assert.match(anonError || '', /permission denied|execute/i);
  const memberError = await erro(db, intruso, `select public.finalize_purchase('{}'::jsonb,'[]'::jsonb)`);
  assert.match(memberError || '', /Acesso negado/);
  assert.deepEqual(await q(db, intruso, `select id from public.registros where kind='compra'`), []);
});

test('finalization inserts one purchase and deletes only matching snapshots; retry is idempotent', async () => {
  const p = compra('purchase-1');
  const saved = await savePurchase(membro, p, source(item('item-1')));
  assert.equal(saved[0].saved.id, 'purchase-1');
  const retry = await savePurchase(membro, p, source(item('item-1')));
  assert.equal(retry[0].saved.id, 'purchase-1');
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='item' and id='item-1'`), []);
  const [{ n }] = await q(db, membro, `select count(*)::int n from public.registros where kind='compra' and id='purchase-1'`);
  assert.equal(n, 1);
  const collision = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify({ ...p, total: 100 }), JSON.stringify(source(item('item-1')))]);
  assert.match(collision || '', /dados diferentes/);
});

test('legacy item JSON without generated id, createdAt, or feito compares to its raw database snapshot', async () => {
  const legacy = { texto: 'Feijão', lista: 'mercado' };
  await db.query(`insert into public.registros(kind,id,data) values ('item','legacy-item',$1::jsonb)`, [JSON.stringify(legacy)]);
  const result = await savePurchase(membro, compra('purchase-legacy', ['legacy-item']), [{ id: 'legacy-item', snapshot: legacy }]);
  assert.equal(result[0].saved.id, 'purchase-legacy');
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='item' and id='legacy-item'`), []);
});

test('reviewed receipt standalone import with no sources saves purchase and keeps list snapshots', async () => {
  const pending = { ...item('pending-standalone', 'Feijão'), feito: false };
  await db.query(`insert into public.registros(kind,id,data) values ('item',$1,$2::jsonb)`, [pending.id, JSON.stringify(pending)]);
  const syntheticId = 'nota-12345678-1234-1234-1234-123456789abc';
  const p = { ...compra('receipt-standalone', [syntheticId]), origem: 'nota-revisada' };
  const saved = await savePurchase(membro, p, []);
  assert.equal(saved[0].saved.id, p.id);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='item' and id=$1`, [pending.id]), [{ id: pending.id }]);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='compra' and id=$1`, [p.id]), [{ id: p.id }]);
});

test('reviewed receipt linked subset deletes only linked snapshots, even when pending', async () => {
  const pending = { ...item('receipt-linked', 'Leite'), feito: false };
  const keep = item('receipt-unrelated', 'Pão');
  await db.query(`insert into public.registros(kind,id,data) values ('item',$1,$2::jsonb),('item',$3,$4::jsonb)`,
    [pending.id, JSON.stringify(pending), keep.id, JSON.stringify(keep)]);
  const syntheticId = 'nota-22345678-1234-1234-1234-123456789abc';
  const p = { ...compra('receipt-subset', [pending.id, syntheticId]), origem: 'nota-revisada' };
  const saved = await savePurchase(membro, p, source(pending));
  assert.equal(saved[0].saved.id, p.id);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='item' and id in ($1,$2) order by id`, [pending.id, keep.id]), [{ id: keep.id }]);
});

test('receipt source conflict, mismatched IDs and missing synthetic IDs abort without partial writes; manual mode stays strict', async () => {
  const current = item('receipt-stale', 'Leite');
  const stale = { ...current, texto: 'Versão antiga' };
  await db.query(`insert into public.registros(kind,id,data) values ('item',$1,$2::jsonb)`, [current.id, JSON.stringify(current)]);
  const synthetic = 'nota-32345678-1234-1234-1234-123456789abc';
  const receipt = { ...compra('receipt-stale-purchase', [current.id, synthetic]), origem: 'nota-revisada' };
  const staleError = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify(receipt), JSON.stringify(source(stale))]);
  assert.match(staleError || '', /mudou desde a seleção/);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='compra' and id=$1`, [receipt.id]), []);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='item' and id=$1`, [current.id]), [{ id: current.id }]);

  const mismatched = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify({ ...receipt, id: 'receipt-id-mismatch' }), JSON.stringify([{ id: current.id, snapshot: { ...current, id: 'different-item' } }])]);
  assert.match(mismatched || '', /ids.*coincidir/);
  const noSynthetic = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify({ ...receipt, id: 'receipt-no-synthetic', itens: [{ itemId: 'unlinked-real-id', texto: 'Produto' }] }), '[]']);
  assert.match(noSynthetic || '', /sintético/);
  const manualMismatch = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify(compra('manual-empty-sources')), '[]']);
  assert.match(manualMismatch || '', /exatamente os itens selecionados/);
});

test('a stale source aborts the whole transaction without partial purchase or item deletion', async () => {
  const originalA = item('item-a', 'A');
  const originalB = item('item-b', 'B');
  await db.query(`insert into public.registros(kind,id,data) values ('item','item-a',$1::jsonb),('item','item-b',$2::jsonb)`, [JSON.stringify(originalA), JSON.stringify(originalB)]);
  const staleB = { ...originalB, texto: 'B antes da alteração' };
  await db.query(`update public.registros set data=$1::jsonb where kind='item' and id='item-b'`, [JSON.stringify({ ...originalB, texto: 'B alterado' })]);
  const p = compra('purchase-stale', ['item-a', 'item-b']);
  const snapshots = [originalA, staleB].map(x => ({ id: x.id, snapshot: x }));
  const error = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`, [JSON.stringify(p), JSON.stringify(snapshots)]);
  assert.match(error || '', /mudou desde a seleção/);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='item' and id in ('item-a','item-b') order by id`), [{ id: 'item-a' }, { id: 'item-b' }]);
  assert.deepEqual(await q(db, membro, `select id from public.registros where kind='compra' and id='purchase-stale'`), []);
});

test('purchase payload must match the selected source ids, list and marked state', async () => {
  const extra = item('item-extra');
  await db.query(`insert into public.registros(kind,id,data) values ('item','item-extra',$1::jsonb)`, [JSON.stringify(extra)]);
  const mismatched = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify(compra('purchase-missing-source', ['other'])), JSON.stringify(source(extra))]);
  assert.match(mismatched || '', /corresponder a exatamente uma linha/);
  const wrongList = { ...extra, lista: 'outra' };
  const mismatchList = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify(compra('purchase-wrong-list', ['item-extra'])), JSON.stringify(source(wrongList))]);
  assert.match(mismatchList || '', /não pertence à lista/);
  const unmarked = { ...extra, feito: false };
  const notMarked = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify(compra('purchase-unmarked', ['item-extra'])), JSON.stringify(source(unmarked))]);
  assert.match(notMarked || '', /não está marcado/);
  const repeated = await erro(db, membro, `select public.finalize_purchase($1::jsonb,$2::jsonb)`,
    [JSON.stringify(compra('purchase-repeated', ['item-extra', 'phantom'])), JSON.stringify([...source(extra), ...source(extra)])]);
  assert.match(repeated || '', /fontes repetidas/);
});

test('receipt attach accepts only an uploaded private object and never overwrites existing metadata', async () => {
  const p = compra('purchase-note', []);
  // The purchase itself has no source rows only for test setup; use a direct owner insert to isolate receipt RPC.
  await db.query(`insert into public.registros(kind,id,data) values ('compra','purchase-note',$1::jsonb)`, [JSON.stringify(p)]);
  const path = 'familia/purchase-note/12345678-1234-1234-1234-123456789abc.pdf';
  await q(db, membro, `insert into storage.objects(bucket_id,name) values ('notas-compras',$1) returning name`, [path]);
  const metadata = { path, nome: 'recibo.pdf', type: 'application/pdf', size: 100 };
  const attached = await q(db, membro, `select public.attach_purchase_receipt('purchase-note',$1::jsonb) as data`, [JSON.stringify(metadata)]);
  assert.deepEqual(attached[0].data.nota, metadata);
  assert.match(await erro(db, membro, `select public.attach_purchase_receipt('purchase-note',$1::jsonb)`, [JSON.stringify(metadata)]) || '', /já tem uma nota/);
  await db.query(`insert into public.registros(kind,id,data) values ('compra','purchase-no-object',$1::jsonb)`, [JSON.stringify(compra('purchase-no-object', []))]);
  const missing = await erro(db, membro, `select public.attach_purchase_receipt('purchase-no-object',$1::jsonb)`,
    [JSON.stringify({ ...metadata, path: 'familia/purchase-no-object/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf' })]);
  assert.match(missing || '', /não foi encontrado/);
});

test('storage RLS limits select/insert/delete to authenticated members and familia prefix', async () => {
  const allowed = 'familia/purchase-note/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf';
  await q(db, membro, `insert into storage.objects(bucket_id,name) values ('notas-compras',$1) returning name`, [allowed]);
  assert.deepEqual(await q(db, membro, `select name from storage.objects where name=$1`, [allowed]), [{ name: allowed }]);
  const noPrefix = await erro(db, membro, `insert into storage.objects(bucket_id,name) values ('notas-compras','other/file.pdf')`);
  assert.match(noPrefix || '', /row-level security|policy/i);
  const wrongBucket = await erro(db, membro, `insert into storage.objects(bucket_id,name) values ('another-bucket',$1)`, [allowed]);
  assert.match(wrongBucket || '', /row-level security|policy/i);
  for (const pre of [comoAnon, intruso]) {
    assert.deepEqual(await q(db, pre, `select name from storage.objects where name=$1`, [allowed]), []);
    const denied = await erro(db, pre, `insert into storage.objects(bucket_id,name) values ('notas-compras',$1)`, [allowed]);
    assert.match(denied || '', /row-level security|permission denied|policy/i);
    assert.deepEqual(await q(db, pre, `delete from storage.objects where name=$1 returning name`, [allowed]), []);
  }
  assert.deepEqual(await q(db, membro, `delete from storage.objects where name=$1 returning name`, [allowed]), [{ name: allowed }]);
  const [{ public: isPublic, file_size_limit: maxSize, allowed_mime_types: types }] = await q(db, '', `select public,file_size_limit,allowed_mime_types from storage.buckets where id='notas-compras'`);
  assert.equal(isPublic, false);
  assert.equal(Number(maxSize), 8388608);
  assert.deepEqual(types, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
});

test('finish PGlite', async () => { await db.close(); });
