import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, taskTtl } from '../supabase/functions/mural-push/dispatch.mjs';

const endpoint = 'https://fcm.googleapis.com/fcm/send/device';
const job = { outbox_id: 'task-1', lease_token: 'lease-task-1' };
function fixture({ failRpc, taskJobs = [job], muralJobs = [], status = 201 } = {}) {
  const calls = [], sends = [];
  const fetchImpl = async (url, init) => {
    const name = url.split('/').pop();
    const args = JSON.parse(init.body);
    calls.push({ name, args });
    if (name === failRpc) return new Response('', { status: 503 });
    if (name === 'task_push_prepare_daily' || name.endsWith('_finish')) return Response.json(null);
    if (name === 'task_push_claim') return Response.json(taskJobs);
    if (name === 'mural_push_claim') return Response.json(muralJobs);
    if (name.endsWith('_delivery')) return Response.json([{ endpoint, p256dh: 'public-key', auth_key: 'auth' }]);
    throw new Error(`Unexpected RPC ${name}`);
  };
  const handler = createDispatcher({
    supabaseUrl: 'https://db.example', serviceRoleKey: 'service', dispatchSecret: 'dispatch', fetchImpl,
    sendNotification: async (...args) => { sends.push(args); return { statusCode: status }; },
  });
  return { handler, calls, sends };
}
const request = () => new Request('https://edge.example/mural-push', { method: 'POST', headers: { authorization: 'Bearer dispatch' } });

test('task TTL expires at the next Sao Paulo hour boundary, never beyond the day', () => {
  assert.equal(taskTtl(new Date('2026-10-21T11:59:30Z')), 30); // 08:59:30 local
  assert.equal(taskTtl(new Date('2026-10-22T02:59:59Z')), 1); // 23:59:59 local
  assert.equal(taskTtl(new Date('2026-10-22T23:59:59Z')), 1); // 20:59:59 local
  assert.equal(taskTtl(new Date('2026-10-21T11:00:00Z')), 3600); // 08:00:00 local
});

test('prepares then claims task jobs and sends only fixed task copy with bounded TTL', async () => {
  const { handler, calls, sends } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: 1, sent: 1, retried: 0, suppressed: 0 });
  const names = calls.map(call => call.name);
  assert.ok(names.indexOf('task_push_prepare_daily') < names.indexOf('task_push_claim'));
  const taskSend = sends[0];
  assert.deepEqual(JSON.parse(taskSend[2]), {
    kind: 'task_daily', title: 'Tarefas de hoje',
    body: 'Você tem tarefas para hoje. Abra o Elinor para conferir.',
  });
  assert.ok(taskSend[3].TTL > 0 && taskSend[3].TTL <= 3600);
  assert.equal(taskSend[3].timeout, 10000);
  assert.equal(JSON.stringify(taskSend[2]).includes('task-1'), false);
  assert.equal(calls.find(call => call.name === 'task_push_finish').args.p_result, 'sent');
});

test('task prepare failure returns 503 but still sends independently claimed Mural jobs', async () => {
  const { handler, calls, sends } = fixture({ failRpc: 'task_push_prepare_daily', muralJobs: [{ outbox_id: 'mural-1', lease_token: 'lease-mural' }] });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { claimed: 1, sent: 1, retried: 0, suppressed: 0, task_unavailable: true });
  assert.ok(calls.some(call => call.name === 'mural_push_finish'));
  assert.equal(sends.length, 1);
  assert.equal(JSON.parse(sends[0][2]).title, 'Novo recado');
});

test('Mural claim failure returns 503 but does not block prepared task delivery', async () => {
  const { handler, calls, sends } = fixture({ failRpc: 'mural_push_claim' });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { claimed: 1, sent: 1, retried: 0, suppressed: 0, mural_unavailable: true });
  assert.ok(calls.some(call => call.name === 'task_push_finish'));
  assert.equal(sends.length, 1);
  assert.equal(JSON.parse(sends[0][2]).kind, 'task_daily');
});
