// Parser local e conservador de texto OCR de recibos brasileiros.
// Não consulta serviços, não reconcilia totais e não tenta mapear produtos.
(function (global) {
  'use strict';

  const MAX_TEXT = 200000;
  const MAX_LINES = 500;
  const MAX_PRODUCTS = 200;
  const UNITS = '(?:UN(?:D)?|UND|KG|G|GR|L|LT|ML|CX|PCT|PC|P\\u00c7|FD|SC|DZ|BDJ|PACOTE|LATA|GARRAFA)';
  const NUMBER = '(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[,.]\\d+)?)';
  const AMOUNT = '(?:R\\$\\s*)?';
  const DETAIL_RE = new RegExp(`^(.*?)\\s*(${NUMBER})\\s*(${UNITS})\\s*(?:X\\s*)?${AMOUNT}(${NUMBER})(?:(?:\\s*=\\s*|\\s+)${AMOUNT}(${NUMBER}))?\\s*$`, 'i');
  const DATE_RE = /(?:^|\D)(\d{2})\/(\d{2})\/(\d{4})(?:\D|$)/g;
  const TOTAL_RE = /^\s*(TOTAL|VALOR\s+(?:TOTAL|A\s+PAGAR))\s*(?::|-)?\s*(?:R\$\s*)?(.*?)\s*$/i;
  const IGNORED_LINE = /\b(?:TOTAL\s*(?:DE\s*)?(?:ITENS|QTD)|QTD\s*TOTAL|TROCO|DESCONTO|DESCONTOS|PAGAMENTO|PAGAMENTOS|TRIBUTOS?|IMPOSTOS?|CNPJ|CPF|ENDERE[CÇ]O|CEP|BAIRRO|MUNIC[IÍ]PIO|CIDADE|TELEFONE|FONE|CHAVE\s+DE\s+ACESSO|PROTOCOLO|INSCRI[CÇ][AÃ]O|DANFE|DOCUMENTO\s+AUXILIAR|NFC\s*-?E|SAT\s+N[ºO.]*)\b/i;
  const STORE_NOISE = /\b(?:CNPJ|CPF|ENDERE[CÇ]O|CEP|BAIRRO|MUNIC[IÍ]PIO|CIDADE|TELEFONE|FONE|CHAVE\s+DE\s+ACESSO|PROTOCOLO|INSCRI[CÇ][AÃ]O|DANFE|DOCUMENTO\s+AUXILIAR|NFC\s*-?E|SAT\s+N[ºO.]*)\b/i;

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function validDate(day, month, year) {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }

  // Ponto sem vírgula e com três casas é ambíguo (1.234 pode ser milhar ou decimal).
  function parseBrazilianNumber(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    if (value.includes(',')) {
      if (!/^\d+(?:\.\d{3})*(?:,\d+)$/.test(value) && !/^\d+,\d+$/.test(value)) return null;
      const n = Number(value.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    if (value.includes('.')) {
      if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) return null;
      if (!/^\d+\.\d{2}$/.test(value)) return null;
    } else if (!/^\d+$/.test(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function parseQuantity(raw) {
    if (!raw) return null;
    if (raw.includes(',')) {
      if (!/^\d+(?:,\d+)$/.test(raw)) return null;
      const n = Number(raw.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (raw.includes('.')) {
      if (!/^\d+\.\d{1,3}$/.test(raw)) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function stripCode(description) {
    let text = description.trim().replace(/^[-#]+\s*/, '');
    // Remove only numeric item-code prefixes, not numbers embedded in the product name.
    text = text.replace(/^\d{1,14}\s+(?=\S)/, '');
    return text.trim().replace(/\s{2,}/g, ' ');
  }

  function parseTotalValue(value) {
    const matches = [...value.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[,.]\d+)?)/gi)];
    if (!matches.length) return { value: null, ambiguous: false };
    if (matches.length !== 1) return { value: null, ambiguous: true };
    const parsed = parseBrazilianNumber(matches[0][1]);
    return { value: parsed, ambiguous: parsed === null };
  }

  function parse(text) {
    const result = { loja: '', data: '', total: null, itens: [], warnings: [] };
    const warningSet = new Set();
    const warn = message => { if (!warningSet.has(message)) { warningSet.add(message); result.warnings.push(message); } };

    if (typeof text !== 'string') {
      warn('O texto OCR não é uma string; revise os dados manualmente.');
      return result;
    }
    let source = cleanText(text);
    if (source.length > MAX_TEXT) {
      source = source.slice(0, MAX_TEXT);
      warn(`Texto limitado a ${MAX_TEXT} caracteres; revise se o comprovante foi cortado.`);
    }
    let lines = source.split(/\r\n|\n|\r/);
    if (lines.length > MAX_LINES) {
      lines = lines.slice(0, MAX_LINES);
      warn(`Leitura limitada a ${MAX_LINES} linhas; revise se o comprovante foi cortado.`);
    }
    const normalizedLines = lines.map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);

    const dates = new Set();
    for (const line of normalizedLines) {
      DATE_RE.lastIndex = 0;
      let match;
      while ((match = DATE_RE.exec(line))) {
        const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
        if (validDate(day, month, year)) dates.add(`${match[3]}-${match[2]}-${match[1]}`);
      }
    }
    if (dates.size === 1) result.data = [...dates][0];
    else if (dates.size > 1) warn('Mais de uma data válida foi encontrada; confirme a data da compra.');

    // Loja: somente um nome legível no cabeçalho, antes de datas, itens e resumos.
    for (const line of normalizedLines.slice(0, 8)) {
      if (/\d{2}\/\d{2}\/\d{4}/.test(line) || STORE_NOISE.test(line) || IGNORED_LINE.test(line)) continue;
      if (DETAIL_RE.test(line)) continue;
      if (/^(?:\d|R\$|TOTAL|VALOR\s+A\s+PAGAR|QTD|ITEM|CUPOM|NOTA\s+FISCAL)\b/i.test(line)) continue;
      if (/\b(?:QTD|QUANTIDADE)\b.*\b(?:VL\.?\s*UNIT|PRE[CÇ]O\s*UNIT)\b/i.test(line)) continue;
      if (line.length < 2 || !/[A-Za-z\u00c0-\u024f]/.test(line)) continue;
      if (/\b(?:RUA|AV\.?|AVENIDA|ROD\.?|RODOVIA|N[ºO.]?\s*\d{1,5})\b/i.test(line)) continue;
      result.loja = line;
      break;
    }

    const totals = new Set();
    const paidTotals = new Set();
    for (const [index, line] of normalizedLines.entries()) {
      if (/^\s*TOTAL\s*(?:DE\s*)?(?:ITENS|QTD)\b/i.test(line)) continue;
      const match = line.match(TOTAL_RE);
      if (!match) continue;
      let rawValue = match[2];
      const following = normalizedLines[index + 1] || '';
      if (!rawValue && /^(?:R\$\s*)?\d[\d.,]*$/.test(following)) rawValue = following;
      const parsed = parseTotalValue(rawValue);
      if (parsed.value !== null) (/A\s+PAGAR/i.test(match[1]) ? paidTotals : totals).add(parsed.value);
      else if (parsed.ambiguous) warn('O total do recibo está ambíguo; confirme-o manualmente.');
    }
    const selectedTotals = paidTotals.size ? paidTotals : totals;
    if (selectedTotals.size === 1) result.total = [...selectedTotals][0];
    else if (selectedTotals.size > 1) warn('Foram encontrados totais diferentes; confirme o total do recibo.');
    if (paidTotals.size === 1 && [...totals].some(v => v !== result.total)) warn('Valor a pagar difere do valor total. Confira descontos e acréscimos na nota.');

    let pendingDescription = '';
    let tableHeader = false;
    let itemsStarted = false;
    for (const line of normalizedLines) {
      if (/\bQTD\b.*\bUN\b.*\bVL\.?\s*UNIT\b.*\bVL\.?\s*TOTAL\b/i.test(line)) {
        tableHeader = true;
        pendingDescription = '';
        continue;
      }
      if (/^\s*(?:TOTAL|VALOR\s+A\s+PAGAR)\b/i.test(line) || IGNORED_LINE.test(line)) {
        pendingDescription = '';
        continue;
      }

      const match = line.match(DETAIL_RE);
      if (match) {
        let description = stripCode(match[1]);
        if (!description && pendingDescription) description = stripCode(pendingDescription);
        pendingDescription = '';
        const quantidade = parseQuantity(match[2]);
        const preco = parseBrazilianNumber(match[4]);
        const totalLinha = match[5] ? parseBrazilianNumber(match[5]) : null;
        if (description) {
          if (result.itens.length >= MAX_PRODUCTS) {
            warn(`Leitura limitada a ${MAX_PRODUCTS} produtos; revise o restante do comprovante.`);
            break;
          }
          const priceAmbiguous = (match[4] && preco === null) || (match[5] && totalLinha === null);
          if (!quantidade || priceAmbiguous) warn('Um ou mais valores de item estão ambíguos; revise a quantidade e os preços antes de salvar.');
          result.itens.push({
            texto: description,
            quantidade,
            unidade: match[3],
            preco,
            totalLinha,
          });
          itemsStarted = true;
          continue;
        }
      }

      // NFC-e/PDF: descrição com prefixo numérico em uma linha e dados na seguinte.
      const codeDescription = line.match(/^\s*\d{1,14}\s+(.+\p{L}.*)$/u);
      if (codeDescription && !IGNORED_LINE.test(line)) {
        pendingDescription = codeDescription[1].trim();
        continue;
      }
      // Algumas tabelas quebram descrição e valores em linhas separadas sem código.
      if ((tableHeader || itemsStarted) && /\p{L}/u.test(line) && line.length <= 100 && !/\d{2}\/\d{2}\/\d{4}/.test(line)) {
        pendingDescription = line;
      }
    }
    if (!result.itens.length) warn('Nenhum produto foi identificado com segurança. Confira o texto reconhecido e adicione os produtos manualmente.');
    if (result.total == null) warn('Total pago não identificado com segurança. Informe-o ou deixe em branco.');
    return result;
  }

  global.ReceiptParser = Object.freeze({ parse });
})(typeof globalThis !== 'undefined' ? globalThis : this);
