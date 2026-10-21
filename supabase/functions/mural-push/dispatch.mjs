const MAX_BATCH = 20;
const LOCAL_ZONE = 'America/Sao_Paulo';

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

export function taskTtl(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  const secondsLeft = 3600 - (value.minute * 60 + value.second);
  return Math.max(1, Math.min(3600, secondsLeft));
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

  async function deliver(channel, claimed) {
    const outcomes = await Promise.all((Array.isArray(claimed) ? claimed : []).map(async job => {
      const id = job.outbox_id, token = job.lease_token;
      const name = suffix => `${channel}_${suffix}`;
      const finish = (result, error) => rpc(name('finish'), {
        p_outbox_id: id, p_lease_token: token, p_result: result, ...(error ? { p_error: error } : {}),
      });
      try {
        const rows = await rpc(name('delivery'), { p_outbox_id: id, p_lease_token: token });
        if (!Array.isArray(rows) || !rows.length) return 'suppressed';
        const delivery = rows[0];
        if (!validPushEndpoint(delivery.endpoint)) {
          await finish('suppressed', 'endpoint rejected by dispatcher allowlist');
          return 'suppressed';
        }
        const payload = channel === 'task_push'
          ? { kind: 'task_daily', title: 'Tarefas de hoje', body: 'Você tem tarefas para hoje. Abra o Elinor para conferir.' }
          : { title: 'Novo recado', body: 'Um novo recado está no mural.', url: '/' };
        const options = channel === 'task_push'
          ? { TTL: taskTtl(), timeout: 10000 }
          : { TTL: 3600, timeout: 10000 };
        const result = await sendNotification(delivery.endpoint, { p256dh: delivery.p256dh, auth: delivery.auth_key }, JSON.stringify(payload), options);
        const statusCode = result?.statusCode ?? result?.status ?? 201;
        if (statusCode === 404 || statusCode === 410) {
          await finish('gone', `webpush ${statusCode}`);
          return 'suppressed';
        }
        if (statusCode >= 200 && statusCode < 300) {
          await finish('sent');
          return 'sent';
        }
        await finish('retry', `webpush ${statusCode}`);
        return 'retried';
      } catch (error) {
        // web-push errors can contain endpoint credentials; never return/store the raw message.
        const code = Number(error?.statusCode);
        const result = code === 404 || code === 410 ? 'gone' : 'retry';
        try {
          await finish(result, result === 'gone' ? `webpush ${code}` : 'delivery transport failure');
          return result === 'gone' ? 'suppressed' : 'retried';
        } catch { /* lease expires and another worker retries */ }
        return 'retried';
      }
    }));
    return {
      claimed: Array.isArray(claimed) ? claimed.length : 0,
      sent: outcomes.filter(x => x === 'sent').length,
      retried: outcomes.filter(x => x === 'retried').length,
      suppressed: outcomes.filter(x => x === 'suppressed').length,
    };
  }

  return async function handler(request) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
    const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
    if (!match || !dispatchSecret || !await constantTimeEqual(match[1], dispatchSecret)) {
      return new Response('unauthorized', { status: 401 });
    }

    let muralFailed = false, taskFailed = false;
    const [mural, tasks] = await Promise.all([
      (async () => {
        try { return await deliver('mural_push', await rpc('mural_push_claim', { p_limit: MAX_BATCH })); }
        catch { muralFailed = true; return { claimed: 0, sent: 0, retried: 0, suppressed: 0 }; }
      })(),
      (async () => {
        try {
          await rpc('task_push_prepare_daily', {});
          const claimed = await rpc('task_push_claim', { p_limit: MAX_BATCH });
          return await deliver('task_push', claimed);
        } catch { taskFailed = true; return { claimed: 0, sent: 0, retried: 0, suppressed: 0 }; }
      })(),
    ]);
    const totals = {
      claimed: mural.claimed + tasks.claimed,
      sent: mural.sent + tasks.sent,
      retried: mural.retried + tasks.retried,
      suppressed: mural.suppressed + tasks.suppressed,
    };
    if (muralFailed || taskFailed) return Response.json({ ...totals, ...(muralFailed ? { mural_unavailable: true } : {}), ...(taskFailed ? { task_unavailable: true } : {}) }, { status: 503 });
    return Response.json(totals);
  };
}
