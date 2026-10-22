/* Local-only receipt OCR. External libraries are loaded lazily from ../vendor/ocr/. */
(function (root) {
  'use strict';

  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_PDF_PAGES = 3;
  const MAX_IMAGE_PIXELS = 24_000_000;
  const OCR_IMAGE_PIXELS = 6_000_000;
  const MAX_IMAGE_SIDE = 12_000;
  const OPERATION_TIMEOUT_MS = 120_000;
  const scriptURL = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL('js/receipt-ocr.js', document.baseURI).href;
  const assets = new URL('../vendor/ocr/', scriptURL);
  let tesseractPromise;
  let pdfPromise;

  function error(name, message) {
    const e = new Error(message);
    e.name = name;
    return e;
  }

  function notify(callback, message, fraction) {
    if (typeof callback !== 'function') return;
    try {
      callback({ message, fraction: Math.max(0, Math.min(1, fraction)) });
    } catch (_) {
      // A UI callback must not break local OCR.
    }
  }

  function operation(signal) {
    let rejectFailure;
    let settled = false;
    const cleanups = new Set();
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    failure.catch(() => {});
    const cancel = (err) => {
      if (settled) return;
      settled = true;
      rejectFailure(err);
      for (const cleanup of [...cleanups]) {
        try { Promise.resolve(cleanup()).catch(() => {}); } catch (_) { /* best effort */ }
      }
      cleanups.clear();
    };
    const abort = () => cancel(error('AbortError', 'Leitura do comprovante cancelada.'));
    const timer = setTimeout(() => cancel(error('TimeoutError', 'A leitura excedeu o limite de 120 segundos.')), OPERATION_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    return {
      failure,
      race(promise) { return Promise.race([promise, failure]); },
      check() {
        if (signal && signal.aborted) abort();
        if (settled) throw error(signal && signal.aborted ? 'AbortError' : 'TimeoutError', signal && signal.aborted ? 'Leitura do comprovante cancelada.' : 'A leitura excedeu o limite de 120 segundos.');
      },
      canceled() { return settled; },
      track(cleanup) {
        if (settled) {
          try { Promise.resolve(cleanup()).catch(() => {}); } catch (_) { /* best effort */ }
          return () => {};
        }
        cleanups.add(cleanup);
        return () => cleanups.delete(cleanup);
      },
      finish() {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
        for (const cleanup of [...cleanups]) {
          try { Promise.resolve(cleanup()).catch(() => {}); } catch (_) { /* best effort */ }
        }
        cleanups.clear();
      },
    };
  }

  function bytesStart(bytes, prefix) {
    return prefix.every((value, index) => bytes[index] === value);
  }

  async function identify(file) {
    if (typeof file === 'string' || (file && typeof file.url === 'string' && !(file instanceof Blob))) {
      throw error('TypeError', 'Informe um File/Blob local; URLs não são aceitas.');
    }
    if (typeof Blob === 'undefined' || !(file instanceof Blob)) {
      throw error('TypeError', 'O comprovante deve ser um File ou Blob local.');
    }
    if (file.size === 0) throw error('TypeError', 'O arquivo está vazio.');
    if (file.size > MAX_BYTES) throw error('RangeError', 'O comprovante excede o limite de 8 MiB.');
    const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
    const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(mime)) throw error('TypeError', 'Formato não aceito; use PDF, JPEG, PNG ou WebP.');
    if (typeof File !== 'undefined' && file instanceof File && file.name) {
      const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
      const extensions = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      if (ext && extensions[ext[1]] && extensions[ext[1]] !== mime) {
        throw error('TypeError', 'A extensão do arquivo não corresponde ao tipo MIME informado.');
      }
    }
    const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    let kind;
    if (mime === 'application/pdf' && bytes.length >= 5 && bytesStart(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) kind = 'pdf';
    else if (mime === 'image/png' && bytesStart(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) kind = 'image';
    else if (mime === 'image/jpeg' && bytesStart(bytes, [0xff, 0xd8, 0xff])) kind = 'image';
    else if (mime === 'image/webp' && bytes.length >= 12 && bytesStart(bytes, [0x52, 0x49, 0x46, 0x46]) && bytesStart(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) kind = 'image';
    if (!kind) throw error('TypeError', 'O tipo informado não corresponde à assinatura do arquivo.');
    return kind;
  }

  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (!tesseractPromise) {
      tesseractPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('tesseract/tesseract.min.js', assets).href;
        script.async = true;
        script.onload = () => root.Tesseract ? resolve(root.Tesseract) : reject(new Error('Tesseract.js não carregou.'));
        script.onerror = () => reject(new Error('Falha ao carregar o OCR local.'));
        document.head.appendChild(script);
      }).catch((e) => { tesseractPromise = null; throw e; });
    }
    return tesseractPromise;
  }

  function loadPdf() {
    if (!pdfPromise) {
      const url = new URL('pdfjs/build/pdf.mjs', assets).href;
      pdfPromise = import(url).then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/build/pdf.worker.mjs', assets).href;
        return pdfjs;
      }).catch((e) => { pdfPromise = null; throw e; });
    }
    return pdfPromise;
  }

  async function createOcrWorker(op, onProgress) {
    op.check();
    const Tesseract = await op.race(loadTesseract());
    op.check();
    const workerPath = new URL('tesseract/worker.min.js', assets).href;
    const corePath = new URL('core/', assets).href;
    const langPath = new URL('lang/por/4.0.0_best_int/', assets).href;
    const englishStatus = {
      'loading tesseract core': 'carregando mecanismo OCR',
      'initializing tesseract': 'inicializando mecanismo OCR',
      'loading language traineddata': 'carregando idioma português',
      'initializing api': 'inicializando leitura',
      'recognizing text': 'reconhecendo texto',
    };
    const workerPromise = Tesseract.createWorker('por', 1, {
      workerPath,
      corePath,
      langPath,
      gzip: true,
      workerBlobURL: false,
      logger: (status) => {
        if (status && status.status) {
          const pct = Number.isFinite(status.progress) ? status.progress : 0;
          const label = englishStatus[status.status] || 'processando OCR local';
          notify(onProgress, `OCR: ${label}`, 0.12 + Math.min(0.82, pct * 0.82));
        }
      },
    });
    const workerReady = workerPromise.then((readyWorker) => {
      // createWorker resolves only after setup; terminate the late result if the
      // caller already cancelled or timed out while it was initializing.
      if (op.canceled()) Promise.resolve(readyWorker.terminate()).catch(() => {});
      return readyWorker;
    });
    const worker = await op.race(workerReady);
    const untrack = op.track(() => worker.terminate());
    op.check();
    return { worker, untrack };
  }

  async function recognizeSource(op, source, onProgress) {
    const { worker, untrack } = await createOcrWorker(op, onProgress);
    try {
      op.check();
      const result = await op.race(worker.recognize(source));
      op.check();
      const data = result && result.data ? result.data : {};
      return {
        text: String(data.text || '').trim(),
        confidence: Number.isFinite(data.confidence) ? Math.max(0, Math.min(100, data.confidence)) : null,
      };
    } finally {
      untrack();
      try { await worker.terminate(); } catch (_) { /* already terminated on abort */ }
    }
  }

  function canvasForBitmap(bitmap) {
    const pixels = bitmap.width * bitmap.height;
    if (!bitmap.width || !bitmap.height || pixels > MAX_IMAGE_PIXELS || bitmap.width > MAX_IMAGE_SIDE || bitmap.height > MAX_IMAGE_SIDE) {
      bitmap.close();
      throw error('RangeError', 'A imagem excede os limites de resolução para leitura local (24 megapixels / 12000 px por lado).');
    }
    const scale = Math.min(1, Math.sqrt(OCR_IMAGE_PIXELS / pixels), 4000 / bitmap.width, 4000 / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) { bitmap.close(); throw new Error('Não foi possível preparar a imagem para OCR.'); }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return { canvas, reduced: scale < 1 };
  }

  function disposeCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  }

  function linesFromTextContent(content) {
    const items = (content.items || []).filter((item) => item && typeof item.str === 'string' && item.str.length);
    const positioned = items.map((item, index) => ({
      item,
      index,
      x: Number(item.transform && item.transform[4]) || 0,
      y: Number(item.transform && item.transform[5]) || 0,
      size: Math.abs(Number(item.transform && item.transform[3])) || 10,
    })).sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index);
    const lines = [];
    for (const part of positioned) {
      let line = lines[lines.length - 1];
      const tolerance = Math.max(1.5, Math.min(4, part.size * 0.24));
      if (!line || Math.abs(line.y - part.y) > tolerance) {
        line = { y: part.y, size: part.size, chunks: [] };
        lines.push(line);
      }
      line.chunks.push(part);
    }
    return lines.map((line) => {
      line.chunks.sort((a, b) => a.x - b.x || a.index - b.index);
      let text = '';
      let prev = null;
      for (const part of line.chunks) {
        const value = part.item.str;
        if (prev && text && !/\s$/.test(text) && !/^\s/.test(value)) {
          const gap = part.x - prev.x - (Number(prev.item.width) || 0);
          if (gap > Math.max(1.2, line.size * 0.12)) text += ' ';
        }
        text += value;
        prev = part;
      }
      return text.trim();
    }).filter(Boolean).join('\n');
  }

  function needsPageOcr(text) {
    const trimmed = text.trim();
    const lineCount = trimmed ? trimmed.split(/\n/).filter(Boolean).length : 0;
    return trimmed.length < 80 || lineCount < 3;
  }

  function mergeSparseText(nativeText, ocrText) {
    if (!nativeText) return ocrText;
    if (!ocrText) return nativeText;
    const key = (line) => line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const ocrLines = ocrText.split(/\n/).filter(Boolean);
    const existing = new Set(ocrLines.map(key));
    const nativeRemainder = nativeText.split(/\n/).filter(Boolean).filter((line) => !existing.has(key(line)));
    return [...ocrLines, ...nativeRemainder].join('\n');
  }

  async function readPdf(op, file, onProgress) {
    notify(onProgress, 'Abrindo PDF local…', 0.03);
    const pdfjs = await op.race(loadPdf());
    op.check();
    const bytes = new Uint8Array(await file.arrayBuffer());
    op.check();
    const loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
    const untrack = op.track(() => loadingTask.destroy());
    const pdf = await op.race(loadingTask.promise);
    op.check();
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw error('RangeError', `PDF com ${pdf.numPages} páginas; o limite é ${MAX_PDF_PAGES}. Nenhuma página foi ignorada.`);
    }
    const extracted = [];
    const rasterPages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      op.check();
      notify(onProgress, `Lendo texto do PDF, página ${pageNumber} de ${pdf.numPages}…`, 0.04 + 0.08 * pageNumber / pdf.numPages);
      const page = await op.race(pdf.getPage(pageNumber));
      const content = await op.race(page.getTextContent());
      const pageText = linesFromTextContent(content);
      extracted.push(pageText);
      if (needsPageOcr(pageText)) rasterPages.push({ page, pageNumber, nativeText: pageText });
      else page.cleanup();
    }
    if (!rasterPages.length) {
      untrack();
      await loadingTask.destroy();
      notify(onProgress, 'Texto do PDF extraído localmente.', 1);
      return { text: extracted.join('\n\n').trim(), confidence: null, pages: pdf.numPages, warnings: [] };
    }
    const confidences = [];
    const warnings = rasterPages.some(({ nativeText }) => nativeText.trim())
      ? ['PDF com conteúdo textual parcial; páginas com texto escasso foram complementadas por OCR local.']
      : [];
    for (let index = 0; index < rasterPages.length; index += 1) {
      op.check();
      const { page, pageNumber } = rasterPages[index];
      const viewportAtOne = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, Math.sqrt(MAX_IMAGE_PIXELS / Math.max(1, viewportAtOne.width * viewportAtOne.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      if (canvas.width * canvas.height > MAX_IMAGE_PIXELS) {
        disposeCanvas(canvas);
        throw error('RangeError', `A página ${pageNumber} do PDF excede o limite de resolução para OCR.`);
      }
      notify(onProgress, `Renderizando página ${pageNumber} para OCR local…`, 0.12 + 0.08 * index / rasterPages.length);
      try {
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Não foi possível renderizar a página do PDF.');
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        const untrackRender = op.track(() => renderTask.cancel());
        await op.race(renderTask.promise);
        untrackRender();
        const result = await recognizeSource(op, canvas, (status) => {
          const progress = status.fraction;
          notify(onProgress, `Página ${pageNumber}: ${status.message}`, 0.2 + 0.78 * (index + progress) / rasterPages.length);
        });
        extracted[pageNumber - 1] = mergeSparseText(rasterPages[index].nativeText, result.text);
        if (result.confidence !== null) confidences.push(result.confidence);
        if (!result.text) warnings.push(`Nenhum texto reconhecível na página ${pageNumber}.`);
      } finally {
        page.cleanup();
        disposeCanvas(canvas);
      }
    }
    untrack();
    await loadingTask.destroy();
    notify(onProgress, 'Leitura concluída.', 1);
    return {
      text: extracted.join('\n\n').trim(),
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
      pages: pdf.numPages,
      warnings,
    };
  }

  async function read(file, options) {
    const opts = options || {};
    const op = operation(opts.signal);
    let bitmap;
    let canvas;
    try {
      op.check();
      notify(opts.onProgress, 'Validando arquivo local…', 0);
      const kind = await op.race(identify(file));
      op.check();
      if (kind === 'pdf') return await op.race(readPdf(op, file, opts.onProgress));
      if (typeof createImageBitmap !== 'function') throw new Error('Este navegador não oferece processamento local de imagem compatível.');
      bitmap = await op.race(createImageBitmap(file));
      op.check();
      const prepared = canvasForBitmap(bitmap);
      canvas = prepared.canvas;
      bitmap = null;
      const result = await op.race(recognizeSource(op, canvas, opts.onProgress));
      notify(opts.onProgress, 'Leitura concluída.', 1);
      return {
        text: result.text,
        confidence: result.confidence,
        pages: 1,
        warnings: [
          ...(prepared.reduced ? ['Imagem reduzida proporcionalmente para caber no limite local de processamento; nenhum conteúdo foi cortado.'] : []),
          ...(!result.text ? ['Nenhum texto reconhecível na imagem.'] : []),
        ],
      };
    } finally {
      if (bitmap) bitmap.close();
      disposeCanvas(canvas);
      op.finish();
    }
  }

  root.ReceiptOCR = Object.freeze({ read });
}(typeof window !== 'undefined' ? window : globalThis));
