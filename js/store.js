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
  let profileName = '';
  // Em nuvem, mantém o JSONB original separado do objeto normalizado para a UI. Assim snapshots
  // legados (sem id/campos opcionais no data) continuam comparáveis byte-semantically via jsonb.
  const itemRawSnapshots = new Map();
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
    profileName = '';
  }

  async function signOut() {
    if (sb && typeof MuralPush !== 'undefined') await MuralPush.disable();
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    }
    user = null;
    profileName = '';
    location.reload();
  }

  // Todo dado que entra (tela, nuvem, agentes, importação) passa pela normalização do Schema.
  const setRow = (kind, id, data) => {
    const obj = Schema.normalize(kind, { ...data, id: data?.id || id });
    (cache[kind] = cache[kind] || {})[obj.id] = obj;
    if (kind === 'item') itemRawSnapshots.set(obj.id, { raw: JSON.parse(JSON.stringify(data)), normalized: JSON.parse(JSON.stringify(obj)) });
    return obj;
  };

  async function loadCloud() {
    cache = {};
    itemRawSnapshots.clear();
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from('registros').select('kind,id,data')
        .order('kind').order('id').range(from, from + size - 1);
      if (error) throw error;
      data.forEach(r => setRow(r.kind, r.id, r.data));
      if (data.length < size) break;
    }
    // O servidor retorna somente o nome vinculado a auth.uid(), nunca perfis alheios.
    // Sem a migração, mantém o fallback manual isolado por conta (não o dono do aparelho).
    profileName = '';
    try {
      const { data, error } = await sb.rpc('current_member_profile');
      if (!error && typeof data === 'string') profileName = data;
    } catch { /* indisponível: identificação manual por conta */ }
    // Quando o outro alterar algo, a tela atualiza sozinha.
    sb.channel('registros')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registros' }, p => {
        if (p.eventType === 'DELETE') {
          const o = p.old || {};
          if (cache[o.kind]) delete cache[o.kind][o.id];
          if (o.kind === 'item') itemRawSnapshots.delete(o.id);
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

  // Usada por Veículos: só atualiza a tela/cache depois que a persistência confirma.
  // Evita indicar sucesso ao anexar arquivos se faltar espaço local ou a rede falhar.
  async function putConfirmed(kind, data) {
    const obj = Schema.normalize(kind, { ...data, id: data.id || U.uid() });
    if (mode === 'local') {
      const next = { ...cache, [kind]: { ...(cache[kind] || {}), [obj.id]: obj } };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); }
      catch { throw new Error('Não foi possível salvar neste navegador. Libere espaço ou reduza os anexos e tente novamente.'); }
    } else {
      const { error } = await sb.from('registros').upsert({ kind, id: obj.id, data: obj });
      if (error) throw error;
    }
    setRow(kind, obj.id, obj);
    emit();
    return obj;
  }

  async function removeConfirmed(kind, id) {
    if (mode === 'local') {
      const items = { ...(cache[kind] || {}) };
      delete items[id];
      const next = { ...cache, [kind]: items };
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } else {
      const { error } = await sb.from('registros').delete().eq('kind', kind).eq('id', id);
      if (error) throw error;
    }
    if (cache[kind]) delete cache[kind][id];
    emit();
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

  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
  };
  const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const withoutReceipt = value => { const copy = { ...value }; delete copy.nota; return copy; };

  // A finalização grava o ledger e remove snapshots de itens numa única transação (RPC na nuvem,
  // gravação localStorage única no modo local). Em nenhum caso a interface antecipa a confirmação.
  async function finalizePurchase(purchase, sources) {
    if (!purchase || !purchase.id || !Array.isArray(purchase.itens) || !Array.isArray(sources)) {
      throw new Error('Compra inválida: informe id, itens e snapshots originais dos itens marcados.');
    }
    const obj = Schema.normalize('compra', { ...purchase, id: String(purchase.id) });
    const reviewedReceipt = obj.origem === 'nota-revisada';
    if (obj.id.length > 200 || !obj.lista || String(obj.lista).length > 200 || obj.itens.length > 500 || sources.length > 500) {
      throw new Error('Compra inválida: id, lista ou quantidade de itens fora dos limites permitidos.');
    }
    const snapshots = sources.map(source => {
      if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.id !== 'string' || source.id.trim() === '' || source.id.length > 200) {
        throw new Error('Snapshot inválido: cada item marcado precisa ter id.');
      }
      return { id: String(source.id), snapshot: JSON.parse(JSON.stringify(source)) };
    });
    if (new Set(snapshots.map(s => s.id)).size !== snapshots.length) throw new Error('Snapshot inválido: há itens repetidos.');
    const lineIds = obj.itens.map(line => line && typeof line === 'object' && !Array.isArray(line) && typeof line.itemId === 'string' ? line.itemId : '');
    if (!lineIds.length || lineIds.some(id => !id || id.length > 200) || new Set(lineIds).size !== lineIds.length) {
      throw new Error('A compra precisa conter de 1 a 500 linhas com itemId válido e exclusivo.');
    }
    const sourceIds = new Set(snapshots.map(source => source.id));
    if (reviewedReceipt) {
      const invalidSynthetic = lineIds.some(id => !sourceIds.has(id) && !/^nota-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (snapshots.some(source => !lineIds.includes(source.id))) {
        throw new Error('Cada item vinculado à lista precisa corresponder a exatamente uma linha da compra.');
      }
      if (invalidSynthetic) throw new Error('Linhas sem vínculo com a lista precisam usar um itemId sintético nota-<UUID>.');
    } else if (!snapshots.length || lineIds.length !== snapshots.length || lineIds.some(id => !sourceIds.has(id))) {
      throw new Error('A compra manual deve conter exatamente uma linha para cada item selecionado.');
    }
    for (const source of snapshots) {
      if (!source.snapshot || typeof source.snapshot !== 'object' || Array.isArray(source.snapshot)) {
        throw new Error('Snapshot inválido: cada item precisa conter um objeto original.');
      }
      if (source.snapshot.id != null && String(source.snapshot.id) !== source.id) {
        throw new Error(`Snapshot inválido: o id ${source.id} diverge do id do item.`);
      }
      if (String(source.snapshot.lista ?? '') !== String(obj.lista)) throw new Error(`O item ${source.id} não pertence à lista desta compra.`);
      const originalState = mode === 'cloud' ? itemRawSnapshots.get(source.id)?.raw : source.snapshot;
      if (!reviewedReceipt && originalState?.feito != null && originalState.feito !== true) {
        throw new Error(`O item ${source.id} não está marcado para compra.`);
      }
    }

    if (mode === 'local') {
      const existing = cache.compra?.[obj.id];
      if (existing) {
        if (sameJson(withoutReceipt(existing), withoutReceipt(obj))) return existing;
        throw new Error('Já existe uma compra finalizada com este id e dados diferentes.');
      }
      for (const source of snapshots) {
        const current = cache.item?.[source.id];
        if (!current) throw new Error(`O item ${source.id} não está mais ativo; atualize a lista e tente novamente.`);
        if (!sameJson(current, source.snapshot)) throw new Error(`O item ${source.id} mudou desde a seleção; atualize a lista antes de finalizar.`);
      }
      const next = { ...cache, compra: { ...(cache.compra || {}), [obj.id]: obj }, item: { ...(cache.item || {}) } };
      snapshots.forEach(({ id }) => { delete next.item[id]; });
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); }
      catch { throw new Error('Não foi possível salvar a compra neste navegador. Libere espaço ou reduza os dados e tente novamente.'); }
      cache = next;
      snapshots.forEach(({ id }) => itemRawSnapshots.delete(id));
      emit();
      return obj;
    }

    const alreadySaved = cache.compra?.[obj.id];
    if (alreadySaved) {
      if (sameJson(withoutReceipt(alreadySaved), withoutReceipt(obj))) return alreadySaved;
      throw new Error('Já existe uma compra finalizada com este id e dados diferentes.');
    }
    const cloudSnapshots = snapshots.map(({ id, snapshot }) => {
      const raw = itemRawSnapshots.get(id);
      if (!raw || !sameJson(raw.normalized, snapshot)) {
        throw new Error(`O item ${id} mudou desde a seleção; atualize a lista antes de finalizar.`);
      }
      return { id, snapshot: raw.raw };
    });
    const saved = await rpc('finalize_purchase', { p_purchase: obj, p_sources: cloudSnapshots });
    const confirmed = saved || obj;
    // Realtime pode já ter trazido alterações concorrentes. Só retire do cache o snapshot ainda igual.
    const nextItems = { ...(cache.item || {}) };
    snapshots.forEach(({ id, snapshot }) => {
      if (nextItems[id] && sameJson(nextItems[id], snapshot)) {
        delete nextItems[id];
        itemRawSnapshots.delete(id);
      }
    });
    cache = { ...cache, item: nextItems };
    setRow('compra', obj.id, confirmed);
    emit();
    return get('compra', obj.id);
  }

  const RECEIPT_TYPES = {
    'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'application/pdf': ['pdf'],
  };
  async function validateReceiptFile(file) {
    if (!file || !RECEIPT_TYPES[file.type] || file.size < 1 || file.size > 8 * 1024 * 1024) {
      throw new Error('Nota inválida: use JPEG, PNG, WebP ou PDF com até 8 MB.');
    }
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    if (!RECEIPT_TYPES[file.type].includes(ext)) throw new Error('A extensão do arquivo não corresponde ao tipo informado.');
    if (typeof file.arrayBuffer !== 'function') throw new Error('Não foi possível verificar o conteúdo deste arquivo.');
    const b = new Uint8Array(await file.arrayBuffer());
    const is = (offset, bytes) => bytes.every((byte, i) => b[offset + i] === byte);
    const signatureOK = file.type === 'image/jpeg' ? is(0, [0xff, 0xd8, 0xff])
      : file.type === 'image/png' ? is(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : file.type === 'image/webp' ? b.length >= 12 && is(0, [0x52, 0x49, 0x46, 0x46]) && is(8, [0x57, 0x45, 0x42, 0x50])
          : is(0, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    if (!signatureOK) throw new Error('A assinatura do arquivo não corresponde a JPEG, PNG, WebP ou PDF.');
    return ext;
  }

  async function attachPurchaseReceipt(id, file) {
    if (mode !== 'cloud' || !sb) throw new Error('Anexar nota exige conexão com a nuvem; arquivos nunca são guardados localmente.');
    const purchase = get('compra', id);
    if (!purchase) throw new Error('Compra não encontrada. Sincronize o histórico e tente novamente.');
    if (purchase.nota) throw new Error('Esta compra já tem uma nota anexada.');
    const ext = await validateReceiptFile(file);
    const uuid = crypto.randomUUID();
    const path = `familia/${id}/${uuid}.${ext}`;
    const { error: uploadError } = await sb.storage.from('notas-compras').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const nota = { path, nome: String(file.name || 'nota'), type: file.type, size: file.size };
    let saved;
    try {
      saved = await rpc('attach_purchase_receipt', { p_id: String(id), p_nota: nota });
    } catch (error) {
      // Confirma que o path segue órfão antes de limpar; se a resposta do RPC se perdeu após commit,
      // a função do banco detecta a referência e evita apagar o anexo já associado.
      try {
        const unattached = await rpc('purchase_receipt_path_unattached', { p_id: String(id), p_path: path });
        if (unattached) await sb.storage.from('notas-compras').remove([path]);
      } catch { /* limpeza best-effort; pode restar um objeto órfão se rede/política falhar */ }
      throw error;
    }
    setRow('compra', String(id), saved || { ...purchase, nota });
    emit();
    return get('compra', String(id));
  }

  async function purchaseReceiptUrl(id) {
    if (mode !== 'cloud' || !sb) throw new Error('Visualizar nota exige conexão com a nuvem.');
    const purchase = get('compra', id);
    if (!purchase?.nota?.path) throw new Error('Esta compra não tem nota anexada.');
    const { data, error } = await sb.storage.from('notas-compras').createSignedUrl(purchase.nota.path, 300);
    if (error) throw error;
    return data.signedUrl;
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
    init, signIn, signOut, loadCloud, list, get, put, putConfirmed, publishRecado, remove, removeConfirmed, removeMany, exportAll, importAll, rpc,
    finalizePurchase, attachPurchaseReceipt, purchaseReceiptUrl,
    config: () => window.APP_CONFIG || {},
    mode: () => mode,
    user: () => user,
    profileName: () => profileName,
    subscribe: fn => listeners.add(fn),
    setErrorHandler: fn => { onError = fn; },
  };
})();
