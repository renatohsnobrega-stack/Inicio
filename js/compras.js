// Regras de domínio do catálogo reutilizável e do histórico de compras.
const Compras = (() => {
  const MAX_ITENS = 500;
  const textoNormalizado = valor => String(valor ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
  const textoLimpo = valor => typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ') : '';
  const objDe = x => x && x.kind ? (x.kind === 'compra' || x.kind === 'item' ? (x.obj || x) : null) : x;
  const tipoNumericoValido = (v, minimo = 0) => typeof v === 'number' && Number.isFinite(v) && v >= minimo;

  // String brasileira rigorosa: milhares em grupos de três com ponto, vírgula decimal;
  // também aceita decimal canônico com ponto quando o ponto não forma agrupamento de milhares.
  function numero(v, { positivo = false } = {}) {
    if (v == null || (typeof v === 'string' && !v.trim())) return null;
    let n;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string') {
      const s = v.trim();
      const sinal = /^[+-]/.test(s) ? s[0] : '';
      const corpo = sinal ? s.slice(1) : s;
      if (!corpo || !/^\d[\d.,]*$/.test(corpo)) return NaN;
      let canonical;
      if (corpo.includes(',')) {
        if (!/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(corpo) && !/^\d+(?:,\d+)?$/.test(corpo)) return NaN;
        canonical = corpo.replace(/\./g, '').replace(',', '.');
      } else if (corpo.includes('.')) {
        if (/^\d{1,3}(?:\.\d{3})+$/.test(corpo)) canonical = corpo.replace(/\./g, '');
        else if (/^\d+\.\d+$/.test(corpo)) canonical = corpo;
        else return NaN;
      } else canonical = corpo;
      n = Number(sinal + canonical);
    } else return NaN;
    if (!Number.isFinite(n) || (positivo && n <= 0)) return NaN;
    return n;
  }

  function catalogo(listaId, itens, compras) {
    const mapa = new Map();
    const inserir = (entrada, historico = false) => {
      const x = objDe(entrada);
      if (!x || (x.lista != null && x.lista !== listaId)) return;
      const texto = textoLimpo(x.texto);
      const chave = textoNormalizado(texto);
      if (!chave) return;
      let atual = mapa.get(chave);
      if (!atual) {
        atual = { chave, texto, quantidade: null, unidade: '' };
        mapa.set(chave, atual);
      }
      // Só usa quantidade/unidade estruturadas explícitas. Nunca interpreta números no texto.
      if ((historico || Object.prototype.hasOwnProperty.call(x, 'quantidade')) && atual.quantidade == null &&
          typeof x.quantidade === 'number' && Number.isFinite(x.quantidade) && x.quantidade > 0 &&
          (!atual.unidade || textoNormalizado(atual.unidade) === textoNormalizado(x.unidade || ''))) {
        atual.quantidade = x.quantidade;
        atual.unidade = typeof x.unidade === 'string' ? x.unidade.trim() : '';
      }
      if (atual.quantidade == null && (historico || Object.prototype.hasOwnProperty.call(x, 'unidade')) && !atual.unidade && typeof x.unidade === 'string') atual.unidade = x.unidade.trim();
    };
    if (Array.isArray(itens)) itens.forEach(i => { const x = objDe(i); if (x && x.lista === listaId) inserir(x); });
    if (Array.isArray(compras)) compras.forEach(c => {
      if (c?.kind && c.kind !== 'compra') return;
      const compra = objDe(c);
      if (!compra || compra.lista !== listaId || !Array.isArray(compra.itens)) return;
      compra.itens.forEach(i => inserir(i, true));
    });
    return [...mapa.values()].sort((a, b) => a.texto.localeCompare(b.texto, 'pt-BR', { sensitivity: 'base' }) || a.chave.localeCompare(b.chave));
  }

  function dataValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s.slice(0, 4) === '0000') return false;
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  function validar(compra) {
    if (!compra || typeof compra !== 'object' || Array.isArray(compra)) return 'Compra inválida.';
    for (const [campo, nome] of [['id', 'identificador'], ['lista', 'lista'], ['listaNome', 'nome da lista']]) {
      if (typeof compra[campo] !== 'string' || !compra[campo].trim()) return `Informe ${nome} da compra.`;
    }
    if (!dataValida(compra.data)) return 'Informe uma data de compra válida.';
    if (compra.loja != null && typeof compra.loja !== 'string') return 'Loja deve ser um texto.';
    if (compra.total !== null && !tipoNumericoValido(compra.total)) return 'Total deve ser um número maior ou igual a zero, ou nulo.';
    if (typeof compra.criadoEm !== 'string' || !compra.criadoEm.trim()) return 'Informe a data de criação da compra.';
    if (!Array.isArray(compra.itens) || compra.itens.length < 1) return 'A compra deve ter ao menos um item.';
    if (compra.itens.length > MAX_ITENS) return `A compra pode ter no máximo ${MAX_ITENS} itens.`;
    const ids = new Set();
    for (const item of compra.itens) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Há um item inválido na compra.';
      if (typeof item.itemId !== 'string' || !item.itemId.trim()) return 'Cada item deve ter um identificador.';
      if (ids.has(item.itemId)) return 'Os identificadores dos itens da compra devem ser únicos.';
      ids.add(item.itemId);
      if (typeof item.texto !== 'string' || !item.texto.trim()) return 'Cada item deve ter um nome.';
      if (item.quantidade !== null && !tipoNumericoValido(item.quantidade, Number.MIN_VALUE)) return 'Quantidade deve ser maior que zero ou nula.';
      if (typeof item.unidade !== 'string') return 'Unidade deve ser um texto.';
      if (item.preco !== null && !tipoNumericoValido(item.preco)) return 'Preço unitário deve ser maior ou igual a zero ou nulo.';
    }
    return '';
  }

  function resumo(compras) {
    const lista = Array.isArray(compras) ? compras.filter(c => !c?.kind || c.kind === 'compra').map(objDe).filter(Boolean) : [];
    let totalConhecido = 0, totaisConhecidos = 0, semTotal = 0;
    const produtos = new Map();
    for (const compra of lista) {
      if (tipoNumericoValido(compra.total)) { totalConhecido += compra.total; totaisConhecidos++; }
      else semTotal++;
      if (!Array.isArray(compra.itens)) continue;
      for (const item of compra.itens) {
        const texto = textoLimpo(item?.texto);
        const chaveNome = textoNormalizado(texto);
        if (!chaveNome) continue;
        const unidade = typeof item.unidade === 'string' ? item.unidade.trim() : '';
        const chaveUnidade = textoNormalizado(unidade);
        const chave = `${chaveNome}\u0000${chaveUnidade}`;
        let p = produtos.get(chave);
        if (!p) {
          p = { texto, unidade, quantidade: null, vezes: 0, gasto: null, semQuantidade: 0, semPreco: 0 };
          produtos.set(chave, p);
        }
        p.vezes++;
        const temQuantidade = tipoNumericoValido(item.quantidade, Number.MIN_VALUE);
        const temPreco = tipoNumericoValido(item.preco);
        if (temQuantidade) p.quantidade = (p.quantidade ?? 0) + item.quantidade;
        else p.semQuantidade++;
        if (temPreco) {
          if (temQuantidade) p.gasto = (p.gasto ?? 0) + item.quantidade * item.preco;
        } else p.semPreco++;
      }
    }
    const saida = [...produtos.values()].sort((a, b) => a.texto.localeCompare(b.texto, 'pt-BR', { sensitivity: 'base' }) ||
      a.unidade.localeCompare(b.unidade, 'pt-BR', { sensitivity: 'base' }));
    return { compras: lista.length, total: totaisConhecidos ? totalConhecido : null, semTotal, produtos: saida };
  }

  return { catalogo, numero, validar, resumo };
})();
