// Telas, navegação e formulários.
(() => {
  const { esc, nl2br, brl } = U;
  const $main = () => document.getElementById('main');

  const state = {
    contasMes: U.thisMonth(),
    calMes: U.thisMonth(),
    lista: null,
    importacao: null, // pré-visualização da importação: [{ kind, data, erros }]
    novaChave: null,  // chave de API recém-criada (mostrada uma vez)
    chaves: null,
    remPessoa: '',    // aba de Remédios ('' = todos)
    tarPessoa: null,  // aba de Tarefas ('' = todos; null = escolher pelo dono do aparelho)
    novaQuando: 'hoje', // prazo escolhido por último no "adicionar rápido" de tarefas
    faixasAbertas: { atrasado: true, hoje: true, semana: true, depois: false, sem: false },
    aliPessoa: null,  // aba de Alimentação ('' = família; null = escolher pelo dono do aparelho)
    print: { sheet: 'dia', date: U.today(), week: U.ymd(U.startOfWeek(new Date())), month: U.thisMonth(), pessoa: '' },
  };

  const NAV = [
    ['painel', 'Painel', '🏠'], ['mural', 'Mural', '📌'], ['contas', 'Contas', '💰'], ['remedios', 'Remédios', '💊'],
    ['alimentacao', 'Alimentação', '🍽️'], ['calendario', 'Calendário', '📅'], ['tarefas', 'Tarefas', '✅'],
    ['listas', 'Listas', '🛒'], ['contatos', 'Contatos', '📞'], ['imprimir', 'Imprimir', '🖨️'],
    ['automacao', 'Automação', '🤖'], ['ajustes', 'Ajustes', '⚙️'],
  ];

  // ---------- Componentes ----------
  const pageHead = (title, sub, actions = '') => `<header class="page-head">
      <div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
      <div class="actions">${actions}</div></header>`;
  const btn = (label, action, attrs = '', cls = '') =>
    `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;
  const printBtn = (sheet, extra = '') => btn('🖨️ Imprimir', 'goto-print', `data-sheet="${sheet}" ${extra}`);
  const monthNav = (key, month) => `<div class="month-nav">
      ${btn('‹', 'month-shift', `data-key="${key}" data-n="-1" aria-label="Mês anterior"`, 'icon')}
      <strong>${U.monthLabel(month)}</strong>
      ${btn('›', 'month-shift', `data-key="${key}" data-n="1" aria-label="Próximo mês"`, 'icon')}
    </div>`;
  const emptyMsg = msg => `<p class="empty">${msg}</p>`;
  const panel = (title, body, actions = '') => `<section class="panel">
      <header class="panel-head"><h2>${title}</h2>${actions}</header>${body}</section>`;
  const stat = (label, value, tone = '') => `<div class="stat ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
  const opts = arr => arr.map(o => (Array.isArray(o) ? o : [o, o]));
  const medIco = m => (D.ehSuplemento(m) ? '🌿' : '💊');

  // Abas por pessoa: [primeiro] + Renato, Vanessa, Antônio… (contar = número ao lado do nome).
  const pessoaTabs = (action, sel, primeiro, contar) => `<div class="tabs">${[['', primeiro], ...D.pessoas().map(p => [p, p])]
    .map(([v, label]) => `<button type="button" class="tab ${v === sel ? 'active' : ''}" data-action="${action}" data-pessoa="${esc(v)}">
      ${esc(label)}${contar ? `<span class="count">${contar(v)}</span>` : ''}</button>`).join('')}</div>`;

  // "restam 12 comprimidos · dá para 6 dias (até 24/10)"
  const estoqueTxt = (m, e) => {
    const qtd = `restam ${D.fmtQtd(e.restante)} ${m.unidade || 'un.'}`;
    if (!e.porDia) return qtd;
    if (e.status === 'acabou') return `${qtd} · não dá para hoje`;
    return `${qtd} · dá para ${e.dias} ${e.dias === 1 ? 'dia' : 'dias'} (até ${U.fmtDay(U.ymd(U.addDays(U.parseYmd(e.acaba), -1)))})`;
  };
  const estoqueRow = ({ med, est }) => `<div class="row ${est.status === 'acabou' ? 'status-atrasada' : 'status-hoje'}">
      <span class="ico">${medIco(med)}</span>
      <span class="grow"><strong>${esc(med.nome)}</strong><small>${esc([med.pessoa, estoqueTxt(med, est)].filter(Boolean).join(' · '))}</small></span>
      ${btn('Repor', 'repor-med', `data-id="${esc(med.id)}"`, 'small primary')}</div>`;

  const doseRow = d => `<label class="check-row ${d.tomado ? 'done' : ''}">
      <input type="checkbox" data-action="toggle-dose" data-key="${esc(d.key)}" ${d.tomado ? 'checked' : ''}>
      <span class="time">${d.hora}</span>
      <span class="grow"><strong>${D.ehSuplemento(d.med) ? '🌿 ' : ''}${esc(d.med.nome)}</strong>${d.med.dose ? ` · ${esc(d.med.dose)}` : ''}
        <small>${esc([d.med.pessoa, d.med.instrucoes].filter(Boolean).join(' · '))}</small></span></label>`;

  const billRow = (o, extra = '') => {
    const st = D.billStatus(o);
    return `<div class="row status-${st}">
      <span class="date">${U.fmtDay(o.venc)}</span>
      <span class="grow"><strong>${esc(o.conta.nome)}</strong>
        <small>${esc([o.conta.responsavel, o.conta.forma].filter(Boolean).join(' · '))}</small></span>
      <span class="badge ${st}">${D.STATUS_LABEL[st]}</span>
      <span class="money">${brl(o.valor)}</span>
      ${o.conta.codigo && !o.pago ? btn('📋 Código', 'copy', `data-text="${esc(o.conta.codigo)}" title="Copiar código de barras / Pix"`, 'small ghost') : ''}
      ${o.pago
        ? btn('Desfazer', 'unpay-bill', `data-id="${esc(o.conta.id)}" data-mes="${o.mes}"`, 'small ghost')
        : btn('Pagar', 'pay-bill', `data-id="${esc(o.conta.id)}" data-mes="${o.mes}"`, 'small primary')}
      ${extra}
    </div>`;
  };

  const eventLine = ({ date, ev }) => `<button type="button" class="row link" data-action="edit-event" data-id="${esc(ev.id)}">
      <span class="date">${U.fmtDay(date)}</span><span class="time">${esc(ev.hora || '')}</span>
      <span class="grow"><strong>${esc(ev.titulo)}</strong><small>${esc([ev.pessoa, ev.local].filter(Boolean).join(' · '))}</small></span></button>`;

  const personSelect = (name, selected) => `<select name="${name}">${D.pessoas().map(p =>
    `<option ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`;

  const noteCard = r => {
    const curtidas = r.curtidas || [];
    const eu = D.eu();
    return `<article class="note ${r.fixado ? 'pinned' : ''}" style="--c:${D.corDe(r.autor)}">
      <header><strong>${esc(r.autor || '—')}</strong><small>${U.timeAgo(r.em)}</small><span class="spacer"></span>
        ${btn(r.fixado ? '📌 Fixado' : '📌', 'pin-note', `data-id="${esc(r.id)}" title="${r.fixado ? 'Desafixar' : 'Fixar no topo'}"`, 'small ghost')}
        ${btn('✕', 'del-note', `data-id="${esc(r.id)}" aria-label="Excluir"`, 'small ghost')}</header>
      <p>${nl2br(r.texto)}</p>
      <footer>${btn(`👍 ${curtidas.includes(eu) ? 'Visto' : 'Ok, vi'}`, 'like-note', `data-id="${esc(r.id)}"`, `small ${curtidas.includes(eu) ? 'primary' : ''}`)}
        ${curtidas.length ? `<small>${esc(curtidas.join(', '))} viu</small>` : ''}</footer>
    </article>`;
  };
  const noteMini = r => `<div class="note-mini" style="--c:${D.corDe(r.autor)}">${r.fixado ? '📌 ' : ''}<strong>${esc(r.autor || '—')}:</strong>
      ${esc(r.texto.length > 140 ? r.texto.slice(0, 140) + '…' : r.texto)} <small class="muted">${U.timeAgo(r.em)}</small></div>`;

  // "qua 21/10"
  const diaCurto = d => `${U.WDS[U.mondayIndex(U.parseYmd(d))].toLowerCase()} ${U.fmtDay(d)}`;
  // Selo do prazo: vermelho se venceu, laranja se é hoje, amarelo nos próximos 7 dias.
  const prazoBadge = data => {
    if (!data) return '';
    const f = D.faixaDe(data);
    const cls = { atrasado: 'atrasada', hoje: 'hoje', semana: 'proxima' }[f] || '';
    return `<span class="badge prazo ${cls}">${f === 'atrasado' ? `venceu ${U.fmtDay(data)}` : f === 'hoje' ? 'hoje' : diaCurto(data)}</span>`;
  };

  const itemRow = i => `<label class="check-row ${i.feito ? 'done' : ''}">
      <input type="checkbox" data-action="toggle-item" data-id="${esc(i.id)}" ${i.feito ? 'checked' : ''}>
      <span class="grow"><strong>${esc(i.texto)}</strong>${i.por ? `<span class="by"> · ${esc(i.por)}</span>` : ''}</span>
      ${i.feito ? '' : prazoBadge(i.prazo)}
      ${btn('✎', 'edit-item', `data-id="${esc(i.id)}" aria-label="Editar"`, 'small ghost')}
      ${btn('✕', 'del-item', `data-id="${esc(i.id)}" aria-label="Remover"`, 'small ghost')}</label>`;

  // Uma pendência (tarefa ou item de lista com prazo), com ☆ para pôr no foco do dia.
  const pendRow = (p, chave) => {
    const t = U.today();
    const foco = D.emFoco(p.obj, chave);
    const meta = [p.kind === 'item' ? `${p.lista?.icone || '📝'} ${p.lista?.nome || 'Lista'}` : '', p.quem, p.obj.local,
      p.recorrente ? D.freqLabel(p.obj) : p.data && p.faixa !== 'hoje' ? diaCurto(p.data) : ''].filter(Boolean).join(' · ');
    const ref = `data-kind="${p.kind}" data-id="${esc(p.obj.id)}"`;
    return `<div class="row pend ${p.feito ? 'done' : ''}">
      <input type="checkbox" data-action="${p.kind === 'tarefa' ? 'toggle-task' : 'toggle-item'}" data-id="${esc(p.obj.id)}" data-date="${t}"
        ${p.feito ? 'checked' : ''} aria-label="Concluir">
      <span class="grow"><strong>${esc(p.titulo)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}</span>
      ${p.feito ? '' : btn(foco ? '★' : '☆', 'toggle-foco', `${ref} data-chave="${esc(chave)}" title="${foco ? 'Tirar do foco' : 'Pôr no foco do dia'}"`, `small ghost foco ${foco ? 'on' : ''}`)}
      ${btn('✎', p.kind === 'tarefa' ? 'edit-task' : 'edit-item', `data-id="${esc(p.obj.id)}" aria-label="Editar"`, 'small ghost')}
    </div>`;
  };
  // "3 de 5 feitas hoje" com barrinha.
  const progresso = ps => {
    const hoje = ps.filter(p => p.faixa === 'atrasado' || p.faixa === 'hoje');
    if (!hoje.length) return '';
    const feitas = hoje.filter(p => p.feito).length;
    return `<div class="progress-wrap"><small>${feitas} de ${hoje.length} feitas hoje</small>
      <span class="progress"><i style="width:${(feitas / hoje.length * 100).toFixed(0)}%"></i></span></div>`;
  };

  // ---------- Telas ----------
  function painel() {
    const t = U.today();
    const wd = U.mondayIndex(new Date());
    const doses = D.dosesOn(t);
    const tomadas = doses.filter(d => d.tomado).length;
    const atencao = D.contasAtencao(10);
    const atrasadas = atencao.filter(o => D.billStatus(o) === 'atrasada');
    const mes = D.billOccurrences(U.thisMonth());
    const aPagar = mes.filter(o => !o.pago).reduce((s, o) => s + o.valor, 0);
    const eu = D.eu();
    const pend = D.pendencias(t, eu);
    const urgentes = pend.filter(p => p.faixa === 'atrasado' || p.faixa === 'hoje');
    const tarefasPend = urgentes.filter(p => !p.feito).length;
    const atrasadasTar = urgentes.filter(p => p.faixa === 'atrasado' && !p.feito).length;
    const foco = D.focoDe(eu, t);
    const resto = urgentes.filter(p => !D.emFoco(p.obj, eu));
    const eventos = D.eventsBetween(t, U.ymd(U.addDays(new Date(), 14)));
    const recados = D.recados().slice(0, 4);
    const revisar = D.paraRevisar();
    const compras = D.listas()[0];
    const itens = compras ? D.itensDa(compras.id).filter(i => !i.feito) : [];
    const acabando = D.estoqueAcabando();

    return pageHead(`Olá${D.eu() ? `, ${esc(D.eu())}` : ''}! Hoje é ${U.longDate(t)}`, D.casaNome(), printBtn('dia', `data-date="${t}"`)) + `
      <div class="stats">
        ${stat('A pagar no mês', brl(aPagar))}
        ${stat('Contas atrasadas', atrasadas.length, atrasadas.length ? 'bad' : 'good')}
        ${stat('Remédios hoje', `${tomadas}/${doses.length}`, doses.length && tomadas === doses.length ? 'good' : '')}
        ${stat('Tarefas para hoje', tarefasPend, atrasadasTar ? 'bad' : tarefasPend ? '' : 'good')}
      </div>
      ${revisar.length ? panel(`🤖 Adicionados automaticamente — para revisar (${revisar.length})`, revisar.map(({ kind, obj }) => `
        <div class="row review">
          <span class="ico">${Schema.KINDS[kind].icone}</span>
          <span class="grow"><strong>${esc(Schema.resumo(kind, obj))}</strong><small>${esc(Schema.KINDS[kind].nome)} · via ${esc(obj.origem || 'agente')}</small></span>
          ${btn('✔ Ok', 'review-ok', `data-kind="${kind}" data-id="${esc(obj.id)}"`, 'small primary')}
          ${btn('Editar', 'review-edit', `data-kind="${kind}" data-id="${esc(obj.id)}"`, 'small')}
          ${btn('✕', 'review-del', `data-kind="${kind}" data-id="${esc(obj.id)}" aria-label="Descartar"`, 'small ghost')}
        </div>`).join('') + `<div class="actions" style="margin-top:8px">${btn('Aprovar todos', 'review-all', '', 'small')}</div>`) : ''}
      ${acabando.length ? panel(`⚠️ Estoque acabando (${acabando.length})`, acabando.map(estoqueRow).join(''),
        `<a href="#/remedios" class="more">ver remédios</a>`) : ''}
      <div class="grid-2">
        ${panel(`🎯 Foco e tarefas de hoje${eu ? ` — ${esc(eu)}` : ''}`, progresso(pend)
          + (foco.length ? `<h3 class="sub">Foco do dia</h3>${foco.map(p => pendRow(p, eu)).join('')}` : '')
          + (resto.length ? `${foco.length ? '<h3 class="sub">Também para hoje</h3>' : ''}${resto.slice(0, 8).map(p => pendRow(p, eu)).join('')}`
            + (resto.length > 8 ? `<p class="muted small">+ ${resto.length - 8} itens</p>` : '') : '')
          + (!foco.length && !resto.length ? emptyMsg('Nada para hoje. 🎉') : !foco.length ? '<p class="muted small">Toque na ☆ para escolher até 3 coisas como foco do dia.</p>' : ''),
          `<a href="#/tarefas" class="more">ver todas</a>`)}
        ${panel('📌 Mural', recados.length ? recados.map(noteMini).join('') : emptyMsg('Nenhum recado. Deixe um para quem chega em casa!'),
          `<a href="#/mural" class="more">escrever</a>`)}
        ${panel(compras ? `${esc(compras.icone || '🛒')} ${esc(compras.nome)} (${itens.length})` : '🛒 Listas',
          itens.length ? itens.slice(0, 8).map(itemRow).join('') + (itens.length > 8 ? `<p class="muted small">+ ${itens.length - 8} itens</p>` : '')
            : emptyMsg(compras ? 'Lista vazia.' : 'Crie sua lista de compras compartilhada.'),
          `<a href="#/listas" class="more">abrir</a>`)}
        ${panel('💊 Remédios de hoje', doses.length ? doses.map(doseRow).join('') : emptyMsg('Nenhum remédio para hoje.'),
          `<a href="#/remedios" class="more">ver todos</a>`)}
        ${panel('💰 Contas atrasadas e próximas', atencao.length ? atencao.map(o => billRow(o)).join('') : emptyMsg('Nada vencendo nos próximos 10 dias. 🎉'),
          `<a href="#/contas" class="more">ver mês</a>`)}
        ${panel('🍽️ Cardápio de hoje', `<dl class="meals-today">${D.SLOTS.map(s =>
          `<dt>${s.nome}</dt><dd>${Print.mealLines(wd, s.id) || '<span class="muted">—</span>'}</dd>`).join('')}</dl>`,
          `<a href="#/alimentacao" class="more">editar</a>`)}
        ${panel('📅 Próximos 14 dias', eventos.length ? eventos.map(eventLine).join('') : emptyMsg('Nenhum compromisso.'),
          btn('+ Evento', 'new-event', `data-date="${t}"`, 'small'))}
      </div>`;
  }

  function contas() {
    const occ = D.billOccurrences(state.contasMes);
    const total = occ.reduce((s, o) => s + o.valor, 0);
    const pago = occ.filter(o => o.pago).reduce((s, o) => s + o.valor, 0);
    const atrasado = occ.filter(o => D.billStatus(o) === 'atrasada').reduce((s, o) => s + o.valor, 0);
    const porCat = Object.entries(U.groupBy(occ, o => o.conta.categoria || 'Outros'))
      .map(([cat, l]) => [cat, l.reduce((s, o) => s + o.valor, 0)]).sort((a, b) => b[1] - a[1]);
    const todas = Store.list('conta').sort((a, b) => a.nome.localeCompare(b.nome));

    return pageHead('Contas e pagamentos', 'Valores, vencimentos e o que já foi pago',
      printBtn('contas', `data-month="${state.contasMes}"`) + btn('+ Nova conta', 'new-bill', '', 'primary')) + `
      ${monthNav('contasMes', state.contasMes)}
      <div class="stats">
        ${stat('Total do mês', brl(total))}${stat('Já pago', brl(pago), 'good')}
        ${stat('A pagar', brl(total - pago))}${stat('Atrasado', brl(atrasado), atrasado ? 'bad' : '')}
      </div>
      <div class="grid-2 wide-first">
        ${panel('Vencimentos do mês', occ.length ? occ.map(o => billRow(o,
          btn('✎', 'edit-bill', `data-id="${esc(o.conta.id)}" aria-label="Editar"`, 'small ghost icon'))).join('')
          : emptyMsg('Nenhuma conta neste mês. Clique em “Nova conta”.'))}
        ${panel('Por categoria', porCat.length ? `<div class="bars">${porCat.map(([cat, v]) => `<div class="bar-row">
            <span>${esc(cat)}</span><span class="bar"><i style="width:${total ? (v / total * 100).toFixed(1) : 0}%"></i></span>
            <span class="money">${brl(v)}</span></div>`).join('')}</div>` : emptyMsg('—'))}
      </div>
      ${panel(`Contas cadastradas (${todas.length})`, todas.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Conta</th><th>Quando</th><th>Valor</th><th>Categoria</th><th>Responsável</th><th></th></tr></thead>
        <tbody>${todas.map(b => `<tr><td><strong>${esc(b.nome)}</strong></td>
          <td>${b.tipo === 'unica' ? U.fmtDate(b.data) : `Todo dia ${esc(b.dia)}${b.fim ? ` até ${esc(b.fim)}` : ''}`}</td>
          <td>${brl(b.valor)}</td><td>${esc(b.categoria)}</td><td>${esc(b.responsavel)}</td>
          <td>${btn('Editar', 'edit-bill', `data-id="${esc(b.id)}"`, 'small ghost')}</td></tr>`).join('')}</tbody></table></div>`
        : emptyMsg('Nenhuma conta cadastrada.'))}`;
  }

  function remedios() {
    const t = U.today();
    const sel = D.pessoas().includes(state.remPessoa) ? state.remPessoa : '';
    const daPessoa = m => !sel || (m.pessoa || '') === sel;
    const doses = D.dosesOn(t).filter(d => daPessoa(d.med));
    const meds = Store.list('remedio').filter(daPessoa)
      .sort((a, b) => (a.pessoa || '').localeCompare(b.pessoa || '') || a.nome.localeCompare(b.nome));
    const acabando = D.estoqueAcabando().filter(x => daPessoa(x.med));
    const card = m => {
      const ativo = D.medActiveOn(m, t);
      const est = D.estoque(m);
      return `<article class="card ${ativo ? '' : 'inactive'}">
        <header><h3>${medIco(m)} ${esc(m.nome)}</h3>${btn('Editar', 'edit-med', `data-id="${esc(m.id)}"`, 'small ghost')}</header>
        <p><strong>${esc(m.pessoa || '')}</strong>${m.dose ? ` · ${esc(m.dose)}` : ''}</p>
        <div class="chips">${(m.horarios || []).map(h => `<span class="chip">${h}</span>`).join('') || '<span class="muted">sem horário fixo</span>'}</div>
        ${m.instrucoes ? `<p class="muted">${esc(m.instrucoes)}</p>` : ''}
        ${est ? `<p class="small estoque ${est.status}">📦 ${esc(estoqueTxt(m, est))} ${btn('Repor', 'repor-med', `data-id="${esc(m.id)}"`, 'small ghost')}</p>` : ''}
        <p class="muted small">${m.inicio ? `De ${U.fmtDate(m.inicio)} ` : ''}${m.fim ? `até ${U.fmtDate(m.fim)}` : 'Uso contínuo'}${ativo ? '' : ' · inativo'}</p>
      </article>`;
    };
    const grupo = (titulo, lista, vazio) => `<h2 class="group-title">${titulo}</h2>
      ${lista.length ? `<div class="cards">${lista.map(card).join('')}</div>` : emptyMsg(vazio)}`;
    const ativos = v => Store.list('remedio').filter(m => (!v || (m.pessoa || '') === v) && D.medActiveOn(m, t)).length;
    const novo = cat => `data-categoria="${cat}" data-pessoa="${esc(sel)}"`;
    return pageHead('Remédios e suplementos', 'Horários, doses, estoque e controle do que já foi tomado',
      printBtn('remedios') + btn('+ Suplemento', 'new-med', novo('suplemento')) + btn('+ Remédio', 'new-med', novo('remedio'), 'primary')) + `
      ${pessoaTabs('pick-rem-pessoa', sel, 'Todos', ativos)}
      ${acabando.length ? panel(`⚠️ Estoque acabando (${acabando.length})`, acabando.map(estoqueRow).join('')) : ''}
      <div class="grid-2 wide-first">
        ${panel(`Hoje — ${U.longDate(t)}`, doses.length ? doses.map(doseRow).join('') : emptyMsg('Nenhuma dose para hoje.'))}
        ${panel('Dica', `<p class="muted">Informe a <b>quantidade disponível</b> de cada remédio: o app desconta as doses de cada dia e,
          ${D.AVISO_ESTOQUE} dias antes de acabar, avisa no Painel e põe o item na lista da farmácia.</p>
          <p class="muted">Imprima o <b>quadro de remédios da semana</b> e deixe no banheiro ou na cozinha.</p>`)}
      </div>
      ${grupo('💊 Remédios', meds.filter(m => !D.ehSuplemento(m)), 'Nenhum remédio cadastrado.')}
      ${grupo('🌿 Suplementos', meds.filter(D.ehSuplemento), 'Nenhum suplemento cadastrado.')}`;
  }

  function alimentacao() {
    const hoje = U.mondayIndex(new Date());
    const ps = D.pessoas();
    if (state.aliPessoa == null) state.aliPessoa = ps.includes(D.eu()) ? D.eu() : '';
    const sel = ps.includes(state.aliPessoa) ? state.aliPessoa : '';
    const supl = D.suplementosDe(sel || null);
    const placeholder = (wd, slot) => (sel && D.mealOwn(wd, slot) ? `Família: ${D.mealOwn(wd, slot)}` : '—');
    return pageHead('Rotina alimentar', sel
      ? `Refeições de ${esc(sel)}. Campo vazio = come o mesmo que a família.`
      : 'Refeições que a família faz junto. Na aba de cada pessoa, o que ficar vazio usa o da família.',
      printBtn('cardapio', `data-pessoa="${esc(sel)}"`)) + `
      ${pessoaTabs('pick-ali-pessoa', sel, '🏠 Família')}
      ${panel(`🌿 Suplementos${sel ? ` de ${esc(sel)}` : ''}`, supl.length ? supl.map(m => `<div class="row">
          <span class="time">${esc((m.horarios || []).join(', ') || '—')}</span>
          <span class="grow"><strong>${esc(m.nome)}</strong><small>${esc([sel ? '' : m.pessoa, m.dose, m.instrucoes].filter(Boolean).join(' · '))}</small></span>
          ${btn('Editar', 'edit-med', `data-id="${esc(m.id)}"`, 'small ghost')}</div>`).join('')
        : emptyMsg('Nenhum suplemento. Eles são cadastrados em Remédios e aparecem aqui também.'),
        btn('+ Suplemento', 'new-med', `data-categoria="suplemento" data-pessoa="${esc(sel)}"`, 'small'))}
      <div class="week-grid">${U.WD.map((dia, wd) => `<section class="day-card ${wd === hoje ? 'today' : ''}">
        <h3>${dia}${wd === hoje ? ' <span class="badge hoje">hoje</span>' : ''}</h3>
        ${D.SLOTS.map(s => `<label class="meal"><span>${s.nome}</span>
          <textarea rows="2" data-action="save-meal" data-id="${esc(D.mealId(wd, s.id, sel))}" data-pessoa="${esc(sel)}"
            placeholder="${esc(placeholder(wd, s.id))}">${esc(D.mealOwn(wd, s.id, sel))}</textarea></label>`).join('')}
      </section>`).join('')}</div>
      ${panel('Observações / regras da alimentação', `<textarea class="full" rows="4" data-action="save-meal-obs"
        placeholder="Ex.: beber 2L de água, sem fritura durante a semana, fruta no lanche…">${esc(D.config('alimentacao').obs || '')}</textarea>`)}`;
  }

  function calendario() {
    const month = state.calMes;
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const contasPorDia = U.groupBy(D.billOccurrences(month), o => o.venc);
    const t = U.today();
    const cells = [];
    for (let d = U.startOfWeek(first); d.getMonth() === m - 1 || d < first || U.mondayIndex(d) !== 0; d = U.addDays(d, 1)) {
      const date = U.ymd(d);
      if (date.slice(0, 7) !== month) { cells.push('<div class="cal-cell out"></div>'); continue; }
      cells.push(`<div class="cal-cell ${date === t ? 'today' : ''}" data-action="new-event" data-date="${date}">
        <span class="dn">${d.getDate()}</span>
        ${D.eventsOn(date).map(ev => `<button type="button" class="ev" data-action="edit-event" data-id="${esc(ev.id)}">${ev.hora ? `<b>${esc(ev.hora)}</b> ` : ''}${esc(ev.titulo)}</button>`).join('')}
        ${(contasPorDia[date] || []).map(o => `<span class="ev bill ${o.pago ? 'paid' : ''}">💰 ${esc(o.conta.nome)}</span>`).join('')}
      </div>`);
    }
    const last = U.ymd(new Date(y, m, 0));
    const eventos = D.eventsBetween(`${month}-01`, last);
    return pageHead('Calendário', 'Clique em um dia para adicionar um compromisso',
      printBtn('calendario', `data-month="${month}"`) + btn('+ Evento', 'new-event', `data-date="${t}"`, 'primary')) + `
      ${monthNav('calMes', month)}
      <div class="cal">${U.WDS.map(d => `<div class="cal-h">${d}</div>`).join('')}${cells.join('')}</div>
      ${panel('Compromissos do mês', eventos.length ? eventos.map(eventLine).join('') : emptyMsg('Nenhum compromisso neste mês.'))}`;
  }

  function tarefas() {
    const t = U.today();
    const ps = D.pessoas();
    if (state.tarPessoa == null) state.tarPessoa = ps.includes(D.eu()) ? D.eu() : '';
    const sel = ps.includes(state.tarPessoa) ? state.tarPessoa : '';
    const chave = sel || D.eu();
    const pend = D.pendencias(t, sel);
    const grupos = U.groupBy(pend, p => p.faixa);
    const foco = D.focoDe(chave, t);
    const all = Store.list('tarefa');
    const rotina = all.filter(D.isRecorrente).sort((a, b) => (a.local || '').localeCompare(b.local || '') || a.titulo.localeCompare(b.titulo));
    const feitas = all.filter(x => !D.isRecorrente(x) && x.feito && x.feitoEm !== t)
      .sort((a, b) => (b.feitoEm || '').localeCompare(a.feitoEm || '')).slice(0, 15);
    const feitaRow = x => `<div class="row pend done">
      <input type="checkbox" data-action="toggle-task" data-id="${esc(x.id)}" data-date="${t}" checked aria-label="Reabrir">
      <span class="grow"><strong>${esc(x.titulo)}</strong><small>${esc(['feita em ' + U.fmtDay(x.feitoEm || t), x.responsavel].filter(Boolean).join(' · '))}</small></span>
      ${btn('✎', 'edit-task', `data-id="${esc(x.id)}" aria-label="Editar"`, 'small ghost')}</div>`;
    const abertos = v => D.pendencias(t, v).filter(p => !p.feito && (p.faixa === 'atrasado' || p.faixa === 'hoje')).length;

    const coluna = f => {
      const l = grupos[f.id] || [];
      if (f.id === 'atrasado' && !l.length) return '';
      const aberta = state.faixasAbertas[f.id];
      const n = l.filter(p => !p.feito).length;
      return `<section class="col faixa-${f.id}">
        <button type="button" class="col-head" data-action="toggle-faixa" data-faixa="${f.id}" aria-expanded="${aberta}">
          <h2>${f.nome}</h2><span class="count">${n}</span><span class="seta">${aberta ? '▾' : '▸'}</span></button>
        ${aberta ? (l.length ? l.map(p => pendRow(p, chave)).join('') : emptyMsg(f.id === 'hoje' ? 'Nada para hoje. 🎉' : 'Nada aqui.')) : ''}
      </section>`;
    };
    const quando = [['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['semana', 'Em 7 dias'], ['sem', 'Sem prazo']];

    return pageHead('Tarefas', 'Organizadas pelo prazo: primeiro o que venceu e o de hoje',
      printBtn('tarefas') + btn('+ Tarefa detalhada', 'new-task', '', '')) + `
      <form class="panel quick-task" data-form="tarefa-rapida">
        <input name="titulo" placeholder="O que precisa ser feito?" autocomplete="off" enterkeyhint="done" aria-label="Nova tarefa">
        <div class="quando">${quando.map(([v, l]) => `<label class="pill"><input type="radio" name="quando" value="${v}" ${state.novaQuando === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          <input type="date" name="data" aria-label="Ou escolha a data">
          <span class="spacer"></span><button class="btn primary" type="submit">Adicionar</button></div>
      </form>
      ${pessoaTabs('pick-tar-pessoa', sel, 'Todos', abertos)}
      ${panel(`🎯 Foco do dia${chave ? ` — ${esc(chave)}` : ''}`, progresso(pend) + (foco.length
        ? foco.map(p => pendRow(p, chave)).join('')
        : `<p class="muted">Escolha até ${D.FOCO_MAX} coisas para hoje tocando na ☆. O resto pode esperar.</p>`))}
      <div class="board">${D.FAIXAS.map(coluna).join('')}</div>
      ${panel(`🔁 Rotina (${rotina.length})`, rotina.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Tarefa</th><th>Quando</th><th>Quem</th><th>Onde</th><th></th></tr></thead>
        <tbody>${rotina.map(x => `<tr><td><strong>${esc(x.titulo)}</strong></td><td>${esc(D.freqLabel(x))}</td>
          <td>${esc(x.responsavel)}</td><td>${esc(x.local)}</td><td>${btn('Editar', 'edit-task', `data-id="${esc(x.id)}"`, 'small ghost')}</td></tr>`).join('')}
        </tbody></table></div>` : emptyMsg('Cadastre tarefas que se repetem em “+ Tarefa detalhada”: lavar roupa, tirar o lixo, regar plantas…'))}
      ${feitas.length ? `<details class="panel"><summary>Concluídas antes de hoje</summary>${feitas.map(feitaRow).join('')}</details>` : ''}`;
  }

  function mural() {
    const lista = D.recados();
    return pageHead('Mural da família', 'Recados rápidos entre vocês — aparecem no painel e no celular do outro') + `
      <form class="panel post-form" data-form="recado">
        <textarea name="texto" rows="3" required placeholder="Escreva um recado… ex.: “Comprei o remédio da sua mãe”, “Chego tarde hoje”, “Não esquecer a reunião da escola”"></textarea>
        <div class="post-actions">
          <label>De ${personSelect('autor', D.eu())}</label>
          <label class="switch"><input type="checkbox" name="fixado"> 📌 Fixar no topo</label>
          <span class="spacer"></span><button class="btn primary" type="submit">Publicar</button>
        </div>
      </form>
      <div class="wall">${lista.length ? lista.map(noteCard).join('') : emptyMsg('Nenhum recado ainda.')}</div>`;
  }

  function listas() {
    const ls = D.listas();
    const head = pageHead('Listas compartilhadas', 'Um adiciona, o outro vê na hora — ótimo para usar no mercado',
      (ls.length ? printBtn('compras', `data-lista="${esc(state.lista || ls[0].id)}"`) : '') + btn('+ Nova lista', 'new-list'));
    if (!ls.length) {
      return head + panel('Comece criando suas listas', `<p class="muted">Sugestões:</p><div class="suggest">
        ${D.LISTAS_SUGERIDAS.map(([icone, nome]) => btn(`${icone} ${nome}`, 'create-list', `data-icone="${icone}" data-nome="${esc(nome)}"`)).join('')}</div>`);
    }
    const cur = ls.find(l => l.id === state.lista) || ls[0];
    state.lista = cur.id;
    const itens = D.itensDa(cur.id);
    const pend = itens.filter(i => !i.feito);
    const feitos = itens.filter(i => i.feito);
    return head + `
      <div class="tabs">${ls.map(l => `<button type="button" class="tab ${l.id === cur.id ? 'active' : ''}" data-action="pick-list" data-id="${esc(l.id)}">
        ${esc(l.icone || '📝')} ${esc(l.nome)}<span class="count">${D.itensDa(l.id).filter(i => !i.feito).length}</span></button>`).join('')}</div>
      <section class="panel">
        <form class="quick-add" data-form="item" data-lista="${esc(cur.id)}">
          <input name="texto" placeholder="Adicionar item… (ex.: 2 L de leite)" autocomplete="off" enterkeyhint="done">
          <input type="date" name="prazo" class="prazo" aria-label="Até quando (opcional)" title="Até quando (opcional)">
          <button class="btn primary" type="submit">Adicionar</button>
        </form>
        ${pend.length ? pend.map(itemRow).join('') : emptyMsg('Nada pendente nesta lista.')}
        ${feitos.length ? `<div class="done-head"><span>✔ Já resolvidos (${feitos.length})</span>
          ${btn('Limpar marcados', 'clear-done', `data-lista="${esc(cur.id)}"`, 'small')}</div>${feitos.map(itemRow).join('')}` : ''}
        <div class="actions" style="margin-top:12px">${btn('Editar / excluir lista', 'edit-list', `data-id="${esc(cur.id)}"`, 'small ghost')}</div>
      </section>`;
  }

  function contatos() {
    const grupos = D.contatosPorCategoria();
    const temEmergencia = D.contatos().some(c => c.categoria === 'Emergência');
    const card = c => `<article class="card contact">
      <header><h3>${esc(c.nome)}</h3>${btn('Editar', 'edit-contact', `data-id="${esc(c.id)}"`, 'small ghost')}</header>
      ${c.telefone ? `<a class="tel" href="${esc(D.telLink(c.telefone))}">📞 ${esc(c.telefone)}</a>` : ''}
      ${c.endereco ? `<p class="muted small">📍 ${esc(c.endereco)}</p>` : ''}
      ${c.obs ? `<p class="muted small">${esc(c.obs)}</p>` : ''}
      ${c.whatsapp && c.telefone ? `<div class="links"><a class="btn small" href="${esc(D.waLink(c.telefone))}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
    </article>`;
    return pageHead('Contatos úteis', 'Médicos, escola, serviços da casa e emergência — imprima e deixe na geladeira',
      printBtn('contatos') + btn('+ Novo contato', 'new-contact', '', 'primary')) + `
      ${temEmergencia ? '' : panel('Números de emergência', `<p class="muted">Quer adicionar os números públicos de emergência (190, 192, 193)?</p>
        ${btn('Adicionar números de emergência', 'add-emergency')}`)}
      ${grupos.length ? grupos.map(([cat, lista]) => `<h2 class="group-title ${cat === 'Emergência' ? 'alert' : ''}">${esc(cat)}</h2>
        <div class="cards">${lista.map(card).join('')}</div>`).join('') : emptyMsg('Nenhum contato cadastrado.')}`;
  }

  function automacao() {
    const cloud = Store.mode() === 'cloud';
    const imp = state.importacao;
    const validos = imp ? imp.filter(r => !r.erros.length) : [];
    const previa = imp ? `<div class="import-preview">
        <p><b>${validos.length}</b> de ${imp.length} registros prontos para importar.</p>
        ${imp.map(r => `<div class="row ${r.erros.length ? 'status-atrasada' : ''}">
          <span class="ico">${Schema.KINDS[r.kind]?.icone || '❓'}</span>
          <span class="grow"><strong>${esc(Schema.KINDS[r.kind] ? Schema.resumo(r.kind, r.data) : r.kind)}</strong>
            <small>${esc(Schema.KINDS[r.kind]?.nome || 'tipo desconhecido')}${r.erros.length ? ' · ⚠️ ' + esc(r.erros.join('; ')) : ''}${Store.get(r.kind, r.data.id) ? ' · já existe: será atualizado' : ''}</small></span>
        </div>`).join('')}
        <div class="actions" style="margin-top:10px">
          ${btn(`Importar ${validos.length} registros`, 'import-confirm', validos.length ? '' : 'disabled', 'primary')}
          ${btn('Cancelar', 'import-cancel', '', 'ghost')}</div></div>` : '';

    const chaves = state.chaves;
    const apiPanel = cloud ? `
        <p class="muted">Crie uma chave para cada agente (ex.: “Claude – e-mails”, “Pierre”). Se algo sair do controle, revogue a chave e pronto.
          Para serviços de terceiros, prefira <b>“Só contas a pagar”</b>: a chave não enxerga remédios, recados nem agenda e não apaga nada.</p>
        <form class="quick-add key-form" data-form="nova-chave"><input name="nome" placeholder="Nome do agente (ex.: Pierre)" aria-label="Nome do agente">
          <select name="escopo" aria-label="Acesso da chave">
            <option value="total">Acesso total</option>
            <option value="contas">Só contas a pagar (sem apagar)</option>
          </select>
          <button class="btn primary" type="submit">Criar chave</button></form>
        ${state.novaChave ? `<div class="secret"><p><b>Copie agora — esta chave não será mostrada de novo:</b></p>
          <code>${esc(state.novaChave)}</code>
          <div class="actions">${btn('📋 Copiar chave', 'copy', `data-text="${esc(state.novaChave)}"`, 'small primary')}
          ${btn('📋 Copiar instruções para o agente', 'copy-agent-guide', '', 'small')}</div></div>` : ''}
        ${chaves == null ? btn('Ver chaves existentes', 'load-keys', '', 'small') : chaves.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Agente</th><th>Acesso</th><th>Chave</th><th>Último uso</th><th></th></tr></thead><tbody>
          ${chaves.map(c => `<tr class="${c.revogada ? 'muted' : ''}"><td>${esc(c.nome)}</td>
            <td>${c.tipos ? `Só ${esc(c.tipos.map(t => Schema.KINDS[t]?.nome || t).join(', ').toLowerCase())}${c.pode_remover === false ? ', sem apagar' : ''}` : 'Total'}</td>
            <td><code>${esc(c.prefixo)}…</code></td>
            <td>${c.ultimo_uso ? U.timeAgo(c.ultimo_uso) : 'nunca'}</td>
            <td>${c.revogada ? 'revogada' : btn('Revogar', 'revoke-key', `data-id="${esc(c.id)}"`, 'small danger')}</td></tr>`).join('')}
          </tbody></table></div>` : emptyMsg('Nenhuma chave criada.')}
        <details class="api-docs"><summary>Como o agente usa (endpoints)</summary>
          <pre>${esc(agentGuide('SUA_CHAVE'))}</pre></details>`
      : `<p>A API para agentes funciona no <b>modo nuvem</b> (Supabase), porque o agente precisa de um lugar na internet para gravar.
          Configure seguindo o README e volte aqui para criar as chaves.</p>
         <p class="muted">Enquanto isso, use “Colar de uma conversa” e “Importar agenda” ao lado — funcionam no modo local.</p>`;

    return pageHead('Automação e integrações', 'Deixe o Claude, Gemini, Manus ou outro agente preencher o app por você') + `
      <div class="grid-2">
        ${panel('💬 Colar de uma conversa com IA', `
          <ol class="steps">
            <li>${btn('📋 Copiar prompt', 'copy-prompt', '', 'small primary')} e cole no Claude, Gemini ou ChatGPT — no fim de uma conversa
              sobre seus remédios, rotina ou contas, ou junto com um e-mail/PDF de conta.</li>
            <li>A IA responde com um bloco JSON. Copie e cole abaixo.</li>
            <li>Confira a pré-visualização e importe.</li>
          </ol>
          <textarea class="full mono" rows="7" data-role="import-text" placeholder='{"remedios": [{"nome": "Losartana", "horarios": ["08:00"]}]}'>${esc(state.importTexto || '')}</textarea>
          <div class="actions" style="margin-top:8px">${btn('Pré-visualizar', 'import-preview', '', 'primary')}</div>
          ${previa}`)}
        ${panel('📅 Importar agenda (Google, Outlook, Apple)', `
          <p class="muted">No Google Agenda: <b>Configurações → Importar e exportar → Exportar</b>. Descompacte e escolha o arquivo <code>.ics</code>.
            Importa compromissos de hoje em diante e os que se repetem (aniversários). Importar de novo atualiza sem duplicar.</p>
          <label class="btn">📂 Escolher arquivo .ics<input type="file" accept=".ics,text/calendar" data-action="import-ics" hidden></label>
          <p class="muted small">Para sincronizar sempre, use um agente com acesso à sua agenda (veja ao lado).</p>`)}
        ${panel('🔑 API para agentes (Claude, Gemini, Manus, n8n, Zapier…)', apiPanel)}
        ${panel('📤 Levar meus dados para uma IA', `
          <p class="muted">Copie um resumo da sua rotina para perguntar ao Claude ou ao Gemini coisas como
            “o que vence esta semana?” ou “monte um cardápio mais saudável”.</p>
          <div class="actions">${btn('📋 Copiar resumo da rotina', 'copy-summary', '', 'small')}${btn('📋 Copiar dados (JSON)', 'copy-json', '', 'small')}</div>`)}
      </div>
      ${panel('🧩 Ideias de automação prontas', `<div class="ideas">
        <div><b>📧 Contas do e-mail</b><p class="muted small">Um agente com acesso ao Gmail procura boletos, faturas e cobranças, e cadastra a conta com valor, vencimento e código de barras. Ela aparece no Painel como “para revisar”.</p></div>
        <div><b>📅 Agenda sempre em dia</b><p class="muted small">Um agente lê o Google Agenda toda manhã e grava os compromissos da semana (id <code>gcal-&lt;id do evento&gt;</code> para não duplicar).</p></div>
        <div><b>💊 Da consulta para o app</b><p class="muted small">Depois de conversar com o Claude sobre uma receita médica, peça para ele gerar o JSON (ou gravar direto via conector MCP).</p></div>
        <div><b>🛒 Lista pelo WhatsApp/voz</b><p class="muted small">Via n8n, Zapier ou Make: uma mensagem “leite, pão, ovos” vira itens na lista de compras.</p></div>
      </div><p class="muted small">Detalhes e prompts prontos no arquivo <code>docs/AUTOMACAO.md</code> do projeto.</p>`)}`;
  }

  function agentGuide(chave) {
    const cfg = Store.config();
    const base = `${String(cfg.supabaseUrl || 'https://SEU-PROJETO.supabase.co').replace(/\/$/, '')}/rest/v1/rpc`;
    const restrita = state.novaChaveEscopo === 'contas';
    const kinds = Object.entries(Schema.KINDS).filter(([k]) => !restrita || k === 'conta').map(([k, d]) => `- ${k}: ${Object.entries(d.campos).map(([c, x]) => `${c}${x.obrig ? '*' : ''} (${x.tipo})`).join(', ')}`).join('\n');
    return `API do app "Casa Organizada" (organização da casa).

Cabeçalhos em todas as chamadas:
  apikey: ${cfg.supabaseAnonKey || 'CHAVE_ANON_DO_SUPABASE'}
  Content-Type: application/json

1) Salvar/atualizar registros
POST ${base}/agente_salvar
{"chave": "${chave}", "registros": [
  {"tipo": "conta", "id": "gmail-<id-da-mensagem>", "dados": {"nome": "Energia Enel", "valor": 287.45, "tipo": "unica", "data": "2026-11-10", "codigo": "8364..."}}
]}
- "id" é opcional; use ids estáveis (gmail-..., gcal-...) para não duplicar ao rodar de novo. Mesmo id = atualiza.
- Itens de lista: {"tipo": "item", "dados": {"texto": "leite", "lista_nome": "Compras"}}.
- Tudo que o agente grava aparece no Painel como "para revisar".

2) Consultar (para evitar duplicados)
POST ${base}/agente_listar
{"chave": "${chave}", "tipo": "conta"}   (tipo e "desde" são opcionais)

3) Marcar uma conta como paga (no mês do vencimento; data e valor opcionais)
POST ${base}/agente_pagar
{"chave": "${chave}", "id": "<id da conta>", "mes": "2026-10", "data": "2026-10-09", "valor": 287.45}

4) Remover${restrita ? ' (não permitido para esta chave)' : ''}
POST ${base}/agente_remover
{"chave": "${chave}", "tipo": "conta", "id": "..."}
${restrita ? '\nESTA CHAVE SÓ ACESSA CONTAS A PAGAR ("tipo": "conta") E NÃO PODE REMOVER.\n' : ''}
Tipos e campos (* = obrigatório). Datas AAAA-MM-DD, horas HH:MM, dias da semana 0=segunda…6=domingo:
${kinds}`;
  }

  function resumoRotina() {
    const t = U.today();
    const linhas = [`# Rotina da casa — ${U.longDate(t)}`, ''];
    const occ = D.billOccurrences(U.thisMonth());
    linhas.push(`## Contas de ${U.monthLabel(U.thisMonth())}`, ...occ.map(o => `- ${U.fmtDay(o.venc)} ${o.conta.nome}: ${U.brl(o.valor)} (${o.pago ? 'paga' : D.STATUS_LABEL[D.billStatus(o)].toLowerCase()})`), '');
    linhas.push('## Remédios e suplementos', ...Store.list('remedio').filter(m => D.medActiveOn(m, t)).map(m => `- ${D.ehSuplemento(m) ? '[suplemento] ' : ''}${m.nome} ${m.dose || ''} — ${m.pessoa || ''} — ${(m.horarios || []).join(', ')} ${m.instrucoes ? `(${m.instrucoes})` : ''}`), '');
    const acabando = D.estoqueAcabando();
    if (acabando.length) linhas.push('## Estoque acabando', ...acabando.map(({ med, est }) => `- ${med.nome} (${med.pessoa || ''}): ${estoqueTxt(med, est)}`), '');
    linhas.push('## Compromissos (30 dias)', ...D.eventsBetween(t, U.ymd(U.addDays(new Date(), 30))).map(({ date, ev }) => `- ${U.fmtDate(date)} ${ev.hora || ''} ${ev.titulo}`), '');
    linhas.push('## Rotina de tarefas', ...Store.list('tarefa').filter(D.isRecorrente).map(x => `- ${x.titulo} — ${D.freqLabel(x)} — ${x.responsavel || ''}`), '');
    linhas.push('## Cardápio', ...U.WD.map((d, wd) => `- ${d}: ${D.SLOTS.map(sl => D.mealResumo(wd, sl.id)
      .map(x => `${x.quem ? `${x.quem}: ` : ''}${x.texto}`).join('; ')).filter(Boolean).join(' / ') || '—'}`));
    return linhas.join('\n');
  }

  async function copiar(texto, msg = 'Copiado ✔') {
    try {
      await navigator.clipboard.writeText(texto);
      toast(msg);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast(msg);
    }
  }

  // Importa registros já normalizados, mesclando com o que existe.
  async function importarRegistros(regs, origem) {
    let n = 0;
    for (const { kind, data } of regs) {
      let d = { origem, ...data, revisado: true };
      if (kind === 'item' && !d.lista) {
        const nome = d.lista_nome || 'Compras';
        let l = D.listas().find(x => x.nome.toLowerCase() === nome.toLowerCase());
        if (!l) l = await Store.put('lista', { nome, icone: nome.toLowerCase().includes('compra') ? '🛒' : '📝' });
        d = { ...d, lista: l.id };
        delete d.lista_nome;
      }
      await Store.put(kind, { ...(Store.get(kind, d.id) || {}), ...d });
      n++;
    }
    return n;
  }

  function imprimir() {
    const p = state.print;
    const { sheet, html } = Print.render(p.sheet, p);
    const param = {
      date: `<label>Dia <input type="date" data-action="print-param" data-key="date" value="${p.date}"></label>`,
      week: `<label>Semana que contém o dia <input type="date" data-action="print-param" data-key="week" value="${p.week}"></label>`,
      month: `<label>Mês <input type="month" data-action="print-param" data-key="month" value="${p.month}"></label>`,
      lista: `<label>Lista <select data-action="print-param" data-key="lista">${D.listas().map(l =>
        `<option value="${esc(l.id)}" ${l.id === p.lista ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></label>`,
      pessoa: `<label>De quem <select data-action="print-param" data-key="pessoa"><option value="">Todos</option>${D.pessoas().map(n =>
        `<option ${n === p.pessoa ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`,
    }[sheet.param] || '';
    return pageHead('Central de impressão', 'Folhas A4 prontas para deixar nos lugares certos da casa') + `
      <div class="print-layout">
        <div class="print-side">
          <div class="sheet-list-picker">${Print.SHEETS.map(s => `<button type="button" class="sheet-pick ${s.id === sheet.id ? 'active' : ''}"
            data-action="print-sheet" data-sheet="${s.id}"><strong>${s.nome}</strong><small>📍 ${s.onde} · ${s.landscape ? 'paisagem' : 'retrato'}</small></button>`).join('')}</div>
          <div class="print-params">${param}${btn('🖨️ Imprimir esta folha', 'do-print', '', 'primary block')}</div>
          <p class="muted small">Dica: na janela de impressão, escolha “Salvar como PDF” para guardar ou mandar por WhatsApp.</p>
        </div>
        <div class="preview-wrap"><div class="preview-scale"><div class="sheet ${sheet.landscape ? 'landscape' : ''}">${html}</div></div></div>
      </div>`;
  }

  function ajustes() {
    const nomes = D.pessoas();
    const cloud = Store.mode() === 'cloud';
    return pageHead('Ajustes', '') + `
      <div class="grid-2">
        ${panel('Casa e pessoas', `<form class="form-inline" data-form="pessoas">
          <label>Nome da casa (aparece nas impressões)<input name="casa" value="${esc(D.casaNome())}"></label>
          <label>Pessoa 1<input name="p1" value="${esc(nomes[0] || '')}"></label>
          <label>Pessoa 2<input name="p2" value="${esc(nomes[1] || '')}"></label>
          <label>Outras pessoas (separadas por vírgula — filhos, avós…)<input name="outros" value="${esc(nomes.slice(2).join(', '))}"></label>
          <button class="btn primary" type="submit">Salvar</button></form>`)}
        ${panel('Este aparelho', `<p class="muted">Diga de quem é este celular/computador. Usado para assinar recados e mostrar quem adicionou itens nas listas.</p>
          <label class="form-inline">Este aparelho é de
            <select data-action="set-eu"><option value="">— escolher —</option>${D.pessoas().map(p =>
              `<option ${p === D.eu() ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>`)}
        ${panel('Onde ficam os dados', cloud
          ? `<p>☁️ <b>Modo nuvem</b> — dados sincronizados entre vocês dois.</p><p class="muted">Conectado como ${esc(Store.user()?.email || '')}</p>
             ${btn('Sair', 'sign-out')}`
          : `<p>💻 <b>Modo local</b> — os dados ficam só neste navegador.</p>
             <p class="muted">Para usar em dois celulares com login, configure o Supabase (veja o README). Leva uns 15 minutos e é gratuito.</p>`)}
        ${panel('Backup', `<p class="muted">Baixe uma cópia de tudo de vez em quando. Também serve para levar os dados do modo local para a nuvem.</p>
          <div class="actions">${btn('⬇️ Baixar backup', 'export')}
          <label class="btn">⬆️ Restaurar backup<input type="file" accept="application/json" data-action="import" hidden></label></div>`)}
        ${panel('Limpeza', `<p class="muted">Apaga o histórico de remédios tomados com mais de 90 dias.</p>${btn('Limpar histórico antigo', 'prune-doses')}`)}
      </div>`;
  }

  const VIEWS = { painel, mural, contas, remedios, alimentacao, calendario, tarefas, listas, contatos, imprimir, automacao, ajustes };

  // ---------- Render ----------
  const currentRoute = () => {
    const r = location.hash.replace(/^#\/?/, '');
    return VIEWS[r] ? r : 'painel';
  };
  let pending = false;
  function render(force = false) {
    const main = $main();
    const ae = document.activeElement;
    // Não atrapalha quem está digitando quando chega atualização do outro celular.
    if (!force && main.contains(ae) && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'checkbox'))) {
      pending = true;
      return;
    }
    pending = false;
    const r = currentRoute();
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
    document.getElementById('brand-name').textContent = D.casaNome();
    main.innerHTML = VIEWS[r]();
    if (r === 'imprimir') fitPreview();
  }

  function fitPreview() {
    const wrap = document.querySelector('.preview-wrap');
    const scaler = document.querySelector('.preview-scale');
    const sheet = scaler?.querySelector('.sheet');
    if (!sheet) return;
    const scale = Math.min(1, (wrap.clientWidth - 24) / sheet.offsetWidth);
    scaler.style.transform = `scale(${scale})`;
    scaler.style.height = `${sheet.offsetHeight * scale}px`;
    scaler.style.width = `${sheet.offsetWidth * scale}px`;
  }

  // Retorno imediato ao concluir; quando não sobra nada de hoje, comemora mais.
  const VIVAS = ['Feito! 🎉', 'Mandou bem! ✨', 'Menos uma! 💪', 'Boa! ✔'];
  function comemorar() {
    const resta = D.pendencias(U.today(), D.eu()).filter(p => !p.feito && (p.faixa === 'atrasado' || p.faixa === 'hoje')).length;
    toast(resta ? `${VIVAS[Math.floor(Math.random() * VIVAS.length)]} Faltam ${resta} para hoje.` : 'Tudo de hoje feito! 🏆');
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---------- Estoque de remédios ----------
  // Remédio acabando vira item na lista da farmácia, uma vez por ciclo (repor libera o próximo aviso).
  // O id do item é fixo por remédio, então os dois celulares fazendo isso ao mesmo tempo não duplicam.
  let cuidandoEstoque = false;
  async function cuidarEstoque() {
    if (cuidandoEstoque) return;
    cuidandoEstoque = true;
    try {
      // Estoque gravado por um agente sem a data da contagem: conta a partir de hoje.
      for (const m of Store.list('remedio')) {
        if (D.temEstoque(m) && !m.estoque_em) await Store.put('remedio', { ...m, estoque_em: U.today() });
      }
      for (const { med } of D.estoqueAcabando()) {
        if (med.avisado) continue;
        const lista = await listaFarmacia();
        const id = `estoque-${med.id}`;
        await Store.put('item', { ...(Store.get('item', id) || {}), id, lista: lista.id, feito: false, por: 'aviso de estoque',
          texto: `${med.nome}${med.pessoa ? ` (${med.pessoa})` : ''}`, criadoEm: new Date().toISOString() });
        await Store.put('remedio', { ...Store.get('remedio', med.id), avisado: true });
        toast(`${medIco(med)} ${med.nome} está acabando: foi para a lista ${lista.nome}`);
      }
    } finally {
      cuidandoEstoque = false;
    }
  }
  const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  async function listaFarmacia() {
    const ls = D.listas();
    return ls.find(l => semAcento(l.nome).includes('farmacia')) || ls.find(l => semAcento(l.nome).includes('compra'))
      || Store.put('lista', { id: 'farmacia', nome: 'Farmácia', icone: '💊', criadaEm: new Date().toISOString() });
  }
  let estoqueTimer;
  const agendarEstoque = () => { clearTimeout(estoqueTimer); estoqueTimer = setTimeout(cuidarEstoque, 1500); };

  // ---------- Formulário genérico ----------
  function fieldHtml(f, val) {
    const id = `f-${f.name}`;
    const v = val ?? f.default ?? '';
    let input;
    switch (f.type) {
      case 'select': {
        const options = opts(f.options);
        if (v !== '' && !options.some(([value]) => String(value) === String(v))) options.push([v, v]);
        input = `<select id="${id}" name="${f.name}">${options.map(([value, label]) =>
          `<option value="${esc(value)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
        break;
      }
      case 'textarea':
        input = `<textarea id="${id}" name="${f.name}" rows="3">${esc(v)}</textarea>`;
        break;
      case 'weekdays':
        input = `<div class="weekdays">${U.WDS.map((d, i) => `<label><input type="checkbox" name="${f.name}" value="${i}"
          ${(v || []).includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>`;
        break;
      case 'bool':
        return `<div class="field" data-field="${f.name}"><label class="switch"><input type="checkbox" name="${f.name}" ${v === false || v === '' ? '' : 'checked'}> ${esc(f.label)}</label></div>`;
      case 'money':
        input = `<input id="${id}" name="${f.name}" inputmode="decimal" placeholder="0,00" value="${v === '' ? '' : Number(v).toFixed(2).replace('.', ',')}">`;
        break;
      case 'times':
        input = `<input id="${id}" name="${f.name}" placeholder="08:00, 20:00" value="${esc((v || []).join(', '))}">`;
        break;
      case 'combo':
        input = `<input id="${id}" name="${f.name}" list="${id}-l" value="${esc(v)}"><datalist id="${id}-l">${f.options.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
        break;
      default:
        input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}" inputmode="decimal"` : ''}>`;
    }
    return `<div class="field" data-field="${f.name}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ''}</div>`;
  }

  function readField(form, f) {
    if (f.type === 'weekdays') return [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map(i => +i.value);
    const el = form.querySelector(`[name="${f.name}"]`);
    switch (f.type) {
      case 'bool': return el.checked;
      case 'money': return U.parseMoney(el.value);
      case 'number': return el.value === '' ? '' : Number(el.value);
      case 'times': return U.parseTimes(el.value);
      default: return el.value.trim();
    }
  }

  function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Salvar' }) {
    const dlg = document.getElementById('modal');
    dlg.innerHTML = `<form class="form" novalidate>
      <header class="form-head"><h2>${esc(title)}</h2><button type="button" class="btn icon ghost" data-close aria-label="Fechar">✕</button></header>
      <div class="form-body">${fields.map(f => fieldHtml(f, values[f.name])).join('')}</div>
      <footer class="form-actions">${onDelete ? '<button type="button" class="btn danger" data-del>Excluir</button>' : ''}
        <span class="spacer"></span><button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${esc(saveLabel)}</button></footer></form>`;
    const form = dlg.querySelector('form');
    const read = () => Object.fromEntries(fields.map(f => [f.name, readField(form, f)]));
    const sync = () => {
      const cur = read();
      fields.forEach(f => { if (f.showIf) form.querySelector(`[data-field="${f.name}"]`).hidden = !f.showIf(cur); });
    };
    form.addEventListener('change', sync);
    form.addEventListener('input', sync);
    sync();
    form.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
    if (onDelete) {
      form.querySelector('[data-del]').onclick = async () => {
        if (!confirm('Excluir este item?')) return;
        dlg.close();
        await onDelete();
        toast('Excluído');
      };
    }
    form.onsubmit = async e => {
      e.preventDefault();
      const data = read();
      const missing = fields.find(f => f.required && (!f.showIf || f.showIf(data)) &&
        (data[f.name] === '' || data[f.name] == null || (Array.isArray(data[f.name]) && !data[f.name].length)));
      if (missing) {
        alert(`Preencha: ${missing.label}`);
        form.querySelector(`[name="${missing.name}"]`)?.focus();
        return;
      }
      dlg.close();
      await onSave(data);
      toast('Salvo ✔');
    };
    dlg.showModal();
    form.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
  }

  // ---------- Formulários de cada módulo ----------
  function billForm(conta = {}) {
    openForm({
      title: conta.id ? 'Editar conta' : 'Nova conta',
      values: conta,
      fields: [
        { name: 'nome', label: 'Nome da conta', required: true },
        { name: 'valor', label: 'Valor (R$)', type: 'money', hint: 'Para contas que variam (luz, água), coloque um valor aproximado e ajuste ao pagar.' },
        { name: 'tipo', label: 'Repetição', type: 'select', options: [['mensal', 'Todo mês'], ['unica', 'Uma vez só']], default: 'mensal' },
        { name: 'dia', label: 'Dia do vencimento', type: 'number', min: 1, max: 31, required: true, showIf: v => v.tipo === 'mensal' },
        { name: 'data', label: 'Data do vencimento', type: 'date', required: true, showIf: v => v.tipo === 'unica' },
        { name: 'inicio', label: 'A partir de (mês)', type: 'month', default: U.thisMonth(), showIf: v => v.tipo === 'mensal' },
        { name: 'fim', label: 'Até (mês) — vazio se não tem fim', type: 'month', showIf: v => v.tipo === 'mensal' },
        { name: 'categoria', label: 'Categoria', type: 'select', options: D.CATEGORIAS },
        { name: 'responsavel', label: 'Quem paga', type: 'select', options: D.responsaveis() },
        { name: 'forma', label: 'Forma de pagamento', type: 'combo', options: ['Boleto', 'Pix', 'Débito automático', 'Cartão de crédito', 'Dinheiro'] },
        { name: 'codigo', label: 'Código de barras / Pix copia e cola', type: 'textarea' },
        { name: 'obs', label: 'Observações (código de barras, site, login…)', type: 'textarea' },
      ],
      onSave: v => Store.put('conta', { ...conta, ...v }),
      onDelete: conta.id ? () => Store.remove('conta', conta.id) : null,
    });
  }

  function medForm(med = {}) {
    const est = med.id ? D.estoque(med) : null;
    const sup = D.ehSuplemento(med);
    const comEstoque = v => v.estoque !== '';
    openForm({
      title: `${med.id ? 'Editar' : 'Novo'} ${sup ? 'suplemento' : 'remédio'}`,
      // O formulário mostra o estoque de hoje (já descontadas as doses dos dias passados).
      values: { ...med, estoque: est ? est.restante : med.estoque },
      fields: [
        { name: 'nome', label: sup ? 'Suplemento' : 'Remédio', required: true },
        { name: 'categoria', label: 'Tipo', type: 'select', options: [['remedio', 'Remédio'], ['suplemento', 'Suplemento (aparece também em Alimentação)']], default: 'remedio' },
        { name: 'pessoa', label: 'Para quem', type: 'combo', options: D.pessoas(), default: D.pessoas()[0] },
        { name: 'dose', label: 'Dose', hint: 'Ex.: 1 comprimido de 50mg, 10 gotas' },
        { name: 'horarios', label: 'Horários', type: 'times', hint: 'Separe por vírgula. Ex.: 08:00, 14:00, 20:00' },
        { name: 'instrucoes', label: 'Como tomar', hint: 'Ex.: em jejum, após o almoço, com água' },
        { name: 'inicio', label: 'Início', type: 'date', default: U.today() },
        { name: 'fim', label: 'Fim (vazio = uso contínuo)', type: 'date' },
        { name: 'estoque', label: 'Quantidade disponível agora', type: 'number', min: 0, step: 'any',
          hint: `Ex.: 28 comprimidos. O app desconta as doses de cada dia e avisa ${D.AVISO_ESTOQUE} dias antes de acabar. Vazio = não controlar.` },
        { name: 'unidade', label: 'Unidade', type: 'combo', options: D.UNIDADES, default: 'comprimidos', showIf: comEstoque },
        { name: 'por_dose', label: 'Unidades gastas em cada horário', type: 'number', min: 0, step: 'any', default: 1, showIf: comEstoque,
          hint: 'Ex.: 1 comprimido, 0.5 (meio), 20 gotas' },
        { name: 'ativo', label: 'Ativo', type: 'bool', default: true },
      ],
      onSave: v => {
        const novo = { ...med, ...v };
        if (v.estoque === '') {
          novo.estoque = '';
          novo.estoque_em = '';
        } else {
          novo.estoque_em = U.today();
          if (!est || v.estoque > est.restante) novo.avisado = false; // reposição libera um novo aviso
        }
        return Store.put('remedio', novo);
      },
      onDelete: med.id ? () => Store.remove('remedio', med.id) : null,
    });
  }

  function eventForm(ev = {}) {
    openForm({
      title: ev.id ? 'Editar compromisso' : 'Novo compromisso',
      values: ev,
      fields: [
        { name: 'titulo', label: 'O quê', required: true },
        { name: 'data', label: 'Data', type: 'date', required: true },
        { name: 'hora', label: 'Hora', type: 'time' },
        { name: 'pessoa', label: 'Quem', type: 'select', options: D.responsaveis(), default: 'Ambos' },
        { name: 'local', label: 'Local' },
        { name: 'repete', label: 'Repetir', type: 'select', options: D.REPETE, hint: 'Use “Todo ano” para aniversários.' },
        { name: 'obs', label: 'Observações', type: 'textarea' },
      ],
      onSave: v => Store.put('evento', { ...ev, ...v }),
      onDelete: ev.id ? () => Store.remove('evento', ev.id) : null,
    });
  }

  function taskForm(t = {}) {
    openForm({
      title: t.id ? 'Editar tarefa' : 'Nova tarefa',
      values: t,
      fields: [
        { name: 'titulo', label: 'Tarefa', required: true },
        { name: 'tipo', label: 'Frequência', type: 'select', options: D.TIPOS_TAREFA, default: 'unica' },
        { name: 'data', label: 'Prazo (opcional)', type: 'date', showIf: v => v.tipo === 'unica' },
        { name: 'dias', label: 'Dias da semana', type: 'weekdays', required: true, showIf: v => v.tipo === 'semanal' },
        { name: 'dia', label: 'Dia do mês', type: 'number', min: 1, max: 31, required: true, showIf: v => v.tipo === 'mensal' },
        { name: 'responsavel', label: 'Quem', type: 'select', options: D.responsaveis() },
        { name: 'local', label: 'Onde (cômodo)', type: 'combo', options: D.LOCAIS },
        { name: 'obs', label: 'Observações', type: 'textarea' },
      ],
      onSave: v => Store.put('tarefa', { ...t, ...v }),
      onDelete: t.id ? () => Store.remove('tarefa', t.id) : null,
    });
  }

  function listForm(l = {}) {
    openForm({
      title: l.id ? 'Editar lista' : 'Nova lista',
      values: l,
      fields: [
        { name: 'nome', label: 'Nome da lista', required: true },
        { name: 'icone', label: 'Ícone (emoji)', default: '📝', hint: 'Ex.: 🛒 💊 🔧 🎁 🧳' },
      ],
      onSave: async v => { const nova = await Store.put('lista', { criadaEm: new Date().toISOString(), ...l, ...v }); state.lista = nova.id; render(true); },
      onDelete: l.id ? async () => {
        await Store.removeMany('item', D.itensDa(l.id).map(i => i.id));
        await Store.remove('lista', l.id);
        state.lista = null;
      } : null,
    });
  }

  function itemForm(i) {
    openForm({
      title: 'Editar item',
      values: i,
      fields: [
        { name: 'texto', label: 'Item', required: true },
        { name: 'prazo', label: 'Até quando (opcional)', type: 'date', hint: 'Com prazo, o item aparece também em Tarefas, na coluna do dia.' },
      ],
      onSave: v => Store.put('item', { ...i, ...v }),
      onDelete: () => Store.remove('item', i.id),
    });
  }

  function contactForm(c = {}) {
    openForm({
      title: c.id ? 'Editar contato' : 'Novo contato',
      values: c,
      fields: [
        { name: 'nome', label: 'Nome', required: true, hint: 'Ex.: Dra. Ana (cardiologista), Escola, Encanador João' },
        { name: 'categoria', label: 'Categoria', type: 'select', options: D.CATEG_CONTATO, default: 'Saúde' },
        { name: 'telefone', label: 'Telefone', type: 'tel' },
        { name: 'whatsapp', label: 'Tem WhatsApp', type: 'bool', default: false },
        { name: 'endereco', label: 'Endereço' },
        { name: 'obs', label: 'Observações', type: 'textarea', hint: 'Ex.: convênio, horário de atendimento, nº da carteirinha' },
      ],
      onSave: v => Store.put('contato', { ...c, ...v }),
      onDelete: c.id ? () => Store.remove('contato', c.id) : null,
    });
  }

  // ---------- Ações ----------
  const ACTIONS = {
    'month-shift': el => { state[el.dataset.key] = U.addMonths(state[el.dataset.key], +el.dataset.n); render(true); },
    'goto-print': el => {
      state.print.sheet = el.dataset.sheet;
      if (el.dataset.month) state.print.month = el.dataset.month;
      if (el.dataset.date) state.print.date = el.dataset.date;
      if (el.dataset.lista) state.print.lista = el.dataset.lista;
      if ('pessoa' in el.dataset) state.print.pessoa = el.dataset.pessoa;
      location.hash = '#/imprimir';
    },

    'new-bill': () => billForm(),
    'edit-bill': el => billForm(Store.get('conta', el.dataset.id)),
    'pay-bill': el => {
      const conta = Store.get('conta', el.dataset.id);
      const mes = el.dataset.mes;
      openForm({
        title: `Pagar: ${conta.nome}`,
        saveLabel: 'Marcar como paga',
        fields: [
          { name: 'data', label: 'Pago em', type: 'date', required: true, default: U.today() },
          { name: 'valor', label: 'Valor pago (R$)', type: 'money', default: Number(conta.valor) || 0 },
        ],
        onSave: v => Store.put('conta', { ...conta, pagos: { ...(conta.pagos || {}), [mes]: v } }),
      });
    },
    'unpay-bill': el => {
      const conta = Store.get('conta', el.dataset.id);
      if (!confirm(`Desmarcar o pagamento de "${conta.nome}"?`)) return;
      const pagos = { ...(conta.pagos || {}) };
      delete pagos[el.dataset.mes];
      Store.put('conta', { ...conta, pagos });
    },

    'new-med': el => medForm({ categoria: el.dataset.categoria || 'remedio', ...(el.dataset.pessoa ? { pessoa: el.dataset.pessoa } : {}) }),
    'pick-rem-pessoa': el => { state.remPessoa = el.dataset.pessoa; render(true); },
    'repor-med': el => {
      const med = Store.get('remedio', el.dataset.id);
      const est = D.estoque(med);
      openForm({
        title: `Repor: ${med.nome}`,
        saveLabel: 'Somar ao estoque',
        fields: [{ name: 'qtd', label: `Quantos ${med.unidade || 'unidades'} chegaram?`, type: 'number', min: 0, step: 'any', required: true,
          hint: est ? `Hoje ${estoqueTxt(med, est)}.` : '' }],
        onSave: async v => {
          const total = Math.round(((est ? est.restante : 0) + Number(v.qtd)) * 100) / 100;
          await Store.put('remedio', { ...med, estoque: total, estoque_em: U.today(), avisado: false });
          const item = Store.get('item', `estoque-${med.id}`);
          if (item && !item.feito) await Store.put('item', { ...item, feito: true });
        },
      });
    },
    'edit-med': el => medForm(Store.get('remedio', el.dataset.id)),
    'toggle-dose': el => {
      const key = el.dataset.key;
      if (Store.get('dose', key)) Store.remove('dose', key);
      else Store.put('dose', { id: key, por: D.eu() || Store.user()?.email || '', em: new Date().toISOString() });
    },

    'new-event': el => eventForm({ data: el.dataset.date || U.today() }),
    'edit-event': el => eventForm(Store.get('evento', el.dataset.id)),

    'new-task': () => taskForm(),
    'edit-task': el => taskForm(Store.get('tarefa', el.dataset.id)),
    'toggle-task': async el => {
      const t = Store.get('tarefa', el.dataset.id);
      const date = el.dataset.date;
      const feito = !D.taskDone(t, date);
      if (D.isRecorrente(t)) {
        const limite = U.ymd(U.addDays(new Date(), -120));
        const feitos = Object.fromEntries(Object.entries(t.feitos || {}).filter(([d]) => d >= limite));
        if (feitos[date]) delete feitos[date]; else feitos[date] = true;
        await Store.put('tarefa', { ...t, feitos });
      } else {
        await Store.put('tarefa', { ...t, feito, feitoEm: feito ? date : null });
      }
      if (feito) comemorar();
    },
    'pick-tar-pessoa': el => { state.tarPessoa = el.dataset.pessoa; render(true); },
    'toggle-faixa': el => { const f = el.dataset.faixa; state.faixasAbertas[f] = !state.faixasAbertas[f]; render(true); },
    'toggle-foco': el => {
      const { kind, id } = el.dataset;
      const chave = el.dataset.chave || 'casa';
      const o = Store.get(kind, id);
      const t = U.today();
      // Guarda só o foco de hoje de cada pessoa (as datas antigas saem).
      const foco = Object.fromEntries(Object.entries(o.foco || {}).filter(([, d]) => d === t));
      if (foco[chave] === t) delete foco[chave];
      else {
        if (D.focoDe(el.dataset.chave, t).filter(p => !p.feito).length >= D.FOCO_MAX) {
          return toast(`O foco tem no máximo ${D.FOCO_MAX} itens. Conclua ou tire um antes.`);
        }
        foco[chave] = t;
      }
      Store.put(kind, { ...o, foco });
    },

    'pick-ali-pessoa': el => { state.aliPessoa = el.dataset.pessoa; render(true); },
    'save-meal': el => {
      Store.put('refeicao', { id: el.dataset.id, texto: el.value.trim(), pessoa: el.dataset.pessoa || '' });
      toast('Cardápio salvo ✔');
    },
    'save-meal-obs': el => {
      Store.put('config', { ...D.config('alimentacao'), id: 'alimentacao', obs: el.value.trim() });
      toast('Salvo ✔');
    },

    'print-sheet': el => { state.print.sheet = el.dataset.sheet; render(true); },
    'print-param': el => { if (el.value || el.dataset.key === 'pessoa') state.print[el.dataset.key] = el.value; render(true); },
    'do-print': () => Print.print(state.print.sheet, state.print),

    'pin-note': el => { const r = Store.get('recado', el.dataset.id); Store.put('recado', { ...r, fixado: !r.fixado }); },
    'del-note': el => { if (confirm('Excluir este recado?')) Store.remove('recado', el.dataset.id); },
    'like-note': el => {
      const eu = D.eu();
      if (!eu) { alert('Primeiro diga de quem é este aparelho em Ajustes.'); location.hash = '#/ajustes'; return; }
      const r = Store.get('recado', el.dataset.id);
      const curtidas = (r.curtidas || []).includes(eu) ? r.curtidas.filter(n => n !== eu) : [...(r.curtidas || []), eu];
      Store.put('recado', { ...r, curtidas });
    },

    'new-list': () => listForm(),
    'edit-list': el => listForm(Store.get('lista', el.dataset.id)),
    'create-list': async el => {
      const l = await Store.put('lista', { nome: el.dataset.nome, icone: el.dataset.icone, criadaEm: new Date().toISOString() });
      state.lista = l.id;
      render(true);
    },
    'pick-list': el => { state.lista = el.dataset.id; render(true); },
    'toggle-item': async el => {
      const i = Store.get('item', el.dataset.id);
      await Store.put('item', { ...i, feito: !i.feito, feitoEm: i.feito ? null : U.today() });
      if (!i.feito && i.prazo) comemorar();
    },
    'edit-item': (el, e) => { e.preventDefault(); itemForm(Store.get('item', el.dataset.id)); },
    'del-item': (el, e) => { e.preventDefault(); Store.remove('item', el.dataset.id); },
    'clear-done': el => {
      const ids = D.itensDa(el.dataset.lista).filter(i => i.feito).map(i => i.id);
      if (ids.length && confirm(`Remover ${ids.length} itens marcados?`)) Store.removeMany('item', ids);
    },

    'new-contact': () => contactForm(),
    'edit-contact': el => contactForm(Store.get('contato', el.dataset.id)),
    'add-emergency': async () => {
      for (const [nome, telefone] of [['Polícia Militar', '190'], ['SAMU (ambulância)', '192'], ['Corpo de Bombeiros', '193'], ['Defesa Civil', '199']]) {
        await Store.put('contato', { nome, telefone, categoria: 'Emergência', whatsapp: false });
      }
      toast('Números de emergência adicionados ✔');
    },
    'set-eu': el => { D.setEu(el.value); toast('Salvo ✔'); },

    copy: el => copiar(el.dataset.text),
    'copy-prompt': () => copiar(Schema.promptIA(D.pessoas()), 'Prompt copiado — cole no Claude ou Gemini ✔'),
    'copy-summary': () => copiar(resumoRotina(), 'Resumo copiado ✔'),
    'copy-json': () => copiar(JSON.stringify(Store.exportAll(), null, 2), 'Dados copiados ✔'),
    'copy-agent-guide': () => copiar(agentGuide(state.novaChave || 'SUA_CHAVE'), 'Instruções copiadas ✔'),
    'import-preview': () => {
      const text = $main().querySelector('[data-role=import-text]').value;
      state.importTexto = text;
      try {
        state.importacao = Schema.parseImport(text);
        if (!state.importacao.length) throw new Error('Nenhum registro encontrado.');
      } catch (err) {
        state.importacao = null;
        alert('Não consegui ler o texto: ' + err.message);
      }
      render(true);
    },
    'import-cancel': () => { state.importacao = null; render(true); },
    'import-confirm': async () => {
      const regs = (state.importacao || []).filter(r => !r.erros.length);
      state.importacao = null;
      state.importTexto = '';
      const n = await importarRegistros(regs, 'importacao-ia');
      render(true);
      toast(`${n} registros importados ✔`);
    },
    'import-ics': async el => {
      const file = el.files[0];
      if (!file) return;
      try {
        const regs = Schema.parseICS(await file.text(), U.today());
        if (!regs.length) return alert('Nenhum compromisso de hoje em diante encontrado no arquivo.');
        if (!confirm(`Importar ${regs.length} compromissos?`)) return;
        const n = await importarRegistros(regs, 'calendario-ics');
        toast(`${n} compromissos importados ✔`);
      } catch (err) {
        alert('Não consegui ler o arquivo: ' + err.message);
      } finally {
        el.value = '';
      }
    },
    'load-keys': async () => {
      try { state.chaves = await Store.rpc('listar_chaves_api'); } catch (err) { alert(err.message); state.chaves = []; }
      render(true);
    },
    'revoke-key': async el => {
      if (!confirm('Revogar esta chave? O agente que a usa perde o acesso imediatamente.')) return;
      await Store.rpc('revogar_chave_api', { p_id: el.dataset.id });
      state.chaves = await Store.rpc('listar_chaves_api');
      render(true);
    },
    'review-ok': el => { const o = Store.get(el.dataset.kind, el.dataset.id); Store.put(el.dataset.kind, { ...o, revisado: true }); },
    'review-all': () => D.paraRevisar().forEach(({ kind, obj }) => Store.put(kind, { ...obj, revisado: true })),
    'review-del': el => { if (confirm('Descartar este item?')) Store.remove(el.dataset.kind, el.dataset.id); },
    'review-edit': el => {
      const forms = { conta: billForm, remedio: medForm, evento: eventForm, tarefa: taskForm, contato: contactForm };
      forms[el.dataset.kind]({ ...Store.get(el.dataset.kind, el.dataset.id), revisado: true });
    },

    'sign-out': () => Store.signOut(),
    export: () => {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `casa-organizada-backup-${U.today()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    import: async el => {
      const file = el.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!confirm('Mesclar este backup com os dados atuais? Itens com o mesmo identificador serão substituídos.')) return;
        await Store.importAll(data);
        toast('Backup restaurado ✔');
      } catch (err) {
        alert('Arquivo inválido: ' + err.message);
      } finally {
        el.value = '';
      }
    },
    'prune-doses': async () => {
      const limite = U.ymd(U.addDays(new Date(), -90));
      const ids = Store.list('dose').map(d => d.id).filter(id => id.slice(0, 10) < limite);
      if (!ids.length) return toast('Nada para limpar');
      if (!confirm(`Apagar ${ids.length} registros antigos?`)) return;
      await Store.removeMany('dose', ids);
      toast('Limpo ✔');
    },
  };

  function bindEvents() {
    const main = $main();
    main.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      ACTIONS[el.dataset.action]?.(el, e);
    });
    main.addEventListener('change', e => {
      const el = e.target.closest('[data-action]');
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      ACTIONS[el.dataset.action]?.(el, e);
    });
    main.addEventListener('submit', async e => {
      const form = e.target;
      if (form.dataset.form === 'recado') {
        e.preventDefault();
        const f = new FormData(form);
        const texto = String(f.get('texto') || '').trim();
        if (!texto) return;
        if (!D.eu()) D.setEu(f.get('autor'));
        await Store.put('recado', { texto, autor: f.get('autor'), fixado: f.get('fixado') === 'on', em: new Date().toISOString(), curtidas: [] });
        render(true);
        toast('Recado publicado ✔');
        return;
      }
      if (form.dataset.form === 'item') {
        e.preventDefault();
        const input = form.querySelector('input[name=texto]');
        const textos = input.value.split(/\n|;/).map(t => t.trim()).filter(Boolean);
        const prazo = form.querySelector('input[name=prazo]')?.value || '';
        for (const texto of textos) {
          await Store.put('item', { lista: form.dataset.lista, texto, prazo, feito: false, por: D.eu(), criadoEm: new Date().toISOString() });
        }
        render(true);
        $main().querySelector('.quick-add input')?.focus();
        return;
      }
      if (form.dataset.form === 'tarefa-rapida') {
        e.preventDefault();
        const f = new FormData(form);
        const titulo = String(f.get('titulo') || '').trim();
        if (!titulo) return;
        const quando = String(f.get('quando') || 'hoje');
        const dias = { hoje: 0, amanha: 1, semana: 7 }[quando];
        const data = String(f.get('data') || '') || (dias == null ? '' : U.ymd(U.addDays(new Date(), dias)));
        state.novaQuando = quando;
        const sel = D.pessoas().includes(state.tarPessoa) ? state.tarPessoa : '';
        await Store.put('tarefa', { titulo, tipo: 'unica', data, responsavel: sel, feito: false });
        render(true);
        toast(`Adicionada: ${D.FAIXAS.find(x => x.id === D.faixaDe(data)).nome.toLowerCase()} ✔`);
        $main().querySelector('.quick-task input[name=titulo]')?.focus();
        return;
      }
      if (form.dataset.form === 'nova-chave') {
        e.preventDefault();
        try {
          const f = new FormData(form);
          const soContas = f.get('escopo') === 'contas';
          state.novaChave = await Store.rpc('criar_chave_api', {
            p_nome: f.get('nome'), p_tipos: soContas ? ['conta'] : null, p_pode_remover: !soContas,
          });
          state.novaChaveEscopo = soContas ? 'contas' : 'total';
          state.chaves = await Store.rpc('listar_chaves_api');
        } catch (err) {
          alert('Não foi possível criar a chave: ' + err.message + '\n\nVocê executou a versão mais recente do supabase/schema.sql?');
        }
        render(true);
        return;
      }
      if (form.dataset.form !== 'pessoas') return;
      e.preventDefault();
      const f = new FormData(form);
      const nomes = [f.get('p1'), f.get('p2'), ...String(f.get('outros')).split(',')].map(s => String(s || '').trim()).filter(Boolean);
      Store.put('config', { id: 'pessoas', nomes });
      Store.put('config', { id: 'casa', nome: String(f.get('casa')).trim() });
      toast('Salvo ✔');
    });
    document.addEventListener('focusout', () => { if (pending) setTimeout(() => render(), 0); });
    window.addEventListener('hashchange', () => { render(true); window.scrollTo(0, 0); });
    window.addEventListener('resize', fitPreview);
    // Volta para o app no dia seguinte (tablet na cozinha, por exemplo) com "hoje" atualizado.
    let lastDay = U.today();
    setInterval(() => { if (U.today() !== lastDay) { lastDay = U.today(); render(); agendarEstoque(); } }, 60000);
  }

  function showLogin() {
    document.body.classList.add('logged-out');
    $main().innerHTML = `<form class="login panel" id="login">
      <img src="icon.svg" alt="" width="56" height="56"><h1>Casa Organizada</h1>
      <p class="muted">Acesso restrito. Entre com seu e-mail e senha.</p>
      <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
      <label>Senha<input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn primary block" type="submit">Entrar</button><p class="error" id="login-err"></p></form>`;
    document.getElementById('login').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await Store.signIn(f.get('email'), f.get('password'));
        document.body.classList.remove('logged-out');
        await start();
      } catch (err) {
        const msg = /invalid login credentials/i.test(err.message) ? 'E-mail ou senha incorretos.'
          : /email not confirmed/i.test(err.message) ? 'E-mail ainda não confirmado. Confirme o usuário no Supabase.'
          : err.message;
        document.getElementById('login-err').textContent = 'Não foi possível entrar: ' + msg;
      }
    };
  }

  async function start() {
    if (Store.mode() === 'cloud') {
      $main().innerHTML = '<p class="loading">Carregando…</p>';
      await Store.loadCloud();
    }
    document.getElementById('nav').innerHTML = NAV.map(([r, label, icon]) =>
      `<a href="#/${r}" data-route="${r}"><span class="ico">${icon}</span><span>${label}</span></a>`).join('');
    document.getElementById('mode').innerHTML = Store.mode() === 'cloud'
      ? `☁️ Sincronizado<br><small>${esc(Store.user()?.email || '')}</small>`
      : '💻 Modo local<br><small>dados só neste navegador</small>';
    Store.subscribe(() => { render(); agendarEstoque(); });
    Store.setErrorHandler(err => toast('⚠️ Erro ao salvar: ' + (err.message || err)));
    bindEvents();
    render(true);
    agendarEstoque();
  }

  async function boot() {
    try {
      await Store.init();
      if (Store.mode() === 'cloud' && !Store.user()) return showLogin();
      await start();
    } catch (err) {
      console.error(err);
      $main().innerHTML = `<div class="panel"><h2>Ops, algo deu errado</h2><p>${esc(err.message || err)}</p></div>`;
    }
  }

  boot();
})();
