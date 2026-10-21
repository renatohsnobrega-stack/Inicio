import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, validPushEndpoint } from '../supabase/functions/mural-push/dispatch.mjs';

const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
const baseJob = { outbox_id: 'job-1', lease_token: 'lease-1' };
function setup({ send = async () => ({ statusCode: 201 }), jobs = [baseJob], delivery = [{ endpoint, p256dh: 'p256dh', auth_key: 'auth' }] } = {}) {
  const calls = [], sends = [];
  const fetchImpl = async (url, init) => {
    const name = url.split('/').pop(), args = JSON.parse(init.body); calls.push({ name, args });
    if (name === 'mural_push_claim') return Response.json(jobs);
    if (name === 'mural_push_delivery') return Response.json(delivery);
    if (name === 'mural_push_finish') return Response.json(null);
    throw new Error(`Unexpected RPC ${name}`);
  };
  const handler = createDispatcher({ supabaseUrl: 'https://db.example', serviceRoleKey: 'service-secret', dispatchSecret: 'dispatch-secret', fetchImpl,
    sendNotification: async (...args) => { sends.push(args); return send(...args); } });
  return { handler, calls, sends };
}
const request = (authorization = 'Bearer dispatch-secret') => new Request('https://edge.example/mural-push', { method: 'POST', headers: { authorization } });

test('accepts only configured providers and safe URL structure', () => {
  for (const value of [endpoint, 'https://web.push.apple.com/a', 'https://updates.push.services.mozilla.com/wpush/v2/a', 'https://notify.windows.com/w/?token=abc']) {
    assert.equal(validPushEndpoint(value), true, value);
  }
  for (const value of ['http://fcm.googleapis.com/send', 'https://evil.example/x', 'https://user:pass@fcm.googleapis.com/send',
    'https://fcm.googleapis.com:8443/send', 'https://fcm.googleapis.com/send?username=x']) assert.equal(validPushEndpoint(value), false, value);
});

test('requires bearer secret and never invokes RPC for unauthorized request', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request('Bearer wrong'))).status, 401);
  assert.equal((await handler(new Request('https://edge.example', { method: 'GET' }))).status, 405);
  assert.equal(calls.length, 0);
});

test('sends generic payload only after database revalidation', async () => {
  const { handler, calls, sends } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: 1, sent: 1, retried: 0, suppressed: 0 });
  assert.deepEqual(calls.map(x => x.name), ['mural_push_claim', 'mural_push_delivery', 'mural_push_finish']);
  const [url, keys, payload, options] = sends[0];
  assert.equal(url, endpoint);
  assert.deepEqual(keys, { p256dh: 'p256dh', auth: 'auth' });
  assert.deepEqual(JSON.parse(payload), { title: 'Novo recado', body: 'Um novo recado está no mural.', url: '/' });
  assert.deepEqual(options, { TTL: 3600, timeout: 10000 });
  assert.equal(calls.at(-1).args.p_result, 'sent');
});

test('maps rejected transient and expired responses to bounded retry / subscription revocation', async () => {
  let transient = setup({ send: async () => { throw Object.assign(new Error('endpoint token must not be stored'), { statusCode: 503 }); } });
  await transient.handler(request());
  assert.equal(transient.calls.at(-1).args.p_result, 'retry');
  let gone = setup({ send: async () => { throw Object.assign(new Error('endpoint token must not be stored'), { statusCode: 410 }); } });
  await gone.handler(request());
  assert.equal(gone.calls.at(-1).args.p_result, 'gone');
  assert.equal(gone.calls.at(-1).args.p_error, 'webpush 410');
});

test('suppresses delivery if membership/subscription revalidation returns empty', async () => {
  const { handler, sends, calls } = setup({ delivery: [] });
  const response = await handler(request());
  assert.equal((await response.json()).suppressed, 1);
  assert.equal(sends.length, 0);
  assert.equal(calls.length, 2); // DB marks claim suppressed/dead on empty delivery result
});
