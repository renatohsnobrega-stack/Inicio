// Testes de filtragem pessoal no Painel e na aba Remédios, sem DOM, navegador ou rede.
// Rodar: node testes/painel-pessoal.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
function extract(name, next) {
  const start = app.indexOf(`  function ${name}(`);
  const end = app.indexOf(`\n  function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `função ${name} encontrada`);
  return app.slice(start, end);
}

let identidade = 'Vanessa';
let printMealCalls = 0;
let renderCalls = 0;
let lastRemedios = '';
const medicines = [
  { id: 'med-renato', nome: 'Rem Renato', pessoa: 'Renato', horarios: ['08:00'], ativo: true },
  { id: 'med-vanessa', nome: 'Rem Vanessa', pessoa: 'Vanessa', horarios: ['08:00'], ativo: true },
  { id: 'med-ambos', nome: 'Rem Ambos', pessoa: 'Ambos', horarios: ['08:00'], ativo: true },
  { id: 'med-sem-dono', nome: 'Rem Sem Dono', horarios: ['08:00'], ativo: true },
];
const contas = [
  { conta: { id: 'conta-renato', nome: 'Conta Renato', responsavel: 'Renato' }, valor: 10, venc: '2026-10-20' },
  { conta: { id: 'conta-vanessa', nome: 'Conta Vanessa', responsavel: 'Vanessa' }, valor: 20, venc: '2026-10-20' },
  { conta: { id: 'conta-ambos', nome: 'Conta Ambos', responsavel: 'Ambos' }, valor: 30, venc: '2026-10-20' },
  { conta: { id: 'conta-sem-dono', nome: 'Conta Sem Dono' }, valor: 40, venc: '2026-10-20' },
];
const eventos = [
  { date: '2026-10-20', ev: { id: 'ev-renato', titulo: 'Evento Renato', pessoa: 'Renato' } },
  { date: '2026-10-20', ev: { id: 'ev-vanessa', titulo: 'Evento Vanessa', pessoa: 'Vanessa' } },
  { date: '2026-10-20', ev: { id: 'ev-ambos', titulo: 'Evento Ambos', pessoa: 'Ambos' } },
  { date: '2026-10-20', ev: { id: 'ev-sem-dono', titulo: 'Evento Sem Dono' } },
];
const cache = { remedio: medicines };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = {
  eu: () => identidade,
  ehDe: (quem, pessoa) => !pessoa || !quem || quem === pessoa || quem === 'Ambos',
  pessoas: () => ['Renato', 'Vanessa'],
  dosesOn: () => medicines.map((med, i) => ({ med, hora: '08:00', key: `dose-${i}`, tomado: false })),
  contasAtencao: () => contas,
  billStatus: () => 'pendente',
  billOccurrences: () => contas,
  pendencias: () => [],
  focoDe: () => [],
  emFoco: () => false,
  eventsBetween: () => eventos,
  recados: () => [],
  paraRevisar: () => [],
  listas: () => [],
  itensDa: () => [],
  estoqueAcabando: () => medicines.map(med => ({ med, est: { status: 'baixo', restante: 2 } })),
  aniversariosProximos: () => [],
  AVISO_ANIVERSARIO: 7,
  AVISO_ESTOQUE: 7,
  SLOTS: [{ id: 'cafe', nome: 'Café' }, { id: 'almoco', nome: 'Almoço' }],
  meal: (wd, slot, pessoa) => pessoa ? `Refeição <${pessoa}>\nsegunda linha` : '',
  medActiveOn: () => true,
  estoque: () => null,
  ehSuplemento: () => false,
  fmtQtd: n => String(n),
};
const U = {
  today: () => '2026-10-19',
  mondayIndex: () => 0,
  thisMonth: () => '2026-10',
  addDays: (date, days) => new Date(date.getTime() + days * 864e5),
  ymd: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  longDate: () => 'segunda-feira, 19 de outubro',
  MONTHS: Array(12).fill('Outubro'),
  medSchedule: () => '08:00',
  fmtDate: () => '19/10/2026',
};
const ctx = vm.createContext({
  assert, console, D, U, esc,
  ehDe: (quem, pessoa) => D.ehDe(quem, pessoa),
  nl2br: text => esc(text).replace(/\n/g, '<br>'),
  brl: n => `R$ ${n}`,
  state: { remPessoa: null, tarPessoa: null, aliPessoa: null },
  Store: { list: kind => Object.values(cache[kind] || {}), get: () => null },
  Print: { mealLines: () => { printMealCalls++; return '<span>cardápio da família</span>'; } },
  pageHead: () => '', printBtn: () => '',
  panel: (title, body) => `<section><h2>${title}</h2>${body}</section>`,
  btn: (label, action, attrs = '') => `<button data-action="${action}" ${attrs}>${label}</button>`,
  emptyMsg: text => `<p>${text}</p>`,
  semEmoji: text => text,
  eventLine: ({ ev }) => `<div>evento: ${esc(ev.titulo)}</div>`,
  ico: () => '',
  doseRow: d => `<div>${esc(d.med.nome)}</div>`,
  itemRow: i => `<div>${esc(i.texto)}</div>`,
  estoqueRow: x => `<div>estoque: ${esc(x.med.nome)}</div>`,
  aniverRow: () => '',
  billRow: o => `<div>conta: ${esc(o.conta.nome)} · ${esc(o.conta.responsavel || '')}</div>`,
  progresso: () => '', pendRow: () => '',
  medIco: () => '💊', estoqueTxt: () => '',
  pessoaTabs: (action, selected, first, count, people = D.pessoas()) => `<div>${[['', first], ...people.map(p => [p, p])].map(([value, label]) =>
    `<button class="tab ${value === selected ? 'active' : ''}" data-action="${action}" data-pessoa="${esc(value)}">${esc(label)}${count ? count(value) : ''}</button>`).join('')}</div>`,
  render: () => { renderCalls++; lastRemedios = vm.runInContext('remedios()', ctx); },
  location: { hash: '' },
});
vm.runInContext(extract('painel', 'contas'), ctx);
vm.runInContext(extract('remedios', 'alimentacao'), ctx);

function checkPersonalPanel(persona, visible, hidden) {
  identidade = persona;
  printMealCalls = 0;
  const html = vm.runInContext('painel()', ctx);
  for (const name of visible) assert.ok(html.includes(name), `${persona} deveria ver ${name}`);
  for (const name of hidden) assert.ok(!html.includes(name), `${persona} não deveria ver ${name}`);
  assert.ok(html.includes(`Refeição &lt;${persona}&gt;<br>segunda linha`), 'cardápio pessoal escapa HTML e converte quebras de linha');
  assert.strictEqual(printMealCalls, 0, 'o cardápio pessoal não usa Print.mealLines');
}

checkPersonalPanel('Vanessa', [
  'Rem Vanessa', 'Rem Ambos', 'Rem Sem Dono',
  'estoque: Rem Vanessa', 'estoque: Rem Ambos', 'estoque: Rem Sem Dono',
  'Conta Vanessa', 'Conta Ambos', 'Conta Sem Dono',
  'Evento Vanessa', 'Evento Ambos', 'Evento Sem Dono',
], [
  'Rem Renato', 'estoque: Rem Renato', 'Conta Renato', 'Evento Renato',
]);
checkPersonalPanel('Renato', [
  'Rem Renato', 'Rem Ambos', 'Rem Sem Dono',
  'estoque: Rem Renato', 'estoque: Rem Ambos', 'estoque: Rem Sem Dono',
  'Conta Renato', 'Conta Ambos', 'Conta Sem Dono',
  'Evento Renato', 'Evento Ambos', 'Evento Sem Dono',
], [
  'Rem Vanessa', 'estoque: Rem Vanessa', 'Conta Vanessa', 'Evento Vanessa',
]);

identidade = '';
printMealCalls = 0;
const familyPanel = vm.runInContext('painel()', ctx);
assert.ok(familyPanel.includes('cardápio da família'));
assert.ok(printMealCalls > 0, 'sem identidade, o painel mantém Print.mealLines para a família');

// Inicialização da aba escolhe a pessoa logada; a aba Todos continua sendo uma escolha manual.
identidade = 'Vanessa';
ctx.state.remPessoa = null;
let medsHtml = vm.runInContext('remedios()', ctx);
assert.strictEqual(ctx.state.remPessoa, 'Vanessa');
assert.ok(medsHtml.includes('data-action="pick-rem-pessoa" data-pessoa=""'), 'há uma aba Todos navegável');
assert.ok(medsHtml.includes('Rem Vanessa'));
assert.ok(!medsHtml.includes('Rem Renato'));
const entryStart = app.indexOf("'pick-rem-pessoa':");
const entryEnd = app.indexOf(',\n', entryStart);
assert.ok(entryStart >= 0 && entryEnd > entryStart, 'handler de navegação Todos encontrado');
const pickRem = vm.runInContext(`({${app.slice(entryStart, entryEnd)}})['pick-rem-pessoa']`, ctx);
const beforeRender = renderCalls;
pickRem({ dataset: { pessoa: '' } });
assert.strictEqual(ctx.state.remPessoa, '', 'a seleção manual Todos persiste como vazio, sem reinicializar na pessoa atual');
assert.strictEqual(renderCalls, beforeRender + 1);
assert.ok(lastRemedios.includes('Rem Vanessa') && lastRemedios.includes('Rem Renato'), 'Todos mostra remédios de ambas as pessoas');
console.log('ok - filtros pessoais do Painel para Vanessa e Renato, compartilhados e sem dono');
console.log('ok - cardápio pessoal escapado, fallback da família e navegação manual Todos');
