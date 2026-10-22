// Andamento pessoal do Foco. Não altera tarefas, prazos, responsáveis nem notificações.
// Config separada por auth.uid(); no modo local, por pessoa escolhida neste navegador.
const Foco = (() => {
  const ref = (kind, id) => JSON.stringify([kind, id]);
  const conta = () => {
    const pessoa = D.eu();
    if (!pessoa || !D.adultos().includes(pessoa)) return null;
    return `foco-execucao:${Store.user()?.id || 'local:' + encodeURIComponent(pessoa)}`;
  };
  const pendencia = (kind, id) => {
    if (!conta() || !['tarefa', 'item'].includes(kind)) return null;
    return D.focoDe(D.eu(), U.today()).find(p => p.kind === kind && p.obj.id === id && !p.feito) || null;
  };
  const dados = () => {
    const id = conta();
    const salvo = id && Store.get('config', id);
    return { id, dia: U.today(), itens: salvo?.dia === U.today() ? { ...salvo.itens } : {} };
  };
  function status(kind, id) {
    const p = pendencia(kind, id);
    if (!p) return null;
    const salvo = dados().itens[ref(kind, id)];
    // Concluir/reabrir invalida a execução nas duas contas, inclusive se uma estava offline.
    const item = salvo?.revisao === (p.obj.focoRevisao || '') ? salvo : null;
    return { estado: ['andamento', 'pausada'].includes(item?.estado) ? item.estado : 'pronta', nota: typeof item?.nota === 'string' ? item.nota : '' };
  }
  async function mudar(kind, id, acao, nota = '') {
    const atual = status(kind, id);
    if (!atual) throw new Error('Escolha uma pendência no seu Foco do dia.');
    const esperado = { comecar: 'pronta', pausar: 'andamento', retomar: 'pausada' };
    if (!esperado[acao] || atual.estado !== esperado[acao]) throw new Error('O foco mudou. Confira o estado atual antes de continuar.');
    const data = dados();
    const key = ref(kind, id);
    if (acao !== 'pausar') {
      // Uma coisa de cada vez. A troca preserva a nota da tarefa anterior.
      for (const [k, item] of Object.entries(data.itens)) {
        if (item?.estado === 'andamento') data.itens[k] = { ...item, estado: 'pausada' };
      }
    }
    data.itens[key] = {
      estado: acao === 'pausar' ? 'pausada' : 'andamento',
      nota: acao === 'pausar' ? String(nota || '').trim().slice(0, 500) : atual.nota,
      revisao: pendencia(kind, id).obj.focoRevisao || '',
    };
    await Store.put('config', data);
  }
  async function limpar(kind, id) {
    if (!conta()) return;
    const data = dados();
    const key = ref(kind, id);
    if (!Object.hasOwn(data.itens, key)) return;
    delete data.itens[key];
    await Store.put('config', data);
  }
  return { status, mudar, limpar };
})();
