# Veículos: manutenção, OBD e multas

## Onde ficou e como usar

Abra **Mais → Veículos** no celular, ou **Veículos** no menu lateral do computador. Uma seção própria evita misturar histórico técnico e prazos de defesa com tarefas domésticas e, principalmente, evita tornar esses registros elegíveis aos avisos automáticos das tarefas.

1. Toque em **+ Veículo** e informe um nome reconhecível. Modelo/ano, placa e observações são opcionais. É possível cadastrar vários veículos; o app não presume nenhum dado do carro.
2. Toque em **+ Registro**, selecione o veículo e o tipo: **Manutenção**, **Manutenção anual**, **Diagnóstico OBD** ou **Multa de trânsito**.
3. Informe as datas conhecidas e, se desejar, anexe PDFs ou imagens. Salvar é uma ação explícita; cancelar não grava nada.

## Datas que ajudam a agir

- **Manutenção / anual / OBD:** data do registro, data de realização, quilometragem atual e prazo da próxima manutenção. A modalidade anual é uma classificação: não cria a revisão do próximo ano. Não há cálculo de periodicidade nem alerta por quilometragem.
- **Multas:** data do registro, data da infração, número do auto, vencimento do pagamento, **prazo de defesa** e **prazo de recurso** em campos separados. Datas desconhecidas podem ficar vazias e aparecem como não informadas. Copie as datas da notificação oficial: o app não calcula prazos legais.
- **Pendente / Resolvido:** marcação manual. O app não paga multa, não protocola defesa/recurso e não infere que o caso foi encerrado.

Manutenções/OBD e multas aparecem em grupos distintos. Dentro de cada grupo, pendências ficam antes das resolvidas e são ordenadas pelo menor prazo conhecido, inclusive vencido. Cada prazo é exibido; nas multas, pagamento, defesa e recurso não se substituem. Há filtros por veículo, tipo e status. Para editar ou mudar o veículo vinculado, use **Editar registro**.

Não existe criação automática de veículos, manutenções, tarefas, cobranças ou lembretes. **IPVA e licenciamento continuam em Contas → Impostos e taxas pessoais. Tributos e renovações da PJ não fazem parte desta entrega.**

## PDFs e prints

O app recebe arquivos de verdade, não só links: PDF, PNG, JPEG e WebP, com download posterior. Limites: **até 3 anexos por registro, até 1 MB por arquivo e até 2 MB somados**. A tela confere MIME, tamanho e assinatura inicial do arquivo. SVG/HTML e arquivos incompatíveis são recusados; isso não substitui um antivírus.

Ao editar, desmarque **Manter [arquivo]** para removê-lo quando salvar. Cancelar preserva os anexos anteriores. O download usa um Blob temporário criado a partir dos bytes validados, não uma URL externa arbitrária. Os arquivos não são interpretados nem têm diagnóstico extraído automaticamente.

Neste MVP não havia infraestrutura de upload existente. Para evitar alterar serviços ou implantar um bucket, os anexos pequenos ficam codificados no próprio registro JSON, aproveitando a persistência, o backup e as permissões atuais. Isso aumenta o volume carregado pelo app (base64 adiciona cerca de um terço ao tamanho). No modo local, o limite agregado depende do navegador: uma falha de espaço mostra erro e mantém o formulário aberto e o estado anterior; reduza os anexos para tentar novamente. Uma biblioteca grande de PDFs exigirá uma evolução para armazenamento privado dedicado, não coberta por esta PR.

## Privacidade e compatibilidade

Os novos tipos são `veiculo` e `registro_veiculo`, na mesma tabela `registros`. A RLS existente só permite acesso direto aos membros autenticados e autorizados da casa. Os registros e anexos são **compartilhados entre essas contas**, como Contas, e não um cofre individual. Responsável é organização, não controle de acesso. No modo local, os dados ficam no navegador.

O backup existente inclui veículos e arquivos; guarde-o com cuidado. As chaves de API **Total** existentes também conseguem ler esses registros, conforme o compartilhamento geral já adotado pelo app. Chaves restritas a contas/tarefas não ganham acesso a veículos. A criação/importação por IA/MCP desses novos tipos não foi habilitada neste MVP; cadastro é pela tela e restauração pelo backup existente. Não há nova chave nem alteração do escopo de chaves existentes.

O formulário usa a persistência confirmada para veículos: uma falha de gravação não atualiza o cache como se tivesse salvo. A exclusão de um veículo com registros é bloqueada na tela para preservar o histórico; não há exclusão em cascata. Como no restante do app, edições simultâneas seguem a última gravação. Vínculos e limites de anexos são validações da aplicação, não novas constraints no banco.

Não há migração de banco, nenhuma alteração em registros reais, no Mural ou nas regras de notificações. Os tipos são separados de `tarefa`, portanto não entram no agendamento push existente. Não foram modificados o service worker, as funções de push ou a configuração de produção.

## Verificar sem produção

```bash
node --test testes/veiculos.test.js testes/veiculos-store.test.js
python3 testes/veiculos-ui.test.py
node testes/banco/veiculos.test.mjs supabase/schema.sql
node --test testes/*.test.js testes/*.test.mjs
npm test --prefix testes/banco
python3 testes/foco-ui.test.py
python3 testes/impostos-ui.test.py
```

Os testes de interface usam Chromium/Playwright em localhost, configuração de nuvem vazia, service workers bloqueados e rede externa bloqueada. Usam somente dados fictícios. Os testes de banco usam Postgres embutido em memória, sem acesso ao Supabase real.

**Entrega somente por PR para revisão. Não mesclar nem publicar sem aprovação explícita.**
