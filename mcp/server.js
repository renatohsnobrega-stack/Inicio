#!/usr/bin/env node
// Conector MCP do Casa Organizada — deixa o Claude (Desktop ou Code) ler e gravar no app.
// Sem dependências: precisa só do Node 18+.
//
// Variáveis de ambiente:
//   CASA_SUPABASE_URL   ex.: https://abcdefgh.supabase.co
//   CASA_ANON_KEY       chave "anon / public" do Supabase
//   CASA_CHAVE          chave de agente criada no app (Automação → API para agentes)
//
// Para gastar poucos tokens, as respostas são texto curto (uma linha por registro)
// e o "resumo" já vem calculado com as mesmas regras do app.
// Veja docs/AUTOMACAO.md para configurar no Claude Desktop.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');

// Reaproveita as regras do próprio app: formato (schema.js) e cálculos (domain.js).
// O domain.js lê os dados por um "Store" que aqui é preenchido a partir da API.
const cache = {};
const ctx = vm.createContext({
  crypto: globalThis.crypto,
  console,
  Store: {
    list: kind => Object.values(cache[kind] || {}),
    get: (kind, id) => cache[kind]?.[id],
  },
});
for (const f of ['util.js', 'schema.js', 'caderneta.js', 'domain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const U = vm.runInContext('U', ctx);
const Schema = vm.runInContext('Schema', ctx);
const D = vm.runInContext('D', ctx);

const URL_BASE = String(process.env.CASA_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.CASA_ANON_KEY || '';
const CHAVE = process.env.CASA_CHAVE || '';

async function rpc(fn, body) {
  if (!URL_BASE || !ANON || !CHAVE) {
    throw new Error('Configure CASA_SUPABASE_URL, CASA_ANON_KEY e CASA_CHAVE no conector.');
  }
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ chave: CHAVE, ...body }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch { /* texto puro */ }
    throw new Error(`Erro ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

// Baixa os dados para o cache local (usado pelas regras do domain.js).
async function carregar({ comDoses = false } = {}) {
  for (const k of Object.keys(cache)) delete cache[k];
  const pedidos = [rpc('agente_listar', {}), rpc('agente_listar', { tipo: 'config' })];
  if (comDoses) pedidos.push(rpc('agente_listar', { tipo: 'dose', desde: U.ymd(U.addDays(new Date(), -2)) }));
  for (const lista of await Promise.all(pedidos)) {
    for (const r of lista || []) {
      const o = Schema.normalize(r.tipo, { ...r.dados, id: r.dados?.id || r.id });
      (cache[r.tipo] = cache[r.tipo] || {})[o.id] = o;
    }
  }
}

const TIPOS = Object.keys(Schema.KINDS);
const linha = (tipo, o) => `${Schema.KINDS[tipo]?.icone || '•'} ${Schema.resumo(tipo, o)}${o.revisado === false && Schema.REVISAVEIS.includes(tipo) ? ' [revisar]' : ''} (id: ${o.id})`;

function formato(tipo) {
  const kinds = tipo ? [[tipo, Schema.KINDS[tipo]]] : Object.entries(Schema.KINDS);
  return kinds.map(([k, d]) => `${k} (${d.nome}): ${Object.entries(d.campos)
    .map(([c, x]) => `${c}${x.obrig ? '*' : ''}=${x.tipo}`).join('; ')}\nex.: ${JSON.stringify(d.exemplo)}`).join('\n\n')
    + '\n\n* = obrigatório. Datas AAAA-MM-DD, horas HH:MM, dias da semana 0=segunda…6=domingo.';
}

function listar({ tipo, busca, limite = 30, incluir_concluidos = false }) {
  const termo = String(busca || '').toLowerCase();
  let regs = (tipo ? [tipo] : TIPOS.filter(k => k !== 'lista'))
    .flatMap(k => Object.values(cache[k] || {}).map(o => ({ k, o })));
  if (!incluir_concluidos) regs = regs.filter(({ k, o }) => !((k === 'item' || (k === 'tarefa' && o.tipo === 'unica')) && o.feito));
  if (termo) regs = regs.filter(({ k, o }) => Schema.resumo(k, o).toLowerCase().includes(termo));
  const total = regs.length;
  const nomesListas = Object.fromEntries(Object.values(cache.lista || {}).map(l => [l.id, l.nome]));
  const texto = regs.slice(0, limite).map(({ k, o }) =>
    linha(k, k === 'item' ? { ...o, lista_nome: nomesListas[o.lista] } : o));
  if (!total) return 'Nada encontrado.';
  return texto.join('\n') + (total > limite ? `\n… e mais ${total - limite}. Refine com "busca" ou aumente "limite".` : '');
}

function resumo({ dias = 7 }) {
  const hoje = U.today();
  const ate = U.ymd(U.addDays(new Date(), dias));
  const out = [`Resumo de ${U.longDate(hoje)} (próximos ${dias} dias) — ${D.casaNome()}`];

  const meses = [...new Set([-3, -2, -1, 0, 1, 2].map(n => U.addMonths(U.thisMonth(), n)))]
    .filter(m => m <= ate.slice(0, 7));
  const contas = meses.flatMap(m => D.billOccurrences(m)).filter(o => !o.pago && o.venc <= ate);
  out.push('', `Contas a pagar (${contas.length}, total ${U.brl(contas.reduce((s, o) => s + o.valor, 0))}):`);
  contas.forEach(o => out.push(`- ${o.venc < hoje ? 'ATRASADA ' : ''}${U.fmtDay(o.venc)} ${o.conta.nome} ${U.brl(o.valor)}${o.conta.codigo ? ' (tem código)' : ''}`));

  const doses = D.dosesOn(hoje);
  out.push('', `Remédios hoje (${doses.filter(d => d.tomado).length}/${doses.length} tomados):`);
  doses.forEach(d => out.push(`- ${d.hora} ${d.med.nome}${d.med.dose ? ` ${d.med.dose}` : ''} — ${d.med.pessoa || ''} ${d.tomado ? '✔' : '○'}`));
  const acabando = D.estoqueAcabando();
  if (acabando.length) {
    out.push('', `Estoque acabando (${acabando.length}):`);
    acabando.forEach(({ med, est }) => out.push(`- ${med.nome} (${med.pessoa || ''}): restam ${D.fmtQtd(est.restante)} ${med.unidade || 'un.'}, dá para ${est.dias} dia(s)`));
  }

  const eventos = D.eventsBetween(hoje, ate);
  out.push('', `Compromissos (${eventos.length}):`);
  eventos.forEach(({ date, ev }) => out.push(`- ${U.fmtDay(date)} ${ev.hora || ''} ${ev.titulo}${ev.pessoa ? ` (${ev.pessoa})` : ''}`));

  const aniver = D.aniversariosProximos(dias, hoje);
  if (aniver.length) {
    out.push('', `Aniversários (${aniver.length}):`);
    aniver.forEach(x => out.push(`- ${U.fmtDay(x.data)} ${x.contato.nome}${x.idade ? ` (faz ${x.idade})` : ''} — ${D.quandoTxt(x.dias)}`));
  }

  const tarefas = D.pendencias(hoje).filter(p => !p.feito && (p.faixa === 'atrasado' || p.faixa === 'hoje'));
  out.push('', `Tarefas para hoje e atrasadas (${tarefas.length}):`);
  tarefas.forEach(p => out.push(`- ${p.faixa === 'atrasado' ? `ATRASADA (${U.fmtDay(p.data)}) ` : ''}${p.titulo}${p.quem ? ` (${p.quem})` : ''}${p.kind === 'item' ? ` [lista ${p.lista?.nome || ''}]` : ''}`));

  for (const l of D.listas()) {
    const itens = D.itensDa(l.id).filter(i => !i.feito);
    if (itens.length) out.push('', `Lista ${l.nome} (${itens.length}): ${itens.map(i => i.texto).join(', ')}`);
  }
  const fixados = D.recados().filter(r => r.fixado);
  if (fixados.length) out.push('', 'Recados fixados:', ...fixados.map(r => `- ${r.autor || ''}: ${r.texto}`));
  const rev = D.paraRevisar().length;
  if (rev) out.push('', `${rev} item(ns) adicionado(s) por agentes aguardando revisão no app.`);
  return out.join('\n');
}

const TOOLS = [
  {
    name: 'casa_resumo',
    description: 'Resumo da casa: contas a vencer/atrasadas, remédios de hoje, compromissos, tarefas, listas e recados. Use primeiro para perguntas sobre a rotina.',
    inputSchema: { type: 'object', properties: { dias: { type: 'number', description: 'Período em dias (padrão 7)' } } },
  },
  {
    name: 'casa_listar',
    description: 'Busca registros do app, uma linha por registro, com o id para editar ou remover.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: TIPOS },
        busca: { type: 'string', description: 'Texto a procurar' },
        limite: { type: 'number', description: 'Máximo de linhas (padrão 30)' },
        incluir_concluidos: { type: 'boolean', description: 'Incluir itens e tarefas já concluídos' },
      },
    },
  },
  {
    name: 'casa_formato',
    description: 'Campos aceitos por tipo. Consulte antes de salvar um tipo que ainda não usou nesta conversa.',
    inputSchema: { type: 'object', properties: { tipo: { type: 'string', enum: TIPOS } } },
  },
  {
    name: 'casa_salvar',
    description: 'Cria ou atualiza registros (mesmo id = atualiza; campos enviados são mesclados). Use ids estáveis da fonte, ex.: "gmail-<id>". Aparecem no app como "para revisar".',
    inputSchema: {
      type: 'object',
      required: ['registros'],
      properties: {
        registros: {
          type: 'array',
          items: {
            type: 'object',
            required: ['tipo', 'dados'],
            properties: { tipo: { type: 'string', enum: TIPOS }, id: { type: 'string' }, dados: { type: 'object' } },
          },
        },
        origem: { type: 'string', description: 'Ex.: "gmail", "conversa"' },
      },
    },
  },
  {
    name: 'casa_remover',
    description: 'Remove um registro pelo tipo e id.',
    inputSchema: { type: 'object', required: ['tipo', 'id'], properties: { tipo: { type: 'string', enum: TIPOS }, id: { type: 'string' } } },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'casa_resumo':
      await carregar({ comDoses: true });
      return resumo(args);
    case 'casa_listar':
      await carregar();
      return listar(args);
    case 'casa_formato':
      return formato(args.tipo && Schema.KINDS[args.tipo] ? args.tipo : null);
    case 'casa_salvar': {
      const erros = [];
      const registros = (args.registros || []).map((r, i) => {
        const tipo = Schema.kindOf(r.tipo);
        if (!tipo) { erros.push(`#${i + 1}: tipo inválido "${r.tipo}"`); return null; }
        const dados = Schema.normalize(tipo, { origem: args.origem || 'claude', ...(r.dados || {}), ...(r.id ? { id: r.id } : {}) });
        const e = Schema.validate(tipo, dados);
        if (e.length) { erros.push(`#${i + 1} (${tipo}): ${e.join('; ')}`); return null; }
        return { tipo, id: dados.id, dados };
      }).filter(Boolean);
      if (erros.length) throw new Error(`Nada foi salvo. Corrija:\n${erros.join('\n')}`);
      const out = await rpc('agente_salvar', { registros });
      return `Salvo (${out.salvos.length}):\n${registros.map(r => linha(r.tipo, r.dados)).join('\n')}`;
    }
    case 'casa_remover': {
      const out = await rpc('agente_remover', { tipo: args.tipo, id: args.id });
      return out.removidos ? 'Removido.' : 'Nada encontrado com esse id.';
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

// ---------- Protocolo MCP (JSON-RPC 2.0 via stdin/stdout) ----------
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notificações (ex.: notifications/initialized)
  try {
    switch (method) {
      case 'initialize':
        return send({ id, result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'casa-organizada', version: '1.1.0' },
          instructions: 'App Casa Organizada (rotina da casa). Para perguntas, comece por casa_resumo; para achar algo, casa_listar com busca.',
        } });
      case 'ping':
        return send({ id, result: {} });
      case 'tools/list':
        return send({ id, result: { tools: TOOLS } });
      case 'tools/call':
        try {
          const text = await callTool(params?.name, params?.arguments);
          return send({ id, result: { content: [{ type: 'text', text }] } });
        } catch (err) {
          return send({ id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
        }
      default:
        return send({ id, error: { code: -32601, message: `Método não suportado: ${method}` } });
    }
  } catch (err) {
    return send({ id, error: { code: -32603, message: err.message } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'JSON inválido' } }); }
  handle(msg);
});
