import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, Response, convertV4MiniflareOptions } from 'miniflare';

const secret = 'offline_webhook_secret_123';
async function fixture(t, bindings = {}) {
  const sent = [];
  let failure = null;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: 'dist/worker.js', compatibilityDate: '2026-10-25',
    d1Databases: ['DB'],
    bindings: { TELEGRAM_BOT_TOKEN: '123456:OFFLINE_ONLY', TELEGRAM_WEBHOOK_SECRET: secret,
      SUPORTE_CHAT_ID: '-1001', FINANCEIRO_CHAT_ID: '-1002', ...bindings },
    outboundService: async request => {
      assert.equal(new URL(request.url).hostname, 'api.telegram.org');
      const body = await request.json();
      const failed = failure?.(body);
      if (failed) {
        const status = typeof failed === 'number' ? failed : 403;
        return Response.json({ ok: false, error_code: status }, { status });
      }
      sent.push(body);
      return Response.json({ ok: true, result: { message_id: sent.length } });
    },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  // D1 exec accepts one-line SQL statements. Preserve the trigger body as a single statement.
  const migration = await readFile('migrations/0001_initial.sql', 'utf8');
  const statements = migration.match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g);
  await db.batch(statements.map(sql => db.prepare(sql)));
  const extension = await readFile('migrations/0002_extensible_departments.sql', 'utf8');
  await db.batch(extension.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()).map(sql => db.prepare(sql)));
  let counter = 1;
  const post = (payload, options = {}) => mf.dispatchFetch('https://bot.test/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret, ...options.headers },
    body: JSON.stringify(payload),
  });
  const payload = (text, chat = 42, id = counter++) => ({ update_id: id,
    message: { chat: { id: chat, type: chat > 0 ? 'private' : 'supergroup' }, from: { username: 'cliente' }, ...(text === null ? {} : { text }) } });
  const say = async (text, chat = 42) => {
    const update = payload(text, chat);
    const result = await post(update);
    assert.equal(result.status, 200, await result.text());
    return update;
  };
  const triage = async (choice = '1', chat = 42) => {
    await say(choice, chat); await say('Falar com atendente', chat); await say('Maria', chat); await say('-', chat);
    return say('Preciso de ajuda.', chat);
  };
  return { mf, db, sent, post, payload, say, triage, fail: fn => { failure = fn; } };
}

test('menu, two sectors, durable triage and authorized staff response', async t => {
  const f = await fixture(t);
  await f.say('/start');
  assert.deepEqual(f.sent.at(-1).reply_markup.keyboard.map(row => row[0]), ['1 - Suporte ⚙️', '2 - Financeiro 💰']);
  for (const [choice, group, department] of [['1', -1001, 'suporte'], ['2 - Financeiro 💰', -1002, 'financeiro']]) {
    const update = await f.triage(choice);
    const ticket = await f.db.prepare('SELECT * FROM tickets WHERE id=?').bind(update.update_id).first();
    assert.equal(ticket.department, department);
    assert.equal(ticket.company, 'Não informado');
    assert.equal(ticket.delivery_status, 'delivered');
    assert.equal(f.sent.at(-2).chat_id, group);
    await f.say(`/responder@MeuBot ${ticket.id} Vamos ajudar!`, group);
    assert.equal(f.sent.at(-2).chat_id, 42);
    assert.match(f.sent.at(-2).text, /Vamos ajudar!/);
    const before = f.sent.length;
    await f.post(update);
    assert.equal(f.sent.length, before, 'duplicate webhook sends no extra messages');
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM tickets WHERE id=?').bind(ticket.id).first()).n, 1);
  }
  assert.equal((await f.mf.dispatchFetch('https://bot.test/health')).status, 200);
});

test('authentication, invalid payloads, routes, unsupported updates and group chatter', async t => {
  const f = await fixture(t);
  assert.equal((await f.post(f.payload('/start'), { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' } })).status, 401);
  assert.equal((await f.post({ update_id: 'bad' })).status, 400);
  assert.equal((await f.post({ update_id: 33, message: {} })).status, 400);
  assert.equal((await f.post({ update_id: 34, message: { chat: { id: 42, type: 'private' }, text: {} } })).status, 400);
  assert.equal((await f.post({ update_id: 35, edited_message: {} })).status, 200);
  assert.equal((await f.mf.dispatchFetch('https://bot.test/other')).status, 404);
  assert.equal((await f.mf.dispatchFetch('https://bot.test/webhook')).status, 405);
  await f.say('1', -1001);
  assert.equal(f.sent.length, 0);
  await f.say('/id@MeuBot', -1001);
  assert.match(f.sent.at(-1).text, /-1001/);
});

test('limits, non-text, inactive sectors, cancel and restart of Worker preserve D1 draft', async t => {
  const f = await fixture(t);
  for (const text of ['3', '4', '5', '6', 'Comercial', null]) await f.say(text);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM tickets').first()).n, 0);
  await f.say('1'); await f.say('5'); await f.say('a'.repeat(101));
  assert.match(f.sent.at(-1).text, /100/);
  await f.say('Maria'); await f.say('a'.repeat(151));
  assert.match(f.sent.at(-1).text, /150/);
  await f.say('Empresa');
  const draft = await f.db.prepare('SELECT draft FROM sessions WHERE chat_id=42').first();
  assert.equal(JSON.parse(draft.draft).stage, 'description');
  // Every dispatch invokes the Worker anew; no state lives in module globals.
  await f.say('😀'.repeat(2500));
  assert.match(f.sent.at(-1).text, /2500/);
  await f.say('/cancelar');
  assert.equal((await f.db.prepare('SELECT draft FROM sessions WHERE chat_id=42').first()).draft, null);
});

test('delivery failure stays pending; only owner can retry; successful retry is not duplicated', async t => {
  const f = await fixture(t);
  f.fail(body => body.chat_id === -1002);
  const update = await f.triage('2');
  assert.equal((await f.db.prepare('SELECT delivery_status FROM tickets WHERE id=?').bind(update.update_id).first()).delivery_status, 'pending');
  assert.match(f.sent.at(-1).text, /indisponível/);
  await f.say(`/reenviar ${update.update_id}`, 99);
  assert.match(f.sent.at(-1).text, /não encontrado/);
  f.fail(null);
  await f.say(`/reenviar ${update.update_id}`);
  assert.equal(f.sent.at(-2).chat_id, -1002);
  await f.say(`/reenviar ${update.update_id}`);
  assert.match(f.sent.at(-1).text, /já foi/);
});

test('missing destination, cross-sector authorization, invalid protocols, blocked customer', async t => {
  const f = await fixture(t, { SUPORTE_CHAT_ID: '' });
  const pending = await f.triage('1');
  assert.match(f.sent.at(-1).text, /indisponível/);
  const finance = await f.triage('2');
  await f.say(`/responder ${finance.update_id} segredo`, -1001);
  assert.match(f.sent.at(-1).text, /não está autorizado/);
  await f.say(`/responder ${pending.update_id} segredo`, -1002);
  assert.match(f.sent.at(-1).text, /não encontrado/);
  for (const id of ['99999999999999999999999', '²', '0']) {
    await f.say(`/reenviar ${id}`); assert.match(f.sent.at(-1).text, /Use \/reenviar/);
  }
  f.fail(body => body.chat_id === 42);
  await f.say(`/responder ${finance.update_id} resposta`, -1002);
  assert.match(f.sent.at(-1).text, /Não foi possível/);
});

test('duplicate concurrent updates commit a ticket only once', async t => {
  const f = await fixture(t);
  await f.say('1'); await f.say('5'); await f.say('Maria'); await f.say('Empresa');
  const update = f.payload('Solicitação concorrente');
  const results = await Promise.all([f.post(update), f.post(update)]);
  assert.ok(results.some(r => r.status === 200));
  const retry = await f.post(update);
  assert.equal(retry.status, 200);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM tickets').first()).n, 1);
  assert.equal(f.sent.filter(s => s.chat_id === -1001).length, 1);
});

test('temporary client confirmation failure retries stored action without duplicating ticket or team notification', async t => {
  const f = await fixture(t);
  await f.say('1'); await f.say('5'); await f.say('Maria'); await f.say('Empresa');
  f.fail(body => body.chat_id === 42 ? 500 : false);
  const update = f.payload('Descrição final');
  assert.equal((await f.post(update)).status, 503);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM tickets').first()).n, 1);
  f.fail(null);
  assert.equal((await f.post(update)).status, 200);
  assert.equal(f.sent.filter(s => s.chat_id === -1001).length, 1);
  assert.match(f.sent.at(-1).text, /Protocolo/);
});

test('support answers all four topics without opening tickets and hands chosen topic to the team', async t => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile('src/config.json', 'utf8'));
  await f.say('1');
  assert.equal(f.sent.at(-1).reply_markup.keyboard.length, 6);
  for (const option of config.departments[0].options.filter(o => o.action === 'answer')) {
    await f.say(`${option.number} - ${option.label}`);
    assert.ok(f.sent.at(-1).text.startsWith(option.answer));
    assert.equal((await f.db.prepare('SELECT count(*) n FROM tickets').first()).n, 0);
  }
  await f.say('5');
  assert.match(f.sent.at(-1).text, /seu nome/);
  await f.say('Maria'); await f.say('Empresa');
  const update = await f.say('Tenho uma dúvida.');
  const ticket = await f.db.prepare('SELECT * FROM tickets WHERE id=?').bind(update.update_id).first();
  assert.match(ticket.description, /Assunto: Dúvidas sobre cadastros/);
  assert.equal(f.sent.at(-2).chat_id, -1001);
});

test('finance has only doubts and attendant, supports navigation and forwards doubt context', async t => {
  const f = await fixture(t);
  await f.say('2');
  assert.deepEqual(f.sent.at(-1).reply_markup.keyboard.map(row => row[0]), ['1 - Dúvidas', '2 - Falar com atendente', '0 - Voltar ao menu']);
  await f.say('9');
  assert.match(f.sent.at(-1).text, /Escolha/);
  await f.say('1');
  assert.match(f.sent.at(-1).text, /financeira/);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM tickets').first()).n, 0);
  await f.say('2'); await f.say('Maria'); await f.say('Empresa');
  await f.say('Preciso esclarecer uma cobrança.');
  assert.equal(f.sent.at(-2).chat_id, -1002);
  assert.match(f.sent.at(-2).text, /Assunto: Dúvidas/);
  await f.say('1'); await f.say('0');
  assert.equal((await f.db.prepare('SELECT draft FROM sessions WHERE chat_id=42').first()).draft, null);
  assert.match(f.sent.at(-1).text, /Financeiro/);
  await f.say('2'); await f.say('/menu'); await f.say('1');
  const draft = JSON.parse((await f.db.prepare('SELECT draft FROM sessions WHERE chat_id=42').first()).draft);
  assert.equal(draft.department, 'suporte');
  assert.equal(draft.stage, 'submenu');
});

test('extensible-sector migration preserves existing tickets and accepts new department keys', async t => {
  const f = await fixture(t);
  const update = await f.triage();
  const before = await f.db.prepare('SELECT * FROM tickets WHERE id=?').bind(update.update_id).first();
  const sql = await readFile('migrations/0002_extensible_departments.sql', 'utf8');
  await f.db.batch(sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()).map(s => f.db.prepare(s)));
  assert.deepEqual(await f.db.prepare('SELECT * FROM tickets WHERE id=?').bind(update.update_id).first(), before);
  await f.db.prepare("INSERT INTO tickets (id, chat_id, department, customer_name, company, description) VALUES (9999, 42, 'comercial', 'Maria', 'Empresa', 'Nova solicitação')").run();
  assert.equal((await f.db.prepare('SELECT department FROM tickets WHERE id=9999').first()).department, 'comercial');
});
