import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run the CLI in an isolated child process with fetch replaced before imports.
// No Cloudflare or Telegram network request is possible in these tests.
function run(t, currentUrl, args = ['register', 'https://new-worker.example']) {
  const directory = mkdtempSync(join(tmpdir(), 'telegram-cli-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const callsPath = join(directory, 'calls.jsonl');
  const mockPath = join(directory, 'mock.mjs');
  writeFileSync(mockPath, `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'new-worker.example' && parsed.pathname === '/health') {
        appendFileSync(process.env.TEST_CALLS, JSON.stringify({ method: 'health' }) + '\\n');
        return Response.json({ ok: true });
      }
      if (parsed.hostname !== 'api.telegram.org') throw new Error('Unexpected host');
      const method = parsed.pathname.split('/').at(-1);
      appendFileSync(process.env.TEST_CALLS, JSON.stringify({ method }) + '\\n');
      if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: process.env.TEST_CURRENT_URL } });
      if (method === 'setWebhook') return Response.json({ ok: true, result: true });
      if (method === 'getMe') return Response.json({ ok: true, result: { username: 'offline_bot' } });
      throw new Error('Unexpected API method');
    };
  `);
  const token = '123456:OFFLINE_SECRET';
  const secret = 'offline_secret_123456';
  const result = spawnSync(process.execPath, ['--import', mockPath, resolve('scripts/telegram.mjs'), ...args], {
    cwd: directory,
    env: { PATH: process.env.PATH || '', TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_WEBHOOK_SECRET: secret, TEST_CALLS: callsPath, TEST_CURRENT_URL: currentUrl },
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  let calls = [];
  try { calls = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
  assert.ok(!(result.stdout + result.stderr).includes(secret));
  return { ...result, calls: calls.map(call => call.method) };
}

test('register refuses a different existing webhook without changing or exposing it', t => {
  const result = run(t, 'https://support.example/private?key=do-not-print');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Nenhuma alteração foi feita/);
  assert.match(result.stderr, /--replace-webhook/);
  assert.ok(!result.stderr.includes('do-not-print'));
  assert.deepEqual(result.calls, ['getWebhookInfo']);
});

test('explicit replacement checks health and registers the new webhook', t => {
  const result = run(t, 'https://support.example/webhook', ['register', 'https://new-worker.example', '--replace-webhook']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['getWebhookInfo', 'health', 'setWebhook']);
  assert.match(result.stdout, /Webhook registrado/);
});

test('same webhook URL may be registered without a replacement flag', t => {
  const result = run(t, 'https://new-worker.example/webhook');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['getWebhookInfo', 'health', 'setWebhook']);
});

test('initial empty webhook may be registered', t => {
  const result = run(t, '');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['getWebhookInfo', 'health', 'setWebhook']);
});

test('unknown flags and invalid CLI usage make no API requests', t => {
  for (const args of [
    ['unknown'], ['check', 'extra'], ['register'],
    ['register', 'https://new-worker.example', '--unknown'],
    ['register', 'https://new-worker.example', '--replace-webhook', '--replace-webhook'],
  ]) {
    const result = run(t, '', args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Uso:/);
    assert.deepEqual(result.calls, []);
  }
});
