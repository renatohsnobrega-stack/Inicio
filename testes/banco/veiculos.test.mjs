// Regressões de veículos sobre o schema atual: RLS herdado de registros e API de agentes sem kinds de veículo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banco, q, erro, comoAnon } from './base.mjs';

const root = new URL('../../', import.meta.url);
const db = await banco(new URL('supabase/schema.sql', root));
const como = email => `set role authenticated; set request.jwt.claims = '${JSON.stringify({ email })}';`;
const renato = como('renato@x.com');
const vanessa = como('vanessa@x.com');
const intruso = como('intruso@x.com');
const arquivoFake = { id: 'anexo-crlv', nome: 'crlv.pdf', type: 'application/pdf', size: 12, dados: 'data:application/pdf;base64,JVBERi0xLjQ=' };
const seed = [
  { kind: 'veiculo', id: 'carro-familia', data: { id: 'carro-familia', nome: 'Carro da família', placa: 'ABC-1234' } },
  { kind: 'registro_veiculo', id: 'crlv-familia', data: { id: 'crlv-familia', veiculo: 'carro-familia', titulo: 'CRLV', anexos: [arquivoFake] } },
  { kind: 'conta', id: 'conta-teste', data: { id: 'conta-teste', nome: 'Luz' } },
];
await db.query('insert into public.registros(kind,id,data) select x.kind,x.id,x.data from jsonb_to_recordset($1::jsonb) as x(kind text,id text,data jsonb)', [JSON.stringify(seed)]);

test('Renato e Vanessa, como membros, compartilham veículos e registros com anexos', async () => {
  for (const pre of [renato, vanessa]) {
    const rows = await q(db, pre, `select kind,id,data from public.registros where kind in ('veiculo','registro_veiculo') order by kind`);
    assert.equal(rows.length, 2);
    const reg = rows.find(r => r.kind === 'registro_veiculo');
    assert.deepEqual(reg.data.anexos, [arquivoFake]);
  }

  await q(db, renato, `insert into public.registros(kind,id,data) values ('veiculo','moto-familia','{"id":"moto-familia","nome":"Moto"}')`);
  await q(db, vanessa, `update public.registros set data = data || '{"nome":"Carro atualizado por Vanessa"}'::jsonb where kind='veiculo' and id='carro-familia'`);
  const [{ data }] = await q(db, renato, `select data from public.registros where kind='veiculo' and id='carro-familia'`);
  assert.equal(data.nome, 'Carro atualizado por Vanessa');
  const removed = await q(db, vanessa, `delete from public.registros where kind='veiculo' and id='moto-familia' returning id`);
  assert.deepEqual(removed, [{ id: 'moto-familia' }]);
});

test('anon e usuário autenticado intruso não leem, gravam, editam nem apagam veículos/anexos', async () => {
  for (const pre of [comoAnon, intruso]) {
    const rows = await q(db, pre, `select kind,id from public.registros where kind in ('veiculo','registro_veiculo')`);
    assert.deepEqual(rows, []);
    const insertError = await erro(db, pre, `insert into public.registros(kind,id,data) values ('veiculo','nao-autorizado','{"nome":"x"}')`);
    assert.match(insertError || '', /row-level security|permission denied/i);
    assert.deepEqual(await q(db, pre, `update public.registros set data='{"titulo":"alterado"}'::jsonb where kind='registro_veiculo' and id='crlv-familia' returning id`), []);
    assert.deepEqual(await q(db, pre, `delete from public.registros where kind='registro_veiculo' and id='crlv-familia' returning id`), []);
  }
  const [{ data }] = await q(db, '', `select data from public.registros where kind='registro_veiculo' and id='crlv-familia'`);
  assert.equal(data.titulo, 'CRLV');
  assert.deepEqual(data.anexos, [arquivoFake]);
  const [{ n }] = await q(db, '', `select count(*)::int as n from public.registros where id='nao-autorizado'`);
  assert.equal(n, 0);
});

test('API de agentes: chave restrita a contas não vê veículo/anexo; chave total herdada os vê', async () => {
  const [{ k: total }] = await q(db, renato, `select public.criar_chave_api('Total veículos') as k`);
  const [{ k: contas }] = await q(db, renato, `select public.criar_chave_api('Só contas', array['conta'], false) as k`);

  const [{ l: limitado }] = await q(db, comoAnon, `select public.agente_listar($1) as l`, [contas]);
  assert.ok(limitado.length > 0 && limitado.every(row => row.tipo === 'conta'));
  assert.equal(limitado.some(row => ['veiculo', 'registro_veiculo'].includes(row.tipo)), false);
  assert.equal(JSON.stringify(limitado).includes(arquivoFake.dados), false, 'a chave de contas não recebe conteúdo do anexo');

  const [{ l: completo }] = await q(db, comoAnon, `select public.agente_listar($1) as l`, [total]);
  const carro = completo.find(row => row.tipo === 'veiculo' && row.id === 'carro-familia');
  const registro = completo.find(row => row.tipo === 'registro_veiculo' && row.id === 'crlv-familia');
  assert.ok(carro, 'chave total vê veículo: comportamento herdado do escopo null');
  assert.deepEqual(registro.dados.anexos, [arquivoFake], 'chave total também recebe o anexo no JSON do registro');
});

test('API de agentes recusa veiculo e registro_veiculo: MVP continua exclusivo da UI, sem migração de backend', async () => {
  const [{ k: total }] = await q(db, renato, `select public.criar_chave_api('Total sem veículos') as k`);
  for (const kind of ['veiculo', 'registro_veiculo']) {
    const payload = JSON.stringify([{ tipo: kind, id: `agente-${kind}`, dados: { nome: 'Tentativa', titulo: 'Tentativa', anexos: [arquivoFake] } }]);
    assert.match(await erro(db, comoAnon, `select public.agente_salvar($1, $2::jsonb)`, [total, payload]) || '', /tipo inválido/);
    const [{ n }] = await q(db, '', `select count(*)::int as n from public.registros where id=$1`, [`agente-${kind}`]);
    assert.equal(n, 0);
  }
});

test('finaliza PGlite', async () => {
  await db.close();
});
