const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
async function store({ key = true, fail = false, logoutFail = false } = {}) {
  const calls = [];
  const sb = { auth: { getSession: async () => ({ data: { session: { user: { id: 'user' } } } }), signOut: async () => { calls.push('signOut'); return {}; } }, rpc: async (name, args) => { calls.push([name, args]); return { data: null, error: fail ? new Error('offline') : null }; }, from: () => ({ upsert: async row => { calls.push(['upsert', row]); return {}; } }) };
  const ctx = vm.createContext({
    window: { APP_CONFIG: { supabaseUrl: 'https://development.invalid', supabaseAnonKey: 'public', muralPushPublicKey: key ? 'public-vapid' : '' }, supabase: { createClient: () => sb } },
    document: { createElement: () => ({}), head: { appendChild: s => s.onload() } },
    Schema: { normalize: (_kind, obj) => obj }, U: { uid: () => 'new-id' },
    MuralPush: { disable: async () => { calls.push('disable'); if (logoutFail) throw new Error('offline'); } },
    location: { reload: () => calls.push('reload') }, console, alert: () => {},
  });
  vm.runInContext(fs.readFileSync('js/store.js', 'utf8'), ctx);
  const api = vm.runInContext('Store', ctx); await api.init(); return { api, calls };
}
test('publicação usa RPC exclusiva e só atualiza cache após confirmação', async () => {
  const { api, calls } = await store(); await api.publishRecado({ texto: 'teste local', autor: 'arbitrário' });
  assert.equal(calls[0][0], 'push_publish_recado'); assert.equal(calls[0][1].p_id, 'new-id');
  assert.equal(api.get('recado', 'new-id').texto, 'teste local');
});
test('erro de RPC não vira publicação bem sucedida no cache', async () => {
  const { api } = await store({ fail: true }); await assert.rejects(api.publishRecado({ texto: 'não salvo' }), /offline/); assert.equal(api.get('recado', 'new-id'), undefined);
});
test('chave pública vazia conserva gravação anterior sem RPC de push', async () => {
  const { api, calls } = await store({ key: false }); await api.publishRecado({ texto: 'antigo' }); assert.equal(calls[0][0], 'upsert');
});
test('curtidas/fixações via put continuam upserts e não publicação explícita', async () => {
  const { api, calls } = await store(); await api.put('recado', { id: 'existing', fixado: true, curtidas: ['Renato'] }); assert.equal(calls[0][0], 'upsert');
});
test('logout limpa notificações primeiro; falha não encerra sessão', async () => {
  const { api, calls } = await store(); await api.signOut(); assert.deepEqual(calls, ['disable', 'signOut', 'reload']);
  const blocked = await store({ logoutFail: true }); await assert.rejects(blocked.api.signOut(), /offline/); assert.deepEqual(blocked.calls, ['disable']);
});
