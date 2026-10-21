# Notificações do Mural e das tarefas

**Backend ativado com aprovação do responsável.** Migração isolada aplicada; contas Auth de Renato e Vanessa vinculadas; VAPID e segredo de despacho guardados no Supabase; Edge Function `mural-push` ativa; cron por minuto com Vault. O frontend contém somente a chave VAPID pública. Cada pessoa ainda precisa consentir no próprio aparelho. Não foram enviados recados nem pushes de teste.

## O que muda

No Mural, cada aparelho terá **Ativar notificações** e **Desativar neste aparelho**. A permissão só é solicitada por um toque; nunca ao abrir o site. O aviso diz apenas “Há um novo recado no Mural”, sem texto do recado nem nome do autor na tela bloqueada. Tocá-lo abre `#/mural` dentro do caminho do app (inclusive `/Inicio/`). O service worker não faz cache de dados privados nem intercepta requisições.

Só a publicação explícita de um recado novo pelo app gera uma fila transacional. Curtidas, fixações, edições, exclusões, importações e restauração de backups não geram avisos. Gravações pela chave de agente também não notificam: uma chave compartilhada não identifica com segurança qual das duas pessoas publicou. Recados já existentes não são reenviados.

A identidade vem da sessão Supabase (`auth.uid()`), não do campo selecionável **De**, do nome do aparelho ou de `data.autor`. Cada pessoa precisa usar sua própria conta. Uma lista administrativa de UUIDs autentica os dois participantes do push; inscrições pertencem à conta conectada. Uma pessoa não pode ler/remover inscrições da outra ou transferir para si um endpoint já cadastrado. Todos os aparelhos inscritos do outro participante podem receber; nenhum aparelho da conta que publicou recebe.

## Tarefas do dia: somente para o proprietário

**Um aviso agrupado por conta em cada ciclo: 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 e 20:00 em `America/Sao_Paulo` (Porto Alegre).** Repete somente no dia previsto e enquanto houver pelo menos uma tarefa pendente daquele proprietário. O aviso é genérico, sem títulos, nomes ou detalhes: “Você tem tarefas para hoje”. Ao tocar, abre **Tarefas**, não o Mural. Nenhum recado ou resumo é criado automaticamente.

Entram tarefas únicas com data de hoje ainda não concluídas e rotinas diárias, semanais ou mensais que se aplicam ao dia e não foram concluídas nessa data. Semanal usa segunda = 0; mensal no dia 31 cai no último dia de meses menores, como na interface. Não entram tarefas atrasadas, futuras, únicas sem data ou com dados de recorrência inválidos.

O campo **Quem/responsável** determina o proprietário, mas só é vinculado a uma conta quando corresponde exatamente a um nome único da lista administrativa `push_members`, com UUID Auth válido e acesso à casa ainda vigente. Não usa o nome selecionado no aparelho para autenticar ninguém. **Ambos** é responsabilidade compartilhada e pode avisar os dois. Nome vazio, desconhecido ou ambíguo não gera aviso; renomear uma pessoa exige atualizar o vínculo administrativo, nunca inferir sua identidade pela posição na lista.

As inscrições existentes valem para Mural e tarefas, sem trocar VAPID nem pedir consentimento ao carregar. **Ativar notificações** também aparece em Tarefas. Desativar no aparelho desliga os dois tipos nesse aparelho. Para evitar avisos duplicados à mesma conta no mesmo ciclo, as tarefas usam apenas o aparelho ativo mais recentemente inscrito/revalidado no momento do preparo; o Mural mantém seu comportamento anterior em todos os aparelhos inscritos. Ativar notificações após um ciclo pode permitir o próximo ciclo elegível, nunca uma enxurrada de horários passados.

A fila é separada (`task_push_outbox`) e usa RPCs `task_push_prepare_daily`, `task_push_claim`, `task_push_delivery` e `task_push_finish`, acessíveis somente pelo servidor. A preparação usa o relógio do banco, não uma data enviada pelo navegador. A cada ciclo e imediatamente antes de entregar, reconsulta tarefas e revalida conta, proprietário, data, pendências e inscrição. Conclusões, exclusões ou troca de responsável podem suprimir um aviso ainda não enviado; sem pendências, não há aviso. A chave única é conta/data/hora do ciclo, não uma linha por tarefa.

O cron verifica a cada minuto. A janela de processamento e retentativa de cada ciclo termina ao acabar a hora indicada (08h termina às 09h; o último ciclo, 20h, termina às 21h). Fora dessas janelas, não há entrega nem recuperação de ciclos passados; o próximo ciclo reavalia a situação atual. O TTL do push é limitado ao restante da janela, sem avançar para a madrugada ou para o dia seguinte. A programação evita duplicações por conta/ciclo, mas a entrega de rede continua sendo best effort e não garante exatamente uma notificação em caso de falhas de transporte.

Para implantar a extensão em um backend já preparado, aplicar **somente** `supabase/migrations/202610210001_task_push.sql` e atualizar a Edge Function existente antes de publicar o frontend. Não é necessário recriar o job por minuto, chaves, inscrições, membros ou dados da casa. Os testes de banco usam contas fictícias e não enviam notificações reais.

## Ativar em cada iPhone — depois da implantação aprovada

1. Use **iOS 16.4 ou posterior**. No Safari, abra <https://renatohsnobrega-stack.github.io/Inicio/>.
2. Toque **Compartilhar → Adicionar à Tela de Início**. Abra o app pelo ícone **Elinor**, não pela aba do Safari.
3. Entre com **sua própria conta**: Renato no aparelho de Renato, Vanessa no de Vanessa.
4. Abra **Tarefas ou Mural → Ativar notificações → Permitir**. Repita no outro iPhone, se ainda não estiver ativado.

Se já está instalado, abra pelo ícone e siga a partir do passo 3. Se a permissão foi negada, libere Elinor em **Ajustes → Notificações** no iPhone e tente novamente. Modo Foco, conexão e ajustes do sistema podem atrasar ou silenciar avisos. Não exige inscrição no Apple Developer Program. [Requisitos oficiais do WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

**Sair** remove a inscrição deste aparelho antes de encerrar a sessão. Se essa remoção falhar, o app pede nova tentativa em vez de fingir que saiu. Desativar em um aparelho não desativa os demais. Se reinstalar o app ou o sistema perder a inscrição, toque novamente em Ativar; não há reinscrição automática sem consentimento. Inscrições expiradas são removidas quando o provedor responde 404/410.

## Preparação técnica — exige aprovação antes de produção

Não há necessidade de escolher um provedor adicional: usamos Web Push padrão, Supabase e chaves VAPID. O caminho recomendado é validar primeiro em um projeto Supabase de desenvolvimento com duas contas fictícias.

1. **Aplicar somente** `supabase/migrations/202610200001_mural_push.sql`, após o schema existente. A migração cria tabelas, RLS, RPCs e um trigger de inserção isolados; não altera registros da casa, chaves de agente ou policies existentes. Não executar novamente o bootstrap `schema.sql` em produção como parte desta implantação.
2. **Vincular os UUIDs de Auth** de Renato e Vanessa à tabela `push_members`, via administração confiável. Confirmar que ambos continuam presentes em `membros` e usam logins separados. Não inferir os UUIDs a partir da assinatura dos recados. Ver o exemplo SQL abaixo.
3. **Gerar um par VAPID uma única vez** em ambiente confiável (`npx --yes web-push@3.6.7 generate-vapid-keys`). Guardar a chave privada apenas no servidor. Configurar os secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (contato real `mailto:`) e `MURAL_PUSH_DISPATCH_SECRET` (token aleatório forte, por exemplo `openssl rand -hex 32`) na Edge Function. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são variáveis de servidor fornecidas pelo Supabase. Nunca colocar service role, chave privada ou token do dispatcher em `config.js`, Git, localStorage ou no navegador.
4. **Implantar a Edge Function** `mural-push` com `--no-verify-jwt`: a função usa seu próprio Bearer secret e não aceita chamadas com a chave pública do app. Agendar uma chamada de servidor por minuto com esse Bearer secret, armazenado em cofre de segredos. Não usar cron do navegador nem token na URL. Veja o contrato abaixo. Isso cria uma nova rotina de produção e exige aprovação explícita antes de configurar.
5. **Só depois de validar o backend**, colocar exclusivamente a chave VAPID pública em `config.js → muralPushPublicKey`. Revisar/mesclar a PR e publicar o frontend apenas com autorização. A chave vazia mantém o Mural antigo funcionando, sem pedir permissões ou gerar push.
6. Cada pessoa executa os passos no próprio iPhone. Não cadastrar inscrições de terceiros nem enviar recados de teste reais. Um teste fim a fim em celulares reais deve ser combinado separadamente; os testes deste projeto são locais/mocados.

A aprovação técnica deve contemplar: criação das tabelas e funções, trigger, vínculo dos dois UUIDs, armazenamento dos novos secrets, implantação da função, criação do agendamento e posterior publicação do frontend. **A implantação foi autorizada e executada; novas alterações de produção ou testes reais continuam exigindo autorização própria.**

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

A implantação usa o Cron do próprio Supabase com a extensão HTTP síncrona e o segredo guardado no Vault. O script administrativo reproduzível é `supabase/ops/mural-push-schedule.sql`; contém somente o nome do secret, nunca seu valor. O job `mural-push-every-minute` chama uma função sem parâmetros, sem permissão para `anon`, `authenticated` ou `service_role`. O HTTP tem limite de conexão de 5 s e total de 55 s. Não usa `pg_net`, evitando persistir headers de autorização em sua fila interna. O dispatcher busca sua própria fila e não aceita destinatário, endpoint ou texto fornecido pelo chamador. Não depende de Database Webhook público.

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
node --test testes/*dispatch*.test.mjs
```

Os testes usam VMs, mocks e Postgres embutido (PGlite). Não acessam o Supabase publicado nem enviam push real. O roteiro técnico final e o resultado dos testes ficam também na descrição da PR.
