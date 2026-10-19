// Teste da página dos filhos: idade, idade corrigida, faixa de marcos da Caderneta e consultas recomendadas.
// Rodar: node testes/filhos.test.js
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
for (const f of ['util.js', 'schema.js', 'caderneta.js', 'domain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const Schema = vm.runInContext('Schema', ctx);
const C = vm.runInContext('Caderneta', ctx);
const D = vm.runInContext('D', ctx);
const put = (kind, o) => { const n = Schema.normalize(kind, o); (cache[kind] = cache[kind] || {})[n.id] = n; return n; };
const reset = () => Object.keys(cache).forEach(k => delete cache[k]);
let n = 0;
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const t = (nome, fn) => { reset(); fn(); n++; console.log('ok -', nome); };

t('Caderneta: 17 faixas contínuas de 0 a 72 meses, 4 marcos cada, ids únicos', () => {
  assert.strictEqual(C.FAIXAS.length, 17);
  C.FAIXAS.forEach((f, i) => {
    assert.strictEqual(f.marcos.length, 4, f.nome);
    if (i) assert.strictEqual(f.ini, C.FAIXAS[i - 1].fim);
    f.marcos.forEach(m => assert.ok(m.nome && m.como.length > 20, m.id));
  });
  assert.strictEqual(C.FAIXAS[0].ini, 0);
  assert.strictEqual(C.FAIXAS[16].fim, 72);
  assert.strictEqual(Object.keys(C.MARCOS).length, 68);
  eq(C.FAIXAS.map(f => f.ini), [0, 1, 2, 4, 6, 9, 12, 15, 18, 24, 30, 36, 42, 48, 54, 60, 66]);
});

t('idade em meses e dias, inclusive fim de mês', () => {
  eq(D.idadeEntre('2026-03-10', '2026-10-19'), { meses: 7, dias: 9, total: 7 + 9 / 30.4375 });
  assert.strictEqual(D.idadeEntre('2026-01-31', '2026-02-28').meses, 1); // 31/01 + 1 mês = 28/02
  assert.strictEqual(D.idadeEntre('2026-01-31', '2026-02-27').meses, 0);
  assert.strictEqual(D.idadeEntre('2026-10-20', '2026-10-19'), null);
  assert.strictEqual(D.mesesDepois('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(D.mesesDepois('2025-11-15', 3), '2026-02-15');
  assert.strictEqual(D.idadeTxt({ meses: 0, dias: 12 }), '12 dias');
  assert.strictEqual(D.idadeTxt({ meses: 1, dias: 1 }), '1 mês e 1 dia');
  assert.strictEqual(D.idadeTxt({ meses: 26, dias: 3 }), '2 anos e 2 meses');
});

t('a termo: sem idade corrigida; faixa pelo total de meses', () => {
  const c = put('crianca', { id: 'antonio', nome: 'Antônio', nascimento: '2026-03-10', ig_semanas: 39 });
  const i = D.idadeCrianca(c, '2026-10-19');
  assert.strictEqual(i.corrigida, null);
  assert.strictEqual(D.faixaMarcos(i.usada).nome, '6 meses a 9 meses');
  assert.strictEqual(D.faixaMarcos(D.idadeCrianca(c, '2026-09-09').usada).nome, '4 meses a 6 meses'); // 5 meses e 30 dias
  assert.strictEqual(D.faixaMarcos(D.idadeCrianca(c, '2026-09-10').usada).nome, '6 meses a 9 meses');
});

t('prematuro: desconta o que faltou para 40 semanas (exemplo da Caderneta: 28 sem, 6 meses → 3 meses)', () => {
  const c = put('crianca', { id: 'b', nome: 'B', nascimento: '2026-01-01', ig_semanas: 28 });
  const i = D.idadeCrianca(c, '2026-07-01'); // 6 meses de idade; faltaram 12 semanas (84 dias)
  assert.strictEqual(i.real.meses, 6);
  assert.strictEqual(i.corrigida.meses, 3);
  assert.strictEqual(D.faixaMarcos(i.usada).ini, 2);
  // Antes de completar 40 semanas.
  assert.ok(D.idadeCrianca(c, '2026-02-01').corrigida.antesDoTermo);
});

t('idade corrigida vale até 2 anos (3 anos se < 28 semanas); 37 semanas não corrige', () => {
  const p34 = put('crianca', { id: 'p', nome: 'P', nascimento: '2024-01-10', ig_semanas: 34 });
  assert.ok(D.idadeCrianca(p34, '2026-01-09').corrigida);   // 23 meses
  assert.strictEqual(D.idadeCrianca(p34, '2026-01-10').corrigida, null); // 24 meses
  const p27 = put('crianca', { id: 'q', nome: 'Q', nascimento: '2024-01-10', ig_semanas: 27, ig_dias: 6 });
  assert.ok(D.idadeCrianca(p27, '2026-06-01').corrigida);
  const t37 = put('crianca', { id: 'r', nome: 'R', nascimento: '2026-01-10', ig_semanas: 37 });
  assert.strictEqual(D.idadeCrianca(t37, '2026-06-01').corrigida, null);
});

t('marcos para conversar: só os marcados como ausentes (faixa atual e anterior)', () => {
  const c = put('crianca', { id: 'antonio', nome: 'Antônio', nascimento: '2026-03-10', ig_semanas: 39 });
  // Hoje (19/10) está na faixa 6–9; a anterior é 4–6.
  ['busca-objetos', 'leva-boca', 'localiza-som'].forEach(m => put('marco', { id: D.marcoKey('antonio', m), crianca: 'antonio', marco: m, s: 'P' }));
  put('marco', { id: D.marcoKey('antonio', 'senta'), crianca: 'antonio', marco: 'senta', s: 'A' });
  put('marco', { id: D.marcoKey('antonio', 'transfere'), crianca: 'antonio', marco: 'transfere', s: 'P' });
  eq(D.marcosAtencao(c, '2026-10-19').map(x => x.marco.id), ['senta']);
  eq(D.marcosSemMarcar(c, '2026-10-19').map(m => m.id), ['rola']);
  put('marco', { id: D.marcoKey('antonio', 'rola'), crianca: 'antonio', marco: 'rola', s: 'A' });
  eq(D.marcosAtencao(c, '2026-10-19').map(x => x.marco.id), ['rola', 'senta']);
  eq(D.marcosSemMarcar(c, '2026-10-19'), []);
  assert.strictEqual(D.marcosAtencao({ id: 'x', nome: 'X' }).length, 0); // sem nascimento
});

t('consultas recomendadas com data e agendamento pelo id fixo', () => {
  const c = put('crianca', { id: 'antonio', nome: 'Antônio', nascimento: '2026-03-10' });
  const cs = D.consultasRecomendadas(c);
  eq(cs.map(x => [x.nome, x.data]).slice(0, 4), [['1ª semana', '2026-03-17'], ['1º mês', '2026-04-10'], ['2º mês', '2026-05-10'], ['4º mês', '2026-07-10']]);
  assert.strictEqual(cs.length, 10);
  put('evento', { id: D.consultaEventoId('antonio', '9º mês'), titulo: 'Consulta', data: '2026-12-11', pessoa: 'Antônio' });
  assert.strictEqual(D.consultasRecomendadas(c).find(x => x.nome === '9º mês').evento.data, '2026-12-11');
  eq(D.consultasRecomendadas({ id: 'x', nome: 'X' }), []);
});

console.log(`\n${n} testes passaram`);
