// Configuração do Elinor.
//
// Deixe em branco para usar o MODO LOCAL (dados só neste navegador — bom para testar).
// Preencha com os dados do seu projeto Supabase para o MODO NUVEM (login + sincronização
// entre os celulares). Veja o passo a passo no README.md.
//
// A "anon key" é pública por natureza: quem protege os dados é o login + as regras
// de segurança (RLS) criadas pelo arquivo supabase/schema.sql.
window.APP_CONFIG = {
  // Preencher somente após configurar o backend Web Push (docs/WEB-PUSH.md). Apenas chave PÚBLICA.
  muralPushPublicKey: 'BCLGCs2bm6klLfa2c1uoRbB3ZHftgOMo0oqExUYytz3ERu6xNNy99UF1RVKgPKCoHVcXCMPcwVmWUIvFlkAjLJs',
  supabaseUrl: 'https://qsbrlqxuyjqrpaoalfon.supabase.co',
  // Chave "publishable" (ou a antiga "anon"): pública por natureza.
  supabaseAnonKey: 'sb_publishable_uEvxZgtE833K8fgMkP3TwQ_O3MC6F35',
};
