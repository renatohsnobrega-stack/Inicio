// Interface de compras. Não cria contas, tarefas, recados ou notificações.
const ComprasUI = (() => {
  const e = U.esc;
  let mes = U.thisMonth();
  let limite = 12;
  const historico = lista => Store.list('compra').filter(c => c.lista === lista).sort((a, b) => b.data.localeCompare(a.data) || String(b.criadoEm).localeCompare(String(a.criadoEm)));
  const money = v => v == null ? 'não informado' : U.brl(v);
  const number = v => v == null ? '' : String(v).replace('.', ',');
  const button = (text, action, id, cls = '') => `<button type="button" class="btn ${cls}" data-action="${action}" data-id="${e(id)}">${text}</button>`;
  function render(lista) {
    const todas = historico(lista.id);
    const compras = todas.filter(c => !mes || c.data.startsWith(mes));
    const resumo = Compras.resumo(compras);
    const produtos = [...resumo.produtos].sort((a, b) => b.vezes - a.vezes || a.texto.localeCompare(b.texto, 'pt-BR')).slice(0, 8);
    return `<section class="panel purchase-tools">
      <h2>Compras sem reescrever</h2>
      <p class="muted small">Use os produtos desta lista e das compras anteriores para montar a próxima. Adicionar item acima continua disponível.</p>
      <div class="actions">${button('Escolher produtos', 'purchase-catalog', lista.id)}${button('Finalizar compra', 'purchase-finish', lista.id, 'primary')}</div>
      <p class="muted small">Marque o que comprou e finalize para guardar no histórico. O que faltar permanece na lista.</p>
    </section>
    <section class="panel purchase-history">
      <h2>Histórico de compras</h2>
      <div class="actions"><label>Período <input type="month" value="${e(mes)}" data-action="purchase-month" aria-label="Mês das compras"></label>
        ${button('Todo o histórico', 'purchase-all', lista.id)}${button('Exportar JSON', 'purchase-export', lista.id)}</div>
      <p><strong>${resumo.compras} compra(s) · ${resumo.total == null ? 'nenhum total informado' : U.brl(resumo.total) + ' em totais informados'}</strong>${resumo.semTotal ? ` · ${resumo.semTotal} sem total` : ''}.</p>
      <p class="muted small">Compras indicam reposição, não consumo efetivo. Quantidades e preços ausentes não são estimados.</p>
      ${produtos.length ? `<details><summary>Produtos mais comprados no período</summary><ul class="purchase-summary">${produtos.map(p => `<li><strong>${e(p.texto)}</strong> · ${p.vezes} vez(es)${p.quantidade != null ? ` · ${e(number(p.quantidade))} ${e(p.unidade || '(sem unidade)')}` : ''}${p.semQuantidade ? ` · ${p.semQuantidade} sem quantidade` : ''}${p.gasto != null ? ` · ${U.brl(p.gasto)} em itens com quantidade e preço` : ''}</li>`).join('')}</ul><p class="muted small">Até 8 produtos; unidades diferentes ficam separadas. Exportação inclui todos os registros do período.</p></details>` : ''}
      ${compras.length ? compras.slice(0, limite).map(c => `<article class="purchase-entry">
        <h3>${e(U.fmtDate(c.data))} · ${e(c.loja || 'Loja não informada')}</h3>
        <p><strong>Total: ${money(c.total)}</strong> · ${c.itens.length} produto(s)</p>
        <details><summary>Ver produtos</summary><ul>${c.itens.map(i => `<li>${e(i.texto)}${i.quantidade != null ? ` · ${e(number(i.quantidade))} ${e(i.unidade || '(sem unidade)')}` : ''}${i.preco != null ? ` · ${U.brl(i.preco)} / unidade informada` : ''}</li>`).join('')}</ul></details>
        <div class="actions">${c.nota ? button('Abrir nota fiscal', 'purchase-receipt-open', c.id) : Store.mode() === 'cloud' ? `<label class="btn">Anexar nota fiscal<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-action="purchase-receipt" data-id="${e(c.id)}" hidden></label>` : '<p class="muted small">Anexos disponíveis no modo nuvem.</p>'}</div>
        ${c.nota ? `<p class="small muted">${e(c.nota.nome)} · arquivo privado</p>` : ''}
      </article>`).join('') : '<p class="empty">Nenhuma compra neste período.</p>'}
      ${compras.length > limite ? button('Mostrar mais compras', 'purchase-more', lista.id) : ''}
      <p class="muted small">Nota: JPEG, PNG, WebP ou PDF, até 8 MB. Anexe após finalizar; se o envio falhar, a compra continua salva. O backup JSON contém os dados e referências, não os arquivos das notas.</p>
    </section>`;
  }
  function dialog(title, body, saveLabel, save) {
    const dlg = document.getElementById('modal');
    dlg.innerHTML = `<form class="form purchase-form" novalidate><header class="form-head"><h2>${e(title)}</h2><button type="button" class="btn ghost" data-close aria-label="Fechar">✕</button></header><div class="form-body">${body}<p class="purchase-error" role="alert"></p></div><footer class="form-actions"><button type="button" class="btn" data-close>Cancelar</button><button type="submit" class="btn primary">${e(saveLabel)}</button></footer></form>`;
    const form = dlg.querySelector('form');
    let saving = false;
    const cancel = event => { if (saving) event.preventDefault(); };
    dlg.addEventListener('cancel', cancel);
    dlg.addEventListener('close', () => dlg.removeEventListener('cancel', cancel), { once: true });
    form.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => { if (!saving) dlg.close(); }; });
    form.onsubmit = async event => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      form.querySelectorAll('button').forEach(b => { b.disabled = true; });
      form.querySelector('[role=alert]').textContent = '';
      try { await save(form); dlg.close(); }
      catch (err) { form.querySelector('[role=alert]').textContent = err.message || 'Não foi possível salvar. Tente novamente.'; }
      finally { saving = false; form.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
    };
    dlg.showModal();
    return form;
  }
  function catalog(listaId, refresh) {
    const lista = Store.get('lista', listaId);
    if (!lista) return;
    const produtos = Compras.catalogo(listaId, Store.list('item'), Store.list('compra'));
    const ativos = new Set(Store.list('item').filter(i => i.lista === listaId && !i.feito).map(i => Compras.catalogo(listaId, [i], [])[0]?.chave));
    let destinoCriado = null;
    const form = dialog('Escolher produtos', `<p class="muted">Selecione para adicionar à lista atual ou escreva um nome para criar outra. Nada será apagado.</p>
      <label class="field">Nova lista (opcional)<input name="nova" maxlength="100" placeholder="Vazio: adicionar à lista atual"></label>
      <label class="field">Buscar produto<input name="busca" type="search" placeholder="Digite parte do nome"></label>
      <div class="purchase-catalog">${produtos.map((p, n) => `<label class="check-row" data-product="${n}"><input type="checkbox" name="produto" value="${n}"><span>${e(p.texto)}${ativos.has(p.chave) ? ' · já pendente' : ''}</span></label>`).join('') || '<p class="muted">Adicione o primeiro produto à lista. Ele ficará disponível aqui nas próximas compras.</p>'}</div>`, 'Adicionar selecionados', async f => {
        const selecionados = [...f.querySelectorAll('[name=produto]:checked')].map(el => produtos[Number(el.value)]);
        if (!selecionados.length) throw new Error('Selecione pelo menos um produto.');
        const nome = f.elements.nova.value.trim();
        if (nome && destinoCriado?.nome !== nome) destinoCriado = { id: U.uid(), nome, icone: lista.icone || '🛒' };
        const destino = nome ? await Store.putConfirmed('lista', destinoCriado) : lista;
        for (const p of selecionados) {
          // Id por produto/lista evita duplicar em duplo clique ou repetição após falha.
          const id = `catalogo-${destino.id}-${Schema.hash(p.chave)}`;
          const jaExiste = Compras.catalogo(destino.id, Store.list('item'), []).some(x => x.chave === p.chave);
          if (!jaExiste) await Store.putConfirmed('item', { id, lista: destino.id, texto: p.texto, feito: false, quantidade: p.quantidade, unidade: p.unidade || '', por: D.eu(), criadoEm: new Date().toISOString() });
        }
        refresh(destino.id);
      });
    form.elements.busca.oninput = () => {
      const q = form.elements.busca.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      form.querySelectorAll('[data-product]').forEach(row => { row.hidden = !produtos[Number(row.dataset.product)].chave.includes(q); });
    };
  }
  function finish(listaId, refresh) {
    const lista = Store.get('lista', listaId);
    const sources = Store.list('item').filter(i => i.lista === listaId && i.feito).map(i => JSON.parse(JSON.stringify(i)));
    if (!lista || !sources.length) { alert('Marque pelo menos um produto comprado antes de finalizar.'); return; }
    const id = U.uid();
    const criadoEm = new Date().toISOString();
    dialog('Finalizar compra', `<p class="muted">${sources.length} produto(s) marcado(s) serão guardados no histórico. Os pendentes ficam na lista e todos continuam disponíveis no catálogo.</p>
      <label class="field">Data da compra *<input name="data" type="date" value="${U.today()}"></label>
      <label class="field">Loja (opcional)<input name="loja" maxlength="160" autocomplete="organization"></label>
      <label class="field">Total pago em R$ (opcional)<input name="total" inputmode="decimal" placeholder="Ex.: 125,90"></label>
      <p class="muted small">Detalhes opcionais: deixe em branco o que não souber. Preço é por unidade da quantidade informada; não é o total da linha. A foto da nota pode ser anexada depois.</p>
      ${sources.map((i, n) => `<fieldset class="purchase-item-fields"><legend>${e(i.texto)}</legend><div class="purchase-item-grid">
        <label>Quantidade<input name="q${n}" inputmode="decimal" value="${e(number(i.quantidade))}" placeholder="Ex.: 2"></label>
        <label>Unidade<input name="u${n}" value="${e(i.unidade || '')}" maxlength="30" placeholder="un, kg, L…" list="purchase-units"></label>
        <label>Preço unitário R$<input name="p${n}" inputmode="decimal" placeholder="Ex.: 5,90"></label>
      </div></fieldset>`).join('')}<datalist id="purchase-units"><option value="un"><option value="kg"><option value="g"><option value="L"><option value="ml"><option value="pacote"></datalist>`, 'Guardar compra no histórico', async f => {
        const purchase = { id, lista: listaId, listaNome: lista.nome, data: f.elements.data.value, loja: f.elements.loja.value.trim(), total: Compras.numero(f.elements.total.value), criadoEm,
          itens: sources.map((i, n) => ({ itemId: i.id, texto: i.texto, quantidade: Compras.numero(f.elements[`q${n}`].value), unidade: f.elements[`u${n}`].value.trim(), preco: Compras.numero(f.elements[`p${n}`].value) })) };
        const erro = Compras.validar(purchase);
        if (erro) throw new Error(erro);
        await Store.finalizePurchase(purchase, sources);
        mes = purchase.data.slice(0, 7);
        refresh(listaId);
      });
  }
  async function action(name, el, refresh) {
    const id = el.dataset.id;
    if (name === 'purchase-catalog') return catalog(id, refresh);
    if (name === 'purchase-finish') return finish(id, refresh);
    if (name === 'purchase-month') { mes = el.value; limite = 12; return refresh(); }
    if (name === 'purchase-all') { mes = ''; limite = 12; return refresh(); }
    if (name === 'purchase-more') { limite += 12; return refresh(); }
    if (name === 'purchase-export') {
      const compras = historico(id).filter(c => !mes || c.data.startsWith(mes));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ compras, resumo: Compras.resumo(compras), aviso: 'Arquivos de notas não estão incluídos. Compras não equivalem a consumo efetivo.' }, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `elinor-compras-${mes || 'todas'}-${U.today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (name === 'purchase-receipt') {
      const file = el.files?.[0];
      if (!file) return;
      el.disabled = true;
      try { await Store.attachPurchaseReceipt(id, file); refresh(); }
      catch (err) { alert(`A compra está salva, mas a nota não foi confirmada: ${err.message}`); }
      finally { el.disabled = false; el.value = ''; }
      return;
    }
    if (name === 'purchase-receipt-open') {
      const win = window.open('about:blank', '_blank');
      if (win) win.opener = null;
      try {
        const url = await Store.purchaseReceiptUrl(id);
        if (win) win.location.href = url;
        else { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click(); }
      } catch (err) { win?.close(); alert(`Não foi possível abrir a nota: ${err.message}`); }
    }
  }
  return { render, action };
})();
