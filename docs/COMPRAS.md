# Compras, histórico e leitura local da nota

## O caminho mais rápido

1. Em **Listas → Escolher produtos**, selecione produtos já cadastrados ou comprados. Para outra lista, preencha **Nova lista**; vazio adiciona à atual. Produtos existentes não são duplicados ou desmarcados. **Adicionar item** continua aceitando avulsos.
2. Depois de comprar, use **Ler nota fiscal** e escolha uma foto ou PDF. O próprio aparelho lê o arquivo; nenhuma nota é enviada a um provedor de OCR.
3. Em **Revisar nota antes de guardar**, corrija loja, data, total, nomes, quantidades, unidades e preços unitários. Confira o texto reconhecido e o arquivo original quando necessário. Remova linhas indevidas e adicione produtos que faltaram.
4. Confira **Retirar da lista ao guardar** em cada produto. Uma correspondência única e exata de nome é sugerida; você pode trocar ou escolher **Não retirar nenhum item**. Não há vinculação por semelhança. Os itens não vinculados permanecem na lista.
5. Marque **Conferi os produtos…** e confirme. Só então o histórico é salvo e os itens vinculados são retirados na mesma transação. No modo nuvem, a nota original é anexada depois. Se o envio falhar, a compra continua salva e você pode anexar o mesmo arquivo pelo histórico.

**OCR pode errar:** a confirmação humana é obrigatória e fica desmarcada novamente quando você altera os campos. Nada é salvo ou enviado antes da confirmação. Cancelar a leitura ou a revisão não altera a lista, o histórico ou o Storage. O OCR cria uma **nova compra**; não use a mesma nota novamente se a compra já estiver no histórico.

O preenchimento manual permanece: marque os comprados e use **Finalizar compra / Guardar compra**. Os detalhes são opcionais; depois você pode anexar a nota. Esse anexo posterior não relê nem altera automaticamente uma compra já registrada. **Limpar marcados** foi substituído pelo histórico; exclusão individual ainda corrige itens. Listas com compras registradas podem ser renomeadas, mas não excluídas pela interface, para manter acesso ao histórico.

## Privacidade da leitura

O app hospeda suas próprias cópias do **Tesseract.js 6.0.1**, seu motor WebAssembly e modelo de português, e do **PDF.js 5.5.207**. O motor e o modelo só são carregados quando você toca para ler; não vêm de CDN durante a leitura. Não há API paga de OCR, credencial nova, Google Drive, telemetria de nota ou envio para IA.

Fotos são reconhecidas no navegador. PDFs com texto aproveitam a extração local; páginas escaneadas passam pelo OCR local. O texto bruto reconhecido e o arquivo selecionado ficam somente em memória durante a revisão; não são colocados no JSON/exportação. Depois de confirmar, os campos corrigidos e o anexo original podem ir apenas ao Supabase já utilizado pela família. O anexo original nunca é substituído pela imagem eventualmente reduzida para OCR.

Versões, licenças, origens públicas das bibliotecas e checksums ficam em `vendor/ocr/`. O download inicial do leitor exige rede e consome alguns MB de dados; o processamento usa o aparelho e pode demorar mais em celulares antigos. Não há promessa de funcionar offline antes de os componentes terem sido carregados.

## Limites práticos

- Um **JPEG, PNG, WebP ou PDF até 8 MB por compra**. HEIC não é aceito; exporte como JPEG/PNG ou PDF.
- Leitura de PDF até **3 páginas**; acima disso, o arquivo é recusado com aviso, nunca cortado silenciosamente. Há limite de resolução e de tempo para proteger o celular; a mensagem da tela informa quando ele é excedido.
- O parser reconhece padrões comuns de notas brasileiras: descrição, quantidade/unidade, preço unitário, total da linha, data e total pago. Layouts diferentes, nomes quebrados, fotos ruins, descontos e caracteres ambíguos exigem correção manual. Não deduz quantidade a partir de “2 L” dentro do nome.
- A revisão admite até **200 produtos**. Limites do parser produzem aviso; campos ausentes permanecem vazios, não zero. Confiança do OCR não é garantia de que preços estejam corretos.
- O preço guardado por produto é **unitário**. O total da linha lido serve para conferir, sem conciliação automática. Quando existe um **valor a pagar** explícito, ele prevalece sobre o valor total anterior aos descontos, com aviso quando diferem.

Ainda não há edição de compras finalizadas, substituição de anexos, várias fotos para a mesma nota, conciliação automática de descontos, estoque real, previsão de esgotamento ou análise periódica autônoma.

## Histórico e análise

O filtro mensal ou **Todo o histórico** mostra a soma dos totais informados e produtos mais frequentes. Quantidades são agrupadas por produto e unidade: kg e unidades não se misturam. Gastos por produto só usam linhas com quantidade e preço disponíveis; não precisam coincidir com o total pago, por causa de descontos e campos ausentes.

**Compras medem reposição, não consumo exato.** Acentos, maiúsculas e espaços extras são deduplicados no catálogo; marcas e descrições diferentes não são adivinhadas como um mesmo produto.

**Exportar JSON** baixa os registros e o resumo do período. O backup geral também guarda o histórico. Ambos incluem somente referências às notas, **não os arquivos das imagens/PDFs**. Não existe expurgo automático.

## Armazenamento privado e integridade

Os dados usam a tabela `registros`, tipo `compra`, no banco existente. As notas ficam no bucket **privado** `notas-compras`, em `familia/<compra>/<uuid>.<ext>`, acessível aos membros autenticados. Abrir gera link temporário de **5 minutos**; **Baixar nota fiscal** oferece o arquivo original. Links assinados permitem acesso a quem os possuir durante sua validade; não os compartilhe. O app atual atende uma única família por banco, não múltiplas famílias no mesmo projeto.

O JSON do histórico armazena somente caminho, nome, tipo e tamanho do anexo: **nenhuma imagem/base64 na linha do banco ou no localStorage**. No modo local, catálogo e histórico funcionam no navegador, mas os arquivos não são guardados nem compartilhados. Guarde a nota original separadamente nesse modo.

A finalização usa snapshots e bloqueios: se outro aparelho alterar ou finalizar um item vinculado durante a revisão, a operação é recusada sem apagar o restante. Reenvio idêntico é idempotente. A compra lida pode ter linhas novas sem vínculo, inclusive sem retirar nenhum item da lista. Falta de espaço local não é anunciada como sucesso.

Se a associação de um anexo falhar depois do upload, a limpeza é best-effort e só remove um objeto confirmado como não associado. Uma falha persistente de rede pode deixar objeto órfão. Se a resposta se perder depois de salvar, sincronize o histórico antes de tentar outro upload.

Não há criação automática de contas a pagar, tarefas, posts no Mural ou alterações de notificações. Resumos ficam na própria tela ou na exportação solicitada.

## Ativação e verificação

A correção da PR #26 adiciona OCR local conforme a orientação mais recente de Renato. Depois de revisar o commit exato e passar nos testes, reaplicar **somente** `supabase/migrations/202610220001_compras.sql` antes de publicar o frontend corrigido. A migração atualiza as funções e preserva o bucket privado/políticas, é repetível e não remove registros existentes. Não reexecutar `schema.sql` de exemplo sobre produção. Sem a função atualizada, a importação de linhas da nota não vinculadas à lista falha explicitamente sem fallback destrutivo.

Os testes usam somente notas fictícias, navegador local com rede externa bloqueada, mocks e Postgres embutido. O teste real de OCR exercita imagem, PDF com texto e PDF escaneado. A revisão é testada separadamente para correção, cancelamento, confirmação, vínculos, falhas e preservação dos pendentes. Na ativação, testar upload, visualização e download privado com arquivo fictício e as contas já existentes; remover somente os registros temporários de teste.

```bash
node --test testes/compras.test.js testes/compras-store.test.js testes/receipt-parser.test.js
node testes/banco/compras.test.mjs supabase/schema.sql supabase/migrations/202610220001_compras.sql
python3 testes/compras-ui.test.py
python3 testes/receipt-ui.test.py
python3 testes/receipt-e2e.test.py
python3 testes/ocr/run_browser_tests.py
```
