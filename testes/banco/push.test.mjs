import { banco, q, erro } from './base.mjs';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../supabase/migrations/202610200001_mural_push.sql', import.meta.url), 'utf8');
const db = await banco(process.argv[2]);
await db.exec(`
  create role service_role nologin;
  grant usage on schema public, auth, extensions to service_role;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users values
    ('10000000-0000-0000-0000-000000000001','renato@x.com'),
    ('20000000-0000-0000-0000-000000000002','vanessa@x.com');
`);
await db.exec(migration);
await db.exec(migration); // Reaplicar a migração não recria gatilhos nem perde filas.
const renato = `set role authenticated; set request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","email":"renato@x.com"}';`;
const vanessa = `set role authenticated; set request.jwt.claims = '{"sub":"20000000-0000-0000-0000-000000000002","email":"vanessa@x.com"}';`;
await db.exec(`insert into public.push_members(user_id,nome) values
  ('10000000-0000-0000-0000-000000000001','Renato'),
  ('20000000-0000-0000-0000-000000000002','Vanessa');`);
const endpointR = 'https://fcm.googleapis.com/fcm/send/sub-renato';
const endpointV = 'https://updates.push.services.mozilla.com/wpush/v2/sub-vanessa';
const sub = (endpoint) => JSON.stringify({ endpoint, keys: { p256dh: 'a'.repeat(43), auth: 'b'.repeat(22) } });
const check = (condition, message) => { if (!condition) throw new Error(`✘ ${message}`); console.log(`✔ ${message}`); };

const [{ rsub }] = await q(db, renato, `select public.push_subscribe($1::jsonb) rsub`, [sub(endpointR)]);
const [{ vsub }] = await q(db, vanessa, `select public.push_subscribe($1::jsonb) vsub`, [sub(endpointV)]);
check(rsub && vsub, 'membros registrados podem criar subscriptions com RPC');
check((await q(db, vanessa, `select public.push_status($1) active`, [endpointV]))[0].active === true, 'status só indica subscription própria e ativa');
check((await q(db, renato, `select public.push_status($1) active`, [endpointV]))[0].active === false, 'status não revela endpoint pertencente a outra pessoa');
check(/outro usuário/.test(await erro(db, renato, `select public.push_subscribe($1::jsonb)`, [sub(endpointV)])), 'endpoint global não pode ser transferido para outro uid');
check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select * from public.mural_push_subscriptions`)), 'tabela de subscriptions não tem leitura direta');
check(/não autorizado/.test(await erro(db, `set role authenticated; set request.jwt.claims = '{"email":"renato@x.com"}';`, `select public.push_subscribe($1::jsonb)`, [sub('https://fcm.googleapis.com/fcm/send/no-uid')])), 'auth.uid nulo não registra subscription');
check(/inválida/.test(await erro(db, renato, `select public.push_subscribe($1::jsonb)`, [sub('https://evil.example/steal')])), 'endpoint fora da allowlist é rejeitado');
check(/inválida/.test(await erro(db, renato, `select public.push_subscribe($1::jsonb)`, [sub('https://fcm.googleapis.com:8443/fcm/send/x')])), 'porta não padrão é rejeitada');
check(/inválida/.test(await erro(db, renato, `select public.push_subscribe($1::jsonb)`, [sub('https://user:pass@fcm.googleapis.com/fcm/send/x')])), 'userinfo no endpoint é rejeitado');

// Restaurações/imports fazem INSERT normal, não publicação; conteúdo também tenta falsificar autor.
await q(db, renato, `insert into public.registros(kind,id,data) values ('recado','import-1','{"autor":"Renato","texto":"backup"}')`);
check((await q(db, '', `select count(*)::int n from public.mural_push_outbox`))[0].n === 0, 'INSERT de import/backup não dispara');
// O conteúdo tenta falsificar o autor: sender_id continua vindo exclusivamente de auth.uid().
await q(db, renato, `select public.push_publish_recado('push-1', '{"autor":"Vanessa","texto":"segredo","fixado":true,"curtidas":["Renato"]}'::jsonb)`);
let rows = await q(db, '', `select kind,record_id,sender_id,recipient_id,subscription_id,status from public.mural_push_outbox`);
check(rows.length === 1 && rows[0].sender_id === '10000000-0000-0000-0000-000000000001'
  && rows[0].recipient_id === '20000000-0000-0000-0000-000000000002' && rows[0].subscription_id === vsub,
  'somente o outro uid recebe e data.autor nunca define o remetente/destinatário');
await q(db, renato, `update public.registros set data=data || '{"texto":"editado","fixado":false,"curtidas":["Vanessa"]}'::jsonb where kind='recado' and id='push-1'`);
check((await q(db, '', `select count(*)::int n from public.mural_push_outbox`))[0].n === 1, 'edição, curtida ou fixação não enfileira outra notificação');
await q(db, renato, `delete from public.registros where kind='recado' and id='push-1'`);
await q(db, renato, `select public.push_publish_recado('push-1', '{"autor":"Renato","texto":"reinsert"}'::jsonb)`);
check((await q(db, '', `select count(*)::int n from public.mural_push_outbox`))[0].n === 1, 'reinsert do mesmo kind/id não duplica histórico da subscription');

// Writers sem auth.uid (integrações/chave agente) não são autores autenticados de Web Push.
await db.exec(`set request.jwt.claims = ''; insert into public.registros(kind,id,data) values ('recado','agent-1','{"autor":"Renato","texto":"agent"}');`);
check((await q(db, '', `select count(*)::int n from public.mural_push_outbox`))[0].n === 1, 'INSERT sem auth.uid é ignorado');

// Claim sob service_role; revogar membresía entre claim e envio suprime a entrega.
const service = `set role service_role;`;
const claimed = await q(db, service, `select * from public.mural_push_claim(20)`);
check(claimed.length === 1 && claimed[0].endpoint === endpointV, 'service role reclama job com endpoint do destinatário');
await db.exec(`delete from public.membros where email='vanessa@x.com';`);
const delivery = await q(db, service, `select * from public.mural_push_delivery($1::uuid,$2::uuid)`, [claimed[0].outbox_id, claimed[0].lease_token]);
check(delivery.length === 0, 'membro removido após claim é revalidado e não recebe push');
check((await q(db, '', `select status from public.mural_push_outbox where id=$1`, [claimed[0].outbox_id]))[0].status === 'dead', 'entrega revogada fica suprimida, não em retry');
await db.exec(`insert into public.membros(email) values ('vanessa@x.com');`);
await q(db, renato, `select public.push_publish_recado('push-2', '{"texto":"segundo"}'::jsonb)`);
const claimed2 = await q(db, service, `select * from public.mural_push_claim(20)`);
check(claimed2.length === 1, 'nova publicação cria um segundo job independente');
await db.exec(`delete from public.membros where email='renato@x.com';`);
const senderRevokedDelivery = await q(db, service, `select * from public.mural_push_delivery($1::uuid,$2::uuid)`, [claimed2[0].outbox_id, claimed2[0].lease_token]);
check(senderRevokedDelivery.length === 0, 'remetente que perdeu a membresía após claim também é suprimido');
check(/permission denied|denied|privilege/i.test(await erro(db, renato, `select * from public.mural_push_claim(1)`)), 'RPCs de claim não são acessíveis a authenticated');
await db.exec(`insert into public.membros(email) values ('renato@x.com');`);
await q(db, renato, `select public.push_publish_recado('retry-1', '{"texto":"retry"}'::jsonb)`);
const [retry] = await q(db, service, `select * from public.mural_push_claim(20)`);
check((await q(db, service, `select * from public.mural_push_claim(20)`)).length === 0, 'lease ativo não pode ser reclamado por outro worker');
await q(db, service, `select public.mural_push_finish($1,$2,'sent')`, [retry.outbox_id, '00000000-0000-0000-0000-000000000000']);
check((await q(db, '', `select status from public.mural_push_outbox where id=$1`, [retry.outbox_id]))[0].status === 'claimed', 'lease token incorreto não confirma entrega');
await q(db, service, `select public.mural_push_finish($1,$2,'retry','transport failure')`, [retry.outbox_id, retry.lease_token]);
check((await q(db, '', `select status='pending' and available_at>now() and attempts=1 ok from public.mural_push_outbox where id=$1`, [retry.outbox_id]))[0].ok, 'retry usa backoff e preserva contagem');
await db.query(`update public.mural_push_outbox set available_at=now()-interval '1 second' where id=$1`, [retry.outbox_id]);
const [retryAgain] = await q(db, service, `select * from public.mural_push_claim(20)`);
check(retryAgain.lease_token !== retry.lease_token, 'nova tentativa recebe token diferente');
await q(db, service, `select public.mural_push_finish($1,$2,'gone')`, [retryAgain.outbox_id, retryAgain.lease_token]);
check((await q(db, '', `select not active and endpoint is null and p256dh is null and auth_key is null ok from public.mural_push_subscriptions where id=$1`, [vsub]))[0].ok, '404/410 apaga endpoint e chaves e desativa inscrição');
await q(db, vanessa, `select public.push_subscribe($1::jsonb)`, [sub(endpointV)]);
await q(db, renato, `select public.push_publish_recado('expire-1', '{"texto":"expire"}'::jsonb)`);
await db.exec(`update public.mural_push_outbox set created_at=now()-interval '2 hours' where record_id='expire-1';`);
check((await q(db, service, `select * from public.mural_push_claim(20)`)).length === 0, 'job com mais de uma hora não é enviado');
check((await q(db, '', `select status from public.mural_push_outbox where record_id='expire-1'`))[0].status === 'dead', 'job expirado é encerrado');
await q(db, renato, `select public.push_publish_recado('limit-1', '{"texto":"limit"}'::jsonb)`);
await db.exec(`update public.mural_push_outbox set attempts=8 where record_id='limit-1';`);
check((await q(db, service, `select * from public.mural_push_claim(20)`)).length === 0, 'limite de tentativas impede novo envio');
console.log('Push DB tests concluídos.');
await db.close();
