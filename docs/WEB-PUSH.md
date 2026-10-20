# Notificações de novos recados

**Implementação para revisão. Não está ativa só por mesclar o código.** A configuração pública vem vazia para preservar o funcionamento atual até a preparação do servidor. Não executar a migração ou configurar secrets em produção sem aprovação específica.

## O que muda

No Mural, cada aparelho terá **Ativar notificações** e **Desativar neste aparelho**. A permissão só é solicitada por um toque; nunca ao abrir o site. O aviso diz apenas “Há um novo recado no Mural”, sem texto do recado nem nome do autor na tela bloqueada. Tocá-lo abre `#/mural` dentro do caminho do app (inclusive `/Inicio/`). O service worker não faz cache de dados privados nem intercepta requisições.

Só a publicação explícita de um recado novo pelo app gera uma fila transacional. Curtidas, fixações, edições, exclusões, importações e restauração de backups não geram avisos. Gravações pela chave de agente também não notificam: uma chave compartilhada não identifica com segurança qual das duas pessoas publicou. Recados já existentes não são reenviados.

A identidade vem da sessão Supabase (`auth.uid()`), não do campo selecionável **De**, do nome do aparelho ou de `data.autor`. Cada pessoa precisa usar sua própria conta. Uma lista administrativa de UUIDs autentica os dois participantes do push; inscrições pertencem à conta conectada. Uma pessoa não pode ler/remover inscrições da outra ou transferir para si um endpoint já cadastrado. Todos os aparelhos inscritos do outro participante podem receber; nenhum aparelho da conta que publicou recebe.

## Ativar em cada iPhone — depois da implantação aprovada

1. Use **iOS 16.4 ou posterior**. No Safari, abra <https://renatohsnobrega-stack.github.io/Inicio/>.
2. Toque **Compartilhar → Adicionar à Tela de Início**. Abra o app pelo ícone **Casa**, não pela aba do Safari.
3. Entre com **sua própria conta**: Renato no aparelho de Renato, Vanessa no de Vanessa.
4. Abra **Mural → Ativar notificações → Permitir**. Repita no outro iPhone.

Se já está instalado, abra pelo ícone e siga a partir do passo 3. Se a permissão foi negada, libere Casa em **Ajustes → Notificações** no iPhone e tente novamente. Modo Foco, conexão e ajustes do sistema podem atrasar ou silenciar avisos. Não exige inscrição no Apple Developer Program. [Requisitos oficiais do WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

**Sair** remove a inscrição deste aparelho antes de encerrar a sessão. Se essa remoção falhar, o app pede nova tentativa em vez de fingir que saiu. Desativar em um aparelho não desativa os demais. Se reinstalar o app ou o sistema perder a inscrição, toque novamente em Ativar; não há reinscrição automática sem consentimento. Inscrições expiradas são removidas quando o provedor responde 404/410.

## Preparação técnica — exige aprovação antes de produção

Não há necessidade de escolher um provedor adicional: usamos Web Push padrão, Supabase e chaves VAPID. O caminho recomendado é validar primeiro em um projeto Supabase de desenvolvimento com duas contas fictícias.

1. **Aplicar somente** `supabase/migrations/202610200001_mural_push.sql`, após o schema existente. A migração cria tabelas, RLS, RPCs e um trigger de inserção isolados; não altera registros da casa, chaves de agente ou policies existentes. Não executar novamente o bootstrap `schema.sql` em produção como parte desta implantação.
2. **Vincular os UUIDs de Auth** de Renato e Vanessa à tabela `push_members`, via administração confiável. Confirmar que ambos continuam presentes em `membros` e usam logins separados. Não inferir os UUIDs a partir da assinatura dos recados. Ver o exemplo SQL abaixo.
3. **Gerar um par VAPID uma única vez** em ambiente confiável (`npx --yes web-push@3.6.7 generate-vapid-keys`). Guardar a chave privada apenas no servidor. Configurar os secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (contato real `mailto:`) e `MURAL_PUSH_DISPATCH_SECRET` (token aleatório forte, por exemplo `openssl rand -hex 32`) na Edge Function. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são variáveis de servidor fornecidas pelo Supabase. Nunca colocar service role, chave privada ou token do dispatcher em `config.js`, Git, localStorage ou no navegador.
4. **Implantar a Edge Function** `mural-push` com `--no-verify-jwt`: a função usa seu próprio Bearer secret e não aceita chamadas com a chave pública do app. Agendar uma chamada de servidor por minuto com esse Bearer secret, armazenado em cofre de segredos. Não usar cron do navegador nem token na URL. Veja o contrato abaixo. Isso cria uma nova rotina de produção e exige aprovação explícita antes de configurar.
5. **Só depois de validar o backend**, colocar exclusivamente a chave VAPID pública em `config.js → muralPushPublicKey`. Revisar/mesclar a PR e publicar o frontend apenas com autorização. A chave vazia mantém o Mural antigo funcionando, sem pedir permissões ou gerar push.
6. Cada pessoa executa os passos no próprio iPhone. Não cadastrar inscrições de terceiros nem enviar recados de teste reais. Um teste fim a fim em celulares reais deve ser combinado separadamente; os testes deste projeto são locais/mocados.

A aprovação técnica deve contemplar: criação das tabelas e funções, trigger, vínculo dos dois UUIDs, armazenamento dos novos secrets, implantação da função, criação do agendamento e posterior publicação do frontend. **Nenhuma dessas ações foi executada em produção durante esta implementação.**

### Vincular as contas (administração; substituir UUIDs reais)

```sql
-- Executar apenas após aprovação, verificando os UUIDs em Authentication → Users.
insert into public.push_members (user_id, nome) values
  ('UUID_AUTH_RENATO'::uuid, 'Renato'),
  ('UUID_AUTH_VANESSA'::uuid, 'Vanessa');
```

### Contrato do agendamento

A cada minuto, um agendador de servidor deve fazer `POST` em
`https://SEU-PROJETO.supabase.co/functions/v1/mural-push`, sem payload de recado, com:

```text
Authorization: Bearer <MURAL_PUSH_DISPATCH_SECRET do cofre>
Content-Type: application/json
```

Pode ser o Cron do próprio Supabase com chamada HTTP e o token guardado no Vault. Ao aprovar a implantação, criar o job e o secret no Vault usando administração autenticada; não colocar credenciais em SQL versionado. O dispatcher busca sua própria fila e não aceita destinatário, endpoint ou texto fornecido pelo chamador. Não depende de Database Webhook público.

## Limites e manutenção

A fila tem lease, tentativas limitadas, backoff e expiração. A entrega é **best effort**, não um comprovante de leitura. Falhas transitórias e timeouts podem produzir duplicatas; a tag fixa do service worker agrupa os avisos. Nenhuma aplicação Web Push pode garantir entrega exatamente uma vez ou imediata. O celular pode estar sem rede ou com Foco ativado. O polling acrescenta até cerca de um minuto ao processamento normal.

Endpoints e chaves de inscrição são dados sensíveis e só ficam nas tabelas protegidas; não devem aparecer em logs. O worker deve revalidar a participação antes do envio, rejeitar endpoints fora dos provedores autorizados e remover inscrições expiradas. Remover um usuário da lista administrativa interrompe entregas futuras no próximo processamento; envios já em trânsito não podem ser recolhidos.

Antes de trocar chaves VAPID, planejar reativação das inscrições em cada aparelho. Não apagar histórico de idempotência da fila sem avaliar a possibilidade de reenviar um recado removido e reinserido.

## Testes sem produção

```sh
for f in testes/*.test.js; do node "$f" || exit 1; done
cd testes/banco
npm ci --ignore-scripts
npm test
cd ../..
node --test testes/mural-dispatch.test.mjs
```

Os testes usam VMs, mocks e Postgres embutido (PGlite). Não acessam o Supabase publicado nem enviam push real. O roteiro técnico final e o resultado dos testes ficam também na descrição da PR.
