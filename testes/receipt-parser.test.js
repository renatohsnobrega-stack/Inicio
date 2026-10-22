const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'receipt-parser.js'), 'utf8');
function parser() {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx, { filename: 'receipt-parser.js' });
  return vm.runInContext('ReceiptParser', ctx);
}
const plain = value => JSON.parse(JSON.stringify(value));

test('API estável, leitura do cabeçalho, data e total de recibo fictício', () => {
  const out = plain(parser().parse(`SUPERMERCADO FICTICIO\nCNPJ: 00.000.000/0000-00\n22/10/2026 12:30\nLEITE FICTICIO 2 UN X 5,50 11,00\nTOTAL ITENS 1\nTOTAL R$ 11,00\nTROCO 0,00`));
  assert.deepEqual(out, {
    loja: 'SUPERMERCADO FICTICIO', data: '2026-10-22', total: 11,
    itens: [{ texto: 'LEITE FICTICIO', quantidade: 2, unidade: 'UN', preco: 5.5, totalLinha: 11 }],
    warnings: [],
  });
});

test('lê NFC-e com código numérico e cabeçalho PDF QTD UN VL UNIT VL TOTAL', () => {
  const out = plain(parser().parse(`MERCADO DE TESTE\nCOD PRODUTO QTD UN VL UNIT VL TOTAL\n001 ARROZ FICTICIO\n2 UN X 10,25 20,50\n789123 FEIJAO FICTICIO 1 KG X 8,90 8,90\nVALOR A PAGAR: R$ 29,40`));
  assert.equal(out.loja, 'MERCADO DE TESTE');
  assert.equal(out.total, 29.4);
  assert.deepEqual(out.itens, [
    { texto: 'ARROZ FICTICIO', quantidade: 2, unidade: 'UN', preco: 10.25, totalLinha: 20.5 },
    { texto: 'FEIJAO FICTICIO', quantidade: 1, unidade: 'KG', preco: 8.9, totalLinha: 8.9 },
  ]);
  assert.deepEqual(out.warnings, []);
});

test('não confunde total de itens, troco, desconto, tributos ou pagamentos com total da compra', () => {
  const out = plain(parser().parse(`LOJA FICTICIA\n01/02/2025\nTOTAL ITENS 3\nQTD TOTAL 3\nDESCONTO R$ 2,00\nPAGAMENTO CARTAO 20,00\nTRIBUTOS R$ 1,00\nTROCO 0,00\nCPF 000.000.000-00\nRua Ficticia, 10`));
  assert.equal(out.total, null);
  assert.equal(out.data, '2025-02-01');
  assert.equal(out.itens.length, 0);
  assert.equal(out.loja, 'LOJA FICTICIA');
});

test('ausências permanecem vazias/nulas e item sem total não ganha zero nem cálculo inferido', () => {
  const out = plain(parser().parse('PRODUTO FICTICIO 2 UN X 3,00'));
  assert.deepEqual(out, {
    loja: '', data: '', total: null,
    itens: [{ texto: 'PRODUTO FICTICIO', quantidade: 2, unidade: 'UN', preco: 3, totalLinha: null }],
    warnings: ['Total pago não identificado com segurança. Informe-o ou deixe em branco.'],
  });
});

test('não escolhe entre datas/totais distintos e deixa valores ambíguos para revisão', () => {
  const out = plain(parser().parse(`LOJA FICTICIA\n01/02/2025\n02/02/2025\nITEM FICTICIO 1 UN X 1.234 1.234\nTOTAL R$ 10,00\nTOTAL R$ 11,00`));
  assert.equal(out.data, '');
  assert.equal(out.total, null);
  assert.equal(out.itens[0].preco, null);
  assert.equal(out.itens[0].totalLinha, null);
  assert.ok(out.warnings.some(w => w.includes('totais diferentes')));
  assert.ok(out.warnings.some(w => w.includes('valores de item')));
  const totalAmbiguo = plain(parser().parse('TOTAL 10,00 11,00'));
  assert.equal(totalAmbiguo.total, null);
  assert.ok(totalAmbiguo.warnings.some(w => w.includes('ambíguo')));
});

test('datas impossíveis e cabeçalho sem loja não são inventados', () => {
  const out = plain(parser().parse(`QTD UN VL UNIT VL TOTAL\n31/02/2025\nTOTAL ITENS 2`));
  assert.equal(out.loja, '');
  assert.equal(out.data, '');
  assert.equal(out.total, null);
  assert.deepEqual(out.itens, []);
});

test('aplica limites de tamanho, linhas e produtos com avisos', () => {
  const P = parser();
  const texto = 'X'.repeat(200001);
  assert.ok(P.parse(texto).warnings.some(w => w.includes('200000 caracteres')));
  assert.ok(P.parse(Array(502).fill('linha').join('\n')).warnings.some(w => w.includes('500 linhas')));
  const many = Array.from({ length: 201 }, (_, i) => `ITEM FICTICIO ${i} 1 UN X 1,00 1,00`).join('\n');
  const out = P.parse(many);
  assert.equal(out.itens.length, 200);
  assert.ok(out.warnings.some(w => w.includes('200 produtos')));
});

test('entrada que não é texto produz contrato vazio e aviso', () => {
  assert.deepEqual(plain(parser().parse(null)), {
    loja: '', data: '', total: null, itens: [],
    warnings: ['O texto OCR não é uma string; revise os dados manualmente.'],
  });
});

test('valor a pagar explícito prevalece sobre subtotal e aceita valor na próxima linha', () => {
  const out = plain(parser().parse('MERCADO FICTICIO\n22/10/2026\nLEITE FICTICIO 2 UN X 5,50 = 11,00\nVALOR TOTAL R$ 11,00\nDESCONTO 1,00\nVALOR A PAGAR R$\n10,00'));
  assert.equal(out.total, 10);
  assert.equal(out.itens.length, 1);
  assert.equal(out.itens[0].preco, 5.5);
  assert.equal(out.itens[0].totalLinha, 11);
  assert.ok(out.warnings.some(w => w.includes('descontos')));
  assert.equal(parser().parse('VALOR TOTAL R$ 11,00').total, 11);
});
