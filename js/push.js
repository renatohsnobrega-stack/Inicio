// Web Push opt-in: nunca pede permissão ao carregar nem usa o autor do recado.
const MuralPush = (() => {
  let registration = null;
  let active = false;
  let busy = false;
  let message = '';
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const base = () => new URL('./', document.baseURI);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function unavailable() {
    if (Store.mode() !== 'cloud' || !Store.user()) return 'Notificações exigem login no modo nuvem.';
    if (ios() && !standalone()) return 'No iPhone, adicione à Tela de Início e abra pelo ícone Elinor antes de ativar (iOS 16.4 ou posterior).';
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'Este navegador não oferece Web Push. Use um navegador compatível em HTTPS.';
    if (!Store.config().muralPushPublicKey) return 'Notificações aguardando configuração do servidor.';
    if (Notification.permission === 'denied') return 'Permissão bloqueada. Libere Casa em Ajustes → Notificações no aparelho e tente novamente.';
    return '';
  }
  function keyBytes(value) {
    const s = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Chave pública Web Push inválida. Avise o administrador.');
    return bytes;
  }
  async function init() {
    if (unavailable()) return;
    try {
      registration = await navigator.serviceWorker.register(new URL('sw.js', base()), { scope: base().pathname });
      registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      active = !!sub && await Store.rpc('push_status', { p_endpoint: sub.endpoint });
    } catch { message = 'Não foi possível verificar as notificações. Tente ativar novamente; o Mural continua funcionando.'; }
    emit();
  }
  async function enable() {
    if (busy) return;
    const reason = unavailable();
    if (reason) throw new Error(reason);
    // Precisa ocorrer antes do primeiro await: gesto direto do usuário no iOS.
    const permission = Notification.requestPermission();
    busy = true; message = ''; emit();
    let sub, created = false;
    try {
      if (await permission !== 'granted') throw new Error('Permissão não concedida. Você pode tentar novamente pelas configurações do aparelho.');
      if (!registration) {
        await navigator.serviceWorker.register(new URL('sw.js', base()), { scope: base().pathname });
        registration = await navigator.serviceWorker.ready;
      }
      sub = await registration.pushManager.getSubscription();
      if (!sub) {
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(Store.config().muralPushPublicKey) });
        created = true;
      }
      await Store.rpc('push_subscribe', { p_subscription: sub.toJSON() });
      active = true;
      message = 'Ativadas neste aparelho para a conta conectada. Apenas novos recados da outra pessoa geram aviso.';
    } catch (e) {
      if (created && sub) await sub.unsubscribe().catch(() => {});
      message = 'Não foi possível ativar: ' + (e.message || e);
      throw e;
    } finally { busy = false; emit(); }
  }
  async function disable() {
    if (busy) throw new Error('Aguarde a operação de notificações terminar.');
    busy = true; emit();
    try {
      // Mesmo com permissão revogada/chave removida, limpar inscrição existente ao sair.
      const reg = registration || (('serviceWorker' in navigator) && await navigator.serviceWorker.getRegistration(base().href));
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await Store.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
        if (!await sub.unsubscribe()) throw new Error('Não foi possível desligar a inscrição no aparelho. Tente novamente.');
      }
      active = false; message = 'Notificações desativadas neste aparelho.';
    } finally { busy = false; emit(); }
  }
  function status() {
    return { active, busy, reason: unavailable(), message };
  }
  return { init, enable, disable, status, subscribe: fn => listeners.add(fn) };
})();
