// Teste das tarefas por prazo: faixas, pendências (tarefas + itens de lista) e foco do dia.
// Rodar: node testes/tarefas.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const cache = {};
const ctx = vm.createContext({
  crypto: globalThis.crypto,
  console,
  Store: {
    list: kind => Object.values(cache[kind] || {}),
    get: (kind, id) => cache[kind]?.[id],
  },
});
for (const f of ['util.js', 'schema.js', 'domain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const Schema = vm.runInContext('Schema', ctx);
const D = vm.runInContext('D', ctx);
const put = (kind, o) => { const n = Schema.normalize(kind, o); (cache[kind] = cache[kind] || {})[n.id] = n; return n; };
const reset = () => Object.keys(cache).forEach(k => delete cache[k]);
// Compara valores vindos do contexto do app (outro "realm" do vm).
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
let n = 0;
const t = (nome, fn) => { reset(); put('config', { id: 'pessoas', nomes: ['Renato', 'Vanessa', 'Antônio'] }); fn(); n++; console.log('ok -', nome); };
const HOJE = '2026-10-19'; // segunda-feira

t('faixas de prazo', () => {
  eq(['2026-10-18', HOJE, '2026-10-20', '2026-10-26', '2026-10-27', ''].map(d => D.faixaDe(d, HOJE)),
    ['atrasado', 'hoje', 'semana', 'semana', 'depois', 'sem']);
});

t('pendências juntam tarefas e itens de lista com prazo', () => {
  put('lista', { id: 'l1', nome: 'Compras', icone: '🛒' });
  put('tarefa', { id: 'a', titulo: 'Pagar IPVA', data: '2026-10-15' });
  put('tarefa', { id: 'b', titulo: 'Ligar para o pediatra', data: HOJE });
  put('tarefa', { id: 'c', titulo: 'Trocar lâmpada' });
  put('tarefa', { id: 'd', titulo: 'Velha concluída', data: '2026-10-10', feito: true, feitoEm: '2026-10-11' });
  put('item', { id: 'i1', texto: 'Bolo do aniversário', lista: 'l1', prazo: '2026-10-24' });
  put('item', { id: 'i2', texto: 'Leite', lista: 'l1' }); // sem prazo: fica só na lista
  const ps = D.pendencias(HOJE);
  eq(ps.map(p => [p.titulo, p.faixa]), [
    ['Pagar IPVA', 'atrasado'], ['Ligar para o pediatra', 'hoje'], ['Bolo do aniversário', 'semana'], ['Trocar lâmpada', 'sem'],
  ]);
  assert.strictEqual(ps.find(p => p.kind === 'item').lista.nome, 'Compras');
});

t('concluída hoje continua aparecendo riscada; de outro dia some', () => {
  put('tarefa', { id: 'a', titulo: 'Feita hoje', data: '2026-10-18', feito: true, feitoEm: HOJE });
  put('item', { id: 'i', texto: 'Comprado hoje', lista: 'x', prazo: HOJE, feito: true, feitoEm: HOJE });
  put('item', { id: 'j', texto: 'Comprado ontem', lista: 'x', prazo: HOJE, feito: true, feitoEm: '2026-10-18' });
  const ps = D.pendencias(HOJE);
  eq(ps.map(p => [p.titulo, p.feito, p.faixa]), [['Feita hoje', true, 'atrasado'], ['Comprado hoje', true, 'hoje']]);
});

t('rotina entra só no dia em que cai, como "hoje"', () => {
  put('tarefa', { id: 'r1', titulo: 'Tirar o lixo', tipo: 'semanal', dias: [0, 2, 4] });
  put('tarefa', { id: 'r2', titulo: 'Regar plantas', tipo: 'semanal', dias: [1] });
  put('tarefa', { id: 'r3', titulo: 'Lavar roupa', tipo: 'diaria', feitos: { [HOJE]: true } });
  eq(D.pendencias(HOJE).map(p => [p.titulo, p.faixa, p.feito]), [['Tirar o lixo', 'hoje', false], ['Lavar roupa', 'hoje', true]]);
});

t('filtro por pessoa mostra as dela, as de "Ambos" e as sem responsável', () => {
  put('tarefa', { id: 'a', titulo: 'Do Renato', responsavel: 'Renato', data: HOJE });
  put('tarefa', { id: 'b', titulo: 'Da Vanessa', responsavel: 'Vanessa', data: HOJE });
  put('tarefa', { id: 'c', titulo: 'Dos dois', responsavel: 'Ambos', data: HOJE });
  put('tarefa', { id: 'd', titulo: 'Da casa', data: HOJE });
  eq(D.pendencias(HOJE, 'Renato').map(p => p.titulo).sort(), ['Da casa', 'Do Renato', 'Dos dois']);
  assert.strictEqual(D.pendencias(HOJE, '').length, 4);
});

t('foco do dia é por pessoa e vale só para o dia', () => {
  put('tarefa', { id: 'a', titulo: 'A', data: HOJE, foco: { Renato: HOJE } });
  put('tarefa', { id: 'b', titulo: 'B', data: HOJE, foco: { Renato: '2026-10-18', Vanessa: HOJE } });
  put('item', { id: 'i', texto: 'C', lista: 'x', prazo: '2026-10-25', foco: { casa: HOJE } });
  eq(D.focoDe('Renato', HOJE).map(p => p.titulo), ['A']);
  eq(D.focoDe('Vanessa', HOJE).map(p => p.titulo), ['B']);
  eq(D.focoDe('', HOJE).map(p => p.titulo), ['C']);
  eq(D.focoDe('Renato', '2026-10-20'), []);
  assert.strictEqual(D.FOCO_MAX, 3);
});

t('item normaliza prazo e lista ordena por prazo', () => {
  assert.strictEqual(Schema.normalize('item', { texto: 'x', prazo: '24/10/2026' }).prazo, '2026-10-24');
  put('item', { id: 'a', texto: 'Sem prazo', lista: 'l', criadoEm: '2026-10-01' });
  put('item', { id: 'b', texto: 'Depois', lista: 'l', prazo: '2026-10-30', criadoEm: '2026-10-02' });
  put('item', { id: 'c', texto: 'Antes', lista: 'l', prazo: '2026-10-20', criadoEm: '2026-10-03' });
  put('item', { id: 'd', texto: 'Feito', lista: 'l', prazo: '2026-10-19', feito: true, criadoEm: '2026-10-04' });
  eq(D.itensDa('l').map(i => i.texto), ['Antes', 'Depois', 'Sem prazo', 'Feito']);
});

console.log(`\n${n} testes passaram.`);
