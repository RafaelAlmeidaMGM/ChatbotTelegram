# Atendimento no Telegram

Bot de primeira linha de atendimento em português. O cliente escolhe um setor por
número ou botão, informa nome, empresa e descreve a solicitação. O bot registra um
protocolo em SQLite e envia o chamado para o grupo correspondente no Telegram.
Um integrante desse grupo pode responder ao cliente pelo próprio bot.

| Opção | Setor | Variável do grupo |
| --- | --- | --- |
| 1 | Suporte ⚙️ | `SUPORTE_CHAT_ID` |
| 2 | Financeiro 💰 | `FINANCEIRO_CHAT_ID` |

Por enquanto, somente Suporte e Financeiro estão ativos. Novos setores podem ser
incluídos em `chatbot/departments.py` com número, chave, nome e emoji. A configuração
de destino segue a chave em maiúsculas com o sufixo `_CHAT_ID`; por exemplo,
`comercial` usaria `COMERCIAL_CHAT_ID`. Atualize também `.env.example` e esta tabela
ao habilitar um novo setor. As chaves dos setores existentes devem ser preservadas,
pois identificam o destino dos protocolos já registrados.

## Instalação

Requer Python 3.11 ou superior (validado com Python 3.12). Execute na raiz do projeto:

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
cp -n .env.example .env
```

No Windows, use `.venv\Scripts\python` no lugar de `.venv/bin/python`.
Edite o arquivo `.env` local ou configure variáveis no serviço de hospedagem.
O arquivo `.env` e o diretório `data/` estão no `.gitignore`.

## Criar e conectar o bot

1. No Telegram, abra o perfil oficial **@BotFather**, envie `/newbot` e siga as instruções.
2. Guarde o token em `TELEGRAM_BOT_TOKEN`, no `.env` local ou no gerenciador seguro
   de segredos da hospedagem. Não coloque o token no código, Git, prints ou mensagens.
3. Defina `COMPANY_NAME` com o nome que será exibido na saudação.
4. Crie um grupo privado para cada setor e adicione o bot a esses grupos, com permissão
   para enviar mensagens. Não é necessário torná-lo administrador.
5. Inicie o bot com o comando abaixo. Em cada grupo, envie `/id@NomeDoSeuBot` para
   obter o ID numérico. Cadastre os dois IDs nas variáveis da tabela e reinicie o processo.
   IDs de grupos são negativos; use o número inteiro, incluindo o sinal.
6. Para testar, abra a conversa privada com o bot e envie `/start`.

```bash
.venv/bin/python -m chatbot
```

`TEAM_CHAT_ID` é um destino padrão opcional, caso vários setores sejam atendidos no
mesmo grupo. O ID específico de cada setor tem prioridade sobre o padrão.
Sem destino configurado, o chamado é salvo como pendente e o cliente é informado de
que o encaminhamento está indisponível. Nenhum encaminhamento é simulado.

O bot usa **long polling**: basta uma conexão HTTPS de saída para `api.telegram.org`;
não exige domínio, porta pública ou webhook. Execute somente uma instância por token.
Não use o mesmo bot simultaneamente com outro sistema ou webhook ativo: o início do
polling remove o webhook existente. Use um bot dedicado durante desenvolvimento.

## Uso pelo cliente

```text
/start
1                            → escolhe Suporte
Maria Silva                  → nome
Empresa Exemplo              → empresa (ou - se não se aplica)
Não consigo acessar o sistema. → descrição

Protocolo #000001
Sua solicitação foi encaminhada à equipe responsável.
```

- `/menu`: volta ao menu e descarta a coleta ainda não enviada.
- `/cancelar`: cancela apenas a coleta em andamento, sem excluir protocolos já salvos.
- `/reenviar 1`: tenta novamente um protocolo próprio que ainda está pendente.
- Fotos, áudios e documentos recebem uma orientação para continuar em texto.

## Uso pela equipe

No grupo do setor, o bot envia o protocolo, setor, nome, empresa e descrição.
Para responder ao cliente:

```text
/responder@NomeDoSeuBot 1 Olá, Maria! Vamos ajudar com seu acesso.
```

A resposta chega na conversa privada do cliente com o bot. O comando também funciona
como `/responder 1 ...` quando o Telegram entrega a mensagem ao bot. A forma com
`@NomeDoSeuBot` evita ambiguidades em grupos com mais de um bot.

Somente o grupo configurado para o setor do protocolo pode responder. **Qualquer
integrante desse grupo** pode usar o comando: mantenha nesses grupos apenas a equipe
autorizada. Grupos não cadastrados e grupos de outros setores não obtêm o chamado.

Esta versão faz triagem e encaminha uma solicitação por vez. Ela não usa IA, não
responde dúvidas automaticamente e não espelha uma conversa inteira de atendimento:
mensagens adicionais do cliente exigem um novo fluxo pelo `/menu`. As respostas da
equipe podem ser enviadas ao protocolo já criado.

## Dados e operação

- `DATABASE_PATH` define o arquivo SQLite; o padrão é `data/atendimento.sqlite3`.
  Use armazenamento persistente e backups antes de colocar em produção. Não publique
  esse arquivo: ele contém dados pessoais e o texto das solicitações.
- Protocolos e situação do encaminhamento sobrevivem a reinícios. A coleta ainda
  incompleta fica em memória; após reiniciar, o cliente deve usar `/menu`.
- Chamados pendentes não são reenviados automaticamente. Depois de corrigir o ID,
  permissões ou conexão, o cliente pode usar `/reenviar NUMERO_DO_PROTOCOLO`.
- Em caso de timeout, o Telegram pode ter recebido a mensagem sem confirmar. Um
  reenvio pode duplicar a notificação; o número de protocolo será o mesmo.
- Logs não imprimem o token, URLs das requisições ou o texto dos chamados.
- Para uso contínuo, hospede o processo em um serviço que reinicie o bot após falhas
  e mantenha o banco. Um processo de desenvolvimento nesta máquina não garante 24h.

## Testes

```bash
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m pip check
```

Os testes usam Telegram simulado e um banco temporário: não enviam mensagens reais
nem precisam de token. A validação real exige o token e os grupos configurados:

1. Abra o bot com uma conta de cliente e percorra as duas opções.
2. Confirme que cada protocolo chega somente ao grupo do setor escolhido.
3. Responda com `/responder@NomeDoSeuBot NUMERO mensagem` e confira o recebimento.
4. Tente responder por outro setor e confirme que o envio é recusado.

Os testes locais não substituem essa validação com a conta real do Telegram.
