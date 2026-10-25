import { departments, texts, format } from './config';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  COMPANY_NAME?: string;
  SUPORTE_CHAT_ID?: string;
  FINANCEIRO_CHAT_ID?: string;
  TEAM_CHAT_ID?: string;
}
interface Message { chat: { id: number; type: string }; from?: { username?: string }; text?: string }
interface Update { update_id: number; message?: Message }
interface Draft { department: string; stage: 'submenu' | 'name' | 'company' | 'description'; name?: string; company?: string; topic?: string }
interface Ticket {
  id: number; chat_id: number; username: string | null; department: string;
  customer_name: string; company: string; description: string; delivery_status: string;
}
type Action = {
  kind: 'text' | 'deliver' | 'confirmation' | 'staffAck';
  chat: number; text?: string; markup?: object; ticket?: number;
};
type DB = ReturnType<D1Database['withSession']>;
const button = (d: typeof departments[number]) => `${d.number} - ${d.label} ${d.emoji}`;
const menu = texts.menuPrompt + '\n\n' + departments.map(button).join('\n');
const keyboard = { keyboard: departments.map(d => [button(d)]), resize_keyboard: true, one_time_keyboard: true };
const removeKeyboard = { remove_keyboard: true };
function target(env: Env, key: string): number | undefined {
  const variable = departments.find(d => d.key === key)?.chatIdVariable;
  if (!variable) return;
  const configured = (env as unknown as Record<string, unknown>)[variable];
  const raw = (typeof configured === 'string' ? configured.trim() : '') || env.TEAM_CHAT_ID?.trim();
  if (!raw || !/^-\d+$/.test(raw)) return;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value < 0 ? value : undefined;
}
function protocol(value?: string): number | undefined {
  if (!value || !/^\d{1,16}$/.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

async function plan(update: Update, draft: Draft | null, env: Env, db: DB) {
  const m = update.message!;
  const chat = m.chat.id;
  const text = m.text?.trim() || '';
  const command = /^\/(\w+)(?:@\w+)?(?:\s|$)/.exec(text)?.[1].toLowerCase();
  const args = text.split(/\s+/).slice(1);
  const actions: Action[] = [];
  let ticket: Ticket | undefined;
  const say = (text: string, markup?: object) => actions.push({ kind: 'text', chat, text, markup });
  if (command === 'id') { say(`ID deste chat: ${chat}`); return { draft, actions }; }
  if (m.chat.type !== 'private') {
    if (command !== 'responder' || !['group', 'supergroup'].includes(m.chat.type)) return { draft, actions };
    if (!departments.some(d => target(env, d.key) === chat)) {
      say('Este chat não está autorizado a responder atendimentos.');
    } else {
      const id = protocol(args[0]);
      const existing = id ? await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first<Ticket>() : null;
      if (!id || args.length < 2) say('Use /responder NUMERO_DO_PROTOCOLO Sua resposta.');
      else if (!existing || target(env, existing.department) !== chat) say('Protocolo não encontrado para este grupo.');
      else if (args.slice(1).join(' ').length > 3500) say('Envie uma resposta com até 3500 caracteres.');
      else {
        actions.push({ kind: 'text', chat: existing.chat_id,
          text: `Resposta da equipe — protocolo #${id}\n\n${args.slice(1).join(' ')}\n\nPara outra solicitação, use /menu.` });
        actions.push({ kind: 'staffAck', chat });
      }
    }
    return { draft, actions };
  }
  if (['start', 'menu', 'help', 'ajuda', 'cancelar'].includes(command || '')) {
    draft = null;
    say((command === 'cancelar' ? 'Coleta cancelada.\n\n' :
      format(texts.welcome, { company: (env.COMPANY_NAME || 'Atendimento').slice(0, 100) }) + '\n\n') + menu +
      '\n\n' + texts.privacy, keyboard);
  } else if (command === 'reenviar') {
    const id = args.length === 1 ? protocol(args[0]) : undefined;
    const existing = id ? await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first<Ticket>() : null;
    if (!id) say('Use /reenviar NUMERO_DO_PROTOCOLO.');
    else if (!existing || existing.chat_id !== chat) say('Protocolo não encontrado nesta conversa.');
    else if (existing.delivery_status === 'delivered') say('Esse protocolo já foi encaminhado à equipe.');
    else actions.push({ kind: 'deliver', chat, ticket: id }, { kind: 'confirmation', chat, ticket: id });
  } else if (command) say('Use /menu, /cancelar ou /reenviar NUMERO_DO_PROTOCOLO.');
  else if (!text) say('Envie uma mensagem de texto para continuar ou use /menu.');
  else if (!draft) {
    const selected = departments.find(d => [String(d.number), d.label.toLowerCase(), button(d).toLowerCase()].includes(text.toLowerCase()));
    if (!selected) say('Escolha uma das opções abaixo.\n\n' + menu, keyboard);
    else {
      draft = { department: selected.key, stage: 'submenu' };
      const options = selected.options.map(o => `${o.number} - ${o.label}`);
      say(format(texts.submenuPrompt, { sector: selected.label }) + '\n\n' + [...options, texts.back].join('\n'),
        { keyboard: [...options, texts.back].map(o => [o]), resize_keyboard: true });
    }
  } else if (draft.stage === 'submenu') {
    const department = departments.find(d => d.key === draft!.department);
    if (text === '0' || text.toLowerCase() === texts.back.toLowerCase() || !department) {
      draft = null; say(menu, keyboard);
    } else {
      const options = department.options.map(o => `${o.number} - ${o.label}`);
      const markup = { keyboard: [...options, texts.back].map(o => [o]), resize_keyboard: true };
      const selected = department.options.find(o => [String(o.number), o.label.toLowerCase(), `${o.number} - ${o.label}`.toLowerCase()].includes(text.toLowerCase()));
      if (!selected) say('Escolha uma das opções abaixo.\n\n' + [...options, texts.back].join('\n'), markup);
      else if (selected.action === 'answer') {
        draft = { ...draft, topic: selected.label };
        say(selected.answer! + '\n\n' + texts.afterAnswer, markup);
      } else {
        draft = { ...draft, stage: 'name' };
        say(format(texts.askName, { sector: department.label }), removeKeyboard);
      }
    }
  } else if (draft.stage === 'name') {
    if (text.length > 100) say('Informe um nome com até 100 caracteres.');
    else { draft = { ...draft, name: text, stage: 'company' }; say(texts.askCompany); }
  } else if (draft.stage === 'company') {
    if (text.length > 150) say('Informe uma empresa com até 150 caracteres.');
    else { draft = { ...draft, company: text === '-' ? 'Não informado' : text, stage: 'description' }; say(texts.askDescription); }
  } else if (text.length > 2500) say('Resuma a solicitação em até 2500 caracteres.');
  else {
    ticket = { id: update.update_id, chat_id: chat, username: m.from?.username || null,
      department: draft.department, customer_name: draft.name!, company: draft.company!,
      description: (draft.topic ? `Assunto: ${draft.topic}\n\n` : '') + text, delivery_status: 'pending' };
    actions.push({ kind: 'deliver', chat, ticket: ticket.id }, { kind: 'confirmation', chat, ticket: ticket.id });
    draft = null;
  }
  return { draft, actions, ticket };
}

async function persist(update: Update, env: Env, db: DB) {
  const chat = update.message!.chat.id;
  await db.prepare('INSERT OR IGNORE INTO sessions (chat_id) VALUES (?)').bind(chat).run();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await db.prepare('SELECT id FROM updates WHERE id = ?').bind(update.update_id).first()) return;
    const session = await db.prepare('SELECT version, draft FROM sessions WHERE chat_id = ?').bind(chat).first<{ version: number; draft: string | null }>();
    const result = await plan(update, session!.draft ? JSON.parse(session!.draft) : null, env, db);
    const statements = [
      db.prepare('INSERT INTO updates (id, chat_id) VALUES (?, ?)').bind(update.update_id, chat),
      db.prepare('UPDATE sessions SET version = ?, draft = ? WHERE chat_id = ?')
        .bind(session!.version + 1, result.draft ? JSON.stringify(result.draft) : null, chat),
    ];
    if (result.ticket) {
      const t = result.ticket;
      statements.push(db.prepare('INSERT INTO tickets (id, chat_id, username, department, customer_name, company, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(t.id, t.chat_id, t.username, t.department, t.customer_name, t.company, t.description));
    }
    result.actions.forEach((action, position) => statements.push(
      db.prepare('INSERT INTO outbox (update_id, position, action) VALUES (?, ?, ?)').bind(update.update_id, position, JSON.stringify(action))));
    try { await db.batch(statements); return; }
    catch (error) {
      // D1 batch is transactional. A concurrent duplicate or session change rolls back all writes.
      if (attempt === 4) throw error;
    }
  }
}

class TelegramFailure extends Error {
  constructor(readonly permanent: boolean) { super('Telegram request failed'); }
}
async function send(env: Env, chat: number, text: string, markup?: object) {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, reply_markup: markup }), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new TelegramFailure(false); }
  const body = await response.json() as { ok?: boolean; error_code?: number };
  if (!response.ok || !body.ok) {
    const code = body.error_code || response.status;
    throw new TelegramFailure(code === 400 || code === 403);
  }
}

async function flush(id: number, env: Env, db: DB) {
  const { results } = await db.prepare('SELECT * FROM outbox WHERE update_id = ? ORDER BY position').bind(id)
    .all<{ id: number; position: number; action: string; done: number; success: number | null }>();
  let previousSuccess = true;
  for (const row of results) {
    if (row.done) { previousSuccess = Boolean(row.success); continue; }
    const claimed = await db.prepare('UPDATE outbox SET lease_until = ? WHERE id = ? AND done = 0 AND lease_until < ? RETURNING id')
      .bind(Date.now() + 30000, row.id, Date.now()).first();
    if (!claimed) throw new Error('Delivery busy');
    const a = JSON.parse(row.action) as Action;
    let success = true;
    try {
      if (a.kind === 'deliver') {
        const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(a.ticket!).first<Ticket>();
        if (t!.delivery_status !== 'delivered') {
          const destination = target(env, t!.department);
          if (!destination) success = false;
          else {
            try {
              await send(env, destination, `Novo atendimento #${t!.id}\nSetor: ${departments.find(d => d.key === t!.department)!.label}\nNome: ${t!.customer_name}\nEmpresa: ${t!.company}\nTelegram: ${t!.username ? '@' + t!.username : 'Sem nome de usuário'}\n\n${t!.description}\n\nPara responder:\n/responder ${t!.id} Sua resposta`);
            } catch (error) { if (!(error instanceof TelegramFailure)) throw error; success = false; }
            if (success) await db.prepare("UPDATE tickets SET delivery_status = 'delivered' WHERE id = ?").bind(t!.id).run();
          }
        }
      } else if (a.kind === 'confirmation') {
        const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(a.ticket!).first<Ticket>();
        await send(env, a.chat, `Protocolo #${t!.id}\n` + (t!.delivery_status === 'delivered'
          ? texts.delivered
          : format(texts.pending, { protocol: t!.id })) + '\n\n' + texts.newRequest, removeKeyboard);
      } else if (a.kind === 'staffAck') {
        await send(env, a.chat, previousSuccess ? 'Resposta enviada ao cliente.' : 'Não foi possível enviar. O cliente pode ter bloqueado o bot.');
      } else await send(env, a.chat, a.text!, a.markup);
    } catch (error) {
      if (error instanceof TelegramFailure && error.permanent) success = false;
      else {
        await db.prepare('UPDATE outbox SET lease_until = 0 WHERE id = ?').bind(row.id).run();
        throw error;
      }
    }
    await db.prepare('UPDATE outbox SET done = 1, success = ?, lease_until = 0 WHERE id = ?').bind(success ? 1 : 0, row.id).run();
    previousSuccess = success;
  }
}

async function authorized(request: Request, secret: string): Promise<boolean> {
  const received = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(secret), digest(received)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return new Response('Missing configuration', { status: 503 });
    if (path === '/health' && request.method === 'GET') {
      try { await env.DB.prepare('SELECT id FROM updates LIMIT 1').first(); return Response.json({ ok: true }); }
      catch { return new Response('Database unavailable', { status: 503 }); }
    }
    if (path !== '/webhook') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!await authorized(request, env.TELEGRAM_WEBHOOK_SECRET)) return new Response('Unauthorized', { status: 401 });
    let update: Update;
    try { update = await request.json() as Update; }
    catch { return new Response('Invalid JSON', { status: 400 }); }
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 1) return new Response('Invalid update', { status: 400 });
    if (!update.message) return new Response('OK');
    if (!Number.isSafeInteger(update.message.chat?.id) || typeof update.message.chat.type !== 'string' ||
        (update.message.text !== undefined && typeof update.message.text !== 'string')) return new Response('Invalid message', { status: 400 });
    try {
      const db = env.DB.withSession('first-primary');
      await persist(update, env, db);
      await flush(update.update_id, env, db);
      return new Response('OK');
    } catch {
      // Never log exceptions with authenticated Telegram URLs or customer payloads.
      console.error('Webhook processing failed; Telegram may retry.');
      return new Response('Retry later', { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
