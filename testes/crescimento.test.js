// Teste das curvas da OMS: escore-z conferido com as linhas publicadas pela OMS, percentil e classificação da Caderneta.
// Rodar: node testes/crescimento.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const cache = {};
const ctx = vm.createContext({
  crypto: globalThis.crypto,
  console,
  Store: { list: kind => Object.values(cache[kind] || {}), get: (kind, id) => cache[kind]?.[id] },
});
for (const f of ['util.js', 'schema.js', 'caderneta.js', 'crescimento.js', 'domain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const Schema = vm.runInContext('Schema', ctx);
const G = vm.runInContext('Crescimento', ctx);
const D = vm.runInContext('D', ctx);
const oms = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dados', 'oms-crescimento.json'), 'utf8'));
G.usar(oms);
const put = (kind, o) => { const n = Schema.normalize(kind, o); (cache[kind] = cache[kind] || {})[n.id] = n; return n; };
let n = 0;
const t = (nome, fn) => { Object.keys(cache).forEach(k => delete cache[k]); fn(); n++; console.log('ok -', nome); };

t('dados: 6 tabelas da OMS com 1857 dias (0 a 5 anos)', () => {
  assert.deepStrictEqual(Object.keys(oms.tabelas).sort(), ['comprimento-F', 'comprimento-M', 'pc-F', 'pc-M', 'peso-F', 'peso-M']);
  Object.values(oms.tabelas).forEach(tb => { assert.strictEqual(tb.M.length, 1857); assert.strictEqual(tb.S.length, 1857); });
  // Valores conhecidos da OMS: menino ao nascer, mediana de peso 3,3464 kg, comprimento 49,8842 cm, PC 34,4618 cm.
  assert.strictEqual(G.lms('peso', 'M', 0).M, 3.3464);
  assert.strictEqual(G.lms('comprimento', 'M', 0).M, 49.8842);
  assert.strictEqual(G.lms('pc', 'M', 0).M, 34.4618);
  assert.strictEqual(G.lms('peso', 'M', 1857), null);
});

t('escore-z bate com as linhas −3, −2, 0, +2 e +3 publicadas pela OMS (todas as tabelas, a cada 30 dias)', () => {
  let conferidos = 0, maior = 0;
  for (const [nome, tb] of Object.entries(oms.tabelas)) {
    const [ind, sx] = nome.split('-');
    for (const [dia, linhas] of Object.entries(tb.conferencia)) {
      [-3, -2, 0, 2, 3].forEach((z, i) => {
        const calc = G.zscore(ind, sx, Number(dia), linhas[i]);
        maior = Math.max(maior, Math.abs(calc - z));
        assert.ok(Math.abs(calc - z) <= 0.02, `${nome} dia ${dia} z ${z}: calculado ${calc}`);
        conferidos++;
      });
    }
  }
  console.log(`   ${conferidos} valores conferidos; maior diferença ${maior.toFixed(3)} (a OMS arredonda as linhas em 3 casas)`);
});

t('peso além de ±3: correção da OMS pela distância entre as linhas +2/+3', () => {
  const p = G.lms('peso', 'M', 365);
  const sd3 = G.valorZ(p, 3), sd2 = G.valorZ(p, 2);
  assert.strictEqual(G.zscore('peso', 'M', 365, sd3 + (sd3 - sd2)), 4);
  const n3 = G.valorZ(p, -3), n2 = G.valorZ(p, -2);
  assert.strictEqual(G.zscore('peso', 'M', 365, n3 - (n2 - n3)), -4);
  assert.strictEqual(G.zscore('peso', 'M', 365, 0), null);
});

t('percentil a partir do escore-z', () => {
  assert.strictEqual(G.percentil(0), 50);
  assert.strictEqual(G.percentil(1.96), 97.5);
  assert.strictEqual(G.percentil(-1.645), 5);
  assert.strictEqual(G.percentil(-2), 2.3);
  assert.strictEqual(G.percentil(5), 99.9);
});

t('classificação da Caderneta (limites)', () => {
  const c = (i, z) => G.classificar(i, z).texto;
  assert.strictEqual(c('peso', -3.01), 'Muito baixo peso para a idade');
  assert.strictEqual(c('peso', -3), 'Baixo peso para a idade');
  assert.strictEqual(c('peso', -2), 'Peso adequado para a idade');
  assert.strictEqual(c('peso', 2), 'Peso adequado para a idade');
  assert.strictEqual(c('peso', 2.01), 'Peso elevado para a idade');
  assert.strictEqual(c('comprimento', -2.5), 'Baixo comprimento para a idade');
  assert.strictEqual(c('comprimento', 3), 'Comprimento adequado para a idade');
  assert.strictEqual(c('pc', 2.1), 'PC acima do esperado para a idade');
  assert.strictEqual(c('pc', -2.1), 'PC abaixo do esperado para a idade');
});

t('medida do Antônio: idade em dias, escore-z e classificação', () => {
  const c = put('crianca', { id: 'antonio', nome: 'Antônio', nascimento: '2026-03-10', ig_semanas: 39, sexo: 'menino' });
  assert.strictEqual(c.sexo, 'M');
  const m = put('medida', { id: 'm', crianca: 'antonio', data: '2026-09-10', peso: '7,85', comprimento: 67.5, pc: 43.2 });
  assert.strictEqual(D.idadeDias(c, '2026-09-10').dias, 184);
  const a = D.avaliarMedida(c, m, 'peso');
  const esperado = G.zscore('peso', 'M', 184, 7.85);
  assert.strictEqual(a.z, esperado);
  assert.ok(a.z > -2 && a.z < 2 && a.classe.tom === 'ok');
  assert.strictEqual(D.avaliarMedida({ ...c, sexo: '' }, m, 'peso'), null); // sem sexo não calcula
});

t('prematuro: curvas pela idade corrigida até os 2 anos', () => {
  const c = put('crianca', { id: 'b', nome: 'B', nascimento: '2026-01-01', ig_semanas: 32, sexo: 'F' });
  eq(D.idadeDias(c, '2026-07-01'), { dias: 181 - 56, corrigida: true, antesDoTermo: false });
  assert.ok(D.idadeDias(c, '2026-02-01').antesDoTermo);
  assert.strictEqual(D.idadeDias(c, '2028-01-01').corrigida, false);
});

function eq(a, b) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); }
console.log(`\n${n} testes passaram`);
