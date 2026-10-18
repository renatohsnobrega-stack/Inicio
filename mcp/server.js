#!/usr/bin/env node
// Conector MCP do Casa Organizada — deixa o Claude (Desktop ou Code) ler e gravar no app.
// Sem dependências: precisa só do Node 18+.
//
// Variáveis de ambiente:
//   CASA_SUPABASE_URL   ex.: https://abcdefgh.supabase.co
//   CASA_ANON_KEY       chave "anon / public" do Supabase
//   CASA_CHAVE          chave de agente criada no app (Automação → API para agentes)
//
// Veja docs/AUTOMACAO.md para configurar no Claude Desktop.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');

// Reaproveita as regras de formato do próprio app (js/util.js + js/schema.js).
const ctx = vm.createContext({ crypto: globalThis.crypto, console });
for (const f of ['util.js', 'schema.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const Schema = vm.runInContext('Schema', ctx);

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

const TIPOS = Object.keys(Schema.KINDS);
const formato = () => Object.entries(Schema.KINDS).map(([k, d]) =>
  `## ${k} — ${d.nome}\n${Object.entries(d.campos).map(([c, x]) => `- ${c}${x.obrig ? ' (obrigatório)' : ''}: ${x.tipo} — ${x.desc}`).join('\n')}\nExemplo: ${JSON.stringify(d.exemplo)}`
).join('\n\n');

const TOOLS = [
  {
    name: 'casa_formato',
    description: 'Mostra os tipos de dados do app Casa Organizada (contas, remédios, compromissos, tarefas, cardápio, contatos, recados, listas) e os campos de cada um. Use antes de salvar.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'casa_listar',
    description: 'Lista os dados já cadastrados no app (para consultar ou evitar duplicados).',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: TIPOS, description: 'Filtra por tipo (opcional)' },
        desde: { type: 'string', description: 'Só alterados a partir desta data AAAA-MM-DD (opcional)' },
      },
    },
  },
  {
    name: 'casa_salvar',
    description: 'Cadastra ou atualiza registros no app. Mesmo "id" = atualiza. Use ids estáveis como "gmail-<id da mensagem>" ou "gcal-<id do evento>" para não duplicar. Datas AAAA-MM-DD, horas HH:MM, dias da semana 0=segunda…6=domingo. Os registros aparecem no Painel do app como "para revisar".',
    inputSchema: {
      type: 'object',
      required: ['registros'],
      properties: {
        registros: {
          type: 'array',
          items: {
            type: 'object',
            required: ['tipo', 'dados'],
            properties: {
              tipo: { type: 'string', enum: TIPOS },
              id: { type: 'string', description: 'Opcional' },
              dados: { type: 'object', description: 'Campos do registro (veja casa_formato)' },
            },
          },
        },
        origem: { type: 'string', description: 'De onde vieram os dados (ex.: "gmail", "google-calendar", "conversa")' },
      },
    },
  },
  {
    name: 'casa_remover',
    description: 'Remove um registro do app.',
    inputSchema: {
      type: 'object',
      required: ['tipo', 'id'],
      properties: { tipo: { type: 'string', enum: TIPOS }, id: { type: 'string' } },
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'casa_formato':
      return formato();
    case 'casa_listar': {
      const out = await rpc('agente_listar', { tipo: args.tipo || null, desde: args.desde || null });
      return JSON.stringify(out, null, 2);
    }
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
      return `Salvo: ${out.salvos.length} registro(s).\n${registros.map(r => `- ${Schema.KINDS[r.tipo].icone} ${Schema.resumo(r.tipo, r.dados)}`).join('\n')}`;
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
          serverInfo: { name: 'casa-organizada', version: '1.0.0' },
          instructions: 'Ferramentas para ler e gravar no app Casa Organizada (rotina da casa). Chame casa_formato antes de salvar.',
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
