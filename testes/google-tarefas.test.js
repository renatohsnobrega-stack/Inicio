// Teste da sincronização com o Google Tarefas (Google e API do app simulados).
// Rodar: node testes/google-tarefas.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let relogio = Date.parse('2026-10-18T12:00:00Z');
const agora = () => new Date(relogio += 1000).toISOString();

// ---- API do app (mesma semântica das funções SQL agente_*) ----
const db = new Map(); // kind|id → { kind, id, data, updated_at }
let chamadasApp = 0;
const api = {
  agente_salvar({ registros }) {
    return { ok: true, salvos: registros.map(r => {
      const id = r.id || r.dados.id || 'uuid-' + Math.random().toString(36).slice(2);
      const k = r.tipo + '|' + id, old = db.get(k);
      const data = old ? Object.assign({}, old.data, r.dados, { id }) : Object.assign({ origem: 'agente', revisado: false }, r.dados, { id });
      db.set(k, { kind: r.tipo, id, data, updated_at: agora() });
      return { tipo: r.tipo, id };
    }) };
  },
  agente_listar({ tipo }) { return [...db.values()].filter(r => r.kind === tipo).map(r => ({ tipo: r.kind, id: r.id, dados: r.data, atualizado_em: r.updated_at })); },
  agente_remover({ tipo, id }) { return { ok: true, removidos: db.delete(tipo + '|' + id) ? 1 : 0 }; },
};
const appSet = (tipo, id, data) => db.set(tipo + '|' + id, { kind: tipo, id, data: { id, ...data }, updated_at: agora() });
const appGet = (tipo, id) => db.get(tipo + '|' + id)?.data;
const appDel = (tipo, id) => db.delete(tipo + '|' + id);
const appList = tipo => [...db.values()].filter(r => r.kind === tipo).map(r => r.data);

// ---- Google Tarefas ----
const listas = []; const tarefas = {}; let seq = 0; let chamadasGoogle = 0;
const Tasks = {
  Tasklists: { list: () => ({ items: listas }), get: id => (id === '@default' ? listas[0] : listas.find(l => l.id === id)), insert: l => { const n = { id: 'L' + (++seq), title: l.title }; listas.push(n); tarefas[n.id] = []; return n; } },
  Tasks: {
    list: (lid) => ({ items: tarefas[lid].map(t => ({ ...t })) }),
    insert: (t, lid) => { chamadasGoogle++; const n = { id: 'T' + (++seq), status: 'needsAction', ...limpa(t), updated: agora() }; tarefas[lid].push(n); return n; },
    patch: (t, lid, id) => { chamadasGoogle++; const x = tarefas[lid].find(y => y.id === id); Object.assign(x, limpa(t), { updated: agora() }); if (t.completed === null) delete x.completed; return x; },
    remove: (lid, id) => { chamadasGoogle++; const x = tarefas[lid].find(y => y.id === id); x.deleted = true; x.updated = agora(); },
  },
};
const limpa = t => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== null));
const gList = nome => tarefas[listas.find(l => l.title === nome).id];
const gVivas = nome => gList(nome).filter(t => !t.deleted && !t.hidden);
const gAdd = (nome, t) => Tasks.Tasks.insert(t, listas.find(l => l.title === nome).id);
const gEdit = (nome, title, mud) => { const x = gList(nome).find(t => t.title === title && !t.deleted); Object.assign(x, mud, { updated: agora() }); };

// Toda conta do Google já tem a lista padrão (em inglês aqui, para testar o nome trocado pelo idioma).
Tasks.Tasklists.insert({ title: 'My Tasks' });
gAdd('My Tasks', { title: 'Ligar para o contador', due: '2026-10-28T00:00:00.000Z' });

const props = {};
const ctx = vm.createContext({
  console: { log: m => process.env.V && console.log('   ' + m) },
  Tasks, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  UrlFetchApp: { fetch: (url, o) => { chamadasApp++; const out = api[url.split('/').pop()](JSON.parse(o.payload)); return { getContentText: () => JSON.stringify(out), getResponseCode: () => 200 }; } },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
});
vm.runInContext(fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'integracoes', 'google-tarefas.gs'), 'utf8'), ctx);
const sync = () => vm.runInContext('sincronizarTarefas()', ctx);
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('✔ ' + msg); };

// ---- Cenário ----
appSet('tarefa', 'a1', { titulo: 'Marcar dentista', tipo: 'unica', data: '2026-10-25', obs: 'Dra. Paula', responsavel: 'Vanessa', feito: false });
appSet('tarefa', 'r1', { titulo: 'Tirar o lixo', tipo: 'semanal', dias: [0, 2, 4] });
appSet('lista', 'l1', { nome: 'Compras', icone: '🛒' });
appSet('lista', 'l2', { nome: 'Farmácia' });
appSet('item', 'i1', { texto: 'Leite', lista: 'l1', feito: false, prazo: '2026-10-22' });
appSet('item', 'i2', { texto: 'Dipirona', lista: 'l2', feito: false });

sync();
ok(gVivas('Casa').length === 1 && gVivas('Casa')[0].title === 'Marcar dentista', '1ª: tarefa avulsa do app foi para a lista "Casa" (rotina não foi)');
ok(gVivas('My Tasks').length === 1 && listas.filter(l => /minhas|my tasks/i.test(l.title)).length === 1, '1ª: "Minhas tarefas" usou a lista padrão do Google (sem criar outra) e não recebeu as tarefas do app');
const contador = appList('tarefa').find(t => t.titulo === 'Ligar para o contador');
ok(contador && contador.lista_google === 'Minhas tarefas' && contador.data === '2026-10-28', '1ª: tarefa de "Minhas tarefas" entrou no app, marcada com a lista de origem');
ok(gVivas('Casa')[0].due === '2026-10-25T00:00:00.000Z' && gVivas('Casa')[0].notes === 'Dra. Paula', '1ª: prazo e observação foram junto');
ok(gVivas('Compras').map(t => t.title).join() === 'Leite', '1ª: só o item da lista Compras foi para o Google');
ok(gVivas('Compras')[0].due === '2026-10-22T00:00:00.000Z', '1ª: prazo do item de compra foi junto');

gAdd('Casa', { title: 'Pagar IPVA', due: '2026-11-05T00:00:00.000Z' });
gEdit('Casa', 'Marcar dentista', { status: 'completed', completed: '2026-10-18T13:00:00.000Z' });
gAdd('Compras', { title: 'Pão', due: '2026-10-20T00:00:00.000Z' });
sync();
const ipva = appList('tarefa').find(t => t.titulo === 'Pagar IPVA');
ok(ipva && ipva.data === '2026-11-05' && ipva.revisado === true, '2ª: tarefa criada no Google apareceu no app, com prazo, sem cair em "para revisar"');
ok(appGet('tarefa', 'a1').feito === true && appGet('tarefa', 'a1').feitoEm === '2026-10-18', '2ª: concluir no Google concluiu no app');
ok(appGet('tarefa', 'a1').responsavel === 'Vanessa', '2ª: campos que só existem no app (responsável) foram preservados');
ok(appList('item').some(i => i.texto === 'Pão' && i.lista === 'l1' && i.prazo === '2026-10-20'), '2ª: item novo no Google entrou em Listas → Compras, com prazo');

const g0 = chamadasGoogle, n0 = appList('tarefa').length + appList('item').length;
sync(); sync();
ok(chamadasGoogle === g0 && appList('tarefa').length + appList('item').length === n0, '3ª e 4ª sem mudanças: nenhuma escrita e nada duplicado');

appSet('item', 'i1', { ...appGet('item', 'i1'), feito: true });
appDel('tarefa', ipva.id);
appSet('item', 'i3', { texto: 'Café', lista: 'l1', feito: false });
appSet('tarefa', 'a1', { ...appGet('tarefa', 'a1'), feito: false, feitoEm: null });
sync();
ok(gVivas('Compras').find(t => t.title === 'Leite').status === 'completed', '5ª: riscar no app riscou no Google');
ok(!gVivas('Casa').some(t => t.title === 'Pagar IPVA'), '5ª: apagar no app apagou no Google');
ok(gVivas('Compras').some(t => t.title === 'Café'), '5ª: item novo no app foi para o Google');
const dent = gVivas('Casa').find(t => t.title === 'Marcar dentista');
ok(dent.status === 'needsAction' && !dent.completed, '5ª: reabrir no app reabriu no Google');

gList('Compras').filter(t => t.status === 'completed').forEach(t => { t.hidden = true; t.updated = agora(); }); // "Excluir concluídas"
const pao = gList('Compras').find(t => t.title === 'Pão'); pao.deleted = true; pao.updated = agora();
sync();
ok(!appList('item').some(i => i.texto === 'Leite') && !appList('item').some(i => i.texto === 'Pão'), '6ª: limpar concluídas e apagar no Google removeu do app');
ok(appList('item').some(i => i.texto === 'Dipirona'), '6ª: lista Farmácia do app ficou intacta');

appSet('tarefa', 'a1', { ...appGet('tarefa', 'a1'), titulo: 'Marcar dentista (app)' });
gEdit('Casa', 'Marcar dentista', { title: 'Marcar dentista (Google, mais recente)' });
sync();
ok(appGet('tarefa', 'a1').titulo === 'Marcar dentista (Google, mais recente)', '7ª: conflito nos dois lados, venceu a alteração mais recente');

for (const k of Object.keys(props)) delete props[k]; // estado perdido
const antesG = gVivas('Casa').length + gVivas('Compras').length, antesA = appList('tarefa').length + appList('item').length;
sync(); sync();
ok(gVivas('Casa').length + gVivas('Compras').length === antesG && appList('tarefa').length + appList('item').length === antesA, '8ª: estado perdido: religou pelo título, sem duplicar nos dois lados');

gAdd('Casa', { title: 'Renovar CNH' });
appSet('tarefa', 'a9', { titulo: 'renovar cnh', tipo: 'unica', feito: false });
sync();
ok(gVivas('Casa').filter(t => t.title.toLowerCase() === 'renovar cnh').length === 1, '9ª: mesma tarefa criada nos dois lados antes de sincronizar virou uma só');

// ---- Lista "Minhas tarefas" ----
appSet('tarefa', contador.id, { ...appGet('tarefa', contador.id), titulo: 'Ligar para o contador (IR)', responsavel: 'Renato' }); // edição no app ({ ...t, ...v })
appSet('tarefa', 'a10', { titulo: 'Comprar presente', tipo: 'unica', feito: false });
sync();
ok(gVivas('My Tasks').map(t => t.title).join() === 'Ligar para o contador (IR)', '10ª: editar no app atualizou a tarefa na própria lista "Minhas tarefas"');
ok(gVivas('Casa').some(t => t.title === 'Comprar presente') && !gVivas('My Tasks').some(t => t.title === 'Comprar presente'), '10ª: tarefa nova do app foi só para "Casa"');

gEdit('My Tasks', 'Ligar para o contador (IR)', { status: 'completed', completed: '2026-10-19T10:00:00.000Z' });
gAdd('My Tasks', { title: 'Revisar seguro' });
sync();
ok(appGet('tarefa', contador.id).feito === true && appGet('tarefa', contador.id).responsavel === 'Renato', '11ª: concluir em "Minhas tarefas" concluiu no app, sem perder o responsável');
ok(appList('tarefa').some(t => t.titulo === 'Revisar seguro' && t.lista_google === 'Minhas tarefas'), '11ª: tarefa nova em "Minhas tarefas" entrou no app');

const gM = chamadasGoogle, nM = appList('tarefa').length;
sync();
ok(chamadasGoogle === gM && appList('tarefa').length === nM && gVivas('Casa').length + gVivas('My Tasks').length === nM - 1, '12ª: sem mudanças: nada escrito, nada duplicado entre as listas');
