// Teste dos aniversários: formato da data, próximo aniversário, idade, 29/02 e aviso do Painel.
// Rodar: node testes/aniversarios.test.js
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
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const t = (nome, fn) => { reset(); fn(); n++; console.log('ok -', nome); };

// ---------- Formato ----------
t('aceita os formatos comuns e guarda AAAA-MM-DD ou MM-DD', () => {
  assert.strictEqual(Schema.toAniversario('15/03/1985'), '1985-03-15');
  assert.strictEqual(Schema.toAniversario('5/3'), '03-05');
  assert.strictEqual(Schema.toAniversario('1985-03-15'), '1985-03-15');
  assert.strictEqual(Schema.toAniversario('--03-15'), '03-15');
  assert.strictEqual(Schema.toAniversario('03-15'), '03-15');
  assert.strictEqual(Schema.toAniversario('15.03.85'), '1985-03-15');
  assert.strictEqual(Schema.toAniversario('29/02'), '02-29');
  assert.strictEqual(Schema.fmtAniversario('1985-03-15'), '15/03/1985');
  assert.strictEqual(Schema.fmtAniversario('03-15'), '15/03');
});

t('recusa datas impossíveis e descarta ano inválido', () => {
  assert.strictEqual(Schema.parseAniversario('31/04'), null);
  assert.strictEqual(Schema.parseAniversario('15/13'), null);
  assert.strictEqual(Schema.parseAniversario('amanhã'), null);
  assert.strictEqual(Schema.toAniversario('15/03/2999'), '03-15'); // ano no futuro
  assert.strictEqual(Schema.toAniversario('29/02/2023'), '02-29'); // 2023 não é bissexto
});

t('contato com data inválida aponta o erro na importação', () => {
  const ok = Schema.parseImport(JSON.stringify({ contatos: [{ nome: 'Vó Maria', aniversario: '12/08/1950' }] }))[0];
  eq(ok.erros, []);
  assert.strictEqual(ok.data.aniversario, '1950-08-12');
  const ruim = Schema.parseImport(JSON.stringify({ contatos: [{ nome: 'Tio', aniversario: '40/02' }] }))[0];
  assert.strictEqual(ruim.erros.length, 1);
});

// ---------- Próximo aniversário ----------
t('hoje, ainda este ano e só no ano que vem', () => {
  const v = put('contato', { id: 'v', nome: 'Vanessa', aniversario: '19/10/1988' });
  const r = put('contato', { id: 'r', nome: 'Renato', aniversario: '20/10' });
  const a = put('contato', { id: 'a', nome: 'Antônio', aniversario: '2026-03-10' });
  eq(D.proximoAniversario(v, '2026-10-19'), { contato: JSON.parse(JSON.stringify(v)), data: '2026-10-19', dias: 0, mes: 10, dia: 19, idade: 38 });
  assert.strictEqual(D.proximoAniversario(r, '2026-10-19').dias, 1);
  assert.strictEqual(D.proximoAniversario(r, '2026-10-19').idade, null);
  const ant = D.proximoAniversario(a, '2026-10-19');
  assert.strictEqual(ant.data, '2027-03-10');
  assert.strictEqual(ant.idade, 1);
  eq(D.aniversarios('2026-10-19').map(x => x.contato.id), ['v', 'r', 'a']);
});

t('virada do ano', () => {
  const c = put('contato', { id: 'c', nome: 'Primo', aniversario: '02/01' });
  const x = D.proximoAniversario(c, '2026-12-30');
  assert.strictEqual(x.data, '2027-01-02');
  assert.strictEqual(x.dias, 3);
});

t('29/02 comemora em 28/02 nos anos comuns', () => {
  const c = put('contato', { id: 'c', nome: 'Bissexto', aniversario: '29/02/2000' });
  eq([D.proximoAniversario(c, '2027-01-10').data, D.proximoAniversario(c, '2027-01-10').idade], ['2027-02-28', 27]);
  assert.strictEqual(D.proximoAniversario(c, '2028-01-10').data, '2028-02-29');
  assert.strictEqual(D.aniversariantesEm('2027-02-28').length, 1);
});

t('aviso do Painel: só os próximos 7 dias e ignora contato sem data', () => {
  put('contato', { id: 'a', nome: 'A', aniversario: '26/10' }); // 7 dias
  put('contato', { id: 'b', nome: 'B', aniversario: '27/10' }); // 8 dias
  put('contato', { id: 'c', nome: 'C' });
  cache.contato.d = { id: 'd', nome: 'D', aniversario: 'lixo' }; // gravado direto pela API, sem normalizar
  eq(D.aniversariosProximos(7, '2026-10-19').map(x => x.contato.id), ['a']);
  assert.strictEqual(D.aniversarios('2026-10-19').length, 2);
  assert.strictEqual(D.quandoTxt(0), 'hoje');
  assert.strictEqual(D.quandoTxt(1), 'amanhã');
  assert.strictEqual(D.quandoTxt(5), 'em 5 dias');
});

t('data vinda de agente sem normalizar (DD/MM/AAAA) também funciona', () => {
  cache.contato = { x: { id: 'x', nome: 'Pierre', aniversario: '21/10/1990' } };
  assert.strictEqual(D.aniversariosProximos(7, '2026-10-19')[0].idade, 36);
});

console.log(`\n${n} testes passaram`);
