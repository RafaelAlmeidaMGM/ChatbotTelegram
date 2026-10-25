# Como editar o bot

Abra **`src/config.json`** no GitHub ou no seu editor. Esse é o arquivo principal
para alterar setores, opções dos submenus e respostas prontas. Os textos iniciais
são orientações gerais; substitua-os pelos procedimentos aprovados da sua empresa.
Não escreva senhas, tokens ou dados de clientes nesse arquivo.

## Onde fica cada coisa

| O que deseja mudar | Local em `src/config.json` |
| --- | --- |
| Saudação | `texts.welcome` |
| Pergunta do menu principal | `texts.menuPrompt` |
| Pergunta do submenu | `texts.submenuPrompt` |
| Orientação depois de uma resposta | `texts.afterAnswer` |
| Perguntas de nome, empresa e descrição | `texts.askName`, `askCompany`, `askDescription` |
| Confirmação e aviso de envio indisponível | `texts.delivered`, `texts.pending` |
| Nome, número e emoji de cada setor | `departments` → `label`, `number`, `emoji` |
| Opções de um setor | `departments` → `options` |
| Resposta automática de uma opção | `options` → `answer` |

`COMPANY_NAME` em `wrangler.toml` define o nome da empresa na saudação.
Mensagens técnicas de erro, validações de tamanho e comandos ficam em `src/index.ts`.

## Editar uma resposta ou criar outra opção

Dentro de `options` do setor, uma resposta pronta tem este formato:

```json
{
  "number": 6,
  "label": "Dúvidas sobre atualização",
  "action": "answer",
  "answer": "Escreva aqui a orientação aprovada pela sua equipe."
}
```

Use um número ainda não utilizado **naquele submenu** e uma resposta de até 3000
unidades UTF-16. Para quebrar linhas dentro de uma resposta JSON, escreva `\n`.
Após a resposta, o cliente continua no submenu. Não é criado um protocolo nem
enviada uma notificação à equipe apenas por consultar a resposta.

A opção que abre o atendimento tem `"action": "handoff"`:

```json
{ "number": 5, "label": "Falar com atendente", "action": "handoff" }
```

Ela inicia a coleta de nome, empresa e solicitação. O último assunto consultado é
incluído no chamado. Mantenha pelo menos uma opção `handoff` em cada setor.
O número `0` é reservado para voltar ao menu principal. `/menu` e `/cancelar` também
descartam a coleta incompleta. Os números são interpretados no menu atual: **2** no
menu principal é Financeiro; **2** no submenu Suporte é Problema no PDV.

## Adicionar um setor

Acrescente um objeto na lista `departments`. Exemplo de terceiro setor:

```json
{
  "key": "comercial",
  "number": 3,
  "label": "Comercial",
  "emoji": "💼",
  "chatIdVariable": "COMERCIAL_CHAT_ID",
  "options": [
    { "number": 1, "label": "Dúvidas", "action": "answer", "answer": "Escreva aqui as orientações comerciais." },
    { "number": 2, "label": "Falar com atendente", "action": "handoff" }
  ]
}
```

Em `[vars]` do `wrangler.toml`, adicione `COMERCIAL_CHAT_ID` com o ID negativo do
grupo correspondente. Use `/id@UsuarioDoBot` para obtê-lo. Atualize `.dev.vars`
se quiser usar a variável localmente. Não há necessidade de alterar a função de
encaminhamento nem de criar outra tabela ao incluir novos setores.

- `key`: identificador estável, minúsculo, sem espaços ou acentos. Não troque a chave
  de um setor já usado: os protocolos existentes dependem dela para receber respostas.
- `number`: inteiro positivo, único no menu principal.
- `label`: nome exibido ao cliente, até 100 caracteres.
- `chatIdVariable`: nome da variável de destino; use o padrão `SETOR_CHAT_ID`.
- Outros setores devem seguir o modelo de submenu simples de Financeiro (Dúvidas e
  Falar com atendente), a menos que você queira personalizá-los.

O bot verifica números e chaves duplicados, opções sem respostas e falta de uma
opção de atendente. Testes também verificam as opções atuais; ao mudar o menu,
atualize as expectativas em `tests-worker/bot.test.mjs` para a nova configuração.

## Publicar as alterações

Salve o JSON com aspas duplas e vírgulas entre os objetos, sem vírgula depois do
último item. Execute na raiz:

```bash
npm run check
npm test
npm run db:remote
npm run deploy
```

A migração **0002** libera novos setores no D1 e preserva os protocolos existentes.
Ela deve ser aplicada uma vez antes de utilizar esta versão; o comando de migração
só aplica arquivos pendentes. Não edite migrações já aplicadas.

Se a integração GitHub → Cloudflare estiver configurada conforme o README, salvar
as alterações na branch de produção aciona os mesmos checks e a publicação.
Editar o arquivo localmente não altera sozinho o bot que já está online. Mantenha
o nome e a URL do Worker: mudanças de texto não exigem registrar o webhook de novo.
