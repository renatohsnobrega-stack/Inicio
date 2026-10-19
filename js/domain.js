// Regras de negócio: contas, remédios, refeições, eventos e tarefas.
const D = (() => {
  const SLOTS = [
    { id: 'cafe', nome: 'Café da manhã' },
    { id: 'almoco', nome: 'Almoço' },
    { id: 'lanche', nome: 'Lanche' },
    { id: 'jantar', nome: 'Jantar' },
  ];
  const CATEGORIAS = Schema.CATEGORIAS;
  const LOCAIS = ['Cozinha', 'Banheiro', 'Sala', 'Quarto', 'Lavanderia', 'Área externa', 'Rua'];
  const TIPOS_TAREFA = [['unica', 'Uma vez'], ['diaria', 'Todo dia'], ['semanal', 'Dias da semana'], ['mensal', 'Todo mês']];
  const REPETE = [['nao', 'Não repete'], ['semanal', 'Toda semana'], ['mensal', 'Todo mês'], ['anual', 'Todo ano']];

  const LISTAS_SUGERIDAS = [['🛒', 'Compras'], ['💊', 'Farmácia'], ['🔧', 'Casa / manutenção'], ['🎁', 'Presentes e desejos']];
  const CATEG_CONTATO = Schema.CATEG_CONTATO;
  const CORES = ['#2f6f5e', '#b0527a', '#4a6fa5', '#b7791f', '#7a5aa8'];
  const UNIDADES = ['comprimidos', 'cápsulas', 'ml', 'gotas', 'sachês', 'doses', 'unidades'];
  const AVISO_ESTOQUE = 7; // dias de antecedência do aviso de estoque acabando

  const config = id => Store.get('config', id) || {};
  const pessoas = () => {
    const n = (config('pessoas').nomes || []).filter(Boolean);
    return n.length ? n : ['Eu', 'Esposa'];
  };
  const responsaveis = () => [...pessoas(), 'Ambos'];
  const casaNome = () => config('casa').nome || 'Nossa Casa';

  // Quem está usando este aparelho (fica só neste navegador).
  const eu = () => { try { return localStorage.getItem('casa:eu') || ''; } catch { return ''; } };
  const setEu = nome => { try { localStorage.setItem('casa:eu', nome); } catch { /* sem armazenamento */ } };
  const corDe = nome => { const i = pessoas().indexOf(nome); return CORES[(i < 0 ? pessoas().length : i) % CORES.length]; };

  // ---------- Mural ----------
  const recados = () => Store.list('recado')
    .sort((a, b) => (b.fixado ? 1 : 0) - (a.fixado ? 1 : 0) || (b.em || '').localeCompare(a.em || ''));

  // ---------- Listas ----------
  const listas = () => Store.list('lista').sort((a, b) => (a.criadaEm || '').localeCompare(b.criadaEm || ''));
  const itensDa = id => Store.list('item').filter(i => i.lista === id)
    .sort((a, b) => a.feito - b.feito || (a.criadoEm || '').localeCompare(b.criadoEm || ''));

  // ---------- Contatos ----------
  const contatos = () => Store.list('contato').sort((a, b) => a.nome.localeCompare(b.nome));
  const contatosPorCategoria = () => {
    const g = U.groupBy(contatos(), c => c.categoria || 'Outros');
    return Object.keys(g).sort((a, b) => {
      const ia = CATEG_CONTATO.indexOf(a), ib = CATEG_CONTATO.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    }).map(cat => [cat, g[cat]]);
  };
  const telLink = tel => 'tel:' + String(tel || '').replace(/[^\d+]/g, '');
  const waLink = tel => {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return 'https://wa.me/' + d;
  };

  // Itens criados por agentes/automação que ainda não foram conferidos.
  const paraRevisar = () => Schema.REVISAVEIS.flatMap(kind =>
    Store.list(kind).filter(o => o.revisado === false).map(o => ({ kind, obj: o })));

  // ---------- Contas ----------
  function billOccurrences(month) {
    const [y, m] = month.split('-').map(Number);
    const out = [];
    for (const b of Store.list('conta')) {
      let venc = null;
      if (b.tipo === 'unica') {
        if (b.data && b.data.startsWith(month)) venc = b.data;
      } else {
        if (b.inicio && month < b.inicio) continue;
        if (b.fim && month > b.fim) continue;
        const dia = Math.min(Math.max(Number(b.dia) || 1, 1), U.daysInMonth(y, m));
        venc = `${month}-${U.pad(dia)}`;
      }
      if (!venc) continue;
      const pago = b.pagos?.[month] || null;
      out.push({ conta: b, mes: month, venc, valor: Number(pago ? pago.valor : b.valor) || 0, pago });
    }
    return out.sort((a, b) => a.venc.localeCompare(b.venc) || a.conta.nome.localeCompare(b.conta.nome));
  }

  function billStatus(o, ref = U.today()) {
    if (o.pago) return 'pago';
    if (o.venc < ref) return 'atrasada';
    if (o.venc === ref) return 'hoje';
    const diff = (U.parseYmd(o.venc) - U.parseYmd(ref)) / 864e5;
    return diff <= 5 ? 'proxima' : 'pendente';
  }
  const STATUS_LABEL = { pago: 'Paga', atrasada: 'Atrasada', hoje: 'Vence hoje', proxima: 'Em breve', pendente: 'A pagar' };

  // Contas não pagas atrasadas (até 3 meses atrás) ou vencendo nos próximos `dias`.
  function contasAtencao(dias = 10) {
    const limite = U.ymd(U.addDays(new Date(), dias));
    const mes = U.thisMonth();
    const out = [];
    for (let i = -3; i <= 1; i++) out.push(...billOccurrences(U.addMonths(mes, i)));
    return out.filter(o => !o.pago && o.venc <= limite).sort((a, b) => a.venc.localeCompare(b.venc));
  }

  // ---------- Remédios ----------
  function medActiveOn(m, date) {
    if (m.ativo === false) return false;
    if (m.inicio && date < m.inicio) return false;
    if (m.fim && date > m.fim) return false;
    return true;
  }
  const doseKey = (date, medId, hora) => `${date}|${medId}|${hora}`;
  function dosesOn(date) {
    const out = [];
    for (const m of Store.list('remedio')) {
      if (!medActiveOn(m, date)) continue;
      for (const hora of m.horarios || []) {
        const key = doseKey(date, m.id, hora);
        out.push({ med: m, hora, date, key, tomado: !!Store.get('dose', key) });
      }
    }
    return out.sort((a, b) => a.hora.localeCompare(b.hora) || (a.med.pessoa || '').localeCompare(b.med.pessoa || ''));
  }
  const ehSuplemento = m => m.categoria === 'suplemento';
  const temEstoque = m => m.estoque !== '' && m.estoque != null && !isNaN(Number(m.estoque));

  // Estoque: "estoque" é o que havia no começo do dia "estoque_em". Cada dia passado desconta
  // as doses previstas (horários × unidades por dose), mesmo que ninguém marque como tomada.
  function estoque(m, hoje = U.today()) {
    if (!temEstoque(m)) return null;
    const porDose = m.por_dose === '' || m.por_dose == null ? 1 : Number(m.por_dose);
    const n = (m.horarios || []).length;
    let usado = 0;
    const base = m.estoque_em && m.estoque_em < hoje ? m.estoque_em : hoje;
    for (let d = U.parseYmd(base); U.ymd(d) < hoje; d = U.addDays(d, 1)) {
      if (medActiveOn(m, U.ymd(d))) usado += n * porDose;
    }
    const restante = Math.max(0, Math.round((Number(m.estoque) - usado) * 100) / 100);
    const porDia = medActiveOn(m, hoje) ? n * porDose : 0;
    // Dias cobertos contando hoje; "acaba" é o primeiro dia sem remédio.
    const dias = porDia ? Math.floor(restante / porDia) : null;
    const acaba = dias == null ? null : U.ymd(U.addDays(U.parseYmd(hoje), dias));
    const terminaAntes = m.fim && acaba && acaba > m.fim;
    let status = 'ok';
    if (porDia && !terminaAntes) status = dias === 0 ? 'acabou' : dias <= AVISO_ESTOQUE ? 'baixo' : 'ok';
    return { restante, porDia, dias, acaba, status };
  }
  const estoqueAcabando = (hoje = U.today()) => Store.list('remedio')
    .map(med => ({ med, est: estoque(med, hoje) }))
    .filter(x => x.est && x.est.status !== 'ok')
    .sort((a, b) => a.est.dias - b.est.dias || a.med.nome.localeCompare(b.med.nome));
  const fmtQtd = n => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10).replace('.', ','));

  // ---------- Alimentação ----------
  // Sem pessoa = refeição da família. Com pessoa = a dela; se estiver vazia, vale a da família.
  const mealId = (wd, slot, pessoa) => Schema.mealId(wd, slot, pessoa);
  const mealOwn = (wd, slot, pessoa) => Store.get('refeicao', mealId(wd, slot, pessoa))?.texto || '';
  const meal = (wd, slot, pessoa) => (pessoa && mealOwn(wd, slot, pessoa)) || mealOwn(wd, slot);
  // O que cada um come naquela refeição, juntando quem come a mesma coisa:
  // [{ quem: '' , texto }] quando é igual para todos; senão [{ quem: 'Renato e Vanessa', texto }, …].
  function mealResumo(wd, slot) {
    const ps = pessoas();
    if (!ps.some(p => mealOwn(wd, slot, p))) return mealOwn(wd, slot) ? [{ quem: '', texto: mealOwn(wd, slot) }] : [];
    const grupos = new Map();
    for (const p of ps) {
      const t = meal(wd, slot, p);
      if (t) grupos.set(t, [...(grupos.get(t) || []), p]);
    }
    if (grupos.size === 1 && [...grupos.values()][0].length === ps.length) return [{ quem: '', texto: [...grupos.keys()][0] }];
    const junta = l => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0]);
    return [...grupos].map(([texto, l]) => ({ quem: junta(l), texto }));
  }
  const suplementosDe = (pessoa, date = U.today()) => Store.list('remedio')
    .filter(m => ehSuplemento(m) && medActiveOn(m, date) && (pessoa == null || (m.pessoa || '') === pessoa))
    .sort((a, b) => ((a.horarios || [])[0] || '99').localeCompare((b.horarios || [])[0] || '99') || a.nome.localeCompare(b.nome));

  // ---------- Eventos ----------
  function occursOn(ev, date) {
    if (!ev.data) return false;
    if (ev.data === date) return true;
    if (date < ev.data) return false;
    const a = U.parseYmd(ev.data), b = U.parseYmd(date);
    switch (ev.repete) {
      case 'semanal': return a.getDay() === b.getDay();
      case 'mensal': return a.getDate() === b.getDate();
      case 'anual': return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
      default: return false;
    }
  }
  const eventsOn = date => Store.list('evento').filter(ev => occursOn(ev, date))
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  function eventsBetween(start, end) {
    const out = [];
    for (let d = U.parseYmd(start); U.ymd(d) <= end; d = U.addDays(d, 1)) {
      const date = U.ymd(d);
      eventsOn(date).forEach(ev => out.push({ date, ev }));
    }
    return out;
  }

  // ---------- Tarefas ----------
  const isRecorrente = t => ['diaria', 'semanal', 'mensal'].includes(t.tipo);
  function taskApplies(t, date) {
    const d = U.parseYmd(date);
    switch (t.tipo) {
      case 'diaria': return true;
      case 'semanal': return (t.dias || []).includes(U.mondayIndex(d));
      case 'mensal': {
        const last = U.daysInMonth(d.getFullYear(), d.getMonth() + 1);
        return Math.min(Number(t.dia) || 1, last) === d.getDate();
      }
      default: return t.data === date;
    }
  }
  const taskDone = (t, date) => (isRecorrente(t) ? !!t.feitos?.[date] : !!t.feito);
  function tasksOn(date) {
    return Store.list('tarefa').filter(t => isRecorrente(t)
      ? taskApplies(t, date)
      : (!t.feito && (!t.data || t.data <= date)) || (t.feito && t.feitoEm === date))
      .map(t => ({ tarefa: t, date, feito: taskDone(t, date) }))
      .sort((a, b) => a.feito - b.feito || a.tarefa.titulo.localeCompare(b.tarefa.titulo));
  }
  function freqLabel(t) {
    switch (t.tipo) {
      case 'diaria': return 'Todo dia';
      case 'semanal': return (t.dias || []).slice().sort().map(i => U.WDS[i]).join(', ') || 'Semanal';
      case 'mensal': return `Todo dia ${t.dia || 1}`;
      default: return t.data ? `Até ${U.fmtDate(t.data)}` : 'Sem prazo';
    }
  }

  return {
    SLOTS, CATEGORIAS, LOCAIS, TIPOS_TAREFA, REPETE, STATUS_LABEL, LISTAS_SUGERIDAS, CATEG_CONTATO,
    UNIDADES, AVISO_ESTOQUE,
    config, pessoas, responsaveis, casaNome, eu, setEu, corDe,
    paraRevisar, recados, listas, itensDa, contatos, contatosPorCategoria, telLink, waLink,
    billOccurrences, billStatus, contasAtencao,
    medActiveOn, doseKey, dosesOn, ehSuplemento, temEstoque, estoque, estoqueAcabando, fmtQtd,
    mealId, mealOwn, meal, mealResumo, suplementosDe,
    occursOn, eventsOn, eventsBetween,
    isRecorrente, taskApplies, taskDone, tasksOn, freqLabel,
  };
})();
