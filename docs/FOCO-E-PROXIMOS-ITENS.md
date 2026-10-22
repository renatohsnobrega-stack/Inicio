# Foco: Começar, Pausar e Retomar

## MVP desta PR

No **Foco do dia**, no Painel e em Tarefas, cada pendência da própria pessoa oferece **Começar**. Em andamento, oferece **Pausar**: o formulário permite deixar uma nota opcional de próximo passo, com até 500 caracteres. Uma tarefa pausada oferece **Retomar**, com a nota à vista. Cancelar o formulário não pausa a tarefa.

Uma coisa de cada vez: começar ou retomar outra pendência pausa a anterior, sem apagar sua nota. Concluir ou reabrir uma tarefa invalida seu andamento nas duas contas, sem editar a configuração da outra pessoa. O checklist existente continua sendo o único comando de conclusão. Itens de lista que já podem entrar no Foco usam o mesmo fluxo.

Não há cronômetro, pontuação, aba nova ou notificação nova. Mural, regras de notificações, responsáveis, prazos e compartilhamento das tarefas não foram modificados.

## Por conta e compatibilidade

- O andamento é salvo em um registro `config` distinto por `auth.uid()`, usando `foco-execucao:<uid>`. No modo local, usa `local:<pessoa>`.
- Só há controles para o Foco da pessoa identificada na conta atual. Visitar a aba de outra pessoa não exibe seu andamento nem sua nota.
- Uma tarefa de **Ambos** continua compartilhada: cada conta tem seu andamento independente. Concluir a tarefa continua concluindo a pendência compartilhada, como antes.
- Começar, pausar e retomar gravam somente a configuração da conta. Ao usar o checklist, o registro da tarefa/item recebe também um marcador `focoRevisao`, sem mudar prazo ou responsável; ele impede que uma conta recupere andamento antigo após conclusão/reabertura pela outra. Clientes antigos que não geram esse marcador não oferecem essa invalidação extra.
- O andamento acompanha o **dia atual**, tal como o Foco existente. Ao mudar o dia, as novas escolhas começam prontas, sem reaproveitar estado ou nota do dia anterior.
- Recarregar a página no mesmo dia preserva andamento e nota. Na nuvem, usa a sincronização já existente; nenhuma migração ou nova função de servidor é necessária.
- A separação é de estado e de interface, não um novo cofre privado: a RLS existente permite aos membros da casa ler os registros compartilhados, inclusive configurações e backups. Não inserir informações sigilosas nas notas.
- Como no armazenamento existente, edições simultâneas da mesma conta em aparelhos diferentes seguem a última gravação recebida. Não há bloqueio transacional novo.

## Verificação sem produção

Todos os cenários usam dados fictícios. Não é necessário autenticar nem consultar o Supabase de produção.

```bash
node testes/foco.test.js
python3 testes/foco-ui.test.py
for f in testes/*.test.js testes/*.test.mjs; do node "$f" || exit 1; done
npm test --prefix testes/banco
```

O teste visual requer o pacote Python `playwright` e Chromium (instalado no sistema ou via `playwright install chromium`). Ele cria um servidor temporário só em localhost, substitui `config.js` por configuração vazia e bloqueia chamadas externas. O teste do banco usa somente Postgres embutido em memória (PGlite).

## Próximos itens — apenas registrados

### 7. Manutenção do carro

**Proposta inicial: seção “Carro / manutenção” dentro de Tarefas**, sem nova aba nesta etapa. Organizar por veículo, tipo de serviço, data da última manutenção, próximo prazo por data e/ou quilometragem e status. Guardar PDFs e imagens de OBD, comprovantes e revisão anual ligados ao histórico do veículo. Avaliar aba própria somente se o volume justificar.

Antes de implementar: definir armazenamento e permissões dos anexos, limites de tamanho e se cada veículo pertence a uma pessoa ou a Ambos. Nenhum cadastro, upload ou lembrete foi criado nesta PR.

### 8. Impostos e taxas a pagar

**Proposta inicial: seção “Impostos e taxas” dentro de Contas**, com filtros para IPTU, IPVA, CRM e outras taxas. Cada obrigação terá ano de referência, vencimento, valor, cota única ou parcelas, responsável, status e comprovantes/guias. Avaliar aba separada se houver muitas obrigações e necessidade de visão anual própria.

Antes de implementar: modelar recorrência anual e parcelamento sem duplicar contas existentes; manter compartilhamento explícito por responsável/Ambos. Nenhuma conta real, guia, pagamento ou notificação foi criado nesta PR.

## Publicação

Esta entrega é uma PR para revisão. **Não mesclar, publicar, migrar banco ou alterar produção sem autorização explícita de Renato.**
