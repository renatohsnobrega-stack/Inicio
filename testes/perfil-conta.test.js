const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

function domain() {
  const storage = new Map([['casa:eu', 'Renato']]);
  let user = { id: 'vanessa' }, profile = 'Vanessa';
  const ctx = vm.createContext({
    console,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    Store: {
      user: () => user, profileName: () => profile,
      get: (kind, id) => kind === 'config' && id === 'pessoas' ? { nomes: ['Renato', 'Vanessa', 'Antônio'] } : null,
      list: () => [],
    },
  });
  for (const f of ['util.js', 'schema.js', 'domain.js']) vm.runInContext(source(f), ctx);
  return { D: vm.runInContext('D', ctx), storage, setUser: u => { user = u; }, setProfile: p => { profile = p; } };
}

test('perfil da Vanessa prevalece sobre preferência global antiga do Renato', () => {
  const { D, storage } = domain();
  storage.set('casa:eu:vanessa', 'Renato');
  assert.equal(D.eu(), 'Vanessa');
});
test('troca de conta, retorno ao login e modo local não misturam preferências', () => {
  const d = domain(); d.setProfile('');
  assert.equal(d.D.eu(), '');
  d.D.setEu('Vanessa');
  d.setUser({ id: 'renato' }); assert.equal(d.D.eu(), '');
  d.D.setEu('Renato'); assert.equal(d.D.eu(), 'Renato');
  d.setUser({ id: 'vanessa' }); assert.equal(d.D.eu(), 'Vanessa');
  d.setUser(null); assert.equal(d.D.eu(), 'Renato');
  assert.equal(d.storage.get('casa:eu'), 'Renato');
});
test('nome exato dos metadados funciona e nomes inválidos não são aceitos', () => {
  const d = domain(); d.setProfile('');
  d.setUser({ id: 'vanessa', user_metadata: { full_name: 'Vanessa' } });
  assert.equal(d.D.eu(), 'Vanessa');
  d.setUser({ id: 'outro', user_metadata: { name: 'Visitante' } });
  d.D.setEu('Removido'); assert.equal(d.D.eu(), '');
});
test('perfil funciona mesmo quando localStorage está bloqueado', () => {
  const ctx = vm.createContext({
    Store: { user: () => ({ id: 'v' }), profileName: () => 'Vanessa', get: () => ({ nomes: ['Renato', 'Vanessa'] }) },
    localStorage: { getItem: () => { throw Error('bloqueado'); } },
  });
  for (const f of ['util.js', 'schema.js', 'domain.js']) vm.runInContext(source(f), ctx);
  assert.equal(vm.runInContext('D.eu()', ctx), 'Vanessa');
});

async function store({ fail = false } = {}) {
  let account = 'Vanessa';
  const calls = [];
  const channel = { on() { return this; }, subscribe() {} };
  const sb = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: account } } } }),
      signInWithPassword: async () => ({ data: { user: { id: 'Renato' } } }),
      signOut: async () => ({}),
    },
    from: () => ({ select: () => ({ order() { return this; }, range: async () => ({ data: [], error: null }) }) }),
    channel: () => channel,
    rpc: async name => { calls.push(name); return { data: account, error: fail ? Error('indisponível') : null }; },
  };
  const ctx = vm.createContext({
    window: { APP_CONFIG: { supabaseUrl: 'https://example.invalid', supabaseAnonKey: 'public' }, supabase: { createClient: () => sb } },
    document: { createElement: () => ({}), head: { appendChild: s => s.onload() } },
    location: { reload() {} }, console, alert() {},
  });
  vm.runInContext(source('store.js'), ctx);
  const api = vm.runInContext('Store', ctx); await api.init();
  return { api, calls, setAccount: n => { account = n; } };
}
test('loadCloud aguarda o perfil antes de retornar; login e logout limpam o nome anterior', async () => {
  const { api, calls, setAccount } = await store();
  assert.equal(api.profileName(), '');
  await api.loadCloud(); assert.equal(api.profileName(), 'Vanessa');
  assert.deepEqual(calls, ['current_member_profile']);
  await api.signIn('r@example.invalid', 'test'); assert.equal(api.profileName(), '');
  setAccount('Renato'); await api.loadCloud(); assert.equal(api.profileName(), 'Renato');
  await api.signOut(); assert.equal(api.profileName(), '');
});
test('RPC indisponível não impede carregar a casa nem reutiliza perfil anterior', async () => {
  const { api } = await store({ fail: true });
  await api.loadCloud(); assert.equal(api.profileName(), '');
});
