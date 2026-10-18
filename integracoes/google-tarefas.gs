/**
 * Casa Organizada — sincroniza o Google Tarefas com o app, nos dois sentidos, sem IA.
 *
 * Duas listas do Google Tarefas ficam espelhadas no app:
 *  - "Casa"    ⇄ Tarefas avulsas do app (as de "Uma vez"; rotinas que se repetem ficam só no app)
 *  - "Compras" ⇄ Listas → Compras do app
 * Criar, editar, concluir ou apagar num lado reflete no outro a cada 15 minutos.
 *
 * Como usar (uma vez só, uns 5 minutos):
 *  1. Acesse https://script.google.com → "Novo projeto" e cole este arquivo inteiro.
 *  2. No menu da esquerda, em "Serviços", clique em + e adicione "Google Tasks API".
 *  3. Preencha o CONFIG abaixo (endereço e chaves do app: Automação → API para agentes).
 *  4. Escolha a função "instalar" e clique em ▶ Executar. Autorize o acesso.
 *
 * Em conflito (a mesma tarefa mudou nos dois lados entre duas sincronizações), vale a
 * alteração mais recente. "Excluir tarefas concluídas" no Google também tira do app.
 */
const CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  ANON_KEY: 'sua chave publishable/anon do Supabase',
  CHAVE: 'casa_... (chave criada no app)',
  LISTA_TAREFAS: 'Casa',      // nome da lista no Google Tarefas ('' para não sincronizar)
  LISTA_COMPRAS: 'Compras',   // nome da lista no Google Tarefas ('' para não sincronizar)
  LISTA_COMPRAS_APP: 'Compras', // nome da lista no app
};

const PREFIXO = 'gtasks-';

function sincronizarTarefas() {
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(30000)) return; // outra sincronização em andamento
  try {
    if (CONFIG.LISTA_TAREFAS) sincronizarPar(parTarefas());
    if (CONFIG.LISTA_COMPRAS) sincronizarPar(parCompras());
  } finally {
    trava.releaseLock();
  }
}

// ---------- Como cada lado é lido e escrito ----------
function parTarefas() {
  return {
    nome: 'tarefas',
    listaGoogle: CONFIG.LISTA_TAREFAS,
    tipo: 'tarefa',
    doApp: () => listarApp('tarefa').filter(r => (r.dados.tipo || 'unica') === 'unica'),
    paraApp: (g, id) => ({
      tipo: 'tarefa', id,
      dados: {
        titulo: g.title, tipo: 'unica', obs: g.notes || '',
        data: g.due ? g.due.slice(0, 10) : '',
        feito: g.status === 'completed',
        feitoEm: g.status === 'completed' ? (g.completed || new Date().toISOString()).slice(0, 10) : null,
        origem: 'google-tarefas', revisado: true,
      },
    }),
    paraGoogle: d => ({
      title: d.titulo || '(sem título)', notes: d.obs || '',
      due: d.data ? d.data + 'T00:00:00.000Z' : null,
      status: d.feito ? 'completed' : 'needsAction',
      completed: d.feito ? undefined : null,
    }),
  };
}

function parCompras() {
  const listaApp = listaDoApp(CONFIG.LISTA_COMPRAS_APP);
  return {
    nome: 'compras',
    listaGoogle: CONFIG.LISTA_COMPRAS,
    tipo: 'item',
    doApp: () => listarApp('item').filter(r => r.dados.lista === listaApp),
    paraApp: (g, id) => ({
      tipo: 'item', id,
      dados: { texto: g.title, lista: listaApp, feito: g.status === 'completed', origem: 'google-tarefas' },
    }),
    paraGoogle: d => ({
      title: d.texto || '(sem nome)',
      status: d.feito ? 'completed' : 'needsAction',
      completed: d.feito ? undefined : null,
    }),
  };
}

// ---------- Sincronização de um par de listas ----------
function sincronizarPar(par) {
  const listaId = listaDoGoogle(par.listaGoogle);
  const chaveEstado = 'estado:' + par.nome + ':' + listaId;
  const props = PropertiesService.getScriptProperties();
  const estado = JSON.parse(props.getProperty(chaveEstado) || '{}'); // appId → { g, a, gs }

  const app = porId(par.doApp(), r => r.id);
  const google = porId(tarefasDoGoogle(listaId), t => t.id);
  const vivo = t => t && !t.deleted && !t.hidden && t.title;
  const novo = {};
  const salvar = [];
  const removerApp = [];
  const ligados = new Set();
  const quando = s => new Date(s).getTime();

  // 1) Pares já conhecidos
  Object.keys(estado).forEach(appId => {
    const e = estado[appId];
    const a = app[appId];
    const g = google[e.g];
    ligados.add(e.g);
    if (!a && !vivo(g)) return;                                       // sumiu dos dois lados
    if (!a) { Tasks.Tasks.remove(listaId, e.g); return; }             // apagado no app
    if (!vivo(g)) { removerApp.push(appId); return; }                 // apagado/limpo no Google
    const mudouApp = a.atualizado_em !== e.a;
    const mudouGoogle = g.updated !== e.gs;
    if (mudouGoogle && (!mudouApp || quando(g.updated) > quando(a.atualizado_em))) {
      salvar.push(par.paraApp(g, appId));
    } else if (mudouApp) {
      Tasks.Tasks.patch(par.paraGoogle(a.dados), listaId, g.id);
    }
    novo[appId] = { g: g.id };
  });

  // 2) Novos no app → criar no Google (ou religar a uma tarefa de mesmo título,
  //    para não duplicar na primeira instalação ou se o estado se perder)
  const titulo = d => String(d.titulo || d.texto || '').trim().toLowerCase();
  const soltas = {};
  Object.keys(google).forEach(gid => {
    const g = google[gid];
    if (!ligados.has(gid) && vivo(g) && !soltas[g.title.trim().toLowerCase()]) soltas[g.title.trim().toLowerCase()] = gid;
  });
  Object.keys(app).forEach(appId => {
    if (estado[appId]) return;
    const gid = appId.indexOf(PREFIXO) === 0 ? appId.slice(PREFIXO.length) : null;
    if (gid && vivo(google[gid])) { ligados.add(gid); novo[appId] = { g: gid }; return; }
    if (gid) { removerApp.push(appId); return; }                      // veio do Google e foi apagado lá
    const igual = soltas[titulo(app[appId].dados)];
    if (igual && !ligados.has(igual)) { ligados.add(igual); novo[appId] = { g: igual }; return; }
    const criada = Tasks.Tasks.insert(par.paraGoogle(app[appId].dados), listaId);
    ligados.add(criada.id);
    novo[appId] = { g: criada.id };
  });

  // 3) Novos no Google → criar no app
  Object.keys(google).forEach(gid => {
    if (ligados.has(gid) || !vivo(google[gid])) return;
    const appId = PREFIXO + gid;
    salvar.push(par.paraApp(google[gid], appId));
    novo[appId] = { g: gid };
  });

  for (let i = 0; i < salvar.length; i += 500) chamar('agente_salvar', { registros: salvar.slice(i, i + 500) });
  removerApp.forEach(id => chamar('agente_remover', { tipo: par.tipo, id }));

  // 4) Guarda como cada lado ficou, para detectar a próxima mudança
  if (salvar.length || removerApp.length || Object.keys(novo).length !== Object.keys(estado).length) {
    Object.assign(app, porId(par.doApp(), r => r.id));
  }
  const google2 = porId(tarefasDoGoogle(listaId), t => t.id);
  Object.keys(novo).forEach(appId => {
    if (!app[appId] || !google2[novo[appId].g]) { delete novo[appId]; return; }
    novo[appId].a = app[appId].atualizado_em;
    novo[appId].gs = google2[novo[appId].g].updated;
  });
  props.setProperty(chaveEstado, JSON.stringify(novo));
  console.log(`${par.nome}: ${Object.keys(novo).length} itens · ${salvar.length} gravados no app · ${removerApp.length} removidos do app`);
}

// ---------- Google Tarefas ----------
function listaDoGoogle(nome) {
  const listas = Tasks.Tasklists.list({ maxResults: 100 }).items || [];
  const achada = listas.find(l => l.title.toLowerCase() === nome.toLowerCase());
  return (achada || Tasks.Tasklists.insert({ title: nome })).id;
}

function tarefasDoGoogle(listaId) {
  const out = [];
  let pageToken;
  do {
    const r = Tasks.Tasks.list(listaId, { showCompleted: true, showHidden: true, showDeleted: true, maxResults: 100, pageToken });
    (r.items || []).forEach(t => out.push(t));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

// ---------- App (API para agentes) ----------
function listarApp(tipo) {
  return chamar('agente_listar', { tipo }) || [];
}

function listaDoApp(nome) {
  const achada = listarApp('lista').find(r => (r.dados.nome || '').toLowerCase() === nome.toLowerCase());
  if (achada) return achada.id;
  const id = 'lista-' + nome.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  chamar('agente_salvar', { registros: [{ tipo: 'lista', id, dados: { nome, icone: '🛒' } }] });
  return id;
}

function chamar(funcao, corpo) {
  const resp = UrlFetchApp.fetch(CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + funcao, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: CONFIG.ANON_KEY, Authorization: 'Bearer ' + CONFIG.ANON_KEY },
    payload: JSON.stringify(Object.assign({ chave: CONFIG.CHAVE }, corpo)),
    muteHttpExceptions: true,
  });
  const texto = resp.getContentText();
  if (resp.getResponseCode() >= 300) throw new Error(funcao + ' falhou (' + resp.getResponseCode() + '): ' + texto);
  return texto ? JSON.parse(texto) : null;
}

function porId(lista, fn) {
  const out = {};
  lista.forEach(x => { out[fn(x)] = x; });
  return out;
}

/** Rode uma vez: sincroniza agora e agenda para rodar sozinho a cada 15 minutos. */
function instalar() {
  desinstalar();
  ScriptApp.newTrigger('sincronizarTarefas').timeBased().everyMinutes(15).create();
  sincronizarTarefas();
}

/** Para parar a sincronização automática. */
function desinstalar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizarTarefas')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
