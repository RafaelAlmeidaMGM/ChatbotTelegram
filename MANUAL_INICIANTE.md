# Manual: entender, testar e colocar o atendimento online

## 1. O que você já tem e qual o papel de cada serviço

| Item | Para que serve |
| --- | --- |
| Bot e token do BotFather | Identificam o bot no Telegram |
| Código deste projeto | Menus, respostas prontas, coleta de dados e regras de encaminhamento |
| Cloudflare Workers | Executa o código pela internet quando uma mensagem/evento chega |
| Cloudflare D1 | Guarda a etapa da conversa e os protocolos |
| GitHub | Guarda o código e pode disparar publicações automáticas |
| Sua ferramenta de atendimento | Organiza conversas, equipes, filas e atendentes |
| Domínio e e-mail na Hostinger | Podem continuar como estão; não são necessários para testar este projeto |

O “cérebro” inicial funciona por regras: escolher uma opção determina o próximo
menu e o setor. Não precisa contratar um modelo de IA para essa triagem.
Uma IA para interpretar perguntas livres pode ser adicionada depois, se necessário.

## 2. Primeiro: quem recebe as mensagens do Telegram?

**Como você utiliza uma ferramenta de atendimento, confirme o nome e a documentação
dela antes de conectar este projeto ao bot real.** Nunca compartilhe chaves no chat.

O Telegram mantém **um único endereço de webhook por bot**. Webhook é o endereço para
o qual o Telegram entrega mensagens. Se sua ferramenta já registrou esse endereço,
registrar a Cloudflare no lugar pode interromper a entrada de mensagens na ferramenta.
Uma ferramenta também pode usar consulta contínua, em vez de webhook; webhook vazio
não comprova que nenhuma ferramenta esteja usando o bot.

Há três possibilidades:

1. **Sua ferramenta já possui menus e transferência automática por equipe.**
   Nesse caso, pode ser suficiente configurar nela Suporte e Financeiro, sem manter
   um componente Cloudflare adicional para essa função.
2. **Sua ferramenta permite automação externa por API/webhook.**
   A ferramenta recebe do Telegram, envia um evento à Cloudflare e recebe de volta
   a ação: responder ao cliente ou transferir a conversa para uma equipe.
3. **A Cloudflare deve receber diretamente do Telegram.**
   O Worker controla o webhook e precisa de uma integração compatível para criar e
   atualizar conversas na ferramenta, incluindo a resposta do atendente. Isso depende
   das possibilidades oficiais da ferramenta; nem toda integração permite esse fluxo.

Para seu objetivo de transferir o cliente dentro da ferramenta, normalmente usamos
o fluxo 1 ou 2. No fluxo 2, a arquitetura fica assim:

```text
Cliente no Telegram
        ↓
Ferramenta de atendimento (mantém a integração Telegram)
        ↓ evento de nova mensagem
Cloudflare (menus e regras do cérebro)
        ↓ chamada à API da ferramenta
Equipe de Suporte ou Financeiro dentro da ferramenta
```

Na transferência para uma pessoa, a automação precisa parar de responder aquela
conversa. Também precisamos definir quando ela será reativada: encerramento do
atendimento, nova conversa ou regra específica. Os eventos e comandos exatos dependem
da ferramenta. Não basta enviar a mesma chave Telegram para os dois serviços.

### O que o código atual já faz

O projeto atual implementa o **fluxo direto Telegram → Cloudflare → grupos Telegram**.
Ele oferece os menus e salva chamados. Ao pedir um atendente, o cliente é atendido
por mensagens enviadas a um grupo de equipe e pelo comando `/responder`.

**Ainda não existe conexão com a API da sua ferramenta.** Encaminhar uma notificação
a um grupo Telegram não transfere a conversa para um setor dentro de uma plataforma.
Os IDs `SUPORTE_CHAT_ID` e `FINANCEIRO_CHAT_ID` são grupos Telegram, não os IDs de
equipes da sua ferramenta.

Para concluir essa integração, precisamos saber o nome da ferramenta, como recebe
eventos, como envia respostas, como identifica equipes e como transfere uma conversa.
Essas informações vêm do site/documentação; as credenciais ficam nas configurações
seguras dos serviços, nunca no código ou nesta conversa.

## 3. Onde executar npm ci, npm run check e npm test

Esses comandos são executados em um **terminal dentro da pasta do projeto**. É a
pasta que contém `package.json`, `package-lock.json`, `wrangler.toml` e `src/`.

Você tem três formas de fazer isso:

- **Aqui no ambiente de desenvolvimento:** a pasta é `/workspace/ChatbotTelegram`.
  Eu já instalei dependências e executei os testes aqui. Você não precisa repetir os
  comandos no seu computador apenas para comprovar os testes desta versão.
- **No seu computador:** baixe os arquivos do projeto e siga os passos abaixo.
- **No GitHub Codespaces:** se o projeto já estiver enviado ao GitHub e esse recurso
  estiver disponível na sua conta, abra um Codespace e use o terminal dele. Codespaces
  é opcional e tem franquia/possíveis custos próprios; não é a hospedagem do bot.

### No computador, passo a passo

1. Instale Node.js **24 LTS** pelo site oficial: <https://nodejs.org/>.
2. Instale o Visual Studio Code se quiser um editor com terminal integrado:
   <https://code.visualstudio.com/>.
3. Baixe e extraia o pacote deste projeto. Se já estiver no GitHub, use o download
   ZIP do repositório ou faça um clone. Ter acesso ao GitHub não envia sozinho os
   arquivos criados neste ambiente para sua conta.
4. No VS Code, use **Arquivo → Abrir Pasta** e escolha a pasta extraída que contém
   o `package.json`. Se houver uma pasta dentro da outra, abra a mais interna.
5. Abra **Terminal → Novo Terminal**. É nessa área de texto que você digita comandos,
   não no chat do Telegram, no arquivo de código ou em uma página do painel Cloudflare.
6. Confira a instalação:

   ```bash
   node --version
   npm --version
   ```

7. Execute um comando por vez, esperando terminar:

   ```bash
   npm ci
   npm run check
   npm test
   ```

| Comando | O que ele faz | O que esperar |
| --- | --- | --- |
| `npm ci` | Instala as ferramentas e dependências nas versões do lockfile | Finalização sem erro |
| `npm run check` | Verifica os tipos do TypeScript | Pode terminar sem outra mensagem de erro |
| `npm test` | Simula clientes, Telegram e banco D1 local | Todos os testes passam |

Os testes não exigem a chave real do Telegram e não enviam mensagens a clientes.
Esses três comandos **não publicam o bot nem o deixam online**. Publicar é outra etapa.
Se aparecer `ENOENT` citando `package.json`, confira se o terminal está na pasta certa.
Se `node`/`npm` não for reconhecido, reabra o terminal depois de instalar Node.js.
Se o Windows impedir `npm.ps1`, use o terminal **Prompt de Comando** ou `npm.cmd`
no lugar de `npm`; não é necessário mudar a política de segurança do computador.

## 4. Onde editar o cérebro

Abra `src/config.json`:

- `texts`: saudação, perguntas e principais mensagens.
- `departments`: setores e ordem do menu.
- `options`: submenu de cada setor.
- `answer`: resposta pronta da opção.
- `action: "handoff"`: opção que começa o pedido de atendimento.

Suporte já tem acesso ao sistema, PDV, impressão, cadastros e atendente.
Financeiro tem Dúvidas e atendente. As orientações iniciais são gerais e devem ser
ajustadas aos procedimentos da empresa. Os exemplos completos estão em `EDITAR_BOT.md`.

Se publicar via integração Git, cada alteração precisa ser salva e enviada à branch
configurada. O build e o deploy precisam concluir para a mudança chegar ao Worker.

## 5. Como a Cloudflare deixa o cérebro online

Na primeira publicação:

1. Conectamos sua conta Cloudflare pelo Wrangler (ferramenta de publicação).
2. Criamos o banco D1 e colocamos o ID dele no `wrangler.toml`.
3. Aplicamos as migrações para criar/atualizar as tabelas.
4. Configuramos os segredos apropriados ao fluxo escolhido.
5. Publicamos o código. A Cloudflare fornece uma URL HTTPS `*.workers.dev`.
6. Conectamos **a ferramenta ou um bot de teste dedicado** a esse endereço.

Depois de publicado, você pode desligar seu computador. A Cloudflare executa o
código quando recebe eventos; não precisa deixar `npm run dev` nem um terminal
aberto para produção. Respeite as cotas dos planos gratuitos de Workers e D1.

Para o primeiro teste, use a URL `workers.dev`. Seu domínio e e-mail da Hostinger
podem permanecer como estão. Um domínio personalizado é opcional e pode ser tratado
depois, sem fazer mudanças de DNS durante estes testes.

## 6. Teste independente, sem alterar a ferramenta de atendimento

Este caminho testa o código atual sem depender da API da ferramenta. Use **outro
bot do BotFather, dedicado ao teste**, sem conexão com a ferramenta de atendimento.
As ações a seguir criam recursos na conta Cloudflare escolhida e usam suas cotas.

No terminal do projeto:

```bash
npx wrangler login
npx wrangler d1 create chatbot-atendimento
```

O navegador pedirá login/autorização. Copie o `database_id` retornado para a linha
`database_id` em `wrangler.toml`, substituindo o UUID zerado. Mantenha o binding `DB`.
Defina `COMPANY_NAME` em `[vars]`. Depois execute:

```bash
npm run db:remote
npm run deploy
```

Guarde a URL HTTPS que aparecer. Cadastre o token **do bot de teste**:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

Crie uma senha independente para proteger o webhook:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Guarde a senha gerada e informe-a quando o segundo comando pedir. Ela é diferente do
token do BotFather. O Worker recebe as duas chaves pelos segredos da Cloudflare.

Para o script local registrar o webhook, crie `.dev.vars` na pasta do projeto com:

```dotenv
TELEGRAM_BOT_TOKEN=TOKEN_ORIGINAL_DO_BOT_DE_TESTE
TELEGRAM_WEBHOOK_SECRET=MESMA_SENHA_CADASTRADA_NA_CLOUDFLARE
```

Substitua os exemplos por valores reais apenas nesse arquivo local ignorado pelo
Git. Não coloque esses valores no `config.json`, GitHub ou conversas.

Confirme que a URL publicada seguida de `/health` responde `{"ok":true}`. Então:

```bash
npm run telegram:webhook -- https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev
npm run telegram:check
```

Use a URL real retornada pelo deploy. O comando de registro usa o token de `.dev.vars`
ou do ambiente e altera o webhook desse bot. Ele verifica um webhook existente para
evitar substituí-lo sem uma opção explícita. Essa proteção não identifica ferramentas
que usam consulta contínua: o bot dedicado continua sendo o caminho para este teste.

### Receber os chamados e testar respostas humanas

1. Crie grupos privados de teste Suporte e Financeiro e adicione o bot de teste.
2. Em cada grupo, envie `/id@USUARIO_DO_BOT_DE_TESTE`.
3. Em `[vars]` do `wrangler.toml`, adicione os dois IDs negativos retornados:

   ```toml
   SUPORTE_CHAT_ID = "ID_NEGATIVO_REAL_DO_GRUPO_SUPORTE"
   FINANCEIRO_CHAT_ID = "ID_NEGATIVO_REAL_DO_GRUPO_FINANCEIRO"
   ```

4. Execute `npm run deploy` novamente.
5. No privado do bot de teste, envie `/start`, escolha Suporte e consulte um assunto.
   Somente a resposta pronta deve aparecer, sem abrir chamado.
6. Escolha Falar com atendente, informe nome, empresa e descrição. O chamado deve
   chegar somente ao grupo Suporte.
7. No grupo, envie `/responder@USUARIO_DO_BOT_DE_TESTE PROTOCOLO Olá, vamos ajudar!`.
   A mensagem deve chegar ao cliente no privado.
8. Repita no Financeiro e confira que as opções são apenas Dúvidas e atendente.

Conseguir completar esse teste valida o bot direto com grupos. A transferência dentro
da sua ferramenta continua sendo uma integração própria a implementar.

## 7. Conectar à ferramenta real e automatizar com GitHub

Depois de identificar a ferramenta e confirmar seu suporte à integração:

1. Mapeie IDs reais das equipes Suporte e Financeiro na ferramenta.
2. Configure eventos de novas mensagens/conversas da ferramenta para o Worker.
3. Configure autenticação desses eventos e da API de resposta/transferência.
4. Implemente e teste o adaptador no código; o endpoint atual `/webhook` entende o
   formato do Telegram, não eventos de uma ferramenta desconhecida.
5. Garanta que mensagens do bot não gerem um ciclo de respostas automáticas.
6. Ao transferir, registre que um humano assumiu e suspenda o menu nessa conversa.
7. Teste recebimento, menu, resposta pronta, transferência para a equipe correta,
   resposta humana e encerramento do atendimento.

Os passos de painel, endpoints e campos da API serão específicos da ferramenta.
Não é possível preencher corretamente esses dados apenas com a chave do Telegram.

Quando o código estiver pronto para esse fluxo, envie-o ao GitHub e conecte o Worker
ao repositório pela integração de Builds da Cloudflare. O README descreve os comandos
de build/deploy. Mantenha os segredos nos serviços; eles não entram no repositório.
O GitHub guarda/publica o código; quem o executa online é a Cloudflare.

## 8. O que já foi feito e o que falta

- Já preparados: código Workers/D1, menus, respostas, testes locais e documentação.
- Ainda necessários para um bot online de teste: conta Cloudflare configurada, D1
  remoto, segredos do bot de teste e registro do webhook.
- Ainda necessário para sua ferramenta real: identificação da plataforma e
  implementação/configuração da integração de mensagens e transferência por equipe.
- Publicar o ambiente Codex é separado de publicar na Cloudflare e conectar o bot.

Para continuar no seu cenário, informe o **nome da ferramenta de atendimento** e,
se possível, o site ou link da documentação. Não envie tokens ou senhas.
