const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const utilSource = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');
const schemaSource = fs.readFileSync(path.join(root, 'js', 'schema.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8');
const KEY = 'casa-organizada:v1';
const clone = value => JSON.parse(JSON.stringify(value));

function makeApp({ initial = {}, quota = false, cloudRows = [], cloudError = null } = {}) {
  const disk = new Map([[KEY, JSON.stringify(initial)]]);
  const writes = [];
  const calls = [];
  const listeners = new Set();
  const localStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem: (key, value) => {
      if (quota) throw new Error('QuotaExceededError');
      disk.set(key, String(value));
      writes.push([key, String(value)]);
    },
  };
  const sb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'renato-id', email: 'renato@example.test' } } } }) },
    rpc: async name => name === 'current_member_profile' ? { data: 'Renato', error: null } : { data: null, error: null },
    from(table) {
      assert.equal(table, 'registros');
      return {
        select(columns) {
          calls.push(['select', columns]);
          const query = { order: () => query, range: async () => ({ data: cloudRows, error: null }) };
          return query;
        },
        upsert(row) {
          calls.push(['upsert', clone(row)]);
          return Promise.resolve({ error: cloudError });
        },
        delete() {
          const filters = [];
          const query = { eq: (column, value) => { filters.push([column, value]); return query; } };
          query.then = (resolve, reject) => Promise.resolve({ error: cloudError }).then(resolve, reject);
          calls.push(['delete-query', filters]);
          return query;
        },
      };
    },
    channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  };
  const window = {
    APP_CONFIG: cloudRows.length || arguments[0]?.cloud ? { supabaseUrl: 'https://local.test', supabaseAnonKey: 'public-test' } : {},
    supabase: { createClient: () => sb },
  };
  // Caller can force cloud even when no seeded rows are returned.
  if (arguments[0]?.cloud) window.APP_CONFIG = { supabaseUrl: 'https://local.test', supabaseAnonKey: 'public-test' };
  const ctx = vm.createContext({
    window, document: { createElement: () => ({}), head: { appendChild: script => script.onload() } },
    localStorage, crypto: globalThis.crypto, console, alert: () => {}, location: { reload() {} },
    setTimeout, clearTimeout,
  });
  vm.runInContext(utilSource, ctx, { filename: 'util.js' });
  vm.runInContext(schemaSource, ctx, { filename: 'schema.js' });
  vm.runInContext(storeSource, ctx, { filename: 'store.js' });
  const api = vm.runInContext('Store', ctx);
  return { api, disk, writes, calls, listeners, init: () => api.init(), async load() { await api.init(); await api.loadCloud(); } };
}

test('local putConfirmed/removeConfirmed persist only after success, preserve backup data and emit after confirmation', async () => {
  const oldAttachment = { id: 'arquivo-antigo', nome: 'manual.pdf', type: 'application/pdf', size: 8, dados: 'data:application/pdf;base64,JVBERi0x' };
  const backup = {
    conta: { luz: { id: 'luz', nome: 'Energia', pagos: { '2026-10': { valor: 123 } } } },
    registro_veiculo: { antigo: { id: 'antigo', veiculo: 'carro-1', titulo: 'Revisão anterior', anexos: [oldAttachment] } },
  };
  const app = makeApp({ initial: backup });
  await app.init();
  let emitted = 0;
  app.api.subscribe(() => emitted++);

  const vehicle = await app.api.putConfirmed('veiculo', { id: 'carro-1', nome: '  Carro da família  ', placa: ' ABC-1234 ', modelo: '  Hatch  ', obs: '  familiar  ' });
  assert.deepEqual(clone({ nome: vehicle.nome, placa: vehicle.placa, modelo: vehicle.modelo, obs: vehicle.obs }), {
    nome: 'Carro da família', placa: 'ABC-1234', modelo: 'Hatch', obs: 'familiar',
  });
  assert.equal(app.api.get('veiculo', 'carro-1').placa, 'ABC-1234');
  assert.equal(emitted, 1);

  const newAttachment = { id: 'arquivo-novo', nome: 'nota.pdf', type: 'application/pdf', size: 6, dados: 'data:application/pdf;base64,JVBERi0x' };
  await app.api.putConfirmed('registro_veiculo', {
    id: 'registro-1', veiculo: ' carro-1 ', titulo: '  Troca de óleo ', tipo: ' manutencao ',
    status: ' pendente ', responsavel: ' Renato ', obs: ' conferir ', autoNumero: 123, anexos: [newAttachment],
  });
  assert.deepEqual(clone(Object.fromEntries(['titulo', 'veiculo', 'tipo', 'status', 'responsavel', 'obs', 'autoNumero'].map(k => [k, app.api.get('registro_veiculo', 'registro-1')[k]]))), {
    titulo: 'Troca de óleo', veiculo: 'carro-1', tipo: 'manutencao', status: 'pendente', responsavel: 'Renato', obs: 'conferir', autoNumero: '123',
  });
  assert.deepEqual(clone(app.api.get('registro_veiculo', 'registro-1').anexos), [newAttachment]);
  assert.deepEqual(clone(app.api.get('registro_veiculo', 'antigo').anexos), [oldAttachment]);

  await app.api.removeConfirmed('registro_veiculo', 'registro-1');
  assert.equal(app.api.get('registro_veiculo', 'registro-1'), undefined);
  assert.deepEqual(clone(app.api.get('registro_veiculo', 'antigo').anexos), [oldAttachment]);
  const saved = JSON.parse(app.disk.get(KEY));
  assert.deepEqual(saved.conta, backup.conta, 'backup dos demais kinds continua intacto');
  assert.deepEqual(saved.registro_veiculo.antigo.anexos, [oldAttachment], 'arquivo de registro preexistente continua intacto');
  assert.equal(saved.veiculo['carro-1'].nome, 'Carro da família');
  assert.equal(saved.registro_veiculo['registro-1'], undefined);
  assert.equal(emitted, 3, 'cada gravação/remoção confirmada emite uma vez');
});

test('quota local não altera cache nem emite evento em putConfirmed e removeConfirmed', async () => {
  const original = { veiculo: { 'carro-1': { id: 'carro-1', nome: 'Carro' } }, registro_veiculo: { r1: { id: 'r1', titulo: 'Arquivo', anexos: [{ id: 'a1', dados: 'data:application/pdf;base64,JVBERi0x' }] } } };
  const app = makeApp({ initial: original, quota: true });
  await app.init();
  let emitted = 0;
  app.api.subscribe(() => emitted++);
  await assert.rejects(app.api.putConfirmed('veiculo', { id: 'carro-1', nome: 'Alterado' }), /Não foi possível salvar neste navegador/);
  await assert.rejects(app.api.removeConfirmed('registro_veiculo', 'r1'), /QuotaExceededError/);
  assert.deepEqual(clone(app.api.exportAll()), original);
  assert.equal(emitted, 0);
  assert.equal(app.writes.length, 0);
});

test('cloud mock autentica sessão e carrega cache exclusivamente das linhas retornadas', async () => {
  const returned = [
    { kind: 'veiculo', id: 'carro-servidor', data: { id: 'carro-servidor', nome: 'Carro do banco' } },
    { kind: 'registro_veiculo', id: 'registro-servidor', data: { id: 'registro-servidor', veiculo: 'carro-servidor', titulo: 'Documento', anexos: [{ nome: 'doc.pdf', dados: 'fake-base64' }] } },
  ];
  const app = makeApp({ cloud: true, initial: { veiculo: { local: { id: 'local', nome: 'não carregar' } } }, cloudRows: returned });
  await app.load();
  assert.equal(app.api.mode(), 'cloud');
  assert.equal(app.api.user().id, 'renato-id');
  assert.deepEqual(clone(app.api.list('veiculo').map(x => x.id)), ['carro-servidor']);
  assert.equal(app.api.get('veiculo', 'local'), undefined);
  assert.deepEqual(clone(app.api.get('registro_veiculo', 'registro-servidor').anexos), [{ nome: 'doc.pdf', dados: 'fake-base64' }]);
});

test('cloud failures in putConfirmed/removeConfirmed leave cache and subscribers unchanged', async () => {
  const rows = [
    { kind: 'veiculo', id: 'carro-1', data: { id: 'carro-1', nome: 'Carro' } },
    { kind: 'registro_veiculo', id: 'r1', data: { id: 'r1', veiculo: 'carro-1', titulo: 'Original' } },
  ];
  const app = makeApp({ cloud: true, cloudRows: rows, cloudError: new Error('offline') });
  await app.load();
  let emitted = 0;
  app.api.subscribe(() => emitted++);
  await assert.rejects(app.api.putConfirmed('veiculo', { id: 'carro-1', nome: 'Mutado' }), /offline/);
  await assert.rejects(app.api.removeConfirmed('registro_veiculo', 'r1'), /offline/);
  assert.equal(app.api.get('veiculo', 'carro-1').nome, 'Carro');
  assert.equal(app.api.get('registro_veiculo', 'r1').titulo, 'Original');
  assert.equal(emitted, 0);
});

test('cloud confirmed mutations persist the exact vehicle kinds, never task or message kinds', async () => {
  const app = makeApp({ cloud: true });
  await app.init();
  await app.api.putConfirmed('veiculo', { id: 'carro-1', nome: 'Carro' });
  await app.api.putConfirmed('registro_veiculo', { id: 'r1', veiculo: 'carro-1', titulo: 'Licenciamento', anexos: [{ nome: 'crlv.pdf', dados: 'fake' }] });
  await app.api.removeConfirmed('registro_veiculo', 'r1');
  const upserts = app.calls.filter(c => c[0] === 'upsert').map(c => c[1]);
  assert.deepEqual(upserts.map(row => row.kind), ['veiculo', 'registro_veiculo']);
  const deletes = app.calls.filter(c => c[0] === 'delete-query');
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0][1], [['kind', 'registro_veiculo'], ['id', 'r1']]);
  assert.deepEqual(clone(app.api.list('tarefa')), []);
  assert.deepEqual(clone(app.api.list('recado')), []);
  assert.deepEqual(clone(app.api.list('registro_veiculo')), []);
});
