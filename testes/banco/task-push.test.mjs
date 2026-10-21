import { banco, q, erro } from './base.mjs';
import fs from 'node:fs';

const db = await banco(process.argv[2]);
const mural = fs.readFileSync(new URL('../../supabase/migrations/202610200001_mural_push.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/202610210001_task_push.sql', import.meta.url), 'utf8');
await db.exec(`
  create role service_role nologin;
  grant usage on schema public, auth, extensions to service_role;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users values
    ('10000000-0000-0000-0000-000000000001','renato@x.com'),
    ('20000000-0000-0000-0000-000000000002','vanessa@x.com'),
    ('30000000-0000-0000-0000-000000000003','extra@x.com');
`);
await db.exec(mural);
await db.exec(migration);
await db.exec(migration); // remains idempotent
const service = 'set role service_role;';
const renato = `set role authenticated; set request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","email":"renato@x.com"}';`;
const check = (condition, message) => { if (!condition) throw new Error(`✘ ${message}`); console.log(`✔ ${message}`); };
const uidR = '10000000-0000-0000-0000-000000000001';
const uidV = '20000000-0000-0000-0000-000000000002';
const uidX = '30000000-0000-0000-0000-000000000003';
const seedSub = async (uid, endpoint, timestamp = '2026-10-20 00:00:00+00') => (await q(db, '', `
  insert into public.mural_push_subscriptions(user_id,endpoint_hash,endpoint,p256dh,auth_key,created_at,updated_at)
  values ($1,md5($2),$2,'${'a'.repeat(43)}','${'b'.repeat(22)}',$3::timestamptz,$3::timestamptz) returning id`, [uid, endpoint, timestamp]))[0].id;
await db.exec(`insert into public.push_members(user_id,nome) values ('${uidR}','Renato'),('${uidV}','Vanessa'),('${uidX}','Sem membro');`);
const subROld = await seedSub(uidR, 'https://fcm.googleapis.com/fcm/send/task-r-old', '2026-10-20 01:00:00+00');
const subR = await seedSub(uidR, 'https://fcm.googleapis.com/fcm/send/task-r-new', '2026-10-20 02:00:00+00');
const subV = await seedSub(uidV, 'https://fcm.googleapis.com/fcm/send/task-v');

// Pure evaluator: only exact-date incomplete once, plus supported recurrence rules.
const due = async (data, day) => (await q(db, '', `select public._task_push_due($1::jsonb,$2::date) ok`, [JSON.stringify(data), day]))[0].ok;
check(await due({tipo:'unica',data:'2026-10-25',feito:false},'2026-10-25'), 'tarefa única pendente vale apenas na data exata');
check(!await due({tipo:'unica',data:'2026-10-24',feito:false},'2026-10-25'), 'tarefa única atrasada não é prevista para hoje');
check(!await due({tipo:'unica',feito:false},'2026-10-25') && !await due({tipo:'unica',data:'2026-02-30'},'2026-02-28'), 'data ausente ou inválida é ignorada sem abortar lote');
check(!await due({tipo:'unica',data:'2026-10-25',feito:true},'2026-10-25'), 'tarefa única feita não é elegível');
check(await due({tipo:'diaria'},'2026-10-25') && !await due({tipo:'diaria',feitos:{'2026-10-25':true}},'2026-10-25'), 'recorrência diária respeita o marcador de conclusão');
check(await due({tipo:'semanal',dias:[6]},'2026-10-25') && !await due({tipo:'semanal',dias:[0]},'2026-10-25'), 'recorrência semanal usa segunda=0 e domingo=6');
check(!await due({tipo:'semanal',dias:'6'},'2026-10-25') && !await due({tipo:'desconhecida'},'2026-10-25'), 'tipo ou recorrência desconhecidos são ignorados');
check(await due({tipo:'mensal',dia:31},'2027-02-28') && !await due({tipo:'mensal',dia:31,feitos:{'2027-02-28':'sim'}},'2027-02-28'), 'recorrência mensal limita ao último dia e respeita conclusão');
check(await due({tipo:'mensal',dia:0},'2027-02-01') && !await due({tipo:'mensal',dia:'x'},'2027-02-01'), 'recorrência mensal segue dia||1 e rejeita valor inválido');

const fixed = '2026-10-25'; // Sunday; São Paulo is UTC-3 on these dates.
await db.exec(`insert into public.registros(kind,id,data) values
 ('tarefa','fixed-r','{"tipo":"unica","data":"${fixed}","feito":false,"responsavel":"Renato","titulo":"private title"}'),
 ('tarefa','weekly-v','{"tipo":"semanal","dias":[6],"responsavel":"Vanessa"}'),
 ('tarefa','late','{"tipo":"unica","data":"2026-10-24","responsavel":"Renato"}'),
 ('tarefa','future','{"tipo":"unica","data":"2026-10-26","responsavel":"Vanessa"}'),
 ('tarefa','unknown-owner','{"tipo":"diaria","responsavel":"Nao cadastrado"}'),
 ('tarefa','blank-owner','{"tipo":"diaria","responsavel":"  "}'),
 ('tarefa','unknown-type','{"tipo":"oops","data":"${fixed}","responsavel":"Renato"}');`);
const prep = async (hour, date = fixed) => {
  const localMidnight = new Date(`${date}T00:00:00Z`);
  localMidnight.setUTCHours(hour + 3);
  const timestamp = localMidnight.toISOString();
  return (await q(db, '', `select public._task_push_prepare_at($1::timestamptz) n`, [timestamp]))[0].n;
};
check(await prep(7) === 0, 'preparo anterior às 08:00 locais não enfileira');
check(await prep(8) === 2, 'ciclo das 08:00 agrega por conta (não por dispositivo)');
check(await prep(8) === 0, 'repetição dentro do ciclo das 08:00 é idempotente');
let cycle = await q(db, '', `select user_id,subscription_id,scheduled_date::text,cycle_hour from public.task_push_outbox where scheduled_date='${fixed}' and cycle_hour=8 order by user_id`);
check(cycle.length === 2 && cycle[0].subscription_id === subR && cycle[1].subscription_id === subV, 'um endpoint ativo mais recente por conta é escolhido para cada ciclo');
check(await prep(10) === 2, 'ciclo das 10:00 cria novos avisos mesmo para as mesmas tarefas pendentes');
check((await q(db, '', `select count(*)::int n from public.task_push_outbox where user_id='${uidR}' and scheduled_date='${fixed}' and cycle_hour in (8,10)`))[0].n === 2, 'unicidade é por usuário/data/ciclo e não por subscription/data');
await db.exec(`update public.registros set data=data || '{"feito":true}'::jsonb where kind='tarefa' and id='fixed-r';
update public.registros set data=data || '{"feitos":{"${fixed}":true}}'::jsonb where kind='tarefa' and id='weekly-v';`);
check(await prep(12) === 0, 'ciclo das 12:00 não enfileira tarefas concluídas');
await db.exec(`update public.registros set data=jsonb_set(data,'{feito}','false'::jsonb) where kind='tarefa' and id='fixed-r';
update public.registros set data=data - 'feitos' where kind='tarefa' and id='weekly-v';`);
check(await prep(14) === 2, 'reabertura permite um novo aviso no ciclo das 14:00');
check(await prep(16) === 2 && await prep(18) === 2, 'ciclos das 16:00 e 18:00 podem repetir enquanto seguem pendentes');
check(await prep(20) === 2, 'ciclo das 20:00 é o último ciclo local do dia');
check(await prep(21) === 0 && await prep(23) === 0, 'preparo não ocorre às 21:00 nem às 23:00');
check((await q(db, '', `select count(*)::int n from public.task_push_outbox where scheduled_date='${fixed}' and cycle_hour=20`))[0].n === 2, 'ciclo final mantém um único registro por conta');
check((await q(db, '', `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='task_push_outbox' and column_name in ('titulo','task_data','payload')`))[0].n === 0, 'outbox não armazena título, dados ou payload da tarefa');

// Identity is based on verified auth UUID membership and an unambiguous exact display name.
check(!(await q(db, '', `select public._task_push_user_has_due($1,'${fixed}'::date) ok`, [uidX]))[0].ok, 'push_members sem membro de aplicação verificado não habilita proprietário');
await db.exec(`update public.push_members set nome='Renato' where user_id='${uidX}';`);
check(!(await q(db, '', `select public._task_push_user_has_due($1,'${fixed}'::date) ok`, [uidR]))[0].ok, 'nome duplicado/ambíguo não seleciona proprietário');
await db.exec(`delete from public.push_members where user_id='${uidX}';`);
check((await q(db, '', `select public._task_push_user_has_due($1,'${fixed}'::date) ok`, [uidR]))[0].ok, 'nome exato retorna apenas membro Auth verificado');
await db.exec(`insert into public.registros(kind,id,data) values ('tarefa','both-test','{"tipo":"diaria","responsavel":"Ambos"}');`);
check((await q(db, '', `select public._task_push_user_has_due($1,'${fixed}'::date) ok`, [uidR]))[0].ok && (await q(db, '', `select public._task_push_user_has_due($1,'${fixed}'::date) ok`, [uidV]))[0].ok, 'Ambos habilita cada membro push verificado');
await db.exec(`delete from public.registros where kind='tarefa' and id='both-test';`);

// Simulated worker times exercise the exact-hour gate, lease cap, retries and stale-cycle cleanup.
const claimAt = async (timestamp, limit = 20) => q(db, '', `select * from public._task_push_claim_at($1::timestamptz,$2::integer)`, [timestamp, limit]);
const cycle8ts = '2026-10-25 11:59:30+00'; // 08:59:30 local
const claimed8 = await claimAt(cycle8ts);
check(claimed8.length === 2, 'claim só retorna os dois jobs do ciclo atual');
const leaseRows = await q(db, '', `select count(*)::int n from public.task_push_outbox where cycle_hour=8 and scheduled_date='${fixed}' and status='claimed' and lease_until='2026-10-25 12:00:00+00'::timestamptz`);
check(leaseRows[0].n === 2, 'lease de 90s é limitada ao fim da hora local');
const blockedAt9 = await q(db, '', `select * from public._task_push_delivery_at($1::uuid,$2::uuid,'2026-10-25 12:00:00+00'::timestamptz)`, [claimed8[0].outbox_id, claimed8[0].lease_token]);
check(blockedAt9.length === 0, 'delivery no ciclo seguinte rejeita lease do ciclo anterior');
const other8 = claimed8[1];
check((await q(db, '', `select count(*)::int n from public._task_push_delivery_at($1::uuid,$2::uuid,'2026-10-25 11:59:30+00'::timestamptz)`, [other8.outbox_id, other8.lease_token]))[0].n === 1, 'delivery revalida tarefa, proprietário, data e hora exatas');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'retry','temporary failure','2026-10-25 11:59:40+00'::timestamptz)`, [other8.outbox_id, other8.lease_token]);
check((await q(db, '', `select status='dead' and last_error='temporary failure' ok from public.task_push_outbox where id=$1`, [other8.outbox_id]))[0].ok, 'retry cujo backoff atravessaria 09:00 termina sem cruzar o gate');
await db.exec(`update public.task_push_outbox set status='pending',attempts=0,available_at='2026-10-25 11:00:00+00',lease_until=null,lease_token=null,last_error=null where scheduled_date='${fixed}' and cycle_hour=8;`);
const claimed10 = await claimAt('2026-10-25 13:00:00+00');
check(claimed10.length === 2, 'claim às 10:00 libera apenas o novo ciclo das 10:00');
check((await q(db, '', `select count(*)::int n from public.task_push_outbox where scheduled_date='${fixed}' and cycle_hour=8 and status='dead' and last_error='scheduled cycle expired'`))[0].n === 2, 'claim marca como expirados os ciclos anteriores');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'sent',null,'2026-10-25 13:01:00+00'::timestamptz)`, [claimed10[0].outbox_id, claimed10[0].lease_token]);
check((await q(db, '', `select status='sent' and sent_at='2026-10-25 13:01:00+00'::timestamptz ok from public.task_push_outbox where id=$1`, [claimed10[0].outbox_id]))[0].ok, 'finish sent fecha somente o job do ciclo');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'retry','temporary failure','2026-10-25 13:59:40+00'::timestamptz)`, [claimed10[1].outbox_id, claimed10[1].lease_token]);
check((await q(db, '', `select status='dead' ok from public.task_push_outbox where id=$1`, [claimed10[1].outbox_id]))[0].ok, 'backoff não agenda retry fora da janela das 10:00');
check((await claimAt('2026-10-25 12:00:00+00')).length === 0, 'polling às 09:00 não faz delivery nem claim');
const claimed14 = await claimAt('2026-10-25 17:00:00+00');
check(claimed14.length === 2, 'claim às 14:00 abre o ciclo seguinte');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'retry','temporary failure','2026-10-25 17:01:00+00'::timestamptz)`, [claimed14[0].outbox_id, claimed14[0].lease_token]);
check((await q(db, '', `select status='pending' and available_at='2026-10-25 17:01:30+00'::timestamptz ok from public.task_push_outbox where id=$1`, [claimed14[0].outbox_id]))[0].ok, 'retry no mesmo ciclo aplica backoff exponencial de 30 segundos');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'sent',null,'2026-10-25 17:01:00+00'::timestamptz)`, [claimed14[1].outbox_id, claimed14[1].lease_token]);
const expiredDay = (await q(db, '', `insert into public.task_push_outbox(user_id,subscription_id,scheduled_date,cycle_hour) values ($1,$2,'2026-10-24',20) returning id`, [uidR,subR]))[0].id;
check((await claimAt('2026-10-26 15:00:00+00')).length === 0 && (await q(db, '', `select status='dead' ok from public.task_push_outbox where id=$1`, [expiredDay]))[0].ok, 'claim encerra jobs de outro dia mesmo fora da janela de envio');

// UTC timestamps are interpreted as São Paulo local dates/hours, including the midnight boundary.
check((await q(db, '', `select ('2026-10-26 02:59:59+00'::timestamptz at time zone 'America/Sao_Paulo')::date::text as local_day, extract(hour from '2026-10-26 02:59:59+00'::timestamptz at time zone 'America/Sao_Paulo')::int as local_hour`))[0].local_day === fixed, 'timezone local: 02:59:59 UTC ainda é o dia anterior em São Paulo');
check(await prep(23) === 0, 'hora local 23:00 não prepara antes da meia-noite');
await db.exec(`insert into public.registros(kind,id,data) values ('tarefa','next-day','{"tipo":"diaria","responsavel":"Renato"}');`);
check(await prep(8,'2026-10-26') === 2, 'após meia-noite local cria a nova data para pendências diária e única');
check((await q(db, '', `select count(*)::int n from public.task_push_outbox where user_id=$1 and scheduled_date='2026-10-26' and cycle_hour=8`, [uidR]))[0].n === 1, 'data da nova ocorrência é a data local de São Paulo');

// Retry maximum and service-only permissions.
const limitRow = (await q(db, '', `update public.task_push_outbox set attempts=7,status='pending',available_at='2026-10-25 19:00:00+00',lease_until=null,lease_token=null where user_id=$1 and scheduled_date='2026-10-25' and cycle_hour=16 returning id`, [uidR]))[0].id;
await db.exec(`update public.task_push_outbox set status='dead',last_error='fixture reserved for retry limit test' where user_id='${uidV}' and scheduled_date='${fixed}' and cycle_hour=16;`);
const [limitClaim] = await claimAt('2026-10-25 19:00:00+00');
check(limitClaim?.outbox_id === limitRow, 'job com sete tentativas pode receber a oitava lease');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'retry','delivery failed','2026-10-25 19:01:00+00'::timestamptz)`, [limitClaim.outbox_id, limitClaim.lease_token]);
check((await q(db, '', `select status='dead' and attempts=8 ok from public.task_push_outbox where id=$1`, [limitRow]))[0].ok, 'oito tentativas esgotam o limite e encerram o job');

// Mudanças entre preparo e entrega não podem gerar avisos de tarefas já resolvidas.
const completionDay = '2026-11-01';
check(await prep(8, completionDay) === 2, 'novo dia prepara somente as pendências atuais dos dois proprietários');
const completionJobs = await claimAt('2026-11-01 11:00:00+00');
await db.exec(`update public.registros set data=jsonb_set(data,'{feitos}',coalesce(data->'feitos','{}'::jsonb) || '{"${completionDay}":true}'::jsonb)
  where kind='tarefa' and id in ('next-day','weekly-v');`);
for (const job of completionJobs) {
  const rows = await q(db, '', `select * from public._task_push_delivery_at($1::uuid,$2::uuid,'2026-11-01 11:00:30+00'::timestamptz)`, [job.outbox_id, job.lease_token]);
  check(rows.length === 0, 'conclusão após claim suprime a entrega antes de expor o endpoint');
}
check(await prep(10, completionDay) === 0, 'concluir todas as pendências interrompe os próximos ciclos do dia');

const reassignedDay = '2026-11-02';
await db.exec(`update public.registros set data=jsonb_set(data,'{feitos}',coalesce(data->'feitos','{}'::jsonb) || '{"${reassignedDay}":true}'::jsonb) where kind='tarefa' and id='next-day';
  insert into public.registros(kind,id,data) values ('tarefa','reassign-check','{"tipo":"unica","data":"${reassignedDay}","responsavel":"Renato","feito":false}');`);
check(await prep(8, reassignedDay) === 1, 'prepara a tarefa única somente para seu proprietário original');
const [reassignedJob] = await claimAt('2026-11-02 11:00:00+00');
await db.exec(`update public.registros set data=data || '{"responsavel":"Vanessa"}'::jsonb where kind='tarefa' and id='reassign-check';`);
check((await q(db, '', `select * from public._task_push_delivery_at($1::uuid,$2::uuid,'2026-11-02 11:00:30+00'::timestamptz)`, [reassignedJob.outbox_id,reassignedJob.lease_token])).length === 0, 'troca de proprietário após claim impede aviso à conta anterior');
check(await prep(10, reassignedDay) === 1, 'o próximo ciclo seleciona apenas o novo proprietário');
const [goneJob] = await claimAt('2026-11-02 13:00:00+00');
await q(db, '', `select public._task_push_finish_at($1::uuid,$2::uuid,'gone','webpush 410','2026-11-02 13:00:10+00'::timestamptz)`, [goneJob.outbox_id,goneJob.lease_token]);
check((await q(db, '', `select not active and endpoint is null and p256dh is null and auth_key is null as clean from public.mural_push_subscriptions where id=$1`, [subV]))[0].clean, '410 remove endpoint e chaves da inscrição expirada sem alterar as tarefas');

check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select * from public.task_push_outbox`)), 'authenticated não lê outbox');
check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select * from public.mural_push_subscriptions`)), 'authenticated não lê subscriptions compartilhadas');
check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select * from public.task_push_claim(1)`)), 'authenticated não executa claim');
check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select public.task_push_prepare_daily()`)), 'authenticated não executa prepare');
check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select public._task_push_claim_at(now(),1)`)), 'helpers de claim permanecem privados');
check(/permission denied|denied|privilege/i.test(await erro(db, `set role anon;`, `select public.task_push_claim(1)`)), 'anon não executa claim');
check((await q(db, service, `select count(*)::int n from public.task_push_claim(1)`))[0].n === 0, 'service_role mantém permissão RPC sem claim fora da janela');
console.log('Task push DB tests concluídos.');
await db.close();
