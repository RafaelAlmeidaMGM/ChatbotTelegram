# Bot de atendimento — Cloudflare Workers + D1

**Comece pelo [manual para iniciantes](MANUAL_INICIANTE.md)**: ele explica onde
executar os comandos e distingue o teste direto com Telegram da integração com
uma ferramenta de atendimento.

Para o MGM Helpdesk local com Telegram bloqueado por HTTPS, consulte
[PUBLIC_URL e túnel local](HELPDESK_LOCAL_HTTPS.md). O helper dessa página deve ser
executado na pasta do **Helpdesk**, não na pasta do Worker.

Se você usa uma ferramenta conectada ao Telegram, identifique sua API antes de
registrar este Worker como webhook. O Telegram mantém um único webhook por bot;
substituí-lo pode desconectar a ferramenta. O código atual encaminha para grupos
Telegram e ainda não transfere conversas dentro de uma plataforma externa.

Bot Telegram em TypeScript, sem VPS e sem processo permanentemente ligado.
O Telegram chama `POST /webhook`; o Worker faz a triagem e salva sessões e protocolos
no D1. O código pode ficar no GitHub e ser publicado pela integração Git da Cloudflare.

| Opção | Setor | Destino |
| --- | --- | --- |
| 1 | Suporte ⚙️ | `SUPORTE_CHAT_ID` |
| 2 | Financeiro 💰 | `FINANCEIRO_CHAT_ID` |

Suporte possui opções de acesso, PDV, impressão, cadastros e atendente. Financeiro
possui Dúvidas e Falar com atendente. A consulta de uma resposta não abre chamado.
Ao escolher atendente, o cliente informa nome, empresa e solicitação. A equipe recebe o chamado no seu grupo
Telegram e responde com `/responder@UsuarioDoBot PROTOCOLO mensagem`.
A integração com um sistema externo ainda depende da API do sistema escolhido.

**Para editar opções, respostas e setores, abra [src/config.json](src/config.json).**
Veja o passo a passo e exemplos em [Como editar o bot](EDITAR_BOT.md).

## Desenvolvimento e testes

Requer Node.js 22.9 ou superior (validado com Node 24).

```bash
npm ci
npm run check
npm test
npm run db:local
npm run dev
```

Os testes usam o runtime real `workerd` via Miniflare e D1 local temporário, com
Telegram simulado e todas as saídas de rede interceptadas. Eles não enviam mensagens
reais nem exigem login na Cloudflare. O simulador precisa abrir portas locais.
Os testes incluem encaminhamento, isolamento entre setores/clientes, reenvio,
persistência e entrega duplicada do webhook. `npm run dev` não conecta o Telegram:
o Telegram precisa de uma URL HTTPS pública para entregar mensagens.

Para uso local, copie `.dev.vars.example` para `.dev.vars`, sem sobrescrever um
arquivo já existente. Esse arquivo é ignorado pelo Git; nunca publique tokens.
O banco local fica em `.wrangler/` e é separado do D1 remoto.

## Publicar na Cloudflare

Os passos desta seção são para o **fluxo direto Telegram → Worker**, usando um bot
dedicado ao teste. Para manter a integração de uma ferramenta de atendimento, siga
a arquitetura do manual e adapte o código à API dela antes de ativar o fluxo real.

Use um bot dedicado criado no **@BotFather**. Pare qualquer processo Python/long
polling antigo antes de registrar o webhook. O Telegram admite um webhook por bot.

1. Crie uma conta Cloudflare e habilite Workers e D1 no plano desejado. Confira os
   limites vigentes: [Workers](https://developers.cloudflare.com/workers/platform/pricing/)
   e [D1](https://developers.cloudflare.com/d1/platform/pricing/). Há faixas gratuitas;
   elas não garantem capacidade ilimitada nem disponibilidade contratual.
2. No terminal, na raiz deste repositório:

   ```bash
   npm ci
   npx wrangler login
   npx wrangler d1 create chatbot-atendimento
   ```

3. Coloque o `database_id` retornado em `wrangler.toml`, substituindo o UUID zerado.
   Preserve `binding = "DB"`. Defina `COMPANY_NAME` e os IDs negativos dos grupos
   `SUPORTE_CHAT_ID` e `FINANCEIRO_CHAT_ID` em `[vars]`. Para obter os IDs, veja abaixo.
4. Crie as tabelas remotas:

   ```bash
   npm run db:remote
   ```

5. Cadastre os segredos no Worker. Os comandos pedem os valores sem gravá-los no Git:

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```

   `TELEGRAM_BOT_TOKEN` é o token do BotFather. `TELEGRAM_WEBHOOK_SECRET` é uma senha
   independente, aleatória, usada para autenticar as chamadas recebidas. Gere uma:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Guarde ambos com segurança. Use o mesmo segredo do webhook no Worker e no comando
   de registro. Não coloque chaves em `wrangler.toml`, prints, Git ou conversas.
6. Publique:

   ```bash
   npm run check
   npm test
   npm run deploy
   ```

   O Wrangler retorna a URL pública `https://chatbot-atendimento.SEUSUBDOMINIO.workers.dev`.
   `GET /health` deve responder `{"ok":true}`; isso verifica configuração e acesso ao
   esquema D1, mas não comprova token Telegram válido ou entrega aos grupos.
7. No computador que fará o registro, defina as duas chaves em variáveis seguras ou
   em `.dev.vars` ignorado. Registrar os segredos na Cloudflare não os exporta para o
   seu terminal. Registre o webhook com a URL pública obtida:

   ```bash
   npm run telegram:webhook -- https://chatbot-atendimento.SEUSUBDOMINIO.workers.dev
   npm run telegram:check
   ```

   Em ambientes com proxy HTTPS, usando Node 24, execute esses comandos com
   `NODE_USE_ENV_PROXY=1` antes de `npm run`. Isso usa o proxy configurado sem
   desativar a verificação TLS. Segredos injetados por proxy no ambiente de
   desenvolvimento não são valores exportáveis para os segredos da Cloudflare;
   cadastre na Cloudflare a chave original por um canal seguro.

   O script verifica `/health` e chama `setWebhook` com `secret_token`,
   `allowed_updates: ["message"]`, `max_connections: 1` e preserva mensagens pendentes.
   Isso substitui o webhook anterior desse mesmo bot. Não use URLs de localhost.
   O diagnóstico mostra usuário do bot, webhook e contagem de mensagens pendentes,
   sem imprimir chaves. Erro de entrega deve ser investigado antes de liberar clientes.

### Obter os IDs e testar

- Crie dois grupos privados, adicione o bot e permita o envio de mensagens. Não precisa
  torná-lo administrador. Envie `/id@UsuarioDoBot` em cada grupo depois de registrar o
  webhook. Sem destinos configurados, esse comando já funciona.
- Cadastre os dois IDs negativos em `[vars]` do `wrangler.toml`, publique novamente
  e mantenha as mesmas chaves. `TEAM_CHAT_ID` é um fallback opcional para um grupo único.
- Na conversa privada do cliente, envie `/start`, escolha **1**, consulte um assunto
  se desejar e escolha **Falar com atendente**. Informe nome,
  empresa (ou `-`) e descrição. Confira o protocolo somente no grupo Suporte.
- No grupo, envie `/responder@UsuarioDoBot NUMERO_DO_PROTOCOLO Olá, vamos ajudar!`.
  A resposta deve chegar ao cliente. Repita para **2 — Financeiro**.
- Tente responder a um protocolo de Suporte pelo grupo Financeiro: deve ser recusado.
  Todos os membros de um grupo cadastrado podem responder: use grupos restritos à equipe.

## Publicação automática a partir do GitHub

Depois de enviar este código ao seu repositório e concluir a configuração inicial:

1. No Cloudflare Workers, conecte o Worker ao repositório GitHub pela integração Git.
2. Selecione a branch de produção e a raiz do projeto.
3. Use `npm ci && npm run check && npm test` no build.
4. Use `npm run db:remote && npm run deploy` no comando de publicação.
5. Mantenha o binding D1 e os segredos no Worker, com o mesmo nome de `wrangler.toml`.
   Se a configuração pedir um token de implantação, limite-o à conta e aos recursos
   necessários para Workers e D1; nunca salve esse token no repositório.

O webhook só precisa ser registrado novamente se mudar a URL, bot ou segredo.
Alterações futuras de esquema devem ser novas migrações compatíveis; não edite uma
migração já aplicada. A migração 0002 reconstrói a tabela de protocolos preservando
os dados para permitir novos setores. Faça backup do D1 e revise alterações de
banco antes da publicação automática. Cloudflare Workers Builds tem suas próprias
cotas; acompanhe-as além das cotas de execução e do D1.

## Comportamento e dados

- `/start`, `/menu`, `/ajuda`: abre o menu e descarta somente a coleta incompleta.
- `/cancelar`: cancela a coleta; não apaga protocolos existentes.
- `/reenviar PROTOCOLO`: somente o cliente dono pode reenviar um chamado pendente.
- `/responder PROTOCOLO texto`: somente o grupo do setor pode responder; funciona
  também com `@UsuarioDoBot`, recomendado para grupos com outros bots.
- Fotos, documentos e áudios recebem orientação para enviar texto. Mensagens adicionais
  do cliente passam por uma nova triagem; não há espelhamento completo da conversa.
- Nome: até 100; empresa: 150; descrição: 2500; resposta: 3500 unidades UTF-16.
  Emojis podem ocupar mais de uma unidade. O bot não interpreta HTML ou Markdown.
- Coletas incompletas sobrevivem a reinícios, pois ficam no D1. Os números de protocolo
  vêm do ID do update Telegram; não são necessariamente sequenciais.
- O webhook autentica o cabeçalho `X-Telegram-Bot-Api-Secret-Token`. A gravação de estado,
  protocolo e ações de saída usa uma transação D1 com controle de versão. Reentregas
  de um update não criam novos protocolos. Falhas transitórias em mensagens ao cliente
  retornam 503 para o Telegram tentar novamente; ações já confirmadas são preservadas.
- Falhas de notificação ao setor mantêm o chamado pendente. O cliente recebe a opção
  `/reenviar`. Um timeout pode ocorrer depois de o Telegram receber uma mensagem;
  nesse caso, uma repetição pode duplicar a mensagem, mantendo o mesmo protocolo.
- Uma ação em execução tem bloqueio temporário de 30 segundos para impedir envios
  concorrentes. O registro usa uma conexão webhook para preservar a ordem normal.
- Sessões, chamados e ações de saída contêm dados pessoais. Restrinja acesso ao D1,
  estabeleça retenção e backups. Não apague registros de deduplicação enquanto houver
  possibilidade de reentrega dos updates. Não existe limpeza automática nesta versão.
- A migração inicial cria um banco novo: ela não importa automaticamente os protocolos
  da versão Python. Se houver dados antigos de produção, preserve/exporte esse SQLite
  e planeje uma migração separada antes de trocar o bot. Não execute as duas versões.

## Organização

- `src/config.json`: setores, submenus, respostas e principais textos editáveis.
- `src/config.ts`: validação da configuração e substituição de marcadores de texto.
- `src/index.ts`: webhook, triagem, autorização, sessões D1 e saída para Telegram.
- `migrations/`: esquema D1 versionado.
- `scripts/telegram.mjs`: registro e diagnóstico do webhook sem expor tokens.
- `tests-worker/`: testes da versão Cloudflare.
- `legacy/python/`: versão anterior preservada como referência; não é usada no deploy.

A conversão local não publica código no GitHub, não cria recursos na sua conta
Cloudflare e não registra um webhook real. Essas operações exigem os acessos da conta.
