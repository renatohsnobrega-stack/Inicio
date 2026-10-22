# Impostos e taxas pessoais em Contas

## O que entra

A seção **Impostos e taxas pessoais** fica dentro de **Contas**, sem aba nova. Inclui IPTU, IPVA, licenciamento, anuidade do CRM pessoa física e IRPF **somente quando houver valor a pagar**, à vista ou parcelado. Não inclui a declaração de IRPF sem pagamento, tributos ou renovações da pessoa jurídica.

Cada registro representa **uma cota única ou uma parcela confirmada**, com nome, ano de referência, vencimento, valor, responsável e status de pagamento. Referência de imóvel/veículo, código de pagamento, observações e links HTTPS da guia/comprovante são opcionais.

## Como cadastrar

1. Em **Contas → Impostos e taxas pessoais**, escolher **+ Imposto ou taxa pessoal**.
2. Informar a obrigação, o ano de referência e os dados da cobrança.
3. Escolher **Cota única** ou **Uma parcela**. Para parcela, informar o número e o total; o valor é o desta parcela, não o total da obrigação.
4. Revisar e salvar. Cada outra parcela precisa ser cadastrada manualmente, somente se confirmada.

Também é possível classificar uma conta existente pelo formulário **Editar**, sem criar outro registro. Para evitar duplicação, conferir as contas já cadastradas antes de inserir uma cobrança. Não há deduplicação automática: repetir um cadastro manual pode criar outra conta.

## Filtros e pagamentos

A seção filtra por **ano de referência**, tipo, responsável e status. O ano de referência é independente do ano de vencimento; a seleção inicial usa o ano atual, com opção **Todos os anos**. O filtro por uma pessoa inclui cobranças de **Ambos**, seguindo a regra de compartilhamento existente. A visão mensal de Contas continua sem esses filtros.

As obrigações entram uma única vez nos totais de Contas e no calendário, pelo mês do vencimento. A seção anual é apenas outra visualização dos mesmos registros, não um segundo lançamento. Os botões **Pagar** e **Desfazer** reutilizam o registro de pagamento atual; não efetuam pagamentos bancários. Antes de alterar o vencimento de uma obrigação paga, é necessário desfazer o pagamento.

Links de guia/comprovante devem usar HTTPS e não podem conter usuário ou senha. Não há upload, armazenamento de arquivos, alteração de permissões ou verificação de acesso ao destino. Usar links com acesso restrito; os metadados continuam compartilhados com os membros da casa pelas permissões existentes.

## Compatibilidade e limites

- Usa o tipo `conta` existente, com metadados opcionais `obrigacao`, `anoReferencia`, `modalidade`, `parcela`, `parcelas`, `referencia`, `guiaUrl` e `comprovanteUrl`.
- Toda obrigação cadastrada pela interface é uma conta `unica`, categoria `Impostos`. Não existe repetição anual, geração em lote nem agendamento de cobranças.
- Contas antigas não são reclassificadas por nome ou categoria. Consultar a seção não grava contas. Editar preserva campos adicionais e o histórico de pagamentos.
- Nenhuma migração, função de servidor, alteração de RLS ou mudança em integrações de importação/API. A validação específica deste MVP atua no formulário; clientes externos devem respeitar o contrato dos metadados e não enviar obrigações mensais.
- Mural e notificações não foram alterados. Não há nova automação ou consulta ao banco real nesta entrega.
- Tributos/renovações da PJ ficam para a sessão da PJ. Manutenção do carro permanece apenas como item futuro.

## Testar sem produção

```bash
node testes/impostos.test.js
python3 testes/impostos-ui.test.py
for f in testes/*.test.js testes/*.test.mjs; do node "$f" || exit 1; done
python3 testes/foco-ui.test.py
npm test --prefix testes/banco
```

Os testes de interface usam servidor localhost, configuração de nuvem vazia, service worker bloqueado e interceptação de chamadas externas. Os dados são fictícios. Os testes de banco usam PGlite local.

**Entrega somente em PR para revisão: não mesclar, publicar ou alterar produção sem autorização explícita.**
