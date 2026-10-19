// Teste da sincronização com o Google Agenda (Google e API do app simulados).
// Rodar: node testes/google-agenda.test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');

// ---- API do app (mesma semântica das funções SQL agente_*) ----
const db = new Map(); // id → dados
const api = {
  agente_salvar({ registros }) { registros.forEach(r => db.set(r.id, Object.assign({}, db.get(r.id), r.dados))); return { ok: true }; },
  agente_listar() { return [...db.entries()].map(([id, dados]) => ({ tipo: 'evento', id, dados })); },
  agente_remover({ id }) { db.delete(id); return { ok: true }; },
};

// ---- Google Agenda ----
const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
const dia = n => new Date(hoje.getTime() + n * 86400000 + 10 * 3600000);
let eventos = [];
const evento = (id, titulo, n, tipo = 'DEFAULT') => ({
  getId: () => id + '@google.com', getTitle: () => titulo, getStartTime: () => dia(n), isAllDayEvent: () => tipo === 'BIRTHDAY',
  getLocation: () => '', getDescription: () => '', getEventType: () => tipo,
});
const pad = n => String(n).padStart(2, '0');
const ctx = vm.createContext({
  console: { log: m => process.env.V && console.log('   ' + m), warn() {} },
  Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
  Utilities: { formatDate: (d, tz, p) => p === 'HH:mm' ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` },
  CalendarApp: { EventType: { BIRTHDAY: 'BIRTHDAY', DEFAULT: 'DEFAULT' }, getDefaultCalendar: () => ({ getEvents: () => eventos }) },
  UrlFetchApp: { fetch: (url, o) => { const out = api[url.split('/').pop()](JSON.parse(o.payload)); return { getContentText: () => JSON.stringify(out), getResponseCode: () => 200 }; } },
});
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'integracoes', 'google-agenda.gs'), 'utf8'), ctx);
const sync = () => vm.runInContext('sincronizarAgenda()', ctx);
const titulos = () => [...db.values()].map(d => d.titulo).sort().join(', ');
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('✔ ' + msg); };

// Aniversário que já tinha entrado no app antes do ajuste
db.set('gcal-aniv1-x', { titulo: 'Aniversário de Ricardo', data: `${dia(3).getFullYear()}-${pad(dia(3).getMonth() + 1)}-${pad(dia(3).getDate())}` });
eventos = [evento('c1', 'Pediatra do Antônio', 2), evento('aniv1', 'Aniversário de Ricardo', 3, 'BIRTHDAY')];
sync();
ok(titulos() === 'Pediatra do Antônio', 'aniversário do Google não entra no app, e o que já tinha entrado foi removido');
ok([...db.values()][0].hora === '10:00', 'compromisso comum continua entrando, com hora');

vm.runInContext('CONFIG.ANIVERSARIOS = true', ctx);
sync();
ok(titulos() === 'Aniversário de Ricardo, Pediatra do Antônio', 'com ANIVERSARIOS: true, os aniversários voltam a entrar');
