// Sem rede, sem envio de notificações reais. node --test testes/push.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function app(options = {}) {
  const calls = [];
  let sub = options.existing ? subscription() : null;
  function subscription() { return { endpoint: 'https://web.push.apple.com/test', toJSON: () => ({ endpoint: 'https://web.push.apple.com/test', keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: async () => { calls.push('unsubscribe'); sub = null; return true; } }; }
  const reg = { pushManager: { getSubscription: async () => sub, subscribe: async o => { calls.push(['subscribe', o.userVisibleOnly]); return sub = subscription(); } } };
  const ctx = vm.createContext({
    URL, Uint8Array, atob, console,
    document: { baseURI: 'https://example.org/Inicio/' },
    navigator: { userAgent: options.ios ? 'iPhone' : 'Other', standalone: options.standalone, serviceWorker: { register: async (url, config) => { calls.push(['register', String(url), config.scope]); return reg; }, ready: Promise.resolve(reg), getRegistration: async () => reg } },
    window: { isSecureContext: true, PushManager: {}, Notification: {}, matchMedia: () => ({ matches: !!options.standalone }) },
    Notification: { permission: options.denied ? 'denied' : 'default', requestPermission: () => { calls.push('permission'); return Promise.resolve(options.refused ? 'denied' : 'granted'); } },
    Store: { mode: () => options.local ? 'local' : 'cloud', user: () => ({ id: 'uid' }), config: () => ({ muralPushPublicKey: options.noKey ? '' : Buffer.from([4, ...Array(64).fill(1)]).toString('base64url') }), rpc: async (name, args) => { calls.push([name, args]); if (options.fail && name === 'push_subscribe') throw Error('offline'); return options.active || false; } },
  });
  vm.runInContext(fs.readFileSync('js/push.js', 'utf8'), ctx);
  return { push: vm.runInContext('MuralPush', ctx), calls };
}
test('carregamento não pede permissão nem cria inscrição; escopo /Inicio/', async () => {
  const { push, calls } = app(); await push.init();
  assert.deepEqual(calls, [['register', 'https://example.org/Inicio/sw.js', '/Inicio/']]);
});
test('permissão em resposta ao clique antes de esperar pelo SW; RPC não envia autor', async () => {
  const { push, calls } = app(); const promise = push.enable(); assert.equal(calls[0], 'permission'); await promise;
  assert.equal(push.status().active, true);
  const rpc = calls.find(c => c[0] === 'push_subscribe');
  assert.deepEqual(Object.keys(rpc[1]), ['p_subscription']);
  assert.ok(calls.some(c => c[0] === 'subscribe' && c[1] === true));
});
test('recusa não registra nem inscreve', async () => {
  const { push, calls } = app({ refused: true }); await assert.rejects(push.enable()); assert.deepEqual(calls, ['permission']);
});
test('falha do servidor remove inscrição recém-criada e não diz ativa', async () => {
  const { push, calls } = app({ fail: true }); await assert.rejects(push.enable(), /offline/); assert.equal(calls.at(-1), 'unsubscribe'); assert.equal(push.status().active, false);
});
test('desativar remove no servidor antes de remover no navegador', async () => {
  const { push, calls } = app({ existing: true }); await push.disable(); assert.equal(calls[0][0], 'push_unsubscribe'); assert.equal(calls[1], 'unsubscribe');
});
test('iPhone fora da Tela de Início, modo local e servidor não configurado são bloqueados', async () => {
  for (const options of [{ ios: true }, { local: true }, { noKey: true }, { denied: true }]) {
    const { push, calls } = app(options); await push.init(); await assert.rejects(push.enable()); assert.equal(calls.length, 0);
  }
});
test('inscrição local não é prova de inscrição na conta', async () => {
  const { push, calls } = app({ existing: true, active: false }); await push.init(); assert.equal(push.status().active, false); assert.ok(calls.some(c => c[0] === 'push_status'));
});
function worker() {
  const handlers = {}, calls = [];
  const client = { url: 'https://example.org/Inicio/', navigate: async url => calls.push(['navigate', url]), focus: async () => calls.push('focus') };
  const self = { registration: { scope: 'https://example.org/Inicio/', showNotification: async (title, opts) => calls.push([title, opts]) }, addEventListener: (name, fn) => { handlers[name] = fn; }, clients: { matchAll: async () => [client], openWindow: async url => calls.push(['open', url]) } };
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), { self, URL });
  return { handlers, calls };
}
test('SW ignora texto/URL externos e não intercepta fetch', async () => {
  const { handlers, calls } = worker(); assert.equal(handlers.fetch, undefined);
  let work; handlers.push({ data: { json: () => ({ texto: 'segredo', url: 'https://evil.test' }) }, waitUntil: p => work = p }); await work;
  assert.equal(calls[0][1].data.url, 'https://example.org/Inicio/#/mural'); assert.equal(JSON.stringify(calls).includes('segredo'), false);
});
test('clique abre/foca somente o Mural no escopo do app', async () => {
  const { handlers, calls } = worker(); let work;
  handlers.notificationclick({ notification: { data: { url: 'https://evil.test' }, close() {} }, waitUntil: p => work = p }); await work;
  assert.deepEqual(calls, [['navigate', 'https://example.org/Inicio/#/mural'], 'focus']);
});

test('task push uses generic copy, distinct tag, and only the local Tasks route', async () => {
  const { handlers, calls } = worker(); let work;
  handlers.push({ data: { json: () => ({ kind: 'task_daily', title: 'private task title', body: 'secret task', url: 'https://evil.test' }) }, waitUntil: p => work = p }); await work;
  assert.equal(calls[0][0], 'Tarefas de hoje');
  assert.equal(calls[0][1].body, 'Você tem tarefas para hoje. Abra o Elinor para conferir.');
  assert.equal(calls[0][1].tag, 'casa-tarefas-dia');
  assert.equal(calls[0][1].renotify, true);
  assert.equal(calls[0][1].data.url, 'https://example.org/Inicio/#/tarefas');
  assert.equal(JSON.stringify(calls).includes('secret task'), false);
  let click;
  handlers.notificationclick({ notification: { data: { kind: 'task_daily', url: 'https://evil.test' }, close() {} }, waitUntil: p => click = p }); await click;
  assert.deepEqual(calls.slice(1), [['navigate', 'https://example.org/Inicio/#/tarefas'], 'focus']);
});
