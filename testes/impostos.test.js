const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = file => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
function app() {
  const cache = {};
  let writes = 0;
  const ctx = vm.createContext({
    console, URL,
    Store: {
      list: kind => Object.values(cache[kind] || {}),
      get: (kind, id) => cache[kind]?.[id],
      put: () => { writes++; throw new Error('leitura não pode gravar'); },
      remove: () => { writes++; throw new Error('leitura não pode apagar'); },
    },
  });
  for (const file of ['util.js', 'schema.js', 'domain.js']) vm.runInContext(source(file), ctx, { filename: file });
  const Schema = vm.runInContext('Schema', ctx);
  const D = vm.runInContext('D', ctx);
  const put = (kind, record) => {
    const normalized = Schema.normalize(kind, record);
    (cache[kind] ||= {})[normalized.id] = normalized;
    return normalized;
  };
  return { Schema, D, put, cache, writes: () => writes };
}
const plain = value => JSON.parse(JSON.stringify(value));
const valid = overrides => ({
  id: 'tax', nome: 'IPVA do carro', valor: 1200, tipo: 'unica', data: '2026-02-10',
  categoria: 'Outros', responsavel: 'Renato', obrigacao: 'ipva', anoReferencia: 2025,
  modalidade: 'unica', ...overrides,
});

test('Schema registra obrigações e normaliza sem inferir nem alterar contas antigas', () => {
  const { Schema } = app();
  assert.deepEqual(plain(Schema.OBRIGACOES), {
    iptu: 'IPTU', ipva: 'IPVA', licenciamento: 'Licenciamento', crm_pf: 'CRM pessoa física', irpf: 'IRPF a pagar',
  });
  const legacy = Schema.normalize('conta', { id: 'old', nome: 'IPVA atrasado', valor: 90, tipo: 'unica', data: '2025-01-02', categoria: 'Outros' });
  assert.equal(legacy.categoria, 'Outros');
  assert.equal(Object.hasOwn(legacy, 'obrigacao'), false);
  const byCategoryOnly = Schema.normalize('conta', { id: 'cat', nome: 'Imposto qualquer', tipo: 'unica', data: '2025-01-02', categoria: 'Impostos' });
  assert.equal(Object.hasOwn(byCategoryOnly, 'obrigacao'), false);
  const marked = Schema.normalize('conta', valid({ obrigacao: 'ipva' }));
  assert.equal(marked.categoria, 'Impostos');
  const unknown = Schema.normalize('conta', valid({ categoria: 'Transporte', obrigacao: 'IPVA' }));
  assert.equal(unknown.obrigacao, 'IPVA');
  assert.equal(unknown.categoria, 'Transporte');
  assert.equal(unknown.nome, 'IPVA do carro');
  const badText = Schema.normalize('conta', valid({ referencia: 123 }));
  assert.equal(badText.referencia, 123, 'valor de tipo inválido permanece disponível para validação');
});

test('contas mensais e únicas seguem compatíveis, e vencimento não substitui ano de referência', () => {
  const { D, put } = app();
  put('conta', { id: 'mensal', nome: 'Internet', valor: 99, tipo: 'mensal', dia: 12, inicio: '2025-01', categoria: 'Internet / Telefone' });
  put('conta', { id: 'imposto-recorrente-invalido', nome: 'IPTU recorrente inválido', valor: 99, tipo: 'mensal', dia: 12,
    inicio: '2025-01', categoria: 'Moradia', obrigacao: 'iptu' });
  put('conta', { id: 'unica-antiga', nome: 'Seguro', valor: 500, tipo: 'unica', data: '2026-02-08', categoria: 'Seguros' });
  const taxa = put('conta', valid({ id: 'ipva-2026', data: '2026-02-10', anoReferencia: 2025 }));
  assert.equal(taxa.anoReferencia, 2025);
  assert.deepEqual(plain(D.billOccurrences('2026-02').map(x => [x.conta.id, x.venc]).sort()), [
    ['ipva-2026', '2026-02-10'], ['mensal', '2026-02-12'], ['unica-antiga', '2026-02-08'],
  ].sort((a, b) => a[0].localeCompare(b[0])));
  assert.deepEqual(plain(D.billOccurrences('2027-02').map(x => [x.conta.id, x.venc])), [['mensal', '2027-02-12']]);
  assert.equal(D.impostoDetalhe(taxa), 'IPVA · 2025 · cota única');
});

test('parcelas são lançamentos únicos manuais independentes e mantêm pagos', () => {
  const { D, put } = app();
  put('conta', valid({ id: 'p1', nome: 'IPTU — 1/3', data: '2026-04-05', modalidade: 'parcela', parcela: 1, parcelas: 3,
    pagos: { '2026-04': { valor: 100, em: '2026-04-04' } } }));
  put('conta', valid({ id: 'p2', nome: 'IPTU — 2/3', data: '2026-04-20', modalidade: 'parcela', parcela: 2, parcelas: 3 }));
  const april = D.billOccurrences('2026-04');
  assert.deepEqual(plain(april.map(x => [x.conta.id, x.venc, Boolean(x.pago), x.valor])), [
    ['p1', '2026-04-05', true, 100], ['p2', '2026-04-20', false, 1200],
  ]);
  assert.equal(D.billOccurrences('2026-05').length, 0, 'não gera parcelas ou cobranças em meses futuros');
  assert.equal(D.impostoDetalhe(april[1].conta), 'IPVA · 2025 · parcela 2/3');
});

test('classificação e detalhe são helpers puros e não gravam durante leitura', () => {
  const { D, put, writes } = app();
  const row = put('conta', valid({ referencia: '<img src=x onerror=alert(1)>' }));
  assert.equal(D.impostoPessoal(row), true);
  assert.equal(D.impostoPessoal({ obrigacao: '__proto__' }), false);
  assert.equal(D.impostoPessoal({ obrigacao: '' }), false);
  assert.equal(D.impostoDetalhe(row), 'IPVA · 2025 · <img src=x onerror=alert(1)> · cota única');
  assert.equal(D.validarImposto(row), '');
  D.billOccurrences('2026-02');
  assert.equal(writes(), 0);
});

test('validarImposto exige enum, conta única, ano, data civil, valor e responsável', () => {
  const { D, Schema } = app();
  assert.equal(D.validarImposto(valid({})), '');
  assert.equal(D.validarImposto(valid({ obrigacao: '' })), '');
  assert.match(D.validarImposto(valid({ obrigacao: 'IPVA' })), /Obrigação inválida/);
  assert.match(D.validarImposto(valid({ obrigacao: '__proto__' })), /Obrigação inválida/);
  assert.match(D.validarImposto(valid({ tipo: 'mensal' })), /conta única/);
  for (const anoReferencia of [1899, 10000, 2025.5, '2025', NaN]) {
    assert.match(D.validarImposto(valid({ anoReferencia })), /Ano de referência inválido/);
  }
  for (const data of ['2026-2-10', '2026-02-30', '2026-02-29', '0000-01-01', '10/02/2026', '2026-02-10T00:00:00']) {
    assert.notEqual(D.validarImposto(valid({ data })), '', `rejeita data ${data}`);
  }
  assert.equal(D.validarImposto(valid({ data: '2024-02-29' })), '');
  for (const valor of [0, -1, Infinity, NaN, '1200']) assert.match(D.validarImposto(valid({ valor })), /Valor do imposto/);
  for (const responsavel of ['', '   ', null, 10]) assert.match(D.validarImposto(valid({ responsavel })), /Responsável/);
  assert.match(D.validarImposto(valid({ modalidade: 'anual' })), /Modalidade inválida/);
  const normalizedBadMoney = Schema.normalize('conta', valid({ valor: '12abc' }));
  assert.equal(normalizedBadMoney.valor, '12abc', 'normalização tributária não mascara valor malformado');
  assert.match(D.validarImposto(normalizedBadMoney), /Valor do imposto/);
  const normalizedBadDate = Schema.normalize('conta', valid({ data: '2026-2-10' }));
  assert.equal(normalizedBadDate.data, '2026-2-10');
  assert.notEqual(D.validarImposto(normalizedBadDate), '');
});

test('modalidade única não aceita índices; parcela exige inteiros 1..99 e índice até o total', () => {
  const { D } = app();
  for (const field of ['parcela', 'parcelas']) assert.match(D.validarImposto(valid({ [field]: 1 })), /Cota única/);
  for (const parcela of [0, 100, 1.2, '1']) assert.match(D.validarImposto(valid({ modalidade: 'parcela', parcela, parcelas: 3 })), /Parcela deve/);
  for (const parcelas of [0, 100, 3.5, '3']) assert.match(D.validarImposto(valid({ modalidade: 'parcela', parcela: 1, parcelas })), /Quantidade de parcelas/);
  assert.match(D.validarImposto(valid({ modalidade: 'parcela', parcela: 4, parcelas: 3 })), /não pode superar/);
  assert.equal(D.validarImposto(valid({ modalidade: 'parcela', parcela: 3, parcelas: 3 })), '');
});

test('referência e links mantêm tipo textual; URLs aceitam somente HTTPS válido sem credenciais', () => {
  const { D } = app();
  assert.equal(D.validarImposto(valid({ guiaUrl: 'https://exemplo.gov.br/guia', comprovanteUrl: 'https://exemplo.com/recibo' })), '');
  for (const guiaUrl of ['http://exemplo.com', 'javascript:alert(1)', '//exemplo.com/guia', 'https://user:senha@exemplo.com/guia', 'https://', 'https://exa mplo.com']) {
    assert.match(D.validarImposto(valid({ guiaUrl })), /URL da guia deve ser HTTPS/);
  }
  assert.match(D.validarImposto(valid({ comprovanteUrl: 'https://user@exemplo.com' })), /URL do comprovante deve ser HTTPS/);
  assert.match(D.validarImposto(valid({ referencia: { texto: 'carro' } })), /Referência deve ser texto/);
  assert.match(D.validarImposto(valid({ guiaUrl: ['https://exemplo.com'] })), /URL da guia deve ser texto/);
});
