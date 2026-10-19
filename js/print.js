// Folhas A4 para imprimir e deixar nos lugares da casa.
const Print = (() => {
  const { esc, nl2br } = U;
  const BOX = '<span class="box"></span>';

  const SHEETS = [
    { id: 'dia', nome: 'Resumo do dia', onde: 'Geladeira / porta', param: 'date', landscape: false },
    { id: 'remedios', nome: 'Quadro de remédios da semana', onde: 'Banheiro / cozinha', param: 'week', landscape: true },
    { id: 'cardapio', nome: 'Cardápio semanal', onde: 'Geladeira', param: 'pessoa', landscape: true },
    { id: 'contas', nome: 'Contas do mês', onde: 'Escritório / pasta de contas', param: 'month', landscape: false },
    { id: 'calendario', nome: 'Calendário do mês', onde: 'Mural / corredor', param: 'month', landscape: true },
    { id: 'tarefas', nome: 'Rotina de tarefas da semana', onde: 'Lavanderia / cozinha', param: 'week', landscape: true },
    { id: 'compras', nome: 'Lista de compras', onde: 'Porta da geladeira / bolsa', param: 'lista', landscape: false },
    { id: 'contatos', nome: 'Telefones úteis', onde: 'Geladeira / perto do telefone', param: null, landscape: false },
  ];

  const head = (title, sub) => `<header class="sheet-head">
      <div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      <div class="sheet-brand">${esc(D.casaNome())}</div>
    </header>`;
  const empty = msg => `<p class="sheet-empty">${esc(msg)}</p>`;
  // Refeição com o nome de quem come algo diferente: "<b>Antônio:</b> papinha<br><b>Renato e Vanessa:</b> arroz…"
  const mealLines = (wd, slot) => D.mealResumo(wd, slot)
    .map(x => `${x.quem ? `<b>${esc(x.quem)}:</b> ` : ''}${nl2br(x.texto)}`).join('<br>');
  const weekDays = week => {
    const start = U.startOfWeek(U.parseYmd(week));
    return [...Array(7)].map((_, i) => U.ymd(U.addDays(start, i)));
  };
  const dayTh = d => `<th class="w-day">${U.WDS[U.mondayIndex(U.parseYmd(d))]}<br><small>${U.fmtDay(d)}</small></th>`;

  function dia({ date }) {
    const wd = U.mondayIndex(U.parseYmd(date));
    const doses = D.dosesOn(date);
    const tarefas = D.tasksOn(date);
    const eventos = D.eventsOn(date);
    const limite = U.ymd(U.addDays(U.parseYmd(date), 7));
    const contas = [...D.billOccurrences(date.slice(0, 7)), ...D.billOccurrences(U.addMonths(date.slice(0, 7), 1))]
      .filter(o => !o.pago && o.venc <= limite);
    const sec = (titulo, body) => `<section class="sheet-sec"><h2>${titulo}</h2>${body}</section>`;
    const lista = (items, fn, vazio) => items.length ? `<ul class="sheet-list">${items.map(fn).join('')}</ul>` : empty(vazio);

    return head('Nosso dia', U.longDate(date)) + `<div class="sheet-cols">
      <div>
        ${sec('💊 Remédios', lista(doses, d => `<li>${BOX}<b class="time">${d.hora}</b> ${esc(d.med.nome)}
          <small>${esc([d.med.dose, d.med.pessoa, d.med.instrucoes].filter(Boolean).join(' · '))}</small></li>`, 'Nenhum remédio hoje.'))}
        ${sec('✅ Tarefas', lista(tarefas, t => `<li>${BOX}${esc(t.tarefa.titulo)}
          <small>${esc([t.tarefa.responsavel, t.tarefa.local].filter(Boolean).join(' · '))}</small></li>`, 'Nenhuma tarefa.'))}
      </div>
      <div>
        ${sec('🍽️ Refeições', `<dl class="sheet-meals">${D.SLOTS.map(s =>
          `<dt>${s.nome}</dt><dd>${mealLines(wd, s.id) || '—'}</dd>`).join('')}</dl>`)}
        ${sec('📅 Compromissos', lista(eventos, e => `<li><b class="time">${esc(e.hora || '—')}</b> ${esc(e.titulo)}
          <small>${esc([e.pessoa, e.local].filter(Boolean).join(' · '))}</small></li>`, 'Nenhum compromisso.'))}
        ${sec('💰 Contas a vencer (7 dias)', lista(contas, o => `<li>${BOX}<b class="time">${U.fmtDay(o.venc)}</b> ${esc(o.conta.nome)}
          <small>${U.brl(o.valor)}</small></li>`, 'Nenhuma conta nos próximos dias.'))}
      </div>
    </div>
    <footer class="sheet-notes"><h2>Anotações</h2><div class="lines"></div></footer>`;
  }

  function remedios({ week }) {
    const days = weekDays(week);
    const meds = Store.list('remedio').filter(m => days.some(d => D.medActiveOn(m, d)));
    let html = head('Remédios da semana', `${U.fmtDate(days[0])} a ${U.fmtDate(days[6])} — marque ao tomar`);
    if (!meds.length) return html + empty('Nenhum remédio ativo nesta semana.');
    const porPessoa = U.groupBy(meds, m => m.pessoa || 'Geral');
    for (const pessoa of Object.keys(porPessoa).sort()) {
      const rows = porPessoa[pessoa]
        .flatMap(m => ((m.horarios || []).length ? m.horarios : ['livre']).map(h => ({ m, h })))
        .sort((a, b) => a.h.localeCompare(b.h));
      html += `<h2 class="sheet-person">${esc(pessoa)}</h2>
      <table class="grid"><thead><tr><th class="w-time">Horário</th><th>Remédio</th><th>Dose / como tomar</th>
        ${days.map(dayTh).join('')}</tr></thead><tbody>
        ${rows.map(({ m, h }) => `<tr><td class="time">${h}</td><td><b>${esc(m.nome)}</b>${D.ehSuplemento(m) ? ' <small>(suplemento)</small>' : ''}</td>
          <td>${esc(m.dose)}${m.instrucoes ? `<br><small>${esc(m.instrucoes)}</small>` : ''}</td>
          ${days.map(d => `<td class="c">${D.medActiveOn(m, d) ? BOX : '<span class="na">—</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`;
    }
    return html;
  }

  function cardapio({ pessoa } = {}) {
    const obs = D.config('alimentacao').obs;
    const cell = (wd, slot) => (pessoa ? nl2br(D.meal(wd, slot, pessoa)) : mealLines(wd, slot));
    const supl = D.suplementosDe(pessoa || null);
    return head(pessoa ? `Cardápio de ${pessoa}` : 'Cardápio da semana', 'Rotina alimentar') + `
      <table class="grid meals"><thead><tr><th class="w-slot"></th>${U.WD.map(d => `<th>${d}</th>`).join('')}</tr></thead>
      <tbody>${D.SLOTS.map(s => `<tr><th class="slot">${s.nome}</th>
        ${U.WD.map((_, wd) => `<td>${cell(wd, s.id)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${supl.length ? `<section class="sheet-sec"><h2>🌿 Suplementos</h2><ul class="sheet-list cols">${supl.map(m =>
        `<li><b class="time">${esc((m.horarios || []).join(', ') || '—')}</b> ${esc(m.nome)}
          <small>${esc([pessoa ? '' : m.pessoa, m.dose, m.instrucoes].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul></section>` : ''}
      ${obs ? `<footer class="sheet-notes"><h2>Observações</h2><p>${nl2br(obs)}</p></footer>` : ''}`;
  }

  function contas({ month }) {
    const occ = D.billOccurrences(month);
    const total = occ.reduce((s, o) => s + o.valor, 0);
    const pago = occ.filter(o => o.pago).reduce((s, o) => s + o.valor, 0);
    let html = head('Contas do mês', U.monthLabel(month));
    if (!occ.length) return html + empty('Nenhuma conta cadastrada para este mês.');
    html += `<table class="grid"><thead><tr><th class="w-time">Venc.</th><th>Conta</th><th>Categoria</th>
      <th>Responsável</th><th>Forma</th><th class="r">Valor</th><th class="w-paid">Pago em</th></tr></thead><tbody>
      ${occ.map(o => `<tr><td class="time">${U.fmtDay(o.venc)}</td><td><b>${esc(o.conta.nome)}</b></td>
        <td>${esc(o.conta.categoria)}</td><td>${esc(o.conta.responsavel)}</td><td>${esc(o.conta.forma)}</td>
        <td class="r">${U.brl(o.valor)}</td>
        <td>${o.pago ? `✔ ${U.fmtDay(o.pago.data)}` : `${BOX} ___/___`}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="5" class="r">Total do mês</th><th class="r">${U.brl(total)}</th><th></th></tr></tfoot></table>
      <div class="sheet-totals"><span>Já pago: <b>${U.brl(pago)}</b></span><span>A pagar: <b>${U.brl(total - pago)}</b></span></div>`;
    return html;
  }

  function calendario({ month }) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = U.startOfWeek(first);
    const contasPorDia = U.groupBy(D.billOccurrences(month), o => o.venc);
    const weeks = [];
    for (let d = start; d.getMonth() === m - 1 || d < first; ) {
      const row = [];
      for (let i = 0; i < 7; i++, d = U.addDays(d, 1)) row.push(U.ymd(d));
      weeks.push(row);
    }
    return head('Calendário', U.monthLabel(month)) + `<table class="grid month month-${weeks.length}">
      <thead><tr>${U.WD.map(d => `<th>${d}</th>`).join('')}</tr></thead>
      <tbody>${weeks.map(row => `<tr>${row.map(date => {
        if (date.slice(0, 7) !== month) return '<td class="out"></td>';
        const items = [
          ...D.eventsOn(date).map(e => `<div class="ev">${e.hora ? `<b>${esc(e.hora)}</b> ` : ''}${esc(e.titulo)}</div>`),
          ...(contasPorDia[date] || []).map(o => `<div class="ev bill">💰 ${esc(o.conta.nome)}</div>`),
        ];
        return `<td><div class="dn">${U.parseYmd(date).getDate()}</div>${items.join('')}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function tarefas({ week }) {
    const days = weekDays(week);
    const rotina = Store.list('tarefa').filter(t => D.isRecorrente(t) && days.some(d => D.taskApplies(t, d)));
    const pend = Store.list('tarefa').filter(t => !D.isRecorrente(t) && !t.feito && (!t.data || t.data <= days[6]))
      .sort((a, b) => (a.data || '9').localeCompare(b.data || '9'));
    let html = head('Rotina da semana', `${U.fmtDate(days[0])} a ${U.fmtDate(days[6])} — marque ao concluir`);
    if (rotina.length) {
      const porLocal = U.groupBy(rotina, t => t.local || 'Geral');
      html += `<table class="grid"><thead><tr><th>Tarefa</th><th class="w-resp">Quem</th>${days.map(dayTh).join('')}</tr></thead><tbody>
        ${Object.keys(porLocal).sort().map(local => `<tr class="group"><th colspan="9">${esc(local)}</th></tr>
          ${porLocal[local].sort((a, b) => a.titulo.localeCompare(b.titulo)).map(t => `<tr><td>${esc(t.titulo)}</td><td>${esc(t.responsavel)}</td>
            ${days.map(d => `<td class="c">${D.taskApplies(t, d) ? BOX : '<span class="na">—</span>'}</td>`).join('')}</tr>`).join('')}`).join('')}
      </tbody></table>`;
    } else {
      html += empty('Nenhuma tarefa recorrente nesta semana.');
    }
    if (pend.length) {
      html += `<section class="sheet-sec"><h2>Pendências</h2><ul class="sheet-list cols">
        ${pend.map(t => `<li>${BOX}${esc(t.titulo)} <small>${esc([t.data ? 'até ' + U.fmtDay(t.data) : '', t.responsavel].filter(Boolean).join(' · '))}</small></li>`).join('')}
      </ul></section>`;
    }
    return html;
  }

  function compras({ lista }) {
    const listas = D.listas();
    const l = listas.find(x => x.id === lista) || listas[0];
    if (!l) return head('Lista de compras', '') + empty('Nenhuma lista criada ainda.');
    const itens = D.itensDa(l.id).filter(i => !i.feito);
    return head(`${l.icone || ''} ${l.nome}`.trim(), `Atualizada em ${U.fmtDate(U.today())}`) + `
      <ul class="sheet-list cols big">${itens.map(i => `<li>${BOX}${esc(i.texto)}</li>`).join('')}
        ${[...Array(Math.max(8, 30 - itens.length))].map(() => `<li>${BOX}<span class="blank"></span></li>`).join('')}</ul>`;
  }

  function contatos() {
    const grupos = D.contatosPorCategoria();
    let html = head('Telefones úteis', 'Em caso de emergência, mantenha a calma e ligue');
    if (!grupos.length) return html + empty('Nenhum contato cadastrado.');
    for (const [cat, lista] of grupos) {
      html += `<h2 class="sheet-person ${cat === 'Emergência' ? 'alert' : ''}">${esc(cat)}</h2>
        <table class="grid contacts"><tbody>${lista.map(c => `<tr><td><b>${esc(c.nome)}</b>${c.obs ? `<br><small>${esc(c.obs)}</small>` : ''}
          ${c.endereco ? `<br><small>📍 ${esc(c.endereco)}</small>` : ''}</td>
          <td class="tel">${esc(c.telefone)}${c.whatsapp ? ' <small>(WhatsApp)</small>' : ''}</td></tr>`).join('')}</tbody></table>`;
    }
    return html;
  }

  const RENDER = { dia, remedios, cardapio, contas, calendario, tarefas, compras, contatos };

  function render(id, params) {
    const sheet = SHEETS.find(s => s.id === id) || SHEETS[0];
    return { sheet, html: RENDER[sheet.id](params) };
  }

  function print(id, params) {
    const { sheet, html } = render(id, params);
    document.getElementById('print-area').innerHTML = `<div class="sheet ${sheet.landscape ? 'landscape' : ''}">${html}</div>`;
    document.getElementById('page-style').textContent =
      `@page { size: A4 ${sheet.landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`;
    window.print();
  }

  return { SHEETS, render, print, mealLines };
})();
