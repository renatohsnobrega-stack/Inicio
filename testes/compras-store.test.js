const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const clone = v => JSON.parse(JSON.stringify(v));
const KEY = 'casa-organizada:v1';
const utilSource = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');
const schemaSource = fs.readFileSync(path.join(root, 'js', 'schema.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'js', 'store.js'), 'utf8');

function makeApp({ cloud = false, initial = {}, quota = false, rpcHandler, uploadError = null } = {}) {
  const disk = new Map([[KEY, JSON.stringify(initial)]]);
  const calls = [];
  let emitted = 0;
  const localStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem: (key, value) => { if (quota) throw new Error('QuotaExceededError'); disk.set(key, String(value)); },
  };
  const rows = Object.entries(initial).flatMap(([kind, values]) => Object.entries(values).map(([id, data]) => ({ kind, id, data })));
  const sb = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'member-id', email: 'member@example.test' } } } }) },
    rpc: async (name, args) => {
      calls.push(['rpc', name, clone(args || {})]);
      if (name === 'current_member_profile') return { data: 'Member', error: null };
      if (rpcHandler) return rpcHandler(name, args);
      if (name === 'attach_purchase_receipt') return { data: { ...(initial.compra?.[args.p_id] || {}), nota: args.p_nota }, error: null };
      return { data: args?.p_purchase || true, error: null };
    },
    from: table => {
      assert.equal(table, 'registros');
      return { select: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) };
    },
    storage: {
      from: bucket => {
        assert.equal(bucket, 'notas-compras');
        return {
          upload: async (objectPath, file, options) => {
            calls.push(['upload', objectPath, file, options]);
            return { data: { path: objectPath }, error: uploadError };
          },
          remove: async paths => { calls.push(['remove-upload', paths]); return { data: [], error: null }; },
          createSignedUrl: async (objectPath, expires) => {
            calls.push(['signed-url', objectPath, expires]);
            return { data: { signedUrl: 'https://signed.example.test/temporary' }, error: null };
          },
        };
      },
    },
    channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  };
  const ctx = vm.createContext({
    window: { APP_CONFIG: cloud ? { supabaseUrl: 'https://local.test', supabaseAnonKey: 'public-test' } : {}, supabase: { createClient: () => sb } },
    document: { createElement: () => ({}), head: { appendChild: s => s.onload() } }, localStorage,
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' }, console, alert: () => {},
    location: { reload() {} }, setTimeout, clearTimeout,
  });
  vm.runInContext(utilSource, ctx, { filename: 'util.js' });
  vm.runInContext(schemaSource, ctx, { filename: 'schema.js' });
  vm.runInContext(storeSource, ctx, { filename: 'store.js' });
  const api = vm.runInContext('Store', ctx);
  api.subscribe(() => emitted++);
  return { api, disk, calls, emitted: () => emitted, async init() { await api.init(); if (cloud) await api.loadCloud(); } };
}

const item = (id, texto = 'Leite') => ({ id, texto, lista: 'mercado', feito: true, criadoEm: '2026-10-22T10:00:00.000Z' });
const purchase = (id = 'p-1') => ({ id, lista: 'mercado', listaNome: 'Mercado', data: '2026-10-22', loja: 'Mercadinho', total: 12.5, itens: [{ itemId: 'i-1', texto: 'Leite', quantidade: 1, unidade: 'L', preco: 12.5 }], criadoEm: '2026-10-22T11:00:00.000Z' });

 test('local finalization saves purchase and removes only unchanged snapshots, with safe idempotent retry', async () => {
  const first = item('i-1');
  const keep = item('i-2', 'Pão');
  const app = makeApp({ initial: { item: { 'i-1': first, 'i-2': keep } } });
  await app.init();
  const saved = await app.api.finalizePurchase(purchase(), [first]);
  assert.equal(saved.id, 'p-1');
  assert.equal(app.api.get('compra', 'p-1').total, 12.5);
  assert.equal(app.api.get('item', 'i-1'), undefined);
  assert.deepEqual(clone(app.api.get('item', 'i-2')), keep);
  const writesBeforeRetry = app.disk.size;
  const retried = await app.api.finalizePurchase(purchase(), [first]);
  assert.equal(retried.id, 'p-1');
  assert.equal(app.disk.size, writesBeforeRetry);
  assert.equal(app.emitted(), 1);
});

test('local snapshot conflict and localStorage failure leave ledger, source cache, and subscribers unchanged', async () => {
  const source = item('i-1');
  const changed = { ...source, texto: 'Leite sem lactose' };
  const conflict = makeApp({ initial: { item: { 'i-1': changed } } });
  await conflict.init();
  await assert.rejects(conflict.api.finalizePurchase(purchase(), [source]), /mudou desde a seleção/);
  assert.equal(conflict.api.get('compra', 'p-1'), undefined);
  assert.equal(conflict.api.get('item', 'i-1').texto, 'Leite sem lactose');
  assert.equal(conflict.emitted(), 0);

  const full = makeApp({ initial: { item: { 'i-1': source } }, quota: true });
  await full.init();
  await assert.rejects(full.api.finalizePurchase(purchase(), [source]), /Não foi possível salvar a compra/);
  assert.equal(full.api.get('compra', 'p-1'), undefined);
  assert.deepEqual(clone(full.api.get('item', 'i-1')), source);
  assert.equal(full.emitted(), 0);
});

test('cloud finalization calls atomic RPC and updates cache only after confirmation', async () => {
  const source = item('i-1');
  const failed = makeApp({ cloud: true, initial: { item: { 'i-1': source } }, rpcHandler: name => name === 'finalize_purchase' ? { data: null, error: new Error('database offline') } : { data: null, error: null } });
  await failed.init();
  await assert.rejects(failed.api.finalizePurchase(purchase(), [source]), /database offline/);
  assert.equal(failed.api.get('compra', 'p-1'), undefined);
  assert.deepEqual(clone(failed.api.get('item', 'i-1')), source);
  assert.equal(failed.emitted(), 0);

  const ok = makeApp({ cloud: true, initial: { item: { 'i-1': source } } });
  await ok.init();
  const result = await ok.api.finalizePurchase(purchase(), [source]);
  assert.equal(result.id, 'p-1');
  assert.equal(ok.api.get('item', 'i-1'), undefined);
  const rpc = ok.calls.find(c => c[0] === 'rpc' && c[1] === 'finalize_purchase');
  assert.deepEqual(rpc[2].p_sources, [{ id: 'i-1', snapshot: source }]);
  assert.equal(ok.emitted(), 1);
});

test('cloud finalization sends raw legacy item snapshot instead of normalized generated fields', async () => {
  const raw = { texto: 'Feijão', lista: 'mercado' };
  const app = makeApp({ cloud: true, initial: { item: { legacy: raw } } });
  await app.init();
  const normalizedSource = clone(app.api.get('item', 'legacy'));
  assert.equal(normalizedSource.id, 'legacy');
  assert.equal(normalizedSource.feito, false);
  assert.ok(normalizedSource.criadoEm);
  const p = { ...purchase('legacy-purchase'), itens: [{ itemId: 'legacy', texto: 'Feijão', quantidade: 1, unidade: '', preco: 12.5 }] };
  await app.api.finalizePurchase(p, [normalizedSource]);
  const rpc = app.calls.find(c => c[0] === 'rpc' && c[1] === 'finalize_purchase');
  assert.deepEqual(rpc[2].p_sources, [{ id: 'legacy', snapshot: raw }]);
});

function file(name, type, bytes) {
  return { name, type, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

test('receipt upload is private metadata-only, signed URL is temporary, and local mode rejects attachments', async () => {
  const bought = { ...purchase(), nota: undefined };
  delete bought.nota;
  const app = makeApp({ cloud: true, initial: { compra: { 'p-1': bought } } });
  await app.init();
  const pdf = file('nota.pdf', 'application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const attached = await app.api.attachPurchaseReceipt('p-1', pdf);
  assert.equal(attached.nota.path, 'familia/p-1/12345678-1234-1234-1234-123456789abc.pdf');
  assert.deepEqual(clone(attached.nota), { path: attached.nota.path, nome: 'nota.pdf', type: 'application/pdf', size: 6 });
  assert.equal(JSON.stringify(app.api.exportAll()).includes('base64'), false);
  const uploaded = app.calls.find(c => c[0] === 'upload');
  assert.equal(uploaded[3].upsert, false);
  assert.equal(uploaded[3].contentType, 'application/pdf');
  assert.equal(await app.api.purchaseReceiptUrl('p-1'), 'https://signed.example.test/temporary');
  assert.equal(app.calls.find(c => c[0] === 'signed-url')[2], 300);

  const local = makeApp();
  await local.init();
  await assert.rejects(local.api.attachPurchaseReceipt('p-1', pdf), /exige conexão com a nuvem/);
  await assert.rejects(app.api.attachPurchaseReceipt('p-1', pdf), /já tem uma nota/);
});

test('receipt rejects a false file signature before storage upload', async () => {
  const app = makeApp({ cloud: true, initial: { compra: { 'p-1': purchase() } } });
  await app.init();
  await assert.rejects(app.api.attachPurchaseReceipt('p-1', file('nota.pdf', 'application/pdf', [0, 1, 2])), /assinatura/);
  assert.equal(app.calls.some(c => c[0] === 'upload'), false);
});
