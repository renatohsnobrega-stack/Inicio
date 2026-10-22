const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'veiculos.js'), 'utf8');
function app() {
  const ctx = vm.createContext({
    U: { uid: () => 'teste-id' },
    Uint8Array,
    atob,
    Blob,
    URL,
  });
  vm.runInContext(source, ctx, { filename: 'veiculos.js' });
  return vm.runInContext('Veiculos', ctx);
}
const plain = value => JSON.parse(JSON.stringify(value));
const veiculos = [{ id: 'carro-1', nome: 'Carro' }, { id: 'moto-1', nome: 'Moto' }];
const registro = overrides => ({
  titulo: 'Revisão', veiculo: 'carro-1', tipo: 'manutencao', status: 'pendente', data: '2024-02-29',
  km: '', valor: '', ...overrides,
});
const arquivo = (type, size) => ({ type, size });
const anexo = (type, bytes, nome = 'arquivo') => ({
  id: 'anexo-1', nome, type, size: bytes.length,
  dados: `data:${type};base64,${Buffer.from(bytes).toString('base64')}`,
});

 test('datas civis validam anos bissextos e rejeitam datas impossíveis ou formatos não canônicos', () => {
  const V = app();
  for (const data of ['2024-02-29', '2000-02-29', '2024-01-01', '9999-12-31']) assert.equal(V.dataValida(data), true, data);
  for (const data of ['2023-02-29', '1900-02-29', '2024-02-30', '2024-13-01', '0000-01-01', '2024-2-09', '09/02/2024', '2024-02-09T00:00:00', '', null, 20240209]) {
    assert.equal(V.dataValida(data), false, String(data));
  }
});

test('validadores de veículo e registro exigem identificação e referência a veículo cadastrado', () => {
  const V = app();
  assert.equal(V.validarVeiculo({ nome: ' Van ' }), '');
  for (const nome of ['', '  ', null, 7, undefined]) assert.notEqual(V.validarVeiculo({ nome }), '');
  assert.equal(V.validarRegistro(registro(), veiculos), '');
  for (const ref of ['inexistente', '', null, undefined]) assert.match(V.validarRegistro(registro({ veiculo: ref }), veiculos), /veículo cadastrado/);
  assert.match(V.validarRegistro(registro(), []), /veículo cadastrado/);
  assert.throws(() => V.validarRegistro(registro(), null), /some/);
  assert.match(V.validarRegistro(registro({ titulo: '  ' }), veiculos), /título/);
});

test('registro aceita todos os tipos cadastrados e rejeita tipo/status inválidos', () => {
  const V = app();
  assert.deepEqual(plain(V.TIPOS), {
    manutencao: 'Manutenção', anual: 'Manutenção anual', obd: 'Diagnóstico OBD', multa: 'Multa de trânsito',
  });
  for (const tipo of Object.keys(V.TIPOS)) assert.equal(V.validarRegistro(registro({ tipo }), veiculos), '', tipo);
  for (const tipo of ['tarefa', '__proto__', 'toString', '', null]) assert.match(V.validarRegistro(registro({ tipo }), veiculos), /Tipo de registro inválido/);
  for (const status of ['aberto', 'Pendente', '', null]) assert.match(V.validarRegistro(registro({ status }), veiculos), /Status inválido/);
});

test('valida datas de registro e prazos opcionais e impede valores numéricos inválidos', () => {
  const V = app();
  assert.equal(V.validarRegistro(registro({ km: 0, valor: 0, prazo: '2024-02-29', realizadaEm: '2024-03-01', ocorrenciaEm: '2024-02-28', prazoDefesa: '2024-03-03', prazoRecurso: '2024-03-04' }), veiculos), '');
  assert.equal(V.validarRegistro(registro({ km: '', valor: '' }), veiculos), '');
  assert.equal(V.validarRegistro(registro({ km: null, valor: null }), veiculos), '');
  for (const data of ['2024-02-30', '2024-2-01', 'nao-data']) assert.match(V.validarRegistro(registro({ data }), veiculos), /data de registro válida/);
  for (const campo of ['prazo', 'realizadaEm', 'ocorrenciaEm', 'prazoDefesa', 'prazoRecurso']) {
    assert.match(V.validarRegistro(registro({ [campo]: '2023-02-29' }), veiculos), /data inválida ou inexistente/);
  }
  for (const km of [-1, 1.5, '12', NaN, Infinity]) assert.match(V.validarRegistro(registro({ km }), veiculos), /Quilometragem/);
  for (const valor of [-0.01, '12', NaN, Infinity, -Infinity]) assert.match(V.validarRegistro(registro({ valor }), veiculos), /Valor deve/);
  assert.equal(V.validarRegistro(registro({ km: 12, valor: 45.5 }), veiculos), '');
});

test('ordena prazos de multa por data civil e considera pagamento, defesa e recurso, mesmo vencidos', () => {
  const V = app();
  const multa = registro({ tipo: 'multa', prazo: '2020-01-01', prazoDefesa: '2019-12-31', prazoRecurso: '2020-01-02' });
  assert.deepEqual(plain(V.prazos(multa)), [
    { campo: 'prazoDefesa', label: 'Defesa', data: '2019-12-31' },
    { campo: 'prazo', label: 'Pagamento', data: '2020-01-01' },
    { campo: 'prazoRecurso', label: 'Recurso', data: '2020-01-02' },
  ]);
  assert.equal(V.proximoPrazo(multa), '2019-12-31', 'prazo vencido mais próximo continua sendo o mínimo');
  assert.equal(V.proximoPrazo({ ...multa, prazo: '2030-01-01', prazoDefesa: '2025-01-01', prazoRecurso: '2024-01-01' }), '2024-01-01');
  assert.equal(V.proximoPrazo({ ...multa, status: 'resolvido' }), '');
  assert.deepEqual(plain(V.prazos(registro({ tipo: 'manutencao', prazo: '2025-04-01', prazoDefesa: '2024-01-01', prazoRecurso: '2023-01-01' }))), [
    { campo: 'prazo', label: 'Próxima manutenção / prazo', data: '2025-04-01' },
  ]);
});

test('ordena pendentes antes de resolvidos e pendentes por menor prazo, sem alterar a lista', () => {
  const V = app();
  const entrada = [
    registro({ titulo: 'Resolvido antigo', status: 'resolvido', data: '2010-01-01', prazo: '2010-01-02' }),
    registro({ titulo: 'Sem prazo', data: '2026-01-01', prazo: '' }),
    registro({ titulo: 'Prazo distante', data: '2024-01-01', prazo: '2030-01-01' }),
    registro({ titulo: 'Prazo vencido', data: '2023-01-01', tipo: 'multa', prazo: '2025-01-01', prazoDefesa: '2020-01-01', prazoRecurso: '2024-01-01' }),
    registro({ titulo: 'Resolvido recente', status: 'resolvido', data: '2025-01-01' }),
  ];
  const before = plain(entrada);
  const ordenados = V.ordenar(entrada);
  assert.deepEqual(plain(ordenados.map(r => r.titulo)), ['Prazo vencido', 'Prazo distante', 'Sem prazo', 'Resolvido recente', 'Resolvido antigo']);
  assert.notEqual(ordenados, entrada);
  assert.deepEqual(plain(entrada), before);
});

test('validação de seleção limita quantidade, MIME, tamanho individual e total de anexos', () => {
  const V = app();
  const mb = V.MAX_ARQUIVO;
  assert.equal(V.validarSelecao([], [arquivo('application/pdf', mb), arquivo('image/png', mb)]), '');
  assert.match(V.validarSelecao([arquivo('application/pdf', 1)], [arquivo('image/png', 1), arquivo('image/jpeg', 1), arquivo('image/webp', 1)]), /no máximo 3 anexos/);
  assert.match(V.validarSelecao([], [arquivo('application/pdf', mb), arquivo('image/png', mb), arquivo('image/jpeg', mb)]), /somar no máximo 2 MB/);
  for (const invalid of [arquivo('text/html', 10), arquivo('image/svg+xml', 10), arquivo('application/pdf', 0), arquivo('image/png', -1), arquivo('image/webp', mb + 1)]) {
    assert.notEqual(V.validarSelecao([], [invalid]), '', JSON.stringify(invalid));
  }
  assert.equal(V.validarAnexos('não é uma lista'), 'Lista de anexos inválida.');
});

test('valida assinaturas dos anexos PDF, PNG, JPEG e WebP e entrega bytes corretos', () => {
  const V = app();
  const bons = [
    anexo('application/pdf', [...Buffer.from('%PDF-1.4\n')], 'teste.pdf'),
    anexo('image/png', [137, 80, 78, 71, 13, 10, 26, 10], 'teste.png'),
    anexo('image/jpeg', [255, 216, 255], 'teste.jpg'),
    anexo('image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], 'teste.webp'),
  ];
  for (const item of bons) {
    assert.equal(V.validarAnexos([item]), '', item.type);
    assert.deepEqual(Array.from(V.bytesAnexo(item)), Array.from(Buffer.from(item.dados.split(',')[1], 'base64')));
  }
  assert.equal(V.validarAnexos(bons.slice(0, 3)), '');
});

test('rejeita data URLs executáveis, HTML/SVG, MIME incompatível e cabeçalhos forjados', () => {
  const V = app();
  const pdf = [...Buffer.from('%PDF-1.4')];
  const rejects = [
    { nome: 'x.html', type: 'text/html', size: 18, dados: 'data:text/html;base64,PGh0bWw+PC9odG1sPg==' },
    { nome: 'x.svg', type: 'image/svg+xml', size: 11, dados: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    { nome: 'x.js', type: 'application/pdf', size: 3, dados: 'javascript:alert(1)' },
    { nome: 'x.pdf', type: 'application/pdf', size: 8, dados: 'data:text/html;base64,PGh0bWw+' },
    anexo('application/pdf', [...Buffer.from('<html>bad</html>')]),
    anexo('image/png', pdf),
    anexo('image/jpeg', [0, 1, 2, 3]),
    anexo('image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('HTML')]),
  ];
  for (const item of rejects) assert.notEqual(V.validarAnexos([item]), '', JSON.stringify(item));
  for (const item of rejects) assert.throws(() => V.bytesAnexo(item));
});

test('barra tamanho declarado excessivo e payload base64 com tamanho divergente ou conteúdo inflado', () => {
  const V = app();
  const inflado = anexo('application/pdf', [...Buffer.from('%PDF-1.4')]);
  inflado.dados += Buffer.from('x'.repeat(1024)).toString('base64');
  assert.match(V.validarAnexos([inflado]), /Conteúdo do anexo inválido/);
  assert.throws(() => V.bytesAnexo(inflado), /Conteúdo do anexo inválido/);
  const tamanhoExcessivo = { ...anexo('application/pdf', [...Buffer.from('%PDF-1.4')]), size: V.MAX_ARQUIVO + 1 };
  assert.match(V.validarAnexos([tamanhoExcessivo]), /Anexo inválido/);
  assert.throws(() => V.bytesAnexo(tamanhoExcessivo), /Anexo inválido/);
});
