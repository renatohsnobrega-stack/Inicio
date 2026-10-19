// Formato dos dados do app. É a referência usada pela tela, pela importação de IA,
// pela API de agentes e pelo servidor MCP — e também quem "conserta" dados que chegam
// de fora (ex.: "R$ 150,90", "8h", "25/10/2026", "segunda").
const Schema = (() => {
  const CATEGORIAS = ['Moradia', 'Água / Luz / Gás', 'Internet / Telefone', 'Cartão de crédito', 'Mercado',
    'Saúde', 'Educação', 'Transporte', 'Seguros', 'Impostos', 'Assinaturas', 'Outros'];
  const CATEG_CONTATO = ['Emergência', 'Saúde', 'Família', 'Amigos', 'Escola', 'Serviços da casa', 'Trabalho', 'Outros'];
  const SLOTS = { cafe: 'Café da manhã', almoco: 'Almoço', lanche: 'Lanche', jantar: 'Jantar' };

  const f = (tipo, desc, obrig = false) => ({ tipo, desc, obrig });
  const COMUNS = {
    origem: f('texto', 'De onde veio o dado (ex.: "gmail", "google-calendar", "claude")'),
    revisado: f('booleano', 'false = aparece no Painel em "para revisar"'),
  };
  const KINDS = {
    conta: {
      nome: 'Contas a pagar', plural: 'contas', icone: '💰',
      campos: {
        nome: f('texto', 'Nome da conta (ex.: "Energia Enel")', true),
        valor: f('número', 'Valor em reais, com ponto decimal (ex.: 150.90)'),
        tipo: f('"mensal" | "unica"', 'mensal = repete todo mês; unica = vence uma vez só'),
        dia: f('número 1-31', 'Dia do vencimento (contas mensais)'),
        data: f('data AAAA-MM-DD', 'Data do vencimento (contas únicas)'),
        inicio: f('mês AAAA-MM', 'Primeiro mês da conta mensal'),
        fim: f('mês AAAA-MM', 'Último mês da conta mensal (vazio = sem fim)'),
        categoria: f(CATEGORIAS.map(c => `"${c}"`).join(' | '), 'Categoria'),
        responsavel: f('texto', 'Quem paga'),
        forma: f('texto', 'Forma de pagamento (Boleto, Pix, Débito automático…)'),
        codigo: f('texto', 'Linha digitável do boleto ou Pix copia e cola'),
        obs: f('texto', 'Observações'),
      },
      exemplo: { nome: 'Energia Enel', valor: 287.45, tipo: 'unica', data: '2026-11-10', categoria: 'Água / Luz / Gás', forma: 'Boleto', codigo: '83640000002-8 87450...' },
    },
    remedio: {
      nome: 'Remédios', plural: 'remedios', icone: '💊',
      campos: {
        nome: f('texto', 'Nome do remédio ou suplemento', true),
        categoria: f('"remedio" | "suplemento"', 'Suplementos também aparecem em Alimentação'),
        pessoa: f('texto', 'Para quem'),
        dose: f('texto', 'Dose (ex.: "1 comprimido 50mg")'),
        horarios: f('lista de "HH:MM"', 'Horários (ex.: ["08:00","20:00"])'),
        instrucoes: f('texto', 'Como tomar (ex.: "em jejum")'),
        inicio: f('data AAAA-MM-DD', 'Início do tratamento'),
        fim: f('data AAAA-MM-DD', 'Fim do tratamento (vazio = uso contínuo)'),
        ativo: f('booleano', 'false = suspenso'),
        estoque: f('número', 'Quantidade disponível na data "estoque_em" (vazio = não controlar)'),
        unidade: f('texto', 'Unidade do estoque (comprimidos, cápsulas, ml…)'),
        por_dose: f('número', 'Unidades gastas em cada horário (padrão 1)'),
        estoque_em: f('data AAAA-MM-DD', 'Dia da contagem do estoque (vazio = hoje)'),
      },
      exemplo: { nome: 'Losartana', pessoa: 'Renato', dose: '1 comprimido 50mg', horarios: ['08:00', '20:00'], instrucoes: 'após o café', estoque: 30, unidade: 'comprimidos', por_dose: 1 },
    },
    evento: {
      nome: 'Compromissos', plural: 'eventos', icone: '📅',
      campos: {
        titulo: f('texto', 'O quê', true),
        data: f('data AAAA-MM-DD', 'Data', true),
        hora: f('"HH:MM"', 'Hora (opcional)'),
        pessoa: f('texto', 'Quem vai'),
        local: f('texto', 'Local'),
        repete: f('"nao" | "semanal" | "mensal" | "anual"', 'Repetição (anual = aniversários)'),
        obs: f('texto', 'Observações'),
      },
      exemplo: { titulo: 'Consulta cardiologista', data: '2026-11-04', hora: '14:30', pessoa: 'Renato', local: 'Clínica Coração' },
    },
    tarefa: {
      nome: 'Tarefas', plural: 'tarefas', icone: '✅',
      campos: {
        titulo: f('texto', 'Tarefa', true),
        tipo: f('"unica" | "diaria" | "semanal" | "mensal"', 'Frequência'),
        data: f('data AAAA-MM-DD', 'Prazo (tarefa única)'),
        dias: f('lista de números 0-6', 'Dias da semana (semanal). 0 = segunda … 6 = domingo'),
        dia: f('número 1-31', 'Dia do mês (mensal)'),
        responsavel: f('texto', 'Quem faz'),
        local: f('texto', 'Cômodo (Cozinha, Banheiro, Lavanderia…)'),
        obs: f('texto', 'Observações'),
      },
      exemplo: { titulo: 'Tirar o lixo', tipo: 'semanal', dias: [0, 2, 4], responsavel: 'Renato', local: 'Cozinha' },
    },
    refeicao: {
      nome: 'Cardápio semanal', plural: 'refeicoes', icone: '🍽️',
      campos: {
        dia: f('número 0-6', '0 = segunda … 6 = domingo', true),
        refeicao: f('"cafe" | "almoco" | "lanche" | "jantar"', 'Qual refeição', true),
        texto: f('texto', 'O que comer'),
        pessoa: f('texto', 'De quem é a refeição (vazio = da família toda)'),
      },
      exemplo: { dia: 0, refeicao: 'almoco', texto: 'Arroz, feijão, frango grelhado e salada' },
    },
    contato: {
      nome: 'Contatos úteis', plural: 'contatos', icone: '📞',
      campos: {
        nome: f('texto', 'Nome', true),
        aniversario: f('"AAAA-MM-DD" ou "MM-DD" (sem o ano)', 'Data de aniversário; o ano é opcional e serve para mostrar a idade'),
        categoria: f(CATEG_CONTATO.map(c => `"${c}"`).join(' | '), 'Categoria'),
        telefone: f('texto', 'Telefone'),
        whatsapp: f('booleano', 'Tem WhatsApp'),
        endereco: f('texto', 'Endereço'),
        obs: f('texto', 'Observações'),
      },
      exemplo: { nome: 'Dra. Paula (pediatra)', categoria: 'Saúde', telefone: '(11) 98765-4321', whatsapp: true, aniversario: '03-15' },
    },
    recado: {
      nome: 'Recados do mural', plural: 'recados', icone: '📌',
      campos: {
        texto: f('texto', 'Recado', true),
        autor: f('texto', 'Quem escreveu (ex.: "Claude")'),
        fixado: f('booleano', 'Fixar no topo'),
      },
      exemplo: { texto: 'A fatura do cartão chegou: R$ 1.230,00, vence dia 15.', autor: 'Claude' },
    },
    lista: {
      nome: 'Listas', plural: 'listas', icone: '📝',
      campos: { nome: f('texto', 'Nome da lista', true), icone: f('emoji', 'Ícone') },
      exemplo: { nome: 'Compras', icone: '🛒' },
    },
    item: {
      nome: 'Itens de lista', plural: 'itens', icone: '🛒',
      campos: {
        texto: f('texto', 'Item', true),
        lista_nome: f('texto', 'Nome da lista (ex.: "Compras"); é criada se não existir'),
        lista: f('texto', 'Ou o id da lista'),
        feito: f('booleano', 'Já comprado/resolvido'),
        prazo: f('data AAAA-MM-DD', 'Até quando precisa ser comprado/resolvido (opcional)'),
      },
      exemplo: { texto: '2 L de leite', lista_nome: 'Compras' },
    },
  };
  // Dados dos filhos: ficam fora dos tipos gerais (prompt de IA, MCP) e só são aceitos por chaves "Total + filhos".
  const KINDS_FILHOS = {
    crianca: {
      nome: 'Dados de nascimento', plural: 'criancas', icone: '👶',
      campos: {
        nome: f('texto', 'Nome do filho (igual ao de Ajustes)', true),
        nascimento: f('data AAAA-MM-DD', 'Data de nascimento'),
        ig_semanas: f('número', 'Idade gestacional ao nascer, em semanas'),
        ig_dias: f('número 0-6', 'Dias além das semanas'),
        peso_nascer: f('número', 'Peso ao nascer, em gramas'),
        comprimento_nascer: f('número', 'Comprimento ao nascer, em cm'),
        pc_nascer: f('número', 'Perímetro cefálico ao nascer, em cm'),
        tipo_sanguineo: f('texto', 'Ex.: "O+"'),
        alergias: f('texto', 'Alergias'),
        obs: f('texto', 'Observações'),
      },
    },
    marco: {
      nome: 'Marcos do desenvolvimento', plural: 'marcos', icone: '🧩',
      campos: {
        crianca: f('texto', 'Id da criança (ex.: "antonio")', true),
        marco: f('texto', 'Id do marco da Caderneta da Criança (ex.: "senta")', true),
        s: f('"P" | "A" | "NV"', 'Presente, ausente ou não verificado', true),
        em: f('data AAAA-MM-DD', 'Quando foi observado'),
      },
    },
    medida: {
      nome: 'Medidas', plural: 'medidas', icone: '📏',
      campos: {
        crianca: f('texto', 'Id da criança (ex.: "antonio")', true),
        data: f('data AAAA-MM-DD', 'Data da medida', true),
        peso: f('número', 'Peso em kg (ex.: 8.4)'),
        comprimento: f('número', 'Comprimento/altura em cm'),
        pc: f('número', 'Perímetro cefálico em cm'),
        obs: f('texto', 'Observações'),
      },
    },
    historia: {
      nome: 'História médica', plural: 'historias', icone: '📖',
      campos: {
        crianca: f('texto', 'Id da criança (ex.: "antonio")', true),
        data: f('data AAAA-MM-DD', 'Data', true),
        tipo: f('"Consulta" | "Doença" | "Exame" | "Vacina" | "Internação" | "Cirurgia" | "Alergia" | "Outro"', 'Tipo de registro'),
        titulo: f('texto', 'Resumo (ex.: "Bronquiolite")', true),
        texto: f('texto', 'Detalhes: diagnóstico, conduta, resultado, quem atendeu'),
      },
    },
  };
  const info = kind => KINDS[kind] || KINDS_FILHOS[kind];
  const ALIASES = {
    medicamento: 'remedio', medicamentos: 'remedio', compromisso: 'evento', compromissos: 'evento',
    cardapio: 'refeicao', contas_a_pagar: 'conta',
  };
  Object.entries(KINDS).forEach(([k, v]) => { ALIASES[k] = k; ALIASES[v.plural] = k; });
  const kindOf = name => ALIASES[strip(name).replace(/\s+/g, '_')] || null;
  // Tipos que um agente pode criar e que pedem conferência humana no Painel.
  const REVISAVEIS = ['conta', 'remedio', 'evento', 'tarefa', 'contato', 'medida', 'historia'];

  // ---------- Conversões tolerantes ----------
  const pad = U.pad;
  function strip(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function toYmd(v) {
    const s = String(v ?? '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
      return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
    }
    return '';
  }
  function toYm(v) {
    const s = String(v ?? '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}`;
    if ((m = s.match(/^(\d{1,2})[/-](\d{4})$/))) return `${m[2]}-${pad(m[1])}`;
    return '';
  }
  const toBool = (v, def) => (v == null || v === '' ? def
    : typeof v === 'boolean' ? v : !/^(false|0|nao|no|n)$/.test(strip(v)));
  const toInt = (v, min, max) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? '' : Math.min(max, Math.max(min, n));
  };
  // Aniversário: "1985-03-15", "03-15", "--03-15", "15/03" ou "15/03/1985" → { ano, mes, dia } (ano pode ser null).
  // Ano fora de 1900..ano atual é descartado (fica só dia e mês).
  function parseAniversario(v) {
    const s = String(v ?? '').trim();
    let m, ano = null, mes, dia;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, ano, mes, dia] = m;
    else if ((m = s.match(/^-{0,2}(\d{1,2})-(\d{1,2})$/))) [, mes, dia] = m;
    else if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/))) {
      [, dia, mes, ano] = m;
      if (ano && ano.length === 2) ano = (Number(ano) > new Date().getFullYear() % 100 ? '19' : '20') + ano;
    } else return null;
    mes = Number(mes); dia = Number(dia); ano = ano ? Number(ano) : null;
    if (mes < 1 || mes > 12 || dia < 1 || dia > U.daysInMonth(2000, mes)) return null; // 2000: aceita 29/02
    if (ano && (ano < 1900 || ano > new Date().getFullYear())) ano = null;
    if (ano && dia > U.daysInMonth(ano, mes)) ano = null;
    return { ano, mes, dia };
  }
  const toAniversario = v => {
    const a = parseAniversario(v);
    return !a ? '' : `${a.ano ? a.ano + '-' : ''}${pad(a.mes)}-${pad(a.dia)}`;
  };
  // Para mostrar: "15/03" ou "15/03/1985".
  const fmtAniversario = v => {
    const a = parseAniversario(v);
    return !a ? '' : `${pad(a.dia)}/${pad(a.mes)}${a.ano ? '/' + a.ano : ''}`;
  };
  // Quantidade ("28", "2,5", 30) → número >= 0; vazio continua vazio.
  const toQtd = v => {
    if (v == null || v === '') return '';
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? '' : Math.max(0, n);
  };
  // "Antônio" → "antonio" (usado em ids, ex.: refeição de cada pessoa).
  const slug = s => strip(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Refeição da família: "0-almoco"; de uma pessoa: "0-almoco-antonio".
  const mealId = (wd, slot, pessoa) => (slug(pessoa) ? `${wd}-${slot}-${slug(pessoa)}` : `${wd}-${slot}`);
  const WD_PT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const WD_EN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function toWeekday(v) {
    if (typeof v === 'number' || /^\d$/.test(String(v).trim())) return Number(v) % 7;
    const s = strip(v).slice(0, 3);
    const i = WD_PT.indexOf(s) >= 0 ? WD_PT.indexOf(s) : WD_EN.indexOf(s);
    return i >= 0 ? i : null;
  }
  function toSlot(v) {
    const s = strip(v);
    if (SLOTS[s]) return s;
    if (/cafe|breakfast|manha/.test(s)) return 'cafe';
    if (/almoc|lunch/.test(s)) return 'almoco';
    if (/lanch|snack|tarde/.test(s)) return 'lanche';
    if (/jant|dinner|ceia|noite/.test(s)) return 'jantar';
    return null;
  }
  function pickEnum(v, map, def) {
    const s = strip(v);
    for (const [re, val] of map) if (re.test(s)) return val;
    return def;
  }
  // Hash curto e estável (FNV-1a) para gerar ids que evitam duplicar a mesma coisa.
  function hash(s) {
    let h = 0x811c9dc5;
    for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function naturalKey(kind, o) {
    switch (kind) {
      case 'conta': return `${strip(o.nome)}|${o.tipo === 'unica' ? o.data : o.dia}`;
      case 'remedio': return `${strip(o.nome)}|${strip(o.pessoa)}`;
      case 'evento': return `${strip(o.titulo)}|${o.data}|${o.hora || ''}`;
      case 'tarefa': return strip(o.titulo);
      case 'contato': return strip(o.nome);
      case 'lista': return strip(o.nome);
      default: return null;
    }
  }

  // Coage os campos conhecidos para o formato do app e mantém os demais (pagos, feitos…).
  function normalize(kind, raw) {
    const o = { ...(raw || {}) };
    const str = (...ks) => ks.forEach(k => { if (o[k] != null && typeof o[k] !== 'string') o[k] = String(o[k]); if (typeof o[k] === 'string') o[k] = o[k].trim(); });
    switch (kind) {
      case 'conta':
        str('nome', 'categoria', 'responsavel', 'forma', 'codigo', 'obs');
        if (o.valor != null) o.valor = U.parseMoney(o.valor);
        if (!o.data && o.vencimento) o.data = o.vencimento;
        if (o.data) o.data = toYmd(o.data);
        o.tipo = o.tipo ? pickEnum(o.tipo, [[/unic|uma|once|single/, 'unica']], 'mensal') : (o.data && !o.dia ? 'unica' : 'mensal');
        if (o.tipo === 'mensal') {
          o.dia = toInt(o.dia ?? (o.data ? o.data.slice(8) : ''), 1, 31);
          // Conta recorrente vinda de fora começa no próximo vencimento (não nasce "atrasada").
          if (o.inicio === undefined) {
            o.inicio = o.data ? o.data.slice(0, 7)
              : o.dia && o.dia < new Date().getDate() ? U.addMonths(U.thisMonth(), 1) : U.thisMonth();
          }
        }
        if (o.inicio) o.inicio = toYm(o.inicio);
        if (o.fim) o.fim = toYm(o.fim);
        if (o.pagos && typeof o.pagos !== 'object') delete o.pagos;
        break;
      case 'remedio':
        str('nome', 'pessoa', 'dose', 'instrucoes', 'unidade');
        o.categoria = pickEnum(o.categoria, [[/supl|vitamin|suppl/, 'suplemento']], 'remedio');
        o.horarios = U.parseTimes(o.horarios || []);
        o.ativo = toBool(o.ativo, true);
        if (o.inicio) o.inicio = toYmd(o.inicio);
        if (o.fim) o.fim = toYmd(o.fim);
        if ('estoque' in o) o.estoque = toQtd(o.estoque);
        if ('por_dose' in o) o.por_dose = toQtd(o.por_dose);
        if (o.estoque_em) o.estoque_em = toYmd(o.estoque_em);
        break;
      case 'evento':
        str('titulo', 'pessoa', 'local', 'obs');
        if (o.data) o.data = toYmd(o.data);
        if (o.hora) o.hora = U.parseTimes([o.hora])[0] || '';
        o.repete = pickEnum(o.repete, [[/anu|year|ano/, 'anual'], [/mens|month|mes/, 'mensal'], [/seman|week/, 'semanal']], 'nao');
        break;
      case 'tarefa':
        str('titulo', 'responsavel', 'local', 'obs');
        o.tipo = pickEnum(o.tipo, [[/diar|daily|todo dia/, 'diaria'], [/seman|week/, 'semanal'], [/mens|month/, 'mensal']], 'unica');
        if (o.tipo === 'semanal') o.dias = [...new Set((Array.isArray(o.dias) ? o.dias : String(o.dias || '').split(/[,;\s]+/)).map(toWeekday).filter(d => d != null))].sort();
        if (o.tipo === 'mensal') o.dia = toInt(o.dia, 1, 31);
        if (o.data) o.data = toYmd(o.data);
        o.feito = toBool(o.feito, false);
        break;
      case 'refeicao': {
        str('texto', 'pessoa');
        const wd = o.dia != null ? toWeekday(o.dia) : null;
        const slot = o.refeicao ? toSlot(o.refeicao) : null;
        if (wd != null && slot) o.id = mealId(wd, slot, o.pessoa);
        break;
      }
      case 'contato':
        str('nome', 'categoria', 'telefone', 'endereco', 'obs');
        o.whatsapp = toBool(o.whatsapp, false);
        if (!o.categoria) o.categoria = 'Outros';
        // Data que não deu para entender fica como veio, para o validate apontar o erro.
        if (o.aniversario) o.aniversario = toAniversario(o.aniversario) || String(o.aniversario).trim();
        break;
      case 'recado':
        str('texto', 'autor');
        o.fixado = toBool(o.fixado, false);
        if (!o.em) o.em = new Date().toISOString();
        if (!Array.isArray(o.curtidas)) o.curtidas = [];
        break;
      case 'item':
        str('texto', 'lista', 'lista_nome');
        o.feito = toBool(o.feito, false);
        if (o.prazo) o.prazo = toYmd(o.prazo);
        if (!o.criadoEm) o.criadoEm = new Date().toISOString();
        break;
      case 'crianca':
        str('nome', 'tipo_sanguineo', 'alergias', 'obs');
        if (o.nascimento) o.nascimento = toYmd(o.nascimento);
        ['ig_semanas', 'ig_dias', 'peso_nascer', 'comprimento_nascer', 'pc_nascer'].forEach(k => { if (k in o) o[k] = toQtd(o[k]); });
        break;
      case 'marco':
        o.s = String(o.s || '').toUpperCase();
        if (o.em) o.em = toYmd(o.em);
        if (!o.id && o.crianca && o.marco) o.id = `${o.crianca}-${o.marco}`;
        break;
      case 'medida':
        str('obs');
        if (o.data) o.data = toYmd(o.data);
        ['peso', 'comprimento', 'pc'].forEach(k => { if (k in o) o[k] = toQtd(o[k]); });
        break;
      case 'historia':
        str('tipo', 'titulo', 'texto');
        if (o.data) o.data = toYmd(o.data);
        break;
      case 'lista':
        str('nome', 'icone');
        if (!o.criadaEm) o.criadaEm = new Date().toISOString();
        break;
      default:
        break;
    }
    if (o.id != null) o.id = String(o.id);
    if (!o.id) {
      const key = naturalKey(kind, o);
      o.id = key ? `imp-${kind}-${hash(key)}` : U.uid();
    }
    return o;
  }

  function validate(kind, o) {
    const def = KINDS[kind];
    if (!def) return [`tipo desconhecido: ${kind}`];
    const errs = Object.entries(def.campos).filter(([k, c]) => c.obrig && (o[k] === '' || o[k] == null)).map(([k]) => `falta "${k}"`);
    if (kind === 'conta' && o.tipo === 'unica' && !o.data) errs.push('conta única precisa de "data"');
    if (kind === 'conta' && o.tipo === 'mensal' && !o.dia) errs.push('conta mensal precisa de "dia"');
    if (kind === 'refeicao' && !/^[0-6]-(cafe|almoco|lanche|jantar)(-[a-z0-9-]+)?$/.test(o.id)) errs.push('"dia" ou "refeicao" inválido');
    if (kind === 'item' && !o.lista && !o.lista_nome) errs.push('informe "lista_nome"');
    if (kind === 'contato' && o.aniversario && !parseAniversario(o.aniversario)) errs.push('"aniversario" inválido (use DD/MM ou DD/MM/AAAA)');
    return errs;
  }

  function resumo(kind, o) {
    switch (kind) {
      case 'conta': return `${o.nome} — ${U.brl(o.valor)} — ${o.tipo === 'unica' ? `vence ${U.fmtDate(o.data)}` : `todo dia ${o.dia}`}`;
      case 'remedio': return `${o.categoria === 'suplemento' ? 'Suplemento: ' : ''}${o.nome}${o.dose ? ` (${o.dose})` : ''} — ${o.pessoa || '—'} — ${(o.horarios || []).join(', ') || 'sem horário'}${o.estoque !== '' && o.estoque != null ? ` — estoque ${o.estoque}${o.unidade ? ' ' + o.unidade : ''}` : ''}`;
      case 'evento': return `${o.titulo} — ${U.fmtDate(o.data)}${o.hora ? ` às ${o.hora}` : ''}${o.repete && o.repete !== 'nao' ? ` (${o.repete})` : ''}`;
      case 'tarefa': return `${o.titulo} — ${{ unica: o.data ? `até ${U.fmtDate(o.data)}` : 'uma vez', diaria: 'todo dia', semanal: 'semanal', mensal: `todo dia ${o.dia}` }[o.tipo] || o.tipo}${o.responsavel ? ` — ${o.responsavel}` : ''}`;
      case 'refeicao': { const [wd, slot] = String(o.id).split('-'); return `${U.WD[wd] || '?'} · ${SLOTS[slot] || '?'}${o.pessoa ? ` (${o.pessoa})` : ''}: ${o.texto || '—'}`; }
      case 'contato': return `${o.nome} — ${o.telefone || 'sem telefone'}${parseAniversario(o.aniversario) ? ` — 🎂 ${fmtAniversario(o.aniversario)}` : ''}`;
      case 'item': return `${o.texto} → ${o.lista_nome || 'lista'}${o.prazo ? ` (até ${U.fmtDate(o.prazo)})` : ''}`;
      case 'lista': return o.nome;
      case 'medida': {
        const n = v => String(v).replace('.', ',');
        return `${o.crianca} — ${U.fmtDate(o.data)} — ${[o.peso && `${n(o.peso)} kg`, o.comprimento && `${n(o.comprimento)} cm`, o.pc && `PC ${n(o.pc)} cm`].filter(Boolean).join(', ') || 'sem medida'}`;
      }
      case 'historia': return `${o.crianca} — ${U.fmtDate(o.data)} — ${o.tipo ? `${o.tipo}: ` : ''}${o.titulo || ''}`;
      default: return o.texto || o.nome || o.titulo || o.id;
    }
  }

  // Aceita: [{tipo, dados}], [{kind, data}] ou {contas:[…], remedios:[…], …}; tolera ```json … ```.
  function parseImport(text) {
    let s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    if (!/^[[{]/.test(s)) {
      const i = s.search(/[[{]/);
      if (i < 0) throw new Error('Não encontrei um JSON no texto colado.');
      s = s.slice(i);
    }
    const json = JSON.parse(s);
    const out = [];
    const push = (kindName, data, id) => {
      const kind = kindOf(kindName);
      if (!kind) { out.push({ kind: kindName, data: data || {}, erros: [`tipo desconhecido: ${kindName}`] }); return; }
      out.push({ kind, data: { ...(data || {}), ...(id ? { id } : {}) } });
    };
    if (Array.isArray(json)) {
      json.forEach(r => push(r.tipo || r.kind, r.dados || r.data, r.id));
    } else if (json && typeof json === 'object') {
      if (Array.isArray(json.registros)) json.registros.forEach(r => push(r.tipo || r.kind, r.dados || r.data, r.id));
      else Object.entries(json).forEach(([k, arr]) => (Array.isArray(arr) ? arr : [arr]).forEach(d => push(k, d)));
    }
    return out.map(r => {
      if (r.erros) return r;
      const data = normalize(r.kind, r.data);
      return { kind: r.kind, data, erros: validate(r.kind, data) };
    });
  }

  // Google Agenda / Outlook / Apple: arquivo .ics → compromissos (a partir de `desde`).
  function parseICS(text, desde) {
    const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const evs = [];
    let ev = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') ev = {};
      else if (line === 'END:VEVENT') { if (ev) evs.push(ev); ev = null; }
      else if (ev) {
        const i = line.indexOf(':');
        if (i > 0) ev[line.slice(0, i).split(';')[0].toUpperCase()] = line.slice(i + 1);
      }
    }
    const unesc = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
    return evs.filter(e => !e['RECURRENCE-ID'] && e.STATUS !== 'CANCELLED').map(e => {
      const m = String(e.DTSTART || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z)?)?/);
      if (!m) return null;
      let data = `${m[1]}-${m[2]}-${m[3]}`, hora = '';
      if (m[4]) {
        if (m[6]) {
          const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]));
          data = U.ymd(d);
          hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else hora = `${m[4]}:${m[5]}`;
      }
      const freq = (String(e.RRULE || '').match(/FREQ=(\w+)/) || [])[1];
      const repete = { YEARLY: 'anual', MONTHLY: 'mensal', WEEKLY: 'semanal' }[freq] || 'nao';
      const titulo = unesc(e.SUMMARY) || '(sem título)';
      const data_ = normalize('evento', {
        id: `ics-${hash(e.UID || data + titulo)}`, titulo, data, hora, repete,
        local: unesc(e.LOCATION), obs: unesc(e.DESCRIPTION).slice(0, 500), origem: 'calendario-ics', revisado: true,
      });
      return { kind: 'evento', data: data_, erros: [] };
    }).filter(r => r && (r.data.repete !== 'nao' || r.data.data >= desde));
  }

  // Prompt para colar no Claude / Gemini / ChatGPT e receber os dados no formato do app.
  function promptIA(pessoas = []) {
    const blocos = Object.entries(KINDS).filter(([k]) => k !== 'lista').map(([, def]) =>
      `"${def.plural}": ${def.nome}\n${Object.entries(def.campos).map(([c, x]) =>
        `  - ${c}${x.obrig ? ' (obrigatório)' : ''}: ${x.tipo} — ${x.desc}`).join('\n')}`).join('\n\n');
    const exemplo = {};
    ['conta', 'remedio', 'evento', 'item'].forEach(k => { exemplo[KINDS[k].plural] = [KINDS[k].exemplo]; });
    return `Quero cadastrar informações no meu app de organização da casa ("Casa Organizada").
Com base na nossa conversa (ou no conteúdo que eu enviar a seguir), gere SOMENTE um bloco JSON no formato abaixo.

Regras:
- Hoje é ${U.today()}. Converta datas relativas ("sexta que vem") para AAAA-MM-DD.
- Horários em "HH:MM" (24h). Valores em número com ponto decimal (150.90).
- Dias da semana: 0 = segunda, 1 = terça … 6 = domingo.
- Use só as chaves que tiverem dados; não invente informações que não foram ditas.${pessoas.length ? `\n- As pessoas da casa são: ${pessoas.join(', ')}.` : ''}

Chaves e campos aceitos:

${blocos}

Exemplo de resposta:
\`\`\`json
${JSON.stringify(exemplo, null, 2)}
\`\`\``;
  }

  return {
    CATEGORIAS, CATEG_CONTATO, SLOTS, KINDS, KINDS_FILHOS, info, COMUNS, REVISAVEIS,
    kindOf, normalize, validate, resumo, parseImport, parseICS, promptIA, hash, toYmd, slug, mealId,
    parseAniversario, toAniversario, fmtAniversario,
  };
})();
