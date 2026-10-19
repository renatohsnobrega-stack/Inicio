// Teste das regras da família: estoque de remédios, suplementos e refeições por pessoa.
// Rodar: node testes/familia.test.js
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
let n = 0;
// Compara valores vindos do contexto do app (outro "realm" do vm).
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const t = (nome, fn) => { reset(); put('config', { id: 'pessoas', nomes: ['Renato', 'Vanessa', 'Antônio'] }); fn(); n++; console.log('ok -', nome); };

// ---------- Estoque ----------
t('sem estoque informado não controla', () => {
  const m = put('remedio', { id: 'a', nome: 'Losartana', horarios: ['08:00'] });
  assert.strictEqual(D.estoque(m, '2026-10-19'), null);
});

t('desconta as doses dos dias passados, não as de hoje', () => {
  const m = put('remedio', { id: 'a', nome: 'Losartana', horarios: ['08:00', '20:00'], estoque: 30, estoque_em: '2026-10-19' });
  assert.strictEqual(D.estoque(m, '2026-10-19').restante, 30);
  const e = D.estoque(m, '2026-10-22'); // 3 dias × 2 doses
  assert.strictEqual(e.restante, 24);
  assert.strictEqual(e.dias, 12);
  assert.strictEqual(e.acaba, '2026-11-03');
  assert.strictEqual(e.status, 'ok');
});

t('avisa com 7 dias ou menos e marca como acabou quando não dá para hoje', () => {
  const m = put('remedio', { id: 'a', nome: 'Vitamina D', categoria: 'suplemento', horarios: ['08:00'], estoque: '8', estoque_em: '2026-10-19' });
  assert.strictEqual(D.estoque(m, '2026-10-19').status, 'ok');     // 8 dias
  assert.strictEqual(D.estoque(m, '2026-10-20').status, 'baixo');  // 7 dias
  assert.strictEqual(D.estoque(m, '2026-10-27').status, 'acabou'); // 0
  assert.strictEqual(D.estoque(m, '2026-11-30').restante, 0);      // nunca negativo
  eq(D.estoqueAcabando('2026-10-21').map(x => x.med.id), ['a']);
});

t('meia dose e várias unidades por horário', () => {
  const m = put('remedio', { id: 'a', nome: 'X', horarios: ['08:00'], estoque: '10', por_dose: '0,5', estoque_em: '2026-10-19' });
  assert.strictEqual(D.estoque(m, '2026-10-23').restante, 8);
  assert.strictEqual(D.estoque(m, '2026-10-23').dias, 16);
  const g = put('remedio', { id: 'b', nome: 'Gotas', horarios: ['08:00', '20:00'], estoque: 100, por_dose: 20, unidade: 'gotas', estoque_em: '2026-10-19' });
  assert.strictEqual(D.estoque(g, '2026-10-20').restante, 60);
  assert.strictEqual(D.fmtQtd(2.25), '2,3');
});

t('não avisa remédio suspenso, sem horário ou que termina antes de acabar', () => {
  put('remedio', { id: 'a', nome: 'Suspenso', horarios: ['08:00'], estoque: 1, estoque_em: '2026-10-19', ativo: false });
  put('remedio', { id: 'b', nome: 'Se precisar', horarios: [], estoque: 2, estoque_em: '2026-10-19' });
  put('remedio', { id: 'c', nome: 'Antibiótico', horarios: ['08:00'], estoque: 5, estoque_em: '2026-10-19', fim: '2026-10-22' });
  eq(D.estoqueAcabando('2026-10-19'), []);
  assert.strictEqual(D.estoque(Schema.normalize('remedio', { nome: 'Se precisar', estoque: 2 }), '2026-10-19').restante, 2);
});

t('suspenso no meio do período não gasta estoque', () => {
  const m = put('remedio', { id: 'a', nome: 'X', horarios: ['08:00'], estoque: 10, estoque_em: '2026-10-19', fim: '2026-10-20' });
  assert.strictEqual(D.estoque(m, '2026-10-25').restante, 8); // só 19 e 20
});

t('estoque sem data de contagem conta a partir de hoje', () => {
  const m = put('remedio', { id: 'a', nome: 'X', horarios: ['08:00'], estoque: 10 });
  assert.strictEqual(D.estoque(m, '2026-10-25').restante, 10);
});

// ---------- Normalização ----------
t('normaliza categoria, quantidades e mantém vazio', () => {
  const s = Schema.normalize('remedio', { nome: 'Ômega 3', categoria: 'Suplementos', estoque: '60', por_dose: '2', estoque_em: '19/10/2026' });
  assert.strictEqual(s.categoria, 'suplemento');
  assert.strictEqual(s.estoque, 60);
  assert.strictEqual(s.por_dose, 2);
  assert.strictEqual(s.estoque_em, '2026-10-19');
  const r = Schema.normalize('remedio', { nome: 'Losartana', estoque: '' });
  assert.strictEqual(r.categoria, 'remedio');
  assert.strictEqual(r.estoque, '');
  assert.ok(!('por_dose' in r));
});

t('refeição por pessoa ganha id próprio e passa na validação', () => {
  const [r] = Schema.parseImport('{"refeicoes":[{"dia":"segunda","refeicao":"almoço","texto":"Papinha","pessoa":"Antônio"}]}');
  assert.strictEqual(r.data.id, '0-almoco-antonio');
  eq(r.erros, []);
  const [f] = Schema.parseImport('{"refeicoes":[{"dia":2,"refeicao":"jantar","texto":"Sopa"}]}');
  assert.strictEqual(f.data.id, '2-jantar');
  assert.ok(Schema.resumo('refeicao', r.data).includes('(Antônio)'));
});

// ---------- Refeições ----------
t('pessoa sem refeição própria usa a da família', () => {
  put('refeicao', { id: '0-almoco', texto: 'Arroz e feijão' });
  put('refeicao', { id: '0-almoco-antonio', pessoa: 'Antônio', texto: 'Papinha de legumes' });
  assert.strictEqual(D.meal(0, 'almoco'), 'Arroz e feijão');
  assert.strictEqual(D.meal(0, 'almoco', 'Renato'), 'Arroz e feijão');
  assert.strictEqual(D.meal(0, 'almoco', 'Antônio'), 'Papinha de legumes');
  eq(D.mealResumo(0, 'almoco'), [
    { quem: 'Renato e Vanessa', texto: 'Arroz e feijão' },
    { quem: 'Antônio', texto: 'Papinha de legumes' },
  ]);
});

t('resumo sem diferenças mostra uma linha só', () => {
  put('refeicao', { id: '1-jantar', texto: 'Sopa' });
  eq(D.mealResumo(1, 'jantar'), [{ quem: '', texto: 'Sopa' }]);
  put('refeicao', { id: '1-jantar-renato', pessoa: 'Renato', texto: 'Sopa' });
  eq(D.mealResumo(1, 'jantar'), [{ quem: '', texto: 'Sopa' }]);
  eq(D.mealResumo(3, 'cafe'), []);
});

t('cada um com a sua refeição, sem a da família', () => {
  put('refeicao', { id: '0-cafe-renato', pessoa: 'Renato', texto: 'Ovos' });
  put('refeicao', { id: '0-cafe-vanessa', pessoa: 'Vanessa', texto: 'Iogurte' });
  eq(D.mealResumo(0, 'cafe'), [
    { quem: 'Renato', texto: 'Ovos' }, { quem: 'Vanessa', texto: 'Iogurte' },
  ]);
});

t('suplementos de cada pessoa, ordenados por horário', () => {
  put('remedio', { id: 'a', nome: 'Ômega 3', categoria: 'suplemento', pessoa: 'Vanessa', horarios: ['20:00'] });
  put('remedio', { id: 'b', nome: 'Vitamina D', categoria: 'suplemento', pessoa: 'Vanessa', horarios: ['08:00'] });
  put('remedio', { id: 'c', nome: 'Losartana', pessoa: 'Vanessa', horarios: ['08:00'] });
  put('remedio', { id: 'd', nome: 'Ferro', categoria: 'suplemento', pessoa: 'Antônio', horarios: ['09:00'] });
  eq(D.suplementosDe('Vanessa').map(m => m.id), ['b', 'a']);
  eq(D.suplementosDe(null).map(m => m.id), ['b', 'd', 'a']);
});

console.log(`\n${n} testes passaram.`);
