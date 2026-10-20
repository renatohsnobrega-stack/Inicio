import webpush from 'npm:web-push@3.6.7';
import { createDispatcher } from './dispatch.mjs';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MURAL_PUSH_DISPATCH_SECRET',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const env = Object.fromEntries(required.map((key) => [key, Deno.env.get(key) ?? '']));
for (const key of required) {
  if (!env[key]) throw new Error(`Missing required secret/config: ${key}`);
}

webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
const handler = createDispatcher({
  supabaseUrl: env.SUPABASE_URL,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  dispatchSecret: env.MURAL_PUSH_DISPATCH_SECRET,
  sendNotification: async (endpoint: string, keys: { p256dh: string; auth: string }, payload: string,
    options: { TTL: number; timeout: number }) => {
    // web-push@3.6.7 usa https.request e não segue respostas 3xx; endpoint é validado antes do envio.
    const response = await webpush.sendNotification({ endpoint, keys }, payload, options);
    return { statusCode: response.statusCode };
  },
});

Deno.serve(handler);
