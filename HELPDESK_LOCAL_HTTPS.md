# Helpdesk local: corrigir PUBLIC_URL e verificar o tunel

Este procedimento e para a **pasta MGM Helpdesk**, que contem `scripts/demo.mjs`.
Nao execute nessa pasta os comandos de deploy do projeto ChatbotTelegram.

## Sintomas identificados

- `EADDRINUSE 127.0.0.1:8080`: outro processo ja estava escutando nessa porta.
- A linha `Abra: http://localhost:8080`, mesmo depois de definir PUBLIC_URL: o script
  analisado fixa URL_BASE em localhost e repassa esse valor a API.
- A interface mantem o aviso de que Telegram precisa de HTTPS e o canal desativado.

## Ajustar com backup

Abra o Prompt de Comando na raiz do MGM Helpdesk. O helper abaixo e mantido no
repositorio do chatbot, mas deve ser executado sobre a pasta **MGM Helpdesk**.
Voce pode ler seu codigo no GitHub antes de executa-lo.

```cmd
curl.exe -fL "https://raw.githubusercontent.com/RafaelAlmeidaMGM/ChatbotTelegram/main/scripts/ajustar-helpdesk.mjs" -o ajustar-helpdesk.mjs
node ajustar-helpdesk.mjs
```

O helper confere o nome do projeto e o formato do script antes de gravar. Ele:

1. Cria `scripts/demo.mjs.before-public-url.bak`, sem sobrescrever um backup existente.
2. Faz URL_BASE respeitar PUBLIC_URL, mantendo localhost como padrao quando a variavel nao existe.
3. Mantem o teste de saude inicial em loopback, para iniciar mesmo antes de o tunel estar pronto.
4. Preserva o restante do codigo e nao le `.demo/`, usuarios, banco ou chaves.

Ele nao encerra processos, nao registra webhooks e nao executa o Helpdesk. Repetir o
helper com o arquivo ja ajustado nao muda nada. Se o formato for diferente, ele para
sem alterar o arquivo.

## Reiniciar somente uma instancia

1. Na janela que ja executa MGM Helpdesk, pressione Ctrl+C e aguarde encerrar.
2. Mantenha a janela do `cloudflared` aberta. Use a URL da execucao atual do tunel.
3. No terminal do Helpdesk:

   ```cmd
   set "PUBLIC_URL=https://URL-ATUAL-DO-TUNEL.trycloudflare.com"
   npm run demo
   ```

   Substitua o endereco pelo real. Defina a variavel e inicie o sistema na mesma janela.

4. O terminal deve anunciar `Abra: https://URL-ATUAL-DO-TUNEL.trycloudflare.com`.
   Se ainda anunciar localhost, pare e confira se executou o helper na mesma copia
   do Helpdesk que esta iniciando.

### Se a porta continuar ocupada

Nao inicie repetidamente outras instancias. Em uma nova janela, execute:

```cmd
netstat -ano | findstr LISTENING | findstr :8080
```

O ultimo numero da linha e o PID. Confira o processo antes de encerra-lo:

```cmd
tasklist /FI "PID eq NUMERO_DO_PID"
```

Use Ctrl+C na janela do Helpdesk correspondente. Se precisar usar o Gerenciador de
Tarefas, confira a linha de comando do PID na aba Detalhes para identificar o script
do Helpdesk. Nao encerre todos os processos Node nem um processo desconhecido.
Nao use `demo:reset`: isso apaga os dados da demonstracao e nao corrige URL/porta.

## Testar a API sem depender da pagina

Com Helpdesk e tunel ligados, em outra janela:

```cmd
curl.exe -i http://127.0.0.1:8080/api/health
curl.exe -i https://URL-ATUAL-DO-TUNEL.trycloudflare.com/api/health
```

O esperado e HTTP 200 nos dois. Uma resposta do endpoint de saude nao contem as
credenciais que o bootstrap imprime. Para relatar problemas, envie esses resultados
e a linha `Abra: ...`, sem copiar o bloco de acessos/senhas.

- Local falha: o Helpdesk ainda nao esta atendendo na porta correta.
- Local 200 e publico 502: confira o destino/registro da janela cloudflared. Caso
  localhost esteja sendo resolvido para IPv6 e a API escute so em IPv4, um novo tunel
  apontando para `http://127.0.0.1:8080` pode resolver. Ele pode gerar outra URL; atualize
  PUBLIC_URL e reinicie o Helpdesk com o novo endereco.
- Ambos 200 e pagina em branco: precisamos do erro do Console/Rede do navegador;
  isso e um problema separado de inicializacao do frontend. Nao compartilhe cookies,
  cabecalhos de autenticacao ou tokens.
- Tunel conecta, mas canal continua avisando localhost: a instancia da API ainda
  esta recebendo a URL antiga; confira o ajuste e reinicie a instancia correta.

Quando a URL publica e o PUBLIC_URL estiverem corretos, acesse o Helpdesk pelo
endereco HTTPS, entre em Canais e ative o canal Telegram. O Helpdesk controla o bot;
nao registre o Worker diretamente nesse mesmo bot.

## Credenciais da demonstracao

O bootstrap original imprime senhas e as guarda em `.demo/`. Nao envie esse bloco em
prints ou mensagens e nao publique a pasta. Se ja compartilhou senhas, altere-as no
Helpdesk antes de continuar expondo os acessos pela internet. Este ajuste nao troca
senhas nem transforma a demonstracao em instalacao de producao.
