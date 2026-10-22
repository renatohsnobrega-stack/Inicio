const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'compras.js'), 'utf8');
function app() {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx, { filename: 'compras.js' });
  return vm.runInContext('Compras', ctx);
}
const plain = value => JSON.parse(JSON.stringify(value));
const compraBase = overrides => ({
  id: 'c1', lista: 'l1', listaNome: 'Mercado', data: '2026-10-22', loja: '', total: null,
  itens: [{ itemId: 'i1', texto: 'leite', quantidade: null, unidade: '', preco: null }], criadoEm: '2026-10-22T12:00:00.000Z',
  ...overrides,
});

test('catálogo reúne pendentes, concluídos e histórico apenas da lista, sem interpretar quantidade no texto', () => {
  const C = app();
  const out = C.catalogo('l1', [
    { id: '1', lista: 'l1', texto: ' 2 L Leite ', feito: false },
    { id: '2', lista: 'l1', texto: ' 2 L LEÍTE ', feito: true },
    { id: '3', lista: 'l1', texto: 'Pão', feito: true },
    { id: '4', lista: 'outra', texto: 'Café' },
  ], [
    { kind: 'compra', obj: { lista: 'l1', itens: [{ texto: 'pão', quantidade: 2, unidade: 'un' }, { texto: 'Café' }] } },
    { kind: 'item', obj: { lista: 'l1', texto: 'Não incluir' } },
    { kind: 'compra', obj: { lista: 'outra', itens: [{ texto: 'Outro' }] } },
  ]);
  assert.deepEqual(plain(out), [
    { chave: '2 l leite', texto: '2 L Leite', quantidade: null, unidade: '' },
    { chave: 'cafe', texto: 'Café', quantidade: null, unidade: '' },
    { chave: 'pao', texto: 'Pão', quantidade: 2, unidade: 'un' },
  ]);
});

test('catálogo aceita registros históricos diretos, deduplica acento/case/espaço e ordena por nome', () => {
  const C = app();
  const resultado = C.catalogo('L', [{ lista: 'L', texto: '  Maçã   gala ' }, { lista: 'L', texto: 'maca GALA' }], [
    { lista: 'L', itens: [{ texto: 'MAÇÃ GALA', quantidade: 1, unidade: 'kg' }] },
    { lista: 'L', itens: [{ texto: 'Abacate' }] },
  ]);
  assert.deepEqual(plain(resultado.map(x => x.chave)), ['abacate', 'maca gala']);
  assert.equal(resultado[1].texto, 'Maçã gala');
  assert.equal(resultado[1].quantidade, 1);
});

test('numero interpreta números brasileiros e decimais canônicos e rejeita formatos parciais/ambíguos inválidos', () => {
  const C = app();
  assert.equal(C.numero('1.234,56'), 1234.56);
  assert.equal(C.numero('150,9'), 150.9);
  assert.equal(C.numero('150.90'), 150.9);
  assert.equal(C.numero('0'), 0);
  assert.equal(C.numero(''), null);
  assert.equal(C.numero('   '), null);
  for (const valor of ['1.23,45', '1,2,3', '12abc', '1.234.56', '1e3', 'R$ 20', NaN, Infinity, '12,']) assert.ok(Number.isNaN(C.numero(valor)), String(valor));
  assert.ok(Number.isNaN(C.numero('0', { positivo: true })));
  assert.equal(C.numero('0,01', { positivo: true }), 0.01);
});

test('valida compra com zeros informados e rejeita datas impossíveis, ids repetidos e valores inválidos', () => {
  const C = app();
  assert.equal(C.validar(compraBase({ total: 0, itens: [{ itemId: 'a', texto: 'Arroz', quantidade: 1, unidade: 'kg', preco: 0 }] })), '');
  assert.equal(C.validar(compraBase()), '');
  assert.match(C.validar(compraBase({ data: '2026-02-30' })), /data de compra válida/);
  assert.match(C.validar(compraBase({ itens: [] })), /ao menos um item/);
  assert.match(C.validar(compraBase({ itens: [
    { itemId: 'a', texto: 'Arroz', quantidade: 1, unidade: 'kg', preco: 1 },
    { itemId: 'a', texto: 'Feijão', quantidade: 2, unidade: 'kg', preco: 2 },
  ] })), /únicos/);
  assert.match(C.validar(compraBase({ total: -1 })), /Total/);
  assert.match(C.validar(compraBase({ itens: [{ itemId: 'a', texto: 'Ovo', quantidade: 0, unidade: 'un', preco: null }] })), /Quantidade/);
  assert.match(C.validar(compraBase({ itens: [{ itemId: 'a', texto: 'Ovo', quantidade: null, unidade: 'un', preco: -0.01 }] })), /Preço/);
  assert.match(C.validar(compraBase({ itens: [{ itemId: 'a', texto: 'Ovo', quantidade: null, unidade: 'un', preco: '2,50' }] })), /Preço/);
});

test('resumo agrega por produto normalizado e unidade, não presume total/quantidade/gasto ausentes', () => {
  const C = app();
  const r = C.resumo([
    compraBase({ total: 10, itens: [
      { itemId: '1', texto: 'Maçã', quantidade: 2, unidade: 'kg', preco: 3 },
      { itemId: '2', texto: 'Leite', quantidade: null, unidade: 'L', preco: 4 },
    ] }),
    compraBase({ id: 'c2', total: null, itens: [
      { itemId: '3', texto: 'MACA', quantidade: 1.5, unidade: 'KG', preco: 2 },
      { itemId: '4', texto: 'Maçã', quantidade: 1, unidade: 'un', preco: 0 },
    ] }),
  ]);
  assert.deepEqual(plain(r), {
    compras: 2, total: 10, semTotal: 1,
    produtos: [
      { texto: 'Leite', unidade: 'L', quantidade: null, vezes: 1, gasto: null, semQuantidade: 1, semPreco: 0 },
      { texto: 'Maçã', unidade: 'kg', quantidade: 3.5, vezes: 2, gasto: 9, semQuantidade: 0, semPreco: 0 },
      { texto: 'Maçã', unidade: 'un', quantidade: 1, vezes: 1, gasto: 0, semQuantidade: 0, semPreco: 0 },
    ],
  });
  assert.deepEqual(plain(C.resumo([])), { compras: 0, total: null, semTotal: 0, produtos: [] });
});

test('catálogo não combina quantidade de uma compra com unidade de outra', () => {
  const C = app();
  const kg = C.catalogo('l', [{lista:'l', texto:'Produto', unidade:'kg'}], [{lista:'l', itens:[{texto:'Produto', quantidade:2, unidade:'L'}]}]);
  assert.equal(kg[0].unidade, 'kg');
  assert.equal(kg[0].quantidade, null);
  const semUnidade = C.catalogo('l', [{lista:'l', texto:'Produto', quantidade:3, unidade:''}], [{lista:'l', itens:[{texto:'Produto', quantidade:2, unidade:'L'}]}]);
  assert.equal(semUnidade[0].unidade, '');
  assert.equal(semUnidade[0].quantidade, 3);
});
