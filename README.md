# 🏠 Casa Organizada

Um sistema leve e privado para organizar a rotina da casa a dois:

| Módulo | O que faz |
|---|---|
| **Painel** | Resumo do dia: recados do mural, lista de compras, contas atrasadas ou próximas, remédios de hoje (com check), cardápio, tarefas e compromissos |
| **Mural** | Recados rápidos entre vocês (“chego tarde hoje”), com opção de fixar no topo e marcar 👍 visto |
| **Contas** | Contas mensais ou únicas, valor, vencimento, categoria, quem paga, forma de pagamento. Marca como paga e guarda a data e o valor pago |
| **Remédios** | Remédio, para quem, dose, horários, como tomar, início e fim. Checklist diário de doses tomadas |
| **Alimentação** | Cardápio fixo da semana (café, almoço, lanche e jantar) e observações da dieta |
| **Calendário** | Compromissos (com repetição semanal, mensal ou anual — bom para aniversários) e vencimentos das contas |
| **Tarefas** | Tarefas únicas (com prazo) e rotinas que se repetem (todo dia, em dias da semana ou uma vez por mês), por cômodo e responsável |
| **Listas** | Listas compartilhadas (compras, farmácia, casa…): um adiciona, o outro vê na hora no mercado; mostra quem adicionou |
| **Contatos** | Médicos, escola, serviços da casa e números de emergência, com botão de ligar e de WhatsApp |
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

### 4. No celular
Abra o endereço do site e use **"Adicionar à tela inicial"** (Safari ou Chrome). Ele abre como um aplicativo.

### Já usou o modo local e quer levar os dados para a nuvem?
Em **Ajustes → Baixar backup** (no modo local), depois configure a nuvem, entre e use **Ajustes → Restaurar backup**.

---

## Estrutura

```
index.html            página única
config.js             configuração do Supabase (vazio = modo local)
css/app.css           estilos da tela e das folhas de impressão
js/util.js            datas, dinheiro e formatação
js/store.js           dados (localStorage ou Supabase + tempo real)
js/domain.js          regras: vencimentos, doses, repetições, tarefas
js/print.js           folhas A4 para imprimir
js/app.js             telas, formulários e navegação
supabase/schema.sql   tabela, segurança (RLS) e tempo real
```

## Ideias para as próximas versões
- Lembretes por notificação no celular (horário do remédio, conta vencendo amanhã)
- Ingredientes do cardápio enviados direto para a lista de compras
- Receitas da família ligadas ao cardápio
- Documentos importantes (fotos de RG, carteirinha do convênio, garantias)
- Controle de estoque de remédios ("acaba em 5 dias")
- Histórico de gastos por mês e categoria (gráfico anual)
