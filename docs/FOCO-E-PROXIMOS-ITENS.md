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

## Próximos itens e seus MVPs

### 7. Manutenção do carro

**MVP em seção própria “Veículos” (Mais → Veículos no celular)**, entregue por PR para revisão. A proposta inicial de usar Tarefas foi substituída por uma tela própria para manter histórico, anexos e prazos de multas distinguíveis e, principalmente, não tornar esses registros elegíveis às notificações automáticas de tarefas existentes.

Inclui vários veículos, registros manuais de manutenção, manutenção anual e OBD, data de realização, próximo prazo por data, quilometragem registrada e PDFs/imagens. Multas têm registro, vencimento, prazo de defesa e prazo de recurso próprios. Sem cálculo de manutenção por quilometragem, geração de revisões anuais ou lembretes. Os anexos pequenos compartilham a persistência e permissões da casa. Veja [como usar, limites e testes](VEICULOS.md). Nenhum veículo ou manutenção real foi criado; nenhum backend foi migrado ou publicado.

### 8. Impostos e taxas a pagar

**Proposta inicial: seção “Impostos e taxas” dentro de Contas**, com filtros para IPTU, IPVA, CRM e outras taxas. Cada obrigação terá ano de referência, vencimento, valor, cota única ou parcelas, responsável, status e comprovantes/guias. Avaliar aba separada se houver muitas obrigações e necessidade de visão anual própria.

A proposta acima foi recortada para um [MVP de obrigações pessoais dentro de Contas](IMPOSTOS-PESSOAIS.md), sem aba nova nem recorrência anual: cada cota/parcela é cadastrada manualmente e reutiliza o pagamento existente. IPTU, IPVA/licenciamento, CRM pessoa física e IRPF com valor a pagar estão incluídos. Tributos e renovações da PJ ficam para a sessão da PJ. Não há criação de cobranças reais ou alterações em notificações nesta implementação.

## Publicação

Esta entrega é uma PR para revisão. **Não mesclar, publicar, migrar banco ou alterar produção sem autorização explícita de Renato.**
