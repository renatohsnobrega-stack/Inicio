const MAX_BATCH = 20;

async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function validPushEndpoint(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || u.hash) return false;
    const host = u.hostname.toLowerCase();
    const allowed = host === 'web.push.apple.com' || host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' || host === 'push.services.mozilla.com' ||
      host === 'notify.windows.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
    if (!allowed) return false;
    for (const key of u.searchParams.keys()) {
      if (/^(user(name)?|pass(word)?|credential|authorization|api[_-]?key)$/i.test(key)) return false;
    }
    return true;
  } catch { return false; }
}

export function createDispatcher({ supabaseUrl, serviceRoleKey, dispatchSecret, sendNotification, fetchImpl = fetch }) {
  const base = supabaseUrl.replace(/\/$/, '');
  async function rpc(name, args) {
    const res = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`rpc ${name} returned ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  return async function handler(request) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
    const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
    if (!match || !dispatchSecret || !await constantTimeEqual(match[1], dispatchSecret)) {
      return new Response('unauthorized', { status: 401 });
    }
    let claimed;
    try { claimed = await rpc('mural_push_claim', { p_limit: MAX_BATCH }); }
    catch { return new Response('dispatcher unavailable', { status: 503 }); }
    const outcomes = await Promise.all((Array.isArray(claimed) ? claimed : []).map(async (job) => {
      const id = job.outbox_id, token = job.lease_token;
      try {
        const rows = await rpc('mural_push_delivery', { p_outbox_id: id, p_lease_token: token });
        if (!Array.isArray(rows) || !rows.length) return 'suppressed';
        const delivery = rows[0];
        if (!validPushEndpoint(delivery.endpoint)) {
          await rpc('mural_push_finish', { p_outbox_id: id, p_lease_token: token, p_result: 'suppressed', p_error: 'endpoint rejected by dispatcher allowlist' });
          return 'suppressed';
        }
        const result = await sendNotification(delivery.endpoint, { p256dh: delivery.p256dh, auth: delivery.auth_key },
          JSON.stringify({ title: 'Novo recado', body: 'Um novo recado está no mural.', url: '/' }),
          { TTL: 3600, timeout: 10000 });
        const statusCode = result?.statusCode ?? result?.status ?? 201;
        if (statusCode === 404 || statusCode === 410) {
          await rpc('mural_push_finish', { p_outbox_id: id, p_lease_token: token, p_result: 'gone', p_error: `webpush ${statusCode}` });
          return 'suppressed';
        } else if (statusCode >= 200 && statusCode < 300) {
          await rpc('mural_push_finish', { p_outbox_id: id, p_lease_token: token, p_result: 'sent' }); return 'sent';
        } else {
          await rpc('mural_push_finish', { p_outbox_id: id, p_lease_token: token, p_result: 'retry', p_error: `webpush ${statusCode}` }); return 'retried';
        }
      } catch (error) {
        // web-push rejeita a Promise em 404/410. Nunca propaga .message, que pode incluir URL/token.
        const code = Number(error?.statusCode);
        const result = code === 404 || code === 410 ? 'gone' : 'retry';
        try {
          await rpc('mural_push_finish', { p_outbox_id: id, p_lease_token: token, p_result: result, p_error: result === 'gone' ? `webpush ${code}` : 'delivery transport failure' });
          return result === 'gone' ? 'suppressed' : 'retried';
        } catch { /* lease expira e outro worker retenta */ }
        return 'retried';
      }
    }));
    const sent = outcomes.filter(x => x === 'sent').length;
    const retried = outcomes.filter(x => x === 'retried').length;
    const suppressed = outcomes.filter(x => x === 'suppressed').length;
    return Response.json({ claimed: Array.isArray(claimed) ? claimed.length : 0, sent, retried, suppressed });
  };
}
