# Elinor

> O nome é uma homenagem a Elinor Dashwood, de *Razão e Sensibilidade* (Jane Austen): a irmã do bom senso, que mantém a casa em ordem. Antes o app se chamava "Casa Organizada".

Um sistema leve e privado para organizar a rotina da casa a dois:

| Módulo | O que faz |
|---|---|
| **Painel** | Resumo do dia: recados do mural, lista de compras, contas atrasadas ou próximas, remédios de hoje (com check), cardápio, tarefas e compromissos |
| **Mural** | Recados rápidos entre vocês (“chego tarde hoje”), com opção de fixar no topo e marcar 👍 visto |
| **Contas** | Contas mensais ou únicas, pagamentos e seção **Impostos e taxas pessoais**: IPTU, IPVA/licenciamento, CRM PF e IRPF a pagar, com ano de referência, cota/parcela manual e filtros. Sem geração automática. [Detalhes](docs/IMPOSTOS-PESSOAIS.md) |
| **Remédios** | Remédios e suplementos de cada pessoa da família (abas por pessoa), dose, horários, como tomar, início e fim. Checklist diário de doses tomadas. Controle de estoque: o app desconta as doses de cada dia e, 7 dias antes de acabar, avisa no Painel e põe o item na lista da farmácia |
| **Alimentação** | Cardápio fixo da semana (café, almoço, lanche e jantar) da família e de cada pessoa (o que ficar vazio usa o da família), suplementos de cada um e observações da dieta |
| **Calendário** | Compromissos (com repetição semanal, mensal ou anual — bom para aniversários) e vencimentos das contas |
| **Tarefas** | Tudo organizado pelo prazo, em colunas **Atrasado · Hoje · Próximos 7 dias · Depois · Sem prazo** (as duas últimas recolhidas). Adicionar rápido com Hoje / Amanhã / Em 7 dias. **Foco do dia**: até 3 itens por pessoa, com barra de progresso. Abas por pessoa. Rotinas que se repetem (todo dia, em dias da semana ou uma vez por mês), por cômodo e responsável |
| **Listas** | Listas compartilhadas (compras, farmácia, casa…): um adiciona, o outro vê na hora no mercado; mostra quem adicionou. Item pode ter prazo: aparece também em Tarefas |
| **Veículos** | Vários veículos, manutenção/OBD e multas em grupos distintos, datas e prazos manuais, PDFs e imagens. Defesa e recurso têm campos próprios. Sem tarefas ou avisos automáticos. [Como usar e limites](docs/VEICULOS.md) |
| **Contatos** | Médicos, escola, serviços da casa e números de emergência, com botão de ligar e de WhatsApp |
| **Automação** | Importar dados de conversas com IA e do Google Agenda, chaves de API para agentes (Claude, Gemini, Manus, n8n…) e exportar um resumo da rotina para uma IA |
| **Imprimir** | Folhas A4 prontas para deixar nos lugares certos da casa |
| **Ajustes** | Nomes das pessoas, nome da casa, “este aparelho é de…”, backup e restauração |

Mural, listas e contatos foram inspirados no app FamilyWall.

### Folhas para imprimir

| Folha | Onde deixar | Formato |
|---|---|---|
| Resumo do dia | Geladeira / porta | Retrato |
| Quadro de remédios da semana (com quadradinhos para marcar) | Banheiro / cozinha | Paisagem |
| Cardápio semanal | Geladeira | Paisagem |
| Contas do mês (com campo "pago em") | Escritório / pasta de contas | Retrato |
| Calendário do mês | Mural / corredor | Paisagem |
| Rotina de tarefas da semana | Lavanderia / cozinha | Paisagem |
| Lista de compras (com linhas em branco para completar à mão) | Porta da geladeira / bolsa | Retrato |
| Telefones úteis (emergência em destaque) | Geladeira / perto do telefone | Retrato |

Na janela de impressão você também pode escolher **"Salvar como PDF"** para mandar por WhatsApp.

---

## Como funciona

O sistema é só **HTML + CSS + JavaScript** e não precisa instalar nem compilar nada. Ele funciona de dois jeitos:

1. **Modo local** (padrão): os dados ficam no navegador de quem está usando. Serve para testar agora mesmo.
2. **Modo nuvem** (recomendado para o dia a dia): login com e-mail e senha, banco de dados no
   [Supabase](https://supabase.com) (o plano gratuito sobra) e **sincronização em tempo real**: quando um marca
   "remédio tomado" ou "conta paga", aparece na hora no celular do outro.

O acesso é **fechado**: só os e-mails que você cadastrar conseguem entrar e ver os dados.

## Testar agora (modo local)

```bash
cd Inicio
python3 -m http.server 8000
# abra http://localhost:8000
```

Também funciona abrindo o arquivo `index.html` direto no navegador.

## Colocar online para vocês dois (modo nuvem) — uns 15 minutos

### 1. Criar o banco (Supabase)
1. Crie uma conta gratuita em <https://supabase.com> e clique em **New project**.
2. Abra o **SQL Editor**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql),
   **troque os dois e-mails** pelos de vocês e clique em **Run**.
3. Em **Authentication → Sign In / Providers**, desligue a opção **"Allow new users to sign up"**. Assim ninguém consegue criar conta sozinho.
4. Em **Authentication → Users → Add user → Create new user**, crie os dois usuários (e-mail e senha). Marque **Auto Confirm User**.
5. Em **Project Settings → API**, copie a **Project URL** e a chave **anon / public**.

### 2. Configurar o app
Edite o arquivo [`config.js`](config.js):

```js
window.APP_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

> A chave "anon" é pública por natureza. Quem protege os dados é o login, junto com as regras de segurança (RLS) do `schema.sql`, que só liberam os e-mails cadastrados.

### 3. Publicar o site (escolha um)
- **Netlify** ou **Cloudflare Pages** (grátis, funcionam com repositório privado): conecte este repositório.
  Não precisa de comando de build; a pasta publicada é a raiz.
- **GitHub Pages**: Settings → Pages → Branch `main` / pasta raiz. No plano gratuito do GitHub, o repositório
  precisa ser público. Os dados continuam protegidos pelo login, porque o código não guarda nenhum dado.

### 4. Automação (opcional)
Para que agentes de IA (Claude, Gemini, Manus, n8n…) leiam e gravem no app, veja **[docs/AUTOMACAO.md](docs/AUTOMACAO.md)**.
Se você rodou o `schema.sql` antes desta versão, **rode-o de novo**. Ele é seguro de repetir: cria só o que falta e não apaga dados.

### 5. No celular
Abra o endereço do site e use **"Adicionar à tela inicial"** (Safari ou Chrome). Ele abre como um aplicativo.

### Já usou o modo local e quer levar os dados para a nuvem?
Em **Ajustes → Baixar backup** (no modo local), depois configure a nuvem, entre e use **Ajustes → Restaurar backup**.

---

## Notificações do Mural e das tarefas (Web Push)

Implementação opt-in para avisar a **outra conta autenticada** quando um recado novo é publicado. Não notifica curtidas, fixações, edições ou importações. Cada pessoa ativa no próprio aparelho; no iPhone é necessário iOS 16.4+ e abrir o app pela Tela de Início.

Nas **tarefas**, há um aviso agrupado às **08h, 10h, 12h, 14h, 16h, 18h e 20h (Porto Alegre)**, somente no dia previsto e para o proprietário que ainda tenha pendências. Concluiu tudo, param os avisos. **Ambos** avisa os dois; sem responsável não avisa ninguém. Não duplica a mesma conta no mesmo ciclo, não cria resumos no Mural e não mostra detalhes das tarefas na tela bloqueada.

**Backend ativado mediante aprovação; falta cada pessoa permitir notificações no próprio celular.** Veja [docs/WEB-PUSH.md](docs/WEB-PUSH.md) para segurança, passos de ativação, secrets apenas de servidor e testes locais. Não foram enviados pushes de teste.

## Estrutura

```
index.html            página única
config.js             configuração do Supabase (vazio = modo local)
css/app.css           estilos da tela e das folhas de impressão
js/util.js            datas, dinheiro e formatação
js/schema.js          formato dos dados, normalização, importação (IA e .ics) e prompt para IA
js/store.js           dados (localStorage ou Supabase + tempo real)
js/domain.js          regras: vencimentos, doses, repetições, tarefas
js/print.js           folhas A4 para imprimir
js/app.js             telas, formulários e navegação
supabase/schema.sql   tabela, segurança (RLS), tempo real e API para agentes
mcp/server.js         conector MCP para o Claude (sem dependências)
docs/AUTOMACAO.md     guia de automação, endpoints e prompts prontos
integracoes/          scripts prontos: Google Agenda e Google Tarefas/compras, sem IA
testes/               testes automáticos das regras e integrações (node testes/<arquivo>)
```

## Ideias para as próximas versões

O MVP do Foco permite **Começar · Pausar · Retomar** uma pendência, com próximo passo opcional, sem cronômetro ou novas notificações. Veja [o funcionamento e os testes](docs/FOCO-E-PROXIMOS-ITENS.md). O item 7 tem um [MVP de Veículos](docs/VEICULOS.md), entregue por PR para revisão, com manutenção anual, OBD, anexos e multas. O item 8 tem um [MVP de obrigações pessoais dentro de Contas](docs/IMPOSTOS-PESSOAIS.md); tributos e renovações da PJ ficam para a sessão da PJ.

- Lembretes por notificação no celular (horário do remédio, conta vencendo amanhã)
- Ingredientes do cardápio enviados direto para a lista de compras
- Receitas da família ligadas ao cardápio
- Documentos importantes (fotos de RG, carteirinha do convênio, garantias)
- Controle de estoque de remédios ("acaba em 5 dias")
- Histórico de gastos por mês e categoria (gráfico anual)
