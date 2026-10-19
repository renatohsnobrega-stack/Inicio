// Testes de escopo das chaves e de pagamento (supabase/schema.sql).
import { banco, q, erro, comoMembro, comoAnon } from './base.mjs';
import assert from 'assert';
const ok = (c, m) => { assert.ok(c, m); console.log('✔ ' + m); };
const db = await banco(process.argv[2]);
const anon = (sql, p) => q(db, comoAnon, sql, p);
const anonErr = (sql, p) => erro(db, comoAnon, sql, p);

const [{ k: total }] = await q(db, comoMembro, `select public.criar_chave_api('Claude') k`);
const [{ k: pierre }] = await q(db, comoMembro, `select public.criar_chave_api('Pierre', array['conta'], false) k`);
ok(total && pierre, 'membro cria chave total (assinatura antiga) e chave só de contas');
ok(/tipos inválidos/.test(await erro(db, comoMembro, `select public.criar_chave_api('x', array['senha'])`)), 'tipo inexistente no escopo é recusado');
ok(/permission denied/.test(await anonErr(`select public.criar_chave_api('x', array['conta'], false)`)), 'anônimo não cria chave');
ok(/acesso negado/.test(await erro(db, `set role authenticated; set request.jwt.claims = '{"email":"intruso@x.com"}';`, `select public.criar_chave_api('x')`)), 'logado fora da lista não cria chave');

await anon(`select public.agente_salvar($1, $2::jsonb)`, [total, JSON.stringify([
  { tipo: 'remedio', id: 'r1', dados: { nome: 'Losartana', pessoa: 'Renato' } },
  { tipo: 'recado', id: 'm1', dados: { texto: 'privado' } },
  { tipo: 'conta', id: 'c1', dados: { nome: 'Internet', valor: 129.9, tipo: 'mensal', dia: 10, pagos: { '2026-09': { data: '2026-09-09', valor: 129.9 } } } },
])]);

const [{ r }] = await anon(`select public.agente_salvar($1, $2::jsonb) r`, [pierre, JSON.stringify([
  { tipo: 'conta', id: 'pierre-fatura-nubank-2026-10', dados: { nome: 'Fatura Nubank', valor: 1834.2, tipo: 'unica', data: '2026-10-25', origem: 'pierre' } }])]);
ok(r.ok, 'Pierre cria conta');
const [{ l }] = await anon(`select public.agente_listar($1) l`, [pierre]);
ok(l.length === 2 && l.every(x => x.tipo === 'conta'), 'Pierre lista e só enxerga contas (não vê remédio nem recado)');
ok(/só tem acesso a: conta/.test(await anonErr(`select public.agente_listar($1, 'remedio')`, [pierre])), 'Pierre pedindo remédios: recusado');
ok(/só tem acesso a: conta/.test(await anonErr(`select public.agente_salvar($1, '[{"tipo":"recado","dados":{"texto":"x"}}]'::jsonb)`, [pierre])), 'Pierre gravando recado: recusado');
ok(/não pode remover/.test(await anonErr(`select public.agente_remover($1, 'conta', 'c1')`, [pierre])), 'Pierre apagando conta: recusado');
await anon(`select public.agente_salvar($1, '[{"tipo":"conta","id":"pierre-fatura-nubank-2026-10","dados":{"valor":1901.55}}]'::jsonb)`, [pierre]);
const [{ data: fat }] = await q(db, '', `select data from registros where id='pierre-fatura-nubank-2026-10'`);
ok(fat.valor === 1901.55 && fat.nome === 'Fatura Nubank' && fat.revisado === false, 'Pierre edita o valor; resto preservado; continua "para revisar"');

await anon(`select public.agente_pagar($1, 'c1', '2026-10', '2026-10-09', 131.4)`, [pierre]);
const [{ data: c1 }] = await q(db, '', `select data from registros where id='c1'`);
ok(c1.pagos['2026-10'].valor === 131.4 && c1.pagos['2026-10'].data === '2026-10-09', 'Pierre marca outubro como pago, com data e valor');
ok(c1.pagos['2026-09'].valor === 129.9, 'pagamento de setembro ficou intacto');
await anon(`select public.agente_pagar($1, 'pierre-fatura-nubank-2026-10', '2026-10')`, [pierre]);
const [{ data: f2 }] = await q(db, '', `select data from registros where id='pierre-fatura-nubank-2026-10'`);
ok(f2.pagos['2026-10'].valor === 1901.55, 'sem informar valor, usa o valor cadastrado');
ok(/AAAA-MM/.test(await anonErr(`select public.agente_pagar($1, 'c1', 'outubro')`, [pierre])), 'mês em formato errado: recusado');
ok(/não encontrada/.test(await anonErr(`select public.agente_pagar($1, 'nao-existe', '2026-10')`, [pierre])), 'conta inexistente: erro claro');
ok(/chave inválida/.test(await anonErr(`select public.agente_pagar('casa_falsa', 'c1', '2026-10')`)), 'chave falsa não paga nada');

const [{ l: tudo }] = await anon(`select public.agente_listar($1) l`, [total]);
ok(tudo.some(x => x.tipo === 'remedio') && tudo.some(x => x.tipo === 'recado'), 'chave total continua vendo tudo (Google Agenda/Tarefas e MCP seguem funcionando)');
ok((await anon(`select public.agente_remover($1, 'recado', 'm1') r`, [total]))[0].r.removidos === 1, 'chave total continua podendo remover');

const chaves = await q(db, comoMembro, `select nome, tipos, pode_remover from public.listar_chaves_api()`);
ok(chaves.find(c => c.nome === 'Pierre').tipos.join() === 'conta' && chaves.find(c => c.nome === 'Pierre').pode_remover === false, 'lista de chaves mostra o escopo');
const [{ id }] = await q(db, '', `select id from chaves_api where nome='Pierre'`);
await q(db, comoMembro, `select public.revogar_chave_api($1)`, [id]);
ok(/chave inválida/.test(await anonErr(`select public.agente_listar($1)`, [pierre])), 'chave do Pierre revogada para de funcionar');
ok(/permission denied/.test(await anonErr(`select public._chave('x')`)), 'função interna _chave fechada para anônimos');
ok((await anon(`select count(*)::int n from registros`))[0].n === 0, 'anônimo continua sem ler a tabela direto (RLS)');

// ---------- Dados dos filhos: só chaves "Total + filhos" ----------
const [{ k: manus }] = await q(db, comoMembro, `select public.criar_chave_api('Manus', null, true, true) k`);
ok(/só com acesso total/.test(await erro(db, comoMembro, `select public.criar_chave_api('x', array['conta'], false, true)`)), 'filhos com chave restrita: recusado');
const filhos = [
  { tipo: 'crianca', id: 'antonio', dados: { nome: 'Antônio', nascimento: '2026-03-10' } },
  { tipo: 'marco', dados: { crianca: 'antonio', marco: 'senta', s: 'P', em: '2026-10-19' } },
  { tipo: 'medida', dados: { crianca: 'antonio', data: '2026-10-19', peso: 8.4 } },
  { tipo: 'historia', dados: { crianca: 'antonio', data: '2026-08-02', tipo: 'Doença', titulo: 'Resfriado' } },
];
const [{ r: rf }] = await anon(`select public.agente_salvar($1, $2::jsonb) r`, [manus, JSON.stringify(filhos)]);
ok(rf.ok && rf.salvos.find(x => x.tipo === 'marco').id === 'antonio-senta', 'Manus (Total + filhos) grava criança, marco, medida e história; marco ganha id "antonio-senta"');
const [{ l: lm }] = await anon(`select public.agente_listar($1) l`, [manus]);
ok(['crianca', 'marco', 'medida', 'historia'].every(t => lm.some(x => x.tipo === t)) && lm.some(x => x.tipo === 'conta'), 'Manus enxerga os dados dos filhos e o resto');
await anon(`select public.agente_salvar($1, '[{"tipo":"marco","dados":{"crianca":"antonio","marco":"senta","s":"A"}}]'::jsonb)`, [manus]);
const [{ data: mk }] = await q(db, '', `select data from registros where kind='marco' and id='antonio-senta'`);
ok(mk.s === 'A' && mk.em === '2026-10-19', 'Manus altera o marco (mesmo id = atualiza)');
const [{ id: hid }] = await q(db, '', `select id from registros where kind='historia'`);
ok((await anon(`select public.agente_remover($1, 'historia', $2) r`, [manus, hid]))[0].r.removidos === 1, 'Manus remove registro da história');
ok(/precisa de "id"/.test(await anonErr(`select public.agente_salvar($1, '[{"tipo":"crianca","dados":{"nome":"X"}}]'::jsonb)`, [manus])), 'criança sem id: erro claro');
ok(/precisa de "crianca"/.test(await anonErr(`select public.agente_salvar($1, '[{"tipo":"medida","dados":{"peso":8}}]'::jsonb)`, [manus])), 'medida sem criança: erro claro');
ok(/"P", "A" ou "NV"/.test(await anonErr(`select public.agente_salvar($1, '[{"tipo":"marco","dados":{"crianca":"antonio","marco":"senta","s":"sim"}}]'::jsonb)`, [manus])), 'marco com status inválido: erro claro');

const [{ l: lt }] = await anon(`select public.agente_listar($1) l`, [total]);
ok(!lt.some(x => ['crianca', 'marco', 'medida'].includes(x.tipo)) && lt.some(x => x.tipo === 'remedio'), 'chave Total comum NÃO vê os dados dos filhos (e continua vendo o resto)');
ok(/dados dos filhos/.test(await anonErr(`select public.agente_listar($1, 'medida')`, [total])), 'chave Total comum pedindo medidas: recusado');
ok(/dados dos filhos/.test(await anonErr(`select public.agente_salvar($1, '[{"tipo":"medida","dados":{"crianca":"antonio","peso":9}}]'::jsonb)`, [total])), 'chave Total comum gravando medida: recusado');
ok(/dados dos filhos/.test(await anonErr(`select public.agente_remover($1, 'crianca', 'antonio')`, [total])), 'chave Total comum apagando criança: recusado');
const ch2 = await q(db, comoMembro, `select nome, filhos from public.listar_chaves_api()`);
ok(ch2.find(c => c.nome === 'Manus').filhos === true && ch2.find(c => c.nome === 'Claude').filhos === false, 'lista de chaves mostra quem acessa os filhos');
