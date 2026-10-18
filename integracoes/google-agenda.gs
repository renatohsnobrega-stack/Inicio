/**
 * Casa Organizada — sincroniza o Google Agenda com o app, sem IA (zero tokens).
 *
 * Como usar (uma vez só, uns 5 minutos):
 *  1. Acesse https://script.google.com → "Novo projeto" e cole este arquivo inteiro.
 *  2. Preencha o CONFIG abaixo (endereço e chaves do app: Automação → API para agentes).
 *  3. No menu de funções, escolha "instalar" e clique em ▶ Executar. Autorize o acesso à sua agenda.
 *     Pronto: a agenda é copiada para o app agora e depois a cada hora.
 *
 * O que faz: copia os eventos dos próximos dias para o app (cada repetição de um evento
 * recorrente vira um compromisso no dia certo). Se um evento for apagado ou mudar de dia
 * na agenda, o app é corrigido na próxima sincronização. Nada é apagado fora do período
 * sincronizado e nenhum compromisso criado no próprio app é alterado.
 */
const CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  ANON_KEY: 'sua chave anon do Supabase',
  CHAVE: 'casa_... (chave criada no app)',
  // 'primary' = sua agenda principal. Para incluir outras (ex.: a da esposa compartilhada
  // com você), adicione o id dela: Configurações da agenda → "Integrar agenda" → ID.
  AGENDAS: ['primary'],
  DIAS: 60,          // quantos dias à frente sincronizar
  PESSOA: 'Ambos',   // quem aparece como responsável no app
};

const PREFIXO = 'gcal-';

function sincronizarAgenda() {
  const tz = Session.getScriptTimeZone();
  const fmt = (d, p) => Utilities.formatDate(d, tz, p);
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio.getTime() + CONFIG.DIAS * 86400000);
  const hoje = fmt(inicio, 'yyyy-MM-dd');
  const ultimoDia = fmt(fim, 'yyyy-MM-dd');

  const registros = [];
  CONFIG.AGENDAS.forEach(idAgenda => {
    const agenda = idAgenda === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(idAgenda);
    if (!agenda) { console.warn('Agenda não encontrada: ' + idAgenda); return; }
    agenda.getEvents(inicio, fim).forEach(ev => {
      const data = fmt(ev.getStartTime(), 'yyyy-MM-dd');
      // Repetições de um mesmo evento têm o mesmo id: o dia entra no id do app.
      const id = PREFIXO + ev.getId().replace(/@.*$/, '').replace(/[^\w-]/g, '').slice(0, 60) + '-' + data;
      registros.push({
        tipo: 'evento',
        id,
        dados: {
          titulo: ev.getTitle() || '(sem título)',
          data,
          hora: ev.isAllDayEvent() ? '' : fmt(ev.getStartTime(), 'HH:mm'),
          local: ev.getLocation() || '',
          obs: (ev.getDescription() || '').replace(/<[^>]+>/g, '').slice(0, 500),
          pessoa: CONFIG.PESSOA,
          repete: 'nao',
          origem: 'google-agenda',
          revisado: true,
        },
      });
    });
  });

  // 1) Grava/atualiza (em lotes de até 500)
  for (let i = 0; i < registros.length; i += 500) {
    chamar('agente_salvar', { registros: registros.slice(i, i + 500) });
  }

  // 2) Remove do app o que saiu da agenda no período sincronizado
  const atuais = new Set(registros.map(r => r.id));
  const noApp = chamar('agente_listar', { tipo: 'evento' }) || [];
  let removidos = 0;
  noApp.forEach(r => {
    const d = (r.dados && r.dados.data) || '';
    if (r.id.indexOf(PREFIXO) === 0 && d >= hoje && d <= ultimoDia && !atuais.has(r.id)) {
      chamar('agente_remover', { tipo: 'evento', id: r.id });
      removidos++;
    }
  });
  console.log('Agenda sincronizada: ' + registros.length + ' compromissos, ' + removidos + ' removidos.');
}

function chamar(funcao, corpo) {
  const resp = UrlFetchApp.fetch(CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + funcao, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: CONFIG.ANON_KEY, Authorization: 'Bearer ' + CONFIG.ANON_KEY },
    payload: JSON.stringify(Object.assign({ chave: CONFIG.CHAVE }, corpo)),
    muteHttpExceptions: true,
  });
  const texto = resp.getContentText();
  if (resp.getResponseCode() >= 300) throw new Error(funcao + ' falhou (' + resp.getResponseCode() + '): ' + texto);
  return texto ? JSON.parse(texto) : null;
}

/** Rode uma vez: sincroniza agora e agenda para rodar sozinho a cada hora. */
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizarAgenda')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarAgenda').timeBased().everyHours(1).create();
  sincronizarAgenda();
}

/** Para parar a sincronização automática. */
function desinstalar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizarAgenda')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
