// Testes da execução pessoal de foco (sem rede, backend ou credenciais).
// Rodar: node testes/foco.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
process.env.TZ = 'UTC';

const cache = {};
const toPlain = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected) => assert.deepStrictEqual(toPlain(actual), expected);
const resetCache = () => Object.keys(cache).forEach(k => delete cache[k]);

function ambiente(dia = '2026-10-21', persistido = cache) {
  let hoje = dia;
  const env = { user: null, profile: '', local: new Map(), writes: [] };
  class DataFixa extends Date {
    constructor(...args) { super(...(args.length ? args : [`${hoje}T12:00:00.000Z`])); }
    static now() { return new Date(`${hoje}T12:00:00.000Z`).getTime(); }
  }
  const Store = {
    list: kind => Object.values(persistido[kind] || {}),
    get: (kind, id) => persistido[kind]?.[id],
    user: () => env.user,
    profileName: () => env.profile,
    async put(kind, obj) {
      const normalized = Schema.normalize(kind, obj);
      (persistido[kind] = persistido[kind] || {})[normalized.id] = normalized;
      env.writes.push({ kind, id: normalized.id, data: toPlain(normalized) });
      return normalized;
    },
  };
  const ctx = vm.createContext({
    console, Date: DataFixa, Store,
    localStorage: {
      getItem: key => env.local.has(key) ? env.local.get(key) : null,
      setItem: (key, value) => env.local.set(key, String(value)),
      removeItem: key => env.local.delete(key),
    },
  });
  for (const file of ['util.js', 'schema.js', 'domain.js', 'foco.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), ctx, { filename: file });
  }
  const Schema = vm.runInContext('Schema', ctx);
  const D = vm.runInContext('D', ctx);
  const Foco = vm.runInContext('Foco', ctx);
  const put = (kind, data) => {
    const normalized = Schema.normalize(kind, data);
    (persistido[kind] = persistido[kind] || {})[normalized.id] = normalized;
    return normalized;
  };
  return {
    env, ctx, D, Foco, put,
    setDay: value => { hoje = value; },
    today: () => hoje,
    reload: () => {
      const next = ambiente(hoje, persistido);
      next.env.user = env.user;
      next.env.profile = env.profile;
      next.env.local = new Map(env.local);
      return next;
    },
  };
}

let count = 0;
async function test(name, fn) {
  resetCache();
  await fn();
  count++;
  console.log('ok -', name);
}
function seed(env) {
  env.put('config', { id: 'pessoas', nomes: ['Renato', 'Vanessa', 'João', 'Antônio'], filhos: ['Antônio'] });
  env.env.local.set('casa:eu', 'Renato');
}
function tarefa(env, { id, pessoa = 'Renato', foco = {}, feito = false, ...rest }) {
  return env.put('tarefa', { id, titulo: `Tarefa ${id}`, responsavel: pessoa, foco, feito, ...rest });
}
function item(env, { id, foco = {}, feito = false, ...rest }) {
  return env.put('item', { id, texto: `Item ${id}`, lista: 'compras', prazo: env.today(), foco, feito, ...rest });
}
const key = (kind, id) => JSON.stringify([kind, id]);
const state = (estado, nota = '') => ({ estado, nota });

(async () => {
  await test('começar, pausar com nota aparada e retomar preservando a nota', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'a', foco: { Renato: e.today() } });
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('pronta'));
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('andamento'));
    await e.Foco.mudar('tarefa', 'a', 'pausar', '  esperando retorno  ');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('pausada', 'esperando retorno'));
    await e.Foco.mudar('tarefa', 'a', 'retomar');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('andamento', 'esperando retorno'));
  });

  await test('nota opcional vazia e texto limitado a 500 caracteres', async () => {
    const e = ambiente(); seed(e); tarefa(e, { id: 'a', foco: { Renato: e.today() } });
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    await e.Foco.mudar('tarefa', 'a', 'pausar');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('pausada'));
    await e.Foco.mudar('tarefa', 'a', 'retomar');
    await e.Foco.mudar('tarefa', 'a', 'pausar', `  ${'x'.repeat(510)}  `);
    assert.strictEqual(e.Foco.status('tarefa', 'a').nota.length, 500);
    assert.strictEqual(e.Foco.status('tarefa', 'a').nota, 'x'.repeat(500));
  });

  await test('há no máximo um andamento; começar e retomar pausam o anterior sem perder nota', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'a', foco: { Renato: e.today() } });
    tarefa(e, { id: 'b', foco: { Renato: e.today() } });
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    await e.Foco.mudar('tarefa', 'a', 'pausar', 'guardar');
    await e.Foco.mudar('tarefa', 'b', 'comecar');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'b')), state('andamento'));
    await e.Foco.mudar('tarefa', 'a', 'retomar');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('andamento', 'guardar'));
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'b')), state('pausada'));
  });

  await test('tarefa e item com o mesmo id são entradas independentes', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'igual', foco: { Renato: e.today() } });
    item(e, { id: 'igual', foco: { Renato: e.today() } });
    await e.Foco.mudar('tarefa', 'igual', 'comecar');
    await e.Foco.mudar('item', 'igual', 'comecar');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'igual')), state('pausada'));
    assert.deepStrictEqual(toPlain(e.Foco.status('item', 'igual')), state('andamento'));
    const saved = e.env.writes.filter(w => w.kind === 'config').at(-1).data;
    assert.ok(saved.itens[key('tarefa', 'igual')]);
    assert.ok(saved.itens[key('item', 'igual')]);
  });

  await test('Renato e Vanessa têm foco separado, inclusive em tarefa compartilhada Ambos', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'casa', pessoa: 'Ambos', foco: { Renato: e.today(), Vanessa: e.today() } });
    e.env.user = { id: 'conta-renato' }; e.env.profile = 'Renato';
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'casa')), state('pronta'));
    await e.Foco.mudar('tarefa', 'casa', 'comecar');
    e.env.user = { id: 'conta-vanessa' }; e.env.profile = 'Vanessa';
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'casa')), state('pronta'));
    await e.Foco.mudar('tarefa', 'casa', 'comecar');
    e.env.user = { id: 'conta-renato' }; e.env.profile = 'Renato';
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'casa')), state('andamento'));
    eq(e.env.writes.filter(w => w.kind === 'config').map(w => w.id), [
      'foco-execucao:conta-renato', 'foco-execucao:conta-vanessa',
    ]);
  });

  await test('usa a identidade da conta, não a pessoa selecionada na interface', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'r', foco: { Renato: e.today() } });
    tarefa(e, { id: 'v', foco: { Vanessa: e.today() } });
    e.env.user = { id: 'uid-r' }; e.env.profile = 'Renato';
    e.env.local.set('casa:eu:uid-r', 'Vanessa'); // seleção local divergente não troca a pessoa da conta
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'r')), state('pronta'));
    assert.strictEqual(e.Foco.status('tarefa', 'v'), null);
    await e.Foco.mudar('tarefa', 'r', 'comecar');
    assert.strictEqual(e.env.writes.at(-1).id, 'foco-execucao:uid-r');
  });

  await test('concluir e reabrir Ambos invalida o estado das duas contas, inclusive após reload', async () => {
    const e = ambiente(); seed(e);
    const shared = tarefa(e, { id: 'ambos', pessoa: 'Ambos', foco: { Renato: e.today(), Vanessa: e.today() } });
    e.env.user = { id: 'conta-renato' }; e.env.profile = 'Renato';
    await e.Foco.mudar('tarefa', 'ambos', 'comecar');
    await e.Foco.mudar('tarefa', 'ambos', 'pausar', 'Nota antiga');
    e.env.user = { id: 'conta-vanessa' }; e.env.profile = 'Vanessa';
    await e.Foco.mudar('tarefa', 'ambos', 'comecar');
    e.put('tarefa', { ...shared, feito: true, feitoEm: e.today(), focoRevisao: 'conclusao-1' });
    assert.strictEqual(e.Foco.status('tarefa', 'ambos'), null);
    e.put('tarefa', { ...shared, feito: false, feitoEm: null, focoRevisao: 'reabertura-2' });
    eq(e.Foco.status('tarefa', 'ambos'), state('pronta'));
    e.env.user = { id: 'conta-renato' }; e.env.profile = 'Renato';
    eq(e.Foco.status('tarefa', 'ambos'), state('pronta'));
    eq(e.reload().Foco.status('tarefa', 'ambos'), state('pronta'));
    await e.Foco.mudar('tarefa', 'ambos', 'comecar');
    eq(e.Foco.status('tarefa', 'ambos'), state('andamento'));
  });

  await test('modo local usa chave própria à pessoa codificada e rejeita ausência de identidade', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'a', pessoa: 'João', foco: { João: e.today() } });
    e.env.local.set('casa:eu', 'João');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('pronta'));
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    assert.strictEqual(e.env.writes.at(-1).id, `foco-execucao:local:${encodeURIComponent('João')}`);
    e.env.local.delete('casa:eu');
    assert.strictEqual(e.Foco.status('tarefa', 'a'), null);
    await assert.rejects(e.Foco.mudar('tarefa', 'a', 'comecar'), /pendência/);
  });

  await test('sem identidade, criança e foco de outra pessoa não são elegíveis', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'renato', foco: { Renato: e.today() } });
    tarefa(e, { id: 'filho', pessoa: 'Antônio', foco: { 'Antônio': e.today() } });
    e.env.local.delete('casa:eu');
    assert.strictEqual(e.Foco.status('tarefa', 'renato'), null);
    e.env.profile = 'Antônio';
    assert.strictEqual(e.Foco.status('tarefa', 'filho'), null);
    await assert.rejects(e.Foco.mudar('tarefa', 'filho', 'comecar'), /pendência/);
    assert.strictEqual(e.env.writes.filter(w => w.id.startsWith('foco-execucao:')).length, 0);
  });

  await test('somente tarefa/item pendente no foco de hoje; recorrência respeita o dia e outros kinds são excluídos', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'concluida', foco: { Renato: e.today() }, feito: true, feitoEm: e.today() });
    tarefa(e, { id: 'rotina-diaria', foco: { Renato: e.today() }, tipo: 'diaria' });
    tarefa(e, { id: 'rotina-fora-do-dia', foco: { Renato: e.today() }, tipo: 'semanal', dias: [0] });
    tarefa(e, { id: 'sem-foco', foco: {} });
    item(e, { id: 'sem-prazo', prazo: '', foco: { Renato: e.today() } });
    e.put('recado', { id: 'mural', texto: 'Não é tarefa' });
    assert.strictEqual(e.Foco.status('tarefa', 'concluida'), null);
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'rotina-diaria')), state('pronta'));
    assert.strictEqual(e.Foco.status('tarefa', 'rotina-fora-do-dia'), null);
    assert.strictEqual(e.Foco.status('tarefa', 'sem-foco'), null);
    assert.strictEqual(e.Foco.status('item', 'sem-prazo'), null);
    assert.strictEqual(e.Foco.status('recado', 'mural'), null);
    await assert.rejects(e.Foco.mudar('tarefa', 'concluida', 'comecar'), /pendência/);
  });

  await test('rejeita transições inválidas e ações desconhecidas', async () => {
    const e = ambiente(); seed(e); tarefa(e, { id: 'a', foco: { Renato: e.today() } });
    await assert.rejects(e.Foco.mudar('tarefa', 'a', 'pausar'), /estado atual/);
    await assert.rejects(e.Foco.mudar('tarefa', 'a', 'retomar'), /estado atual/);
    await assert.rejects(e.Foco.mudar('tarefa', 'a', 'concluir'), /estado atual/);
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    await assert.rejects(e.Foco.mudar('tarefa', 'a', 'comecar'), /estado atual/);
    await e.Foco.mudar('tarefa', 'a', 'pausar');
    await assert.rejects(e.Foco.mudar('tarefa', 'a', 'pausar'), /estado atual/);
  });

  await test('novo dia volta a pronta e um reload recupera o estado do dia vigente', async () => {
    const e = ambiente(); seed(e); tarefa(e, { id: 'a', foco: { Renato: e.today(), } });
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    const reloaded = e.reload();
    assert.deepStrictEqual(toPlain(reloaded.Foco.status('tarefa', 'a')), state('andamento'));
    reloaded.setDay('2026-10-22');
    // Hoje o registro não está re-focado, então não há status elegível.
    assert.strictEqual(reloaded.Foco.status('tarefa', 'a'), null);
    reloaded.put('tarefa', { ...reloaded.D.focoDe('Renato', '2026-10-21')[0]?.obj, foco: { Renato: '2026-10-22' } });
    assert.deepStrictEqual(toPlain(reloaded.Foco.status('tarefa', 'a')), state('pronta'));
  });

  await test('limpar apaga só a entrada solicitada e é idempotente', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'a', foco: { Renato: e.today() } });
    tarefa(e, { id: 'b', foco: { Renato: e.today() } });
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    await e.Foco.mudar('tarefa', 'b', 'comecar');
    await e.Foco.limpar('tarefa', 'a');
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'a')), state('pronta'));
    assert.deepStrictEqual(toPlain(e.Foco.status('tarefa', 'b')), state('andamento'));
    const n = e.env.writes.length;
    await e.Foco.limpar('tarefa', 'ausente');
    assert.strictEqual(e.env.writes.length, n);
  });

  await test('grava apenas config pessoal e não altera tarefa, item, mural nem publica recados', async () => {
    const e = ambiente(); seed(e);
    tarefa(e, { id: 'a', foco: { Renato: e.today() }, obs: 'original' });
    item(e, { id: 'i', foco: { Renato: e.today() }, texto: 'Leite' });
    e.put('recado', { id: 'm', texto: 'Original' });
    const antes = Object.fromEntries(['tarefa', 'item', 'recado'].map(k => [k, toPlain(cache[k])]));
    e.env.user = { id: 'renato-id' }; e.env.profile = 'Renato';
    await e.Foco.mudar('tarefa', 'a', 'comecar');
    await e.Foco.mudar('tarefa', 'a', 'pausar', 'nota privada');
    eq(Object.fromEntries(['tarefa', 'item', 'recado'].map(k => [k, cache[k]])), antes);
    eq(e.env.writes.map(w => w.kind), ['config', 'config']);
    assert.ok(e.env.writes.every(w => w.id === 'foco-execucao:renato-id'));
  });

  console.log(`\n${count} testes passaram.`);
})().catch(err => { console.error(err); process.exitCode = 1; });
