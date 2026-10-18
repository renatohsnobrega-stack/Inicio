# 🤖 Automação: deixar a IA preencher o app

O Casa Organizada aceita dados de fora por **5 caminhos**. Do mais simples ao mais automático:

| Caminho | Precisa de | Bom para |
|---|---|---|
| 1. **Colar de uma conversa** | nada (funciona até no modo local) | Levar para o app o que você conversou com o Claude, Gemini ou ChatGPT (remédios, rotina, contas) |
| 2. **Importar agenda (.ics)** | nada | Trazer de uma vez o Google Agenda, Outlook ou Apple |
| 2b. **Sincronizar Google Agenda (script)** | modo nuvem + conta Google | Agenda sempre em dia, de hora em hora, **sem IA e sem gastar tokens** |
| 3. **Conector MCP** | modo nuvem + Claude Desktop ou Claude Code | Falar com o Claude e ele grava direto no app |
| 4. **API para agentes** | modo nuvem | Automações que rodam sozinhas: Claude (tarefas agendadas), Manus, Gemini, n8n, Zapier, Make |

> **Segurança:** tudo que um agente grava pelos caminhos 3 e 4 aparece no **Painel** em
> **"🤖 Adicionados automaticamente — para revisar"**, com os botões Ok, Editar e Descartar.
> Cada agente usa uma **chave própria**, que você revoga quando quiser (Automação → API para agentes).

> **Qual escolher?** Use IA só onde ela é necessária. Dados que já vêm organizados (como a agenda) vão melhor por
> script: é de graça, instantâneo e sempre igual. A IA vale a pena para interpretar coisas soltas: e-mails de cobrança,
> fotos de receitas, conversas.

---

## 1. Colar de uma conversa

1. No app, abra **Automação → Copiar prompt**.
2. Cole o prompt no Claude, Gemini ou ChatGPT, no fim de uma conversa ou junto com o conteúdo (um e-mail, a foto de uma receita médica, um PDF de conta).
3. A IA devolve um bloco JSON. Cole no app, clique em **Pré-visualizar** e depois em **Importar**.

O app corrige formatos comuns ("R$ 150,90", "8h", "25/10/2026", "segunda") e mostra o que estiver faltando antes de importar.
Importar a mesma coisa de novo **atualiza o registro em vez de duplicar**.

## 2. Importar agenda

Google Agenda: **Configurações → Importar e exportar → Exportar**. Descompacte o arquivo e escolha o `.ics` em **Automação → Importar agenda**.
São importados os compromissos de hoje em diante e os que se repetem (aniversários).

## 2b. Sincronizar o Google Agenda automaticamente (sem IA)

O arquivo [`integracoes/google-agenda.gs`](../integracoes/google-agenda.gs) é um script do Google (Apps Script),
gratuito e sem servidor, que copia a sua agenda para o app **de hora em hora**:

1. Acesse <https://script.google.com>, clique em **Novo projeto** e cole o conteúdo do arquivo.
2. Preencha o `CONFIG` no topo: endereço do Supabase, chave anon e uma chave criada em **Automação → API para agentes**.
   Para incluir a agenda da sua esposa, peça que ela a compartilhe com você e adicione o ID dela em `AGENDAS`.
3. Escolha a função **instalar** e clique em ▶ **Executar**. Autorize o acesso à agenda.

O script cria e atualiza os compromissos e também tira do app os que forem apagados ou mudarem de dia na agenda.
Ele só mexe nos eventos que vieram da agenda; o que vocês criarem no próprio app fica como está.
Para parar, execute a função **desinstalar**.

## 3. Conector MCP (Claude Desktop / Claude Code)

Com o conector, você fala com o Claude e ele mesmo consulta e grava no app. Exemplos:
*"Coloque no app que a Ana vai tomar amoxicilina 500mg de 8 em 8 horas por 7 dias, começando hoje"* ou *"o que vence esta semana?"*.

Ferramentas disponíveis:

| Ferramenta | Para quê | Custo típico |
|---|---|---|
| `casa_resumo` | "Como está a semana?": contas a vencer e atrasadas, remédios de hoje (tomados ou não), compromissos, tarefas, listas e recados | ~150 tokens |
| `casa_listar` | Achar registros, com `busca` (texto), `tipo` e `limite`; uma linha por registro, com o id | ~15 tokens por registro |
| `casa_formato` | Campos aceitos (pode pedir só um `tipo`) | ~100 tokens por tipo |
| `casa_salvar` | Criar ou atualizar | — |
| `casa_remover` | Remover pelo id | — |

As respostas são texto curto, não JSON: cerca de 7 vezes menos tokens do que devolver os dados completos.
O resumo é calculado no seu computador com as mesmas regras do app, então os vencimentos e as tarefas do dia
batem com o que aparece na tela.

**Pré-requisitos:** modo nuvem configurado, Node.js 18+ no computador e uma chave criada em **Automação → API para agentes**.

**Claude Desktop:** em *Settings → Developer → Edit Config*, adicione:

```json
{
  "mcpServers": {
    "casa-organizada": {
      "command": "node",
      "args": ["/CAMINHO/ATE/Inicio/mcp/server.js"],
      "env": {
        "CASA_SUPABASE_URL": "https://SEU-PROJETO.supabase.co",
        "CASA_ANON_KEY": "sua chave anon do Supabase",
        "CASA_CHAVE": "casa_... (chave criada no app)"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add casa-organizada \
  -e CASA_SUPABASE_URL=https://SEU-PROJETO.supabase.co \
  -e CASA_ANON_KEY=... -e CASA_CHAVE=casa_... \
  -- node /CAMINHO/ATE/Inicio/mcp/server.js
```

Se o Claude também tiver acesso ao seu Gmail e ao Google Agenda (conectores do claude.ai ou do Claude Desktop), ele pode cruzar as fontes numa única conversa:
*"Leia meus e-mails dos últimos 30 dias, encontre contas a pagar e cadastre no app."*

## 4. API para agentes

Qualquer agente que faça chamadas HTTP pode usar a API. No app, **Automação → API para agentes → Criar chave** e depois
**Copiar instruções para o agente**: você recebe um texto pronto com o endereço, as chaves e o formato, para colar no agente.

### Endpoints

Todas as chamadas são `POST` com estes cabeçalhos:

```
apikey: <chave anon do Supabase>
Content-Type: application/json
```

| Endpoint | Corpo | Faz |
|---|---|---|
| `/rest/v1/rpc/agente_salvar` | `{"chave", "registros": [{"tipo", "id"?, "dados"}]}` | Cria ou atualiza (até 500 por chamada) |
| `/rest/v1/rpc/agente_listar` | `{"chave", "tipo"?, "desde"?}` | Lista o que existe |
| `/rest/v1/rpc/agente_remover` | `{"chave", "tipo", "id"}` | Remove um registro |

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/rest/v1/rpc/agente_salvar" \
  -H "apikey: SUA_CHAVE_ANON" -H "Content-Type: application/json" \
  -d '{"chave": "casa_...", "registros": [
        {"tipo": "conta", "id": "gmail-18c2f...", "dados": {"nome": "Energia Enel", "valor": 287.45, "tipo": "unica", "data": "2026-11-10", "codigo": "83640000002..."}},
        {"tipo": "item", "dados": {"texto": "Azeite", "lista_nome": "Compras"}}
      ]}'
```

**Regras importantes**
- **Mesmo `id` = atualiza.** Use ids estáveis vindos da fonte (`gmail-<id da mensagem>`, `gcal-<id do evento>`) para poder rodar a automação todo dia sem duplicar.
  Sem `id`, contas, remédios, compromissos, tarefas e contatos recebem um id calculado pelo conteúdo (nome + data), o que também evita duplicados.
- Ao atualizar, os campos enviados são **mesclados**: um pagamento marcado no app não se perde quando o agente roda de novo.
- Datas em `AAAA-MM-DD`, horas em `HH:MM`, dias da semana de `0` (segunda) a `6` (domingo).
- Campo extra útil: `"origem": "gmail"`, que aparece no Painel ("via gmail").

### Tipos e campos

O formato completo fica em [`js/schema.js`](../js/schema.js). O botão **Copiar prompt** do app e a ferramenta `casa_formato` do MCP também o mostram. Resumo:

| tipo | campos principais |
|---|---|
| `conta` | **nome**, valor, tipo (`mensal`/`unica`), dia, data, categoria, responsavel, forma, codigo, obs |
| `remedio` | **nome**, pessoa, dose, horarios (`["08:00","20:00"]`), instrucoes, inicio, fim, ativo |
| `evento` | **titulo**, **data**, hora, pessoa, local, repete (`nao`/`semanal`/`mensal`/`anual`), obs |
| `tarefa` | **titulo**, tipo (`unica`/`diaria`/`semanal`/`mensal`), data, dias, dia, responsavel, local |
| `refeicao` | **dia** (0-6), **refeicao** (`cafe`/`almoco`/`lanche`/`jantar`), texto |
| `contato` | **nome**, categoria, telefone, whatsapp, endereco, obs |
| `recado` | **texto**, autor, fixado |
| `item` | **texto**, lista_nome (ex.: `"Compras"`, criada se não existir), feito |

---

## Prompts prontos para agentes

### 📧 Contas do e-mail (Claude com Gmail, Manus, Gemini)

> Você tem acesso ao meu Gmail e à API do app Casa Organizada (instruções abaixo).
> 1. Procure e-mails dos últimos 15 dias com boletos, faturas, cobranças ou contas (luz, água, gás, internet, telefone, cartão, condomínio, escola, plano de saúde, IPTU/IPVA).
> 2. Para cada conta encontrada, extraia: nome do fornecedor, valor, data de vencimento e linha digitável ou Pix (se houver).
> 3. Grave com `agente_salvar`: cada registro com `"tipo": "conta"` e `"id": "gmail-<id da mensagem>"`; nos `dados`, use `"tipo": "unica"`, a `"data"` do vencimento e `"origem": "gmail"`.
> 4. Ignore propagandas e contas já pagas. No fim, me diga o que foi cadastrado.
>
> *(cole aqui o texto de "Copiar instruções para o agente")*

### 📅 Agenda da semana (Claude com Google Agenda, Manus)

Para o Google Agenda, prefira o script do item 2b: não gasta tokens. Use o prompt abaixo só se não puder usar o script.

> Leia os eventos do meu Google Agenda dos próximos 14 dias e grave no app com `"tipo": "evento"`,
> `"id": "gcal-<id do evento>"` e `"origem": "google-calendar"`. Inclua título, data, hora e local. Aniversários recorrentes: `"repete": "anual"`.

### 💊 Receita médica (qualquer IA, com foto)

> Esta é a foto da minha receita médica. Extraia cada remédio com nome, dose, horários (comece às 08:00 quando for "de 8 em 8 horas"),
> instruções, data de início (hoje) e data de fim (se houver duração) e cadastre no app como `remedio`, para a pessoa "Ana".

### ⏰ Rodar sozinho todo dia

- **Claude:** crie uma tarefa agendada (ex.: todo dia às 7h) com o prompt de contas do e-mail ou de agenda. O Claude precisa estar com o Gmail ou o Google Agenda conectado e com acesso à internet.
- **Manus:** crie uma tarefa recorrente com o mesmo prompt e as instruções da API.
- **Gemini:** use um *Gem* com as instruções da API para os casos manuais. Para rodar sozinho, use o Google Apps Script (veja abaixo).
- **n8n / Zapier / Make:** gatilho (novo e-mail com "boleto", mensagem no WhatsApp/Telegram, formulário) → nó de IA para extrair os campos → nó HTTP `POST agente_salvar`.

### Google Apps Script (Gmail → app, grátis, sem servidor)

Em <https://script.google.com>, crie um projeto, cole o código abaixo e agende um gatilho diário. Ele apenas encaminha os
e-mails de cobrança para o app como **recados** para você revisar. Para extrair valor e vencimento automaticamente,
combine com um agente de IA (prompt acima).

```js
const SUPABASE = 'https://SEU-PROJETO.supabase.co', ANON = 'SUA_CHAVE_ANON', CHAVE = 'casa_...';
function contasDoEmail() {
  const threads = GmailApp.search('newer_than:1d (boleto OR fatura OR "segunda via" OR vencimento)');
  const registros = threads.map(t => {
    const m = t.getMessages()[0];
    return { tipo: 'recado', id: 'gmail-' + m.getId(),
             dados: { texto: '📧 Possível conta: ' + m.getSubject() + ' (' + m.getFrom() + ')', autor: 'Gmail', origem: 'gmail' } };
  });
  if (!registros.length) return;
  UrlFetchApp.fetch(SUPABASE + '/rest/v1/rpc/agente_salvar', {
    method: 'post', contentType: 'application/json', headers: { apikey: ANON },
    payload: JSON.stringify({ chave: CHAVE, registros }),
  });
}
```
