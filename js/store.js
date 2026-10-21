// Armazenamento de dados.
// - Modo local: tudo fica no navegador (localStorage). Bom para testar.
// - Modo nuvem: Supabase (login + banco + sincronização em tempo real entre os dois).
// Cada registro é guardado como { kind, id, data } — ex.: kind "conta", "remedio", "tarefa".
const Store = (() => {
  const LS_KEY = 'casa-organizada:v1';
  const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  let cache = {};
  let mode = 'local';
  let sb = null;
  let user = null;
  let onError = e => alert('Não foi possível salvar: ' + (e.message || e));
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar ' + src));
    document.head.appendChild(s);
  });

  async function init() {
    const cfg = window.APP_CONFIG || {};
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      await loadScript(SUPABASE_JS);
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      mode = 'cloud';
      const { data } = await sb.auth.getSession();
      user = data.session?.user || null;
    } else {
      try { cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { cache = {}; }
    }
  }

  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    user = data.user;
  }

  async function signOut() {
    if (sb && typeof MuralPush !== 'undefined') await MuralPush.disable();
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    }
    user = null;
    location.reload();
  }

  // Todo dado que entra (tela, nuvem, agentes, importação) passa pela normalização do Schema.
  const setRow = (kind, id, data) => {
    const obj = Schema.normalize(kind, { ...data, id: data?.id || id });
    (cache[kind] = cache[kind] || {})[obj.id] = obj;
    return obj;
  };

  async function loadCloud() {
    cache = {};
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from('registros').select('kind,id,data')
        .order('kind').order('id').range(from, from + size - 1);
      if (error) throw error;
      data.forEach(r => setRow(r.kind, r.id, r.data));
      if (data.length < size) break;
    }
    // Quando o outro alterar algo, a tela atualiza sozinha.
    sb.channel('registros')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registros' }, p => {
        if (p.eventType === 'DELETE') {
          const o = p.old || {};
          if (cache[o.kind]) delete cache[o.kind][o.id];
        } else {
          setRow(p.new.kind, p.new.id, p.new.data);
        }
        emit();
      })
      .subscribe();
  }

  const persistLocal = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) { onError(e); }
  };

  async function write(fn) {
    if (mode === 'local') return persistLocal();
    const { error } = await fn();
    if (error) onError(error);
  }

  const list = kind => Object.values(cache[kind] || {});
  const get = (kind, id) => cache[kind]?.[id];

  async function put(kind, obj) {
    obj = setRow(kind, obj.id || U.uid(), obj);
    emit();
    await write(() => sb.from('registros').upsert({ kind, id: obj.id, data: obj }));
    return obj;
  }

  async function remove(kind, id) {
    if (cache[kind]) delete cache[kind][id];
    emit();
    await write(() => sb.from('registros').delete().eq('kind', kind).eq('id', id));
  }

  async function publishRecado(data) {
    // Chave vazia mantém o app compatível antes da ativação manual do backend.
    if (mode === 'local' || !configPushEnabled()) return put('recado', data);
    const obj = Schema.normalize('recado', { ...data, id: U.uid() });
    // A fila só nasce nesta publicação explícita. Importações/upserts não disparam push.
    await rpc('push_publish_recado', { p_id: obj.id, p_data: obj });
    setRow('recado', obj.id, obj);
    emit();
    return obj;
  }

  const configPushEnabled = () => !!(window.APP_CONFIG || {}).muralPushPublicKey;

  async function removeMany(kind, ids) {
    if (!ids.length) return;
    ids.forEach(id => { if (cache[kind]) delete cache[kind][id]; });
    emit();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      await write(() => sb.from('registros').delete().eq('kind', kind).in('id', chunk));
    }
  }

  // Funções do banco (chaves de API para agentes). Só no modo nuvem.
  async function rpc(name, args = {}) {
    if (!sb) throw new Error('Disponível só no modo nuvem.');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }

  const exportAll = () => JSON.parse(JSON.stringify(cache));

  // Mescla um backup (mesmo formato do exportAll) aos dados atuais.
  async function importAll(data) {
    const rows = [];
    for (const [kind, items] of Object.entries(data || {})) {
      for (const [id, obj] of Object.entries(items || {})) {
        const n = setRow(kind, id, obj);
        rows.push({ kind, id: n.id, data: n });
      }
    }
    emit();
    if (mode === 'local') return persistLocal();
    for (let i = 0; i < rows.length; i += 500) {
      await write(() => sb.from('registros').upsert(rows.slice(i, i + 500)));
    }
  }

  return {
    init, signIn, signOut, loadCloud, list, get, put, publishRecado, remove, removeMany, exportAll, importAll, rpc,
    config: () => window.APP_CONFIG || {},
    mode: () => mode,
    user: () => user,
    subscribe: fn => listeners.add(fn),
    setErrorHandler: fn => { onError = fn; },
  };
})();
