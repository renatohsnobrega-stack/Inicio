// Testes de dias de uso, doses, estoque e persistência de remédios.
// Rodar: node testes/remedios.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const cache = {};
const ctx = vm.createContext({
  crypto: globalThis.crypto,
  console,
  Store: {
    list: kind => Object.values(cache[kind] || {}),
    get: (kind, id) => cache[kind]?.[id],
  },
});
for (const f of ['util.js', 'schema.js', 'domain.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const U = vm.runInContext('U', ctx);
const Schema = vm.runInContext('Schema', ctx);
const D = vm.runInContext('D', ctx);
const put = (kind, o) => {
  const n = Schema.normalize(kind, o);
  (cache[kind] = cache[kind] || {})[n.id] = n;
  return n;
};
const reset = () => Object.keys(cache).forEach(k => delete cache[k]);
let n = 0;
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const t = (nome, fn) => {
  reset();
  put('config', { id: 'pessoas', nomes: ['Renato', 'Vanessa', 'Antônio'] });
  fn(); n++;
  console.log('ok -', nome);
};

// Datas fixas: 19/10/2026 segunda-feira; 25/10 domingo.
t('normaliza dias numéricos, deduplica e ordena sem perder o índice numérico', () => {
  const m = Schema.normalize('remedio', { id: 'ferro', nome: 'Neutrofer', dias: ['4', 0, '2', '0', 2], horarios: ['19:00'] });
  eq(m.dias, [0, 2, 4]);
  assert.strictEqual(U.medSchedule(m), 'Seg/Qua/Sex · 1× nos dias de uso · 19:00');
  eq(Schema.validate('remedio', m), []);
});

t('rejeita índices inválidos sem convertê-los em esquema diário', () => {
  for (const dias of [[7], [-1], ['x'], ['2.0']]) {
    const m = Schema.normalize('remedio', { id: `inv-${String(dias)}`, nome: 'Inválido', dias, horarios: ['08:00'] });
    assert.ok(Schema.validate('remedio', m).some(e => e.includes('"dias" inválido')), JSON.stringify(m));
    assert.strictEqual(D.medScheduledOn(m, '2026-10-19'), false, JSON.stringify(m));
    assert.ok(U.medSchedule(m).includes('inválidos'), U.medSchedule(m));
  }
  const set = Schema.normalize('remedio', { id: 'mix', nome: 'Misto', dias: [0, 7] });
  assert.ok(Schema.validate('remedio', set).length);
  assert.strictEqual(D.medScheduledOn(set, '2026-10-19'), false); // qualquer índice inválido fecha o cronograma
  assert.ok(U.medSchedule(set).includes('inválidos'));
  put('remedio', { ...set, horarios: ['08:00'] });
  eq(D.dosesOn('2026-10-19'), []); // nem a segunda-feira válida parcial libera uma dose
});

t('importação/resumo mantém dias específicos, legado ausente e [] como diário', () => {
  const rows = Schema.parseImport(JSON.stringify({ remedios: [
    { id: 'ferro', nome: 'Neutrofer', dias: ['0', 2, 4], horarios: ['19:00'] },
    { id: 'antigo', nome: 'Losartana antiga', horarios: ['08:00'] },
    { id: 'vazio', nome: 'Vitamina', dias: [], horarios: ['20:00'] },
    { id: 'ruim', nome: 'Erro', dias: [8], horarios: ['07:00'] },
  ] }));
  eq(rows.map(r => r.erros.length), [0, 0, 0, 1]);
  eq(rows[0].data.dias, [0, 2, 4]);
  assert.ok(Schema.resumo('remedio', rows[0].data).includes('Seg/Qua/Sex'));
  assert.ok(Schema.resumo('remedio', rows[1].data).includes('ao dia'));
  assert.ok(Schema.resumo('remedio', rows[2].data).includes('ao dia'));
  assert.strictEqual(D.medScheduledOn(rows[1].data, '2026-10-25'), true);
  assert.strictEqual(D.medScheduledOn(rows[2].data, '2026-10-25'), true);
});

t('Neutrofer em três dias, inclusive domingo excluído', () => {
  const m = put('remedio', { id: 'ferro', nome: 'Neutrofer', pessoa: 'Vanessa', dias: [0, 2, 4], horarios: ['19:00'] });
  for (const date of ['2026-10-19', '2026-10-21', '2026-10-23']) assert.strictEqual(D.medScheduledOn(m, date), true, date);
  for (const date of ['2026-10-20', '2026-10-22', '2026-10-24', '2026-10-25']) assert.strictEqual(D.medScheduledOn(m, date), false, date);
  eq(D.dosesOn('2026-10-25'), []);
});

t('separa atividade do tratamento e calendário semanal', () => {
  const m = put('remedio', { id: 'curso', nome: 'Antibiótico', dias: [2, 4], horarios: ['08:00'], inicio: '2026-10-21', fim: '2026-10-23' });
  assert.strictEqual(D.medActiveOn(m, '2026-10-20'), false);
  assert.strictEqual(D.medScheduledOn(m, '2026-10-20'), false);
  assert.strictEqual(D.medActiveOn(m, '2026-10-21'), true);
  assert.strictEqual(D.medScheduledOn(m, '2026-10-21'), true);
  assert.strictEqual(D.medScheduledOn(m, '2026-10-22'), false); // ativo, mas não é dia prescrito
  assert.strictEqual(D.medScheduledOn(m, '2026-10-23'), true);  // fim inclusivo
  assert.strictEqual(D.medActiveOn(m, '2026-10-24'), false);
  const suspenso = put('remedio', { id: 'susp', nome: 'Suspenso', dias: [0], ativo: false, horarios: ['09:00'] });
  assert.strictEqual(D.medActiveOn(suspenso, '2026-10-19'), false);
  assert.strictEqual(D.medScheduledOn(suspenso, '2026-10-19'), false);
});

t('chave e histórico de dose são por data, remédio e horário', () => {
  const m = put('remedio', { id: 'ferro', nome: 'Neutrofer', dias: [0, 2, 4], horarios: ['19:00'] });
  const key = D.doseKey('2026-10-21', m.id, '19:00');
  assert.strictEqual(key, '2026-10-21|ferro|19:00');
  put('dose', { id: key, tomado: true });
  const dose = D.dosesOn('2026-10-21')[0];
  assert.strictEqual(dose.key, key);
  assert.strictEqual(dose.tomado, true);
  assert.strictEqual(D.dosesOn('2026-10-23')[0].tomado, false);
  assert.strictEqual(D.dosesOn('2026-10-25').length, 0);
});

t('horários múltiplos geram dose por horário e ordenam cronologicamente', () => {
  put('remedio', { id: 'multi', nome: 'Remédio', dias: [0], horarios: ['20:00', '08:00', '13:30'] });
  eq(D.dosesOn('2026-10-19').map(d => d.hora), ['08:00', '13:30', '20:00']);
  eq(D.dosesOn('2026-10-20'), []);
});

t('não inventa dose para remédio sem horário', () => {
  put('remedio', { id: 'livre', nome: 'Se necessário', dias: [0, 2, 4], horarios: [] });
  eq(D.dosesOn('2026-10-19'), []);
  assert.ok(U.medSchedule(cache.remedio.livre).includes('sem horário fixo'));
});

// Estoque: saldo no começo da data de referência; apenas datas anteriores consomem.
t('estoque semanal desconta só os dias prescritos e prevê o próximo dia sem dose disponível', () => {
  const m = put('remedio', { id: 'sem', nome: 'Ferro', dias: [0, 2, 4], horarios: ['08:00'], estoque: 10, estoque_em: '2026-10-19' });
  const e = D.estoque(m, '2026-10-26'); // 19, 21 e 23 consumiram; segunda 26 ainda não
  assert.strictEqual(e.restante, 7);
  assert.strictEqual(e.porDia, 1);
  assert.strictEqual(e.acaba, '2026-11-11'); // primeira ocorrência após as sete doses cobertas
});

t('previsão em dia sem uso parte do próximo dia prescrito; também considera estoque zero', () => {
  const m = put('remedio', { id: 'sem', nome: 'Ferro', dias: [0, 2, 4], horarios: ['08:00'], estoque: 0, estoque_em: '2026-10-25' });
  const e = D.estoque(m, '2026-10-25'); // domingo: próxima dose seria segunda-feira
  assert.strictEqual(e.porDia, 0);
  assert.strictEqual(e.acaba, '2026-10-26');
  assert.strictEqual(e.dias, 1);
  assert.strictEqual(e.status, 'baixo');
});

t('previsão semanal antes do início começa no primeiro dia elegível', () => {
  const m = put('remedio', { id: 'futuro', nome: 'Ferro futuro', dias: [0, 2, 4], horarios: ['08:00'], estoque: 0, estoque_em: '2026-10-19', inicio: '2026-10-21' });
  const e = D.estoque(m, '2026-10-19');
  assert.strictEqual(e.acaba, '2026-10-21');
  assert.strictEqual(e.dias, 2);
});

t('estoque semanal não prevê uso suspenso, sem horários ou além do fim', () => {
  const susp = put('remedio', { id: 'susp', nome: 'Suspenso', dias: [0, 2], ativo: false, horarios: ['08:00'], estoque: 4, estoque_em: '2026-10-19' });
  const es = D.estoque(susp, '2026-10-26');
  assert.strictEqual(es.restante, 4);
  assert.strictEqual(es.acaba, null);
  const semHora = put('remedio', { id: 'livre', nome: 'Sem horário', dias: [0, 2], horarios: [], estoque: 0, estoque_em: '2026-10-19' });
  assert.strictEqual(D.estoque(semHora, '2026-10-26').acaba, null);
  const fim = put('remedio', { id: 'fim', nome: 'Curso encerrado', dias: [0, 2, 4], horarios: ['08:00'], estoque: 10, estoque_em: '2026-10-19', fim: '2026-10-23' });
  const ef = D.estoque(fim, '2026-10-26');
  assert.strictEqual(ef.restante, 7);
  assert.strictEqual(ef.acaba, null);
  assert.strictEqual(ef.status, 'ok');
});

t('impressão semanal mostra caixas apenas nos dias prescritos', () => {
  put('remedio', { id: 'ferro', nome: 'Neutrofer', pessoa: 'Vanessa', dose: '1 cápsula', dias: [0, 2, 4], horarios: ['19:00'] });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'print.js'), 'utf8'), ctx, { filename: 'print.js' });
  const html = vm.runInContext("Print.render('remedios', { week: '2026-10-19' }).html", ctx);
  assert.strictEqual((html.match(/class="box"/g) || []).length, 3);
  assert.strictEqual((html.match(/class="na"/g) || []).length, 4);
  for (const d of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) assert.ok(html.includes(d));
});

t('formulário preserva os dias e a aba exibe o cronograma mesmo num dia sem dose', () => {
  // Expõe funções apenas nesta cópia em memória; boot/rede/DOM não são iniciados.
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const instrumented = source.replace('  boot();\n})();', `
    globalThis.medUI = { remedios, fieldHtml, readField,
      form: med => {
        const original = openForm;
        let options;
        openForm = value => { options = value; };
        try { medForm(med); } finally { openForm = original; }
        return options;
      }
    };
  })();`);
  assert.notStrictEqual(instrumented, source, 'instrumentação precisa impedir boot');
  vm.runInContext(instrumented, ctx, { filename: 'app.js' });
  const med = put('remedio', { id: 'ferro', nome: 'Neutrofer', dias: [0, 2, 4], horarios: ['19:00'], instrucoes: 'instrução preservada no cadastro' });
  const ui = ctx.medUI;
  const options = ui.form(med);
  const field = options.fields.find(f => f.name === 'dias');
  assert.strictEqual(field.type, 'weekdays');
  const htmlField = ui.fieldHtml(field, options.values.dias);
  eq([...htmlField.matchAll(/value="(\d)"\s+checked/g)].map(m => Number(m[1])), [0, 2, 4]);
  eq(ui.readField({ querySelectorAll: () => [{ value: '0' }, { value: '2' }, { value: '4' }] }, field), [0, 2, 4]);
  const originalPut = ctx.Store.put, originalToday = U.today;
  try {
    ctx.Store.put = (kind, data) => ({ kind, data });
    const saved = options.onSave({ dias: [0, 2, 4], horarios: ['19:00'], estoque: '' });
    eq(saved.data.dias, [0, 2, 4]);
    assert.strictEqual(saved.data.instrucoes, med.instrucoes);
    U.today = () => '2026-10-20'; // terça: sem dose, mas tratamento não está inativo
    const html = ui.remedios();
    assert.ok(html.includes('Neutrofer'));
    assert.ok(html.includes('Seg/Qua/Sex · 1× nos dias de uso · 19:00'));
    assert.ok(!html.includes('card inactive'));
    assert.ok(!html.includes('instrução preservada no cadastro'));
  } finally { ctx.Store.put = originalPut; U.today = originalToday; }
});

// Usa Store real com localStorage fictício; APP_CONFIG vazio impede qualquer inicialização de rede.
function makeStoreEnv(storage) {
  const env = vm.createContext({
    console,
    crypto: globalThis.crypto,
    localStorage: {
      getItem: key => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = String(value); },
    },
    window: { APP_CONFIG: {} },
  });
  for (const f of ['util.js', 'schema.js', 'store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), env, { filename: f });
  }
  return env;
}

(async () => {
  const storage = {};
  const first = makeStoreEnv(storage);
  const Store1 = vm.runInContext('Store', first);
  await Store1.init();
  assert.strictEqual(Store1.mode(), 'local');
  await Store1.put('remedio', { id: 'persistido', nome: 'Neutrofer', dias: ['0', 2, 4], horarios: ['19:00'] });
  assert.ok(storage['casa-organizada:v1']);

  const second = makeStoreEnv(storage);
  const Store2 = vm.runInContext('Store', second);
  await Store2.init();
  const saved = Store2.get('remedio', 'persistido');
  assert.ok(saved);
  eq(saved.dias, [0, 2, 4]);
  eq(saved.horarios, ['19:00']);
  n++;
  console.log('ok - Store local salva e recarrega remédio sem rede');
  console.log(`\n${n} testes passaram.`);
})().catch(err => { console.error(err); process.exitCode = 1; });
