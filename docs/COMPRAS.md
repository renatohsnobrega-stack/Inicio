# Compras: reutilizar produtos e guardar histórico

## No celular

1. Em **Listas**, use **Escolher produtos**. O catálogo reúne os itens que já estão nessa lista (inclusive os pendentes) e os produtos das compras finalizadas. Selecione sem reescrever. Para criar outra lista, preencha **Nova lista**; vazio adiciona à atual. Produtos que já estão na lista não são duplicados nem desmarcados.
2. No mercado, marque o que comprou. Produtos avulsos continuam entrando pelo campo **Adicionar item**.
3. Toque em **Finalizar compra** ou **Guardar compra**. Confira a data e, se souber, informe loja, total e quantidade/unidade/preço unitário de cada produto. Campos desconhecidos ficam vazios; nunca viram zero por suposição.
4. Ao guardar, só os itens marcados da seleção saem da lista: vão para um registro no histórico e continuam disponíveis no catálogo. Os pendentes ficam onde estão. Cancelar não altera a lista.
5. No histórico, toque em **Anexar nota fiscal**. A foto ou PDF é enviado depois da compra; se falhar, o histórico permanece salvo e você pode tentar o anexo novamente.

**Limpar marcados** foi substituído por guardar a compra. A exclusão individual continua disponível para corrigir itens. Listas com compras registradas não podem ser excluídas pela interface; é possível renomeá-las sem perder o acesso ao histórico.

## O que dá para acompanhar

O histórico mostra data, loja, total informado e os produtos comprados. O filtro mensal (ou **Todo o histórico**) apresenta soma dos totais informados e produtos mais frequentes. Quantidades são agrupadas por produto e unidade: kg e unidades não são somados entre si. Gastos por produto só usam linhas com quantidade e preço unitário disponíveis; descontos e diferenças em relação ao total da nota não são reconciliados automaticamente.

**Compras são reposição, não medição exata do consumo.** O texto livre não é interpretado: “2 L de leite” não vira automaticamente uma quantidade estruturada. Variações de nome sem acento, maiúsculas ou espaços extras são deduplicadas; marcas e descrições diferentes não são adivinhadas como o mesmo produto.

**Exportar JSON** baixa os registros e o resumo do período selecionado, úteis para análises futuras. O backup geral também mantém o ledger. Nenhum desses arquivos inclui as imagens das notas; preservam somente suas referências no Storage. Não existe expurgo automático do histórico.

## Arquivos privados, fora do JSON

O histórico usa o banco já existente (`registros`, tipo `compra`). As notas ficam no bucket privado `notas-compras` do Supabase Storage, sob `familia/<compra>/<uuid>.<ext>`. Só os membros autenticados da casa podem acessá-las; visualizar gera um link temporário de 5 minutos, não um endereço público permanente. Como o app atual, este projeto atende uma única família por banco; não é um desenho multi-inquilino.

O registro guarda apenas caminho, nome, tipo e tamanho do anexo: **nenhuma imagem/base64 dentro da linha do banco ou do localStorage**. Aceita um JPEG, PNG, WebP ou PDF de até **8 MB por compra**, com verificação de assinatura no cliente. HEIC não é aceito neste MVP; escolha JPEG/PNG ou PDF. Não há compressão automática para evitar tornar notas longas ilegíveis.

No modo local, lista, catálogo e histórico funcionam no navegador. Anexos exigem o modo nuvem; não há falsa promessa de sincronização ou de backup de imagens locais. Os arquivos serão a maior parte do armazenamento: seu uso cresce conforme a quantidade e tamanho das notas, separado dos registros de texto. Nenhum Google Drive ou serviço externo novo é conectado.

## Segurança ao guardar

Na nuvem, uma função transacional confirma o histórico e remove apenas os itens da seleção original. Se alguém alterar, desmarcar ou finalizar um deles durante o processo, a operação é recusada sem apagar o restante; atualize a lista e confira novamente. Reenviar a mesma compra é idempotente e não cria duplicata. No modo local, o ledger e a remoção usam uma única gravação confirmada; falta de espaço não é anunciada como sucesso.

Se o anexo falhar após upload, o cliente tenta limpar o objeto apenas quando o servidor confirma que não está associado. Uma falha de rede persistente pode deixar arquivo órfão, a ser revisado administrativamente; nunca se repete upload automaticamente. Uma resposta perdida após associação pode mostrar erro apesar de o anexo ter sido salvo: sincronize o histórico antes de reenviar.

## O que ficou para depois

- Ler a nota automaticamente (OCR/IA), extrair seus itens e conciliar preços/descontos.
- Editar compras já finalizadas, substituir anexos, várias fotos para uma nota e análise automática periódica.
- Estoque doméstico real, previsão de esgotamento, comparação externa de preços e backup das imagens para outro provedor.

Este MVP não cria contas a pagar, tarefas, postagens no Mural ou notificações. Os resumos aparecem apenas na própria tela de compras ou na exportação solicitada.

## Ativação após aprovação do PR

O código não executa alterações de backend sozinho. Depois de aprovação explícita, aplicar `supabase/migrations/202610220001_compras.sql` **antes de publicar o frontend**. A migração usa `schema.sql` existente, cria as funções e o bucket privado com suas políticas. É repetível e não remove dados existentes. Não exige novas credenciais ou outro serviço.

Não aplicar a migração nem publicar esta branch durante a revisão. Sem a migração, finalizar/anexar na nuvem falha explicitamente e mantém os itens; não há fallback destrutivo. O comportamento de login, sincronização, contas e outros módulos permanece o existente.

## Testes sem produção

```bash
node --test testes/compras.test.js
node --test testes/compras-store.test.js
node testes/banco/compras.test.mjs supabase/schema.sql supabase/migrations/202610220001_compras.sql
python3 testes/compras-ui.test.py
```

Os testes usam apenas dados fictícios, Postgres embutido/mocks e navegador local com requisições externas bloqueadas. A validação do Storage usa um esqueleto local das tabelas/políticas do Supabase; não faz upload real em produção. Depois da aprovação e ativação, ainda é necessário um smoke test autenticado do Storage real com um arquivo fictício.
