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
  const AVISO_ANIVERSARIO = 7; // dias de antecedência do aviso de aniversário no Painel

  const config = id => Store.get('config', id) || {};
  const pessoas = () => {
    const n = (config('pessoas').nomes || []).filter(Boolean);
    return n.length ? n : ['Eu', 'Esposa'];
  };
  // Filhos aparecem em remédios, alimentação e agenda, mas não recebem tarefas nem pagam contas.
  const filhos = () => (config('pessoas').filhos || []).filter(n => pessoas().includes(n));
  const adultos = () => pessoas().filter(n => !filhos().includes(n));
  const responsaveis = () => [...adultos(), 'Ambos'];
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
  // Pendentes primeiro; entre eles, os com prazo (mais urgente antes) e depois os sem prazo.
  const itensDa = id => Store.list('item').filter(i => i.lista === id)
    .sort((a, b) => a.feito - b.feito || (a.prazo || '9').localeCompare(b.prazo || '9') || (a.criadoEm || '').localeCompare(b.criadoEm || ''));

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

  // ---------- Aniversários (só dos contatos cadastrados) ----------
  const aniversarioDe = c => Schema.parseAniversario(c?.aniversario);
  // Próximo aniversário a partir de `hoje` (inclusive). Quem nasceu em 29/02 comemora em 28/02 nos anos comuns.
  // idade = quantos anos a pessoa faz nesse dia (null se o ano não foi informado).
  function proximoAniversario(c, hoje = U.today()) {
    const a = aniversarioDe(c);
    if (!a) return null;
    const y0 = Number(hoje.slice(0, 4));
    for (const y of [y0, y0 + 1]) {
      const data = `${y}-${U.pad(a.mes)}-${U.pad(Math.min(a.dia, U.daysInMonth(y, a.mes)))}`;
      if (data < hoje) continue;
      const dias = Math.round((U.parseYmd(data) - U.parseYmd(hoje)) / 864e5);
      return { contato: c, data, dias, mes: a.mes, dia: a.dia, idade: a.ano && a.ano < y ? y - a.ano : null };
    }
    return null;
  }
  const aniversarios = (hoje = U.today()) => contatos().map(c => proximoAniversario(c, hoje)).filter(Boolean)
    .sort((a, b) => a.dias - b.dias || a.contato.nome.localeCompare(b.contato.nome));
  const aniversariosProximos = (dias = AVISO_ANIVERSARIO, hoje = U.today()) => aniversarios(hoje).filter(x => x.dias <= dias);
  const aniversariantesEm = date => aniversarios(date).filter(x => x.dias === 0);
  // "hoje", "amanhã", "em 5 dias"
  const quandoTxt = dias => (dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`);

  // ---------- Filhos: dados de nascimento, idade, marcos, medidas e história médica ----------
  // Cada filho tem um registro "crianca" com id = nome sem acento ("antonio").
  const criancaId = nome => Schema.slug(nome);
  const crianca = nome => Store.get('crianca', criancaId(nome)) || { id: criancaId(nome), nome };
  // Data de nascimento + n meses (31/01 + 1 mês = 28/02).
  function mesesDepois(nasc, n) {
    const a = U.parseYmd(nasc);
    const t = a.getMonth() + n, y = a.getFullYear() + Math.floor(t / 12), m = ((t % 12) + 12) % 12 + 1;
    return `${y}-${U.pad(m)}-${U.pad(Math.min(a.getDate(), U.daysInMonth(y, m)))}`;
  }
  // Idade entre duas datas: meses completos + dias; "total" em meses com fração (para achar a faixa).
  function idadeEntre(nasc, data) {
    if (!nasc || data < nasc) return null;
    const a = U.parseYmd(nasc), b = U.parseYmd(data);
    let meses = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    if (mesesDepois(nasc, meses) > data) meses--;
    const dias = Math.round((b - U.parseYmd(mesesDepois(nasc, meses))) / 864e5);
    return { meses, dias, total: meses + dias / 30.4375 };
  }
  const igSemanas = c => (Number(c?.ig_semanas) || 0) + (Number(c?.ig_dias) || 0) / 7;
  // Prematuro (< 37 semanas): desconta o que faltou para 40 semanas, até os 2 anos de idade
  // (até os 3 anos se nasceu com menos de 28 semanas). Caderneta da Criança, p. 20 e 79.
  function idadeCrianca(c, hoje = U.today()) {
    const real = idadeEntre(c?.nascimento, hoje);
    if (!real) return null;
    const ig = igSemanas(c);
    let corrigida = null;
    if (ig && ig < 37 && real.meses < (ig < 28 ? 36 : 24)) {
      const ref = U.ymd(U.addDays(U.parseYmd(hoje), -Math.round((40 - ig) * 7)));
      corrigida = idadeEntre(c.nascimento, ref) || { meses: 0, dias: 0, total: 0, antesDoTermo: true };
    }
    return { real, corrigida, usada: corrigida || real };
  }
  // Idade em dias numa data, para as curvas da OMS. Prematuro: idade corrigida pelas mesmas regras
  // da Caderneta ("Se não for utilizar o gráfico Intergrowth-21, calcular a idade corrigida", p. 20).
  function idadeDias(c, data) {
    if (!c?.nascimento || !data || data < c.nascimento) return null;
    const dias = Math.round((U.parseYmd(data) - U.parseYmd(c.nascimento)) / 864e5);
    const ig = igSemanas(c);
    const meses = idadeEntre(c.nascimento, data).meses;
    if (ig && ig < 37 && meses < (ig < 28 ? 36 : 24)) {
      const d = dias - Math.round((40 - ig) * 7);
      return { dias: Math.max(0, d), corrigida: true, antesDoTermo: d < 0 };
    }
    return { dias, corrigida: false };
  }
  // Escore-z, percentil e classificação de cada medida (precisa do sexo e das tabelas da OMS carregadas).
  function avaliarMedida(c, m, ind) {
    const id = idadeDias(c, m.data);
    const x = Number(m[ind]);
    if (!id || id.antesDoTermo || !x || !['M', 'F'].includes(c.sexo) || !Crescimento.pronto()) return null;
    const z = Crescimento.zscore(ind, c.sexo, id.dias, x);
    return z == null ? null : { z, p: Crescimento.percentil(z), classe: Crescimento.classificar(ind, z), dias: id.dias, corrigida: id.corrigida };
  }

  // "12 dias", "3 meses e 5 dias", "2 anos e 1 mês"
  function idadeTxt(i) {
    if (!i) return '';
    if (i.antesDoTermo) return 'ainda antes das 40 semanas';
    const pl = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    if (i.meses === 0) return pl(i.dias, 'dia', 'dias');
    if (i.meses < 24) return pl(i.meses, 'mês', 'meses') + (i.dias ? ` e ${pl(i.dias, 'dia', 'dias')}` : '');
    const a = Math.floor(i.meses / 12), r = i.meses % 12;
    return pl(a, 'ano', 'anos') + (r ? ` e ${pl(r, 'mês', 'meses')}` : '');
  }
  const faixaMarcos = idade => (idade ? Caderneta.FAIXAS.find(f => idade.total >= f.ini && idade.total < f.fim) || null : null);
  // Marcos: um registro por marco ({ crianca, marco, s: "P" | "A" | "NV", em }).
  const marcoKey = (cid, marco) => `${cid}-${marco}`;
  const marcoDe = (cid, marco) => Store.get('marco', marcoKey(cid, marco)) || null;
  // Para a família: marcos marcados como ausentes na faixa atual e na anterior (a Caderneta manda conferir a anterior
  // quando falta algum, p. 79). A classificação do desenvolvimento é do profissional (p. 80); o app só aponta o que conversar.
  function marcosAtencao(c, hoje = U.today()) {
    const f = faixaMarcos(idadeCrianca(c, hoje)?.usada);
    if (!f) return [];
    const ant = Caderneta.FAIXAS[f.i - 1];
    return [ant, f].filter(Boolean).flatMap(x => x.marcos.filter(m => marcoDe(c.id, m.id)?.s === 'A').map(m => ({ marco: m, faixa: x })));
  }
  // Marcos da faixa anterior ainda sem marcação (só um lembrete, não um alerta).
  function marcosSemMarcar(c, hoje = U.today()) {
    const f = faixaMarcos(idadeCrianca(c, hoje)?.usada);
    const ant = f && Caderneta.FAIXAS[f.i - 1];
    return ant ? ant.marcos.filter(m => !marcoDe(c.id, m.id)) : [];
  }
  // Consultas da Caderneta com a data aproximada; "evento" = a consulta já agendada pelo app.
  const consultaEventoId = (cid, nome) => `consulta-${cid}-${Schema.slug(nome)}`;
  const consultasRecomendadas = c => (c?.nascimento ? Caderneta.CONSULTAS.map(x => ({
    ...x,
    data: x.dias ? U.ymd(U.addDays(U.parseYmd(c.nascimento), x.dias)) : mesesDepois(c.nascimento, x.meses),
    evento: Store.get('evento', consultaEventoId(c.id, x.nome)) || null,
  })) : []);
  const medidasDe = cid => Store.list('medida').filter(m => m.crianca === cid).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const historiaDe = cid => Store.list('historia').filter(h => h.crianca === cid).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const TIPOS_HISTORIA = ['Consulta', 'Doença', 'Exame', 'Vacina', 'Internação', 'Cirurgia', 'Alergia', 'Outro'];

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
  // ---------- Pendências por prazo (tarefas + itens de lista com prazo) ----------
  const FAIXAS = [
    { id: 'atrasado', nome: 'Atrasado' }, { id: 'hoje', nome: 'Hoje' }, { id: 'semana', nome: 'Próximos 7 dias' },
    { id: 'depois', nome: 'Depois' }, { id: 'sem', nome: 'Sem prazo' },
  ];
  function faixaDe(data, hoje = U.today()) {
    if (!data) return 'sem';
    if (data < hoje) return 'atrasado';
    if (data === hoje) return 'hoje';
    return data <= U.ymd(U.addDays(U.parseYmd(hoje), 7)) ? 'semana' : 'depois';
  }
  const ehDe = (quem, pessoa) => !pessoa || !quem || quem === pessoa || quem === 'Ambos';
  // Tudo o que está por fazer, cada coisa com a sua faixa de prazo. Rotinas entram só no dia em que caem.
  // O que foi concluído hoje continua aparecendo (riscado) para dar a sensação de progresso.
  function pendencias(hoje = U.today(), pessoa = '') {
    const out = [];
    for (const t of Store.list('tarefa')) {
      if (!ehDe(t.responsavel, pessoa)) continue;
      if (isRecorrente(t)) {
        if (taskApplies(t, hoje)) out.push({ kind: 'tarefa', obj: t, titulo: t.titulo, data: hoje, feito: taskDone(t, hoje), quem: t.responsavel, recorrente: true });
        continue;
      }
      if (t.feito && t.feitoEm !== hoje) continue;
      out.push({ kind: 'tarefa', obj: t, titulo: t.titulo, data: t.data || '', feito: !!t.feito, quem: t.responsavel });
    }
    const nomes = Object.fromEntries(listas().map(l => [l.id, l]));
    for (const i of Store.list('item')) {
      if (!i.prazo || (i.feito && i.feitoEm !== hoje)) continue;
      out.push({ kind: 'item', obj: i, titulo: i.texto, data: i.prazo, feito: !!i.feito, lista: nomes[i.lista] });
    }
    return out.map(p => ({ ...p, faixa: faixaDe(p.data, hoje) }))
      .sort((a, b) => a.feito - b.feito || (a.data || '9').localeCompare(b.data || '9') || a.titulo.localeCompare(b.titulo));
  }
  // Foco do dia: até 3 coisas por pessoa. Fica no próprio registro ({ foco: { Renato: '2026-10-19' } })
  // e vale só para aquele dia; amanhã a lista começa vazia.
  const FOCO_MAX = 3;
  const emFoco = (o, pessoa, hoje = U.today()) => (o.foco || {})[pessoa || 'casa'] === hoje;
  const focoDe = (pessoa, hoje = U.today()) => pendencias(hoje).filter(p => emFoco(p.obj, pessoa, hoje));

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
    UNIDADES, AVISO_ESTOQUE, AVISO_ANIVERSARIO,
    config, pessoas, filhos, adultos, responsaveis, casaNome, eu, setEu, corDe,
    paraRevisar, recados, listas, itensDa, contatos, contatosPorCategoria, telLink, waLink,
    aniversarioDe, proximoAniversario, aniversarios, aniversariosProximos, aniversariantesEm, quandoTxt,
    billOccurrences, billStatus, contasAtencao,
    medActiveOn, doseKey, dosesOn, ehSuplemento, temEstoque, estoque, estoqueAcabando, fmtQtd,
    mealId, mealOwn, meal, mealResumo, suplementosDe,
    occursOn, eventsOn, eventsBetween,
    isRecorrente, taskApplies, taskDone, tasksOn, freqLabel,
    criancaId, crianca, mesesDepois, idadeEntre, idadeCrianca, idadeDias, avaliarMedida, idadeTxt, faixaMarcos, marcoKey, marcoDe, marcosAtencao, marcosSemMarcar,
    consultaEventoId, consultasRecomendadas, medidasDe, historiaDe, TIPOS_HISTORIA,
    FAIXAS, faixaDe, pendencias, FOCO_MAX, emFoco, focoDe,
  };
})();
