// Node 22+. Reads secure environment or ignored .dev.vars; never logs authenticated URLs.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
async function api(method, data = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error('Telegram recusou a operação. Verifique credenciais e configuração.');
  return body.result;
}
try {
  const [command = 'check', ...args] = process.argv.slice(2);
  const replaceWebhook = args.includes('--replace-webhook');
  const urls = args.filter(arg => !arg.startsWith('--'));
  if (!['check', 'register'].includes(command) ||
      (command === 'check' && args.length !== 0) ||
      (command === 'register' && (urls.length !== 1 ||
        args.some(arg => arg.startsWith('--') && arg !== '--replace-webhook') ||
        args.filter(arg => arg === '--replace-webhook').length > 1))) {
    throw new Error('Uso: telegram.mjs check | register URL_HTTPS [--replace-webhook]');
  }
  if (!token) throw new Error('Configure TELEGRAM_BOT_TOKEN no ambiente seguro ou .dev.vars.');
  if (command === 'register') {
    if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error('Defina TELEGRAM_WEBHOOK_SECRET com 16 a 256 letras, números, _ ou -. Use o mesmo valor no Worker.');
    const url = new URL(urls[0]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Informe somente a origem HTTPS pública do Worker, sem caminho ou parâmetros.');
    }
    const webhookUrl = new URL('/webhook', url).href;
    const existing = await api('getWebhookInfo');
    if (typeof existing.url !== 'string') throw new Error('Não foi possível confirmar o webhook atual. Nenhuma alteração foi feita.');
    if (existing.url && existing.url !== webhookUrl && !replaceWebhook) {
      throw new Error('Este bot já está conectado a outro webhook. Nenhuma alteração foi feita. Para substituir intencionalmente essa conexão, use --replace-webhook; isso pode desconectar sua ferramenta de atendimento.');
    }
    const health = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(15000) });
    if (!health.ok || !(await health.json()).ok) throw new Error('Worker sem configuração/banco prontos. Corrija /health antes de registrar.');
    await api('setWebhook', { url: webhookUrl, secret_token: secret,
      allowed_updates: ['message'], max_connections: 1, drop_pending_updates: false });
    console.log('Webhook registrado. Teste /start na conversa privada com o bot.');
  } else {
    const bot = await api('getMe');
    const info = await api('getWebhookInfo');
    console.log(JSON.stringify({ bot: bot.username, webhook: info.url, pending_updates: info.pending_update_count,
      last_error_at: info.last_error_date || null }, null, 2));
  }
} catch (error) {
  // Do not print fetch exception details, URLs, bodies or stack traces with credentials.
  const safe = error instanceof TypeError ? 'Verifique a URL HTTPS e a conexão.' : error.message;
  console.error(safe.includes(token || '\0') ? 'Falha na operação do Telegram.' : safe);
  process.exitCode = 1;
}
