// Nota fica em memória até a revisão; nunca envia arquivos/texto para um serviço de OCR.
const ReceiptUI = (() => {
  const e = U.esc;
  const num = value => value == null ? '' : String(value).replace('.', ',');
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  let active = false;

  async function open(listaId, file, refresh) {
    if (active || !file) return;
    const lista = Store.get('lista', listaId);
    if (!lista) return;
    active = true;
    const dlg = document.getElementById('modal');
    const controller = new AbortController();
    const sources = Store.list('item').filter(i => i.lista === listaId).map(i => JSON.parse(JSON.stringify(i)));
    const purchaseId = U.uid();
    const criadoEm = new Date().toISOString();
    let cancelled = false, saving = false, closed = false;
    let localUrl = null;
    const finishClose = () => {
      if (closed) return;
      closed = true; cancelled = true; active = false; controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('close', finishClose);
      dlg.replaceChildren();
    };
    const close = () => { if (!saving) { finishClose(); dlg.close(); } };
    const onCancel = event => { event.preventDefault(); close(); };
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('close', finishClose, { once: true });
    const show = (title, body, footer) => {
      dlg.innerHTML = `<form class="form purchase-form receipt-review" novalidate><header class="form-head"><h2>${e(title)}</h2><button type="button" class="btn ghost" data-receipt-close aria-label="Fechar">✕</button></header><div class="form-body">${body}<p class="purchase-error" role="alert"></p></div><footer class="form-actions"><button type="button" class="btn" data-receipt-close>Cancelar</button>${footer || ''}</footer></form>`;
      dlg.querySelectorAll('[data-receipt-close]').forEach(b => { b.onclick = close; });
      const form = dlg.querySelector('form');
      form.onsubmit = event => event.preventDefault();
      return form;
    };
    show('Ler nota no aparelho', `<p>A leitura é feita <strong>neste aparelho</strong>. Nenhuma nota é enviada a um provedor de OCR. O primeiro uso baixa o leitor do próprio app.</p><p class="receipt-progress" role="status" aria-live="polite">Preparando leitura…</p><p class="small muted">Você vai revisar e corrigir tudo antes de guardar. Cancelar não altera a lista nem envia o arquivo.</p>`);
    dlg.showModal();
    try {
      const result = await ReceiptOCR.read(file, {
        signal: controller.signal,
        onProgress: progress => {
          const status = dlg.querySelector('.receipt-progress');
          if (status && !cancelled) status.textContent = typeof progress === 'string' ? progress : (progress.message || progress.status || 'Lendo nota…');
        },
      });
      if (cancelled) return;
      const parsed = ReceiptParser.parse(result.text);
      let rows = parsed.itens.map(i => ({ ...i, draftId: `nota-${U.uid()}` }));
      if (!rows.length) rows = [{ texto: '', quantidade: null, unidade: '', preco: null, totalLinha: null, draftId: `nota-${U.uid()}` }];
      const warnings = [...(result.warnings || []), ...(parsed.warnings || [])];
      if (!parsed.data) warnings.push('Data não reconhecida: hoje foi sugerido. Confira a data da nota.');
      if (result.confidence != null && result.confidence < 75) warnings.push('Leitura de baixa confiança. Confira cada nome e número com atenção.');
      const pageCount = Number.isInteger(result.pages) && result.pages >= 1 && result.pages <= 3 ? result.pages : 1;
      const form = show('Revisar nota antes de guardar', `<p><strong>OCR pode errar.</strong> Confira a nota, corrija os campos e remova linhas que não sejam produtos. Nenhum dado foi salvo ainda.</p>
        <p class="small muted">${e(file.name)} · ${e(pageCount)} página(s) · leitura local${result.confidence != null ? ` · confiança OCR ${Math.round(result.confidence)}% (não garante valores corretos)` : ''}</p>
        ${warnings.length ? `<ul class="receipt-warnings">${[...new Set(warnings)].map(w => `<li>${e(w)}</li>`).join('')}</ul>` : ''}
        <label class="field">Data da compra *<input name="data" type="date" value="${e(parsed.data || U.today())}"></label>
        <label class="field">Loja<input name="loja" maxlength="160" value="${e(parsed.loja || '')}"></label>
        <label class="field">Total pago em R$<input name="total" inputmode="decimal" value="${e(num(parsed.total))}" placeholder="Não identificado: informe ou deixe vazio"></label>
        <p class="muted small">Preço é <strong>unitário</strong>. Quantidade e preço vazios continuam desconhecidos. O total da linha serve só para conferência. A lista só perde os produtos vinculados explicitamente abaixo; os demais pendentes permanecem.</p>
        <div class="receipt-rows"></div><button type="button" class="btn" data-receipt-add>Adicionar produto que faltou</button>
        <details><summary>Ver texto reconhecido</summary><pre class="receipt-raw"></pre></details>
        <details><summary>Conferir arquivo original</summary><div class="receipt-preview"></div></details>
        <label class="check-row receipt-confirm"><input type="checkbox" name="revisado"><span>Conferi os produtos, quantidades, preços, total e vínculos com a lista.</span></label>
        <p class="small muted">${Store.mode() === 'cloud' ? 'Só depois de confirmar, os dados e a nota original serão salvos na nuvem privada da família. Se o anexo falhar, a compra ficará salva para anexá-lo novamente.' : 'Modo local: somente os dados serão guardados neste navegador. O arquivo original NÃO será salvo; guarde sua nota separadamente.'}</p>`, '<button type="submit" class="btn primary">Confirmar e guardar compra</button>');
      form.querySelector('.receipt-raw').textContent = result.text;
      const container = form.querySelector('.receipt-rows');
      let rowCounter = 0;
      const addRow = row => {
        if (container.children.length >= 200) return;
        const n = rowCounter++;
        const matches = sources.filter(s => key(s.texto) === key(row.texto));
        const match = matches.length === 1 ? matches[0].id : '';
        const field = document.createElement('fieldset');
        field.className = 'purchase-item-fields receipt-item';
        field.dataset.draft = row.draftId;
        field.innerHTML = `<legend>Produto ${n + 1}</legend>
          <label class="field">Nome do produto *<input data-field="texto" maxlength="250" value="${e(row.texto || '')}"></label>
          <div class="purchase-item-grid"><label>Quantidade<input data-field="quantidade" inputmode="decimal" value="${e(num(row.quantidade))}"></label>
          <label>Unidade<input data-field="unidade" maxlength="30" value="${e(row.unidade || '')}" placeholder="un, kg, L…"></label>
          <label>Preço unitário R$<input data-field="preco" inputmode="decimal" value="${e(num(row.preco))}"></label></div>
          ${row.totalLinha != null ? `<p class="small muted">Total da linha lido: ${e(U.brl(row.totalLinha))}. Confira descontos/arredondamentos na nota.</p>` : ''}
          <label class="field">Retirar da lista ao guardar<select data-field="source"><option value="">Não retirar nenhum item</option>${sources.map(s => `<option value="${e(s.id)}" ${match === s.id ? 'selected' : ''}>${e(s.texto)}${s.feito ? ' · marcado' : ' · pendente'}</option>`).join('')}</select></label>
          <button type="button" class="btn small ghost" data-receipt-remove>Remover esta linha</button>`;
        field.querySelector('[data-receipt-remove]').onclick = () => { field.remove(); form.elements.revisado.checked = false; };
        container.appendChild(field);
      };
      rows.forEach(addRow);
      form.querySelector('[data-receipt-add]').onclick = () => { addRow({ texto: '', draftId: `nota-${U.uid()}` }); form.elements.revisado.checked = false; };
      form.addEventListener('input', event => { if (event.target.name !== 'revisado') form.elements.revisado.checked = false; });
      form.addEventListener('change', event => { if (event.target.name !== 'revisado') form.elements.revisado.checked = false; });
      const preview = form.querySelector('.receipt-preview');
      // Só cria preview quando solicitado, sem URLs remotas e sem executar conteúdo PDF ativo.
      preview.parentElement.addEventListener('toggle', () => {
        if (!preview.parentElement.open || localUrl || cancelled) return;
        localUrl = URL.createObjectURL(file);
        if (file.type.startsWith('image/')) {
          const image = document.createElement('img'); image.src = localUrl; image.alt = 'Nota original selecionada'; preview.appendChild(image);
        } else {
          const a = document.createElement('a'); a.href = localUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir PDF original neste aparelho'; preview.appendChild(a);
        }
      });
      form.onsubmit = async event => {
        event.preventDefault();
        if (saving || cancelled) return;
        const errorBox = form.querySelector('[role=alert]');
        errorBox.textContent = '';
        try {
          if (!form.elements.revisado.checked) throw new Error('Marque que conferiu os campos antes de guardar.');
          const selectedSources = [];
          const used = new Set();
          const itens = [...container.querySelectorAll('.receipt-item')].map(field => {
            const val = name => field.querySelector(`[data-field="${name}"]`).value.trim();
            const sourceId = val('source');
            if (sourceId) {
              if (used.has(sourceId)) throw new Error('Um produto da lista foi vinculado a duas linhas. Deixe o vínculo em apenas uma delas.');
              used.add(sourceId);
              const original = sources.find(s => s.id === sourceId);
              if (!original) throw new Error('Vínculo da lista inválido. Cancele e tente novamente.');
              selectedSources.push(original);
            }
            return { itemId: sourceId || field.dataset.draft, texto: val('texto'), quantidade: Compras.numero(val('quantidade')), unidade: val('unidade'), preco: Compras.numero(val('preco')) };
          });
          const purchase = { id: purchaseId, origem: 'nota-revisada', lista: listaId, listaNome: lista.nome, data: form.elements.data.value,
            loja: form.elements.loja.value.trim(), total: Compras.numero(form.elements.total.value), itens, criadoEm };
          const invalid = Compras.validar(purchase);
          if (invalid) throw new Error(invalid);
          saving = true;
          form.querySelectorAll('button,input,select').forEach(b => { b.disabled = true; });
          await Store.finalizePurchase(purchase, selectedSources);
          let receiptError = '';
          if (Store.mode() === 'cloud') {
            try { await Store.attachPurchaseReceipt(purchaseId, file); }
            catch (err) { receiptError = err.message || 'Falha no envio da nota.'; }
          }
          saving = false;
          close();
          refresh(listaId);
          if (receiptError) alert(`Compra guardada, mas a nota não foi confirmada. Anexe o mesmo arquivo no histórico: ${receiptError}`);
        } catch (err) {
          saving = false;
          form.querySelectorAll('button,input,select').forEach(b => { b.disabled = false; });
          errorBox.textContent = err.message || 'Não foi possível guardar. Confira e tente novamente.';
        }
      };
    } catch (err) {
      if (cancelled) return;
      const form = show('Não foi possível ler a nota', `<p>A lista e o histórico não foram alterados. Nenhum arquivo foi enviado.</p><p class="receipt-error-detail"></p><p class="muted">Tente uma foto nítida, PDF de até 3 páginas, ou preencha a compra manualmente.</p>`);
      form.querySelector('.receipt-error-detail').textContent = err.message || 'Falha na leitura local.';
    }
  }
  return { open };
})();
