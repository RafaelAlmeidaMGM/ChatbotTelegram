import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const helper = resolve('scripts/ajustar-helpdesk.mjs');
const original = [
  '// surrounding content must remain intact: BEFORE',
  'const PORT = Number(process.env.DEMO_PORT ?? 8080);',
  'const URL_BASE = `http://localhost:${PORT}`;',
  'const env = {',
  '  PUBLIC_URL: URL_BASE,',
  '};',
  'const calls = [];',
  'async function waitHealthy(url) { calls.push(url); }',
  'await waitHealthy(`${URL_BASE}/api/health`);',
  'console.log(JSON.stringify({ url: URL_BASE, env, calls }));',
  '// surrounding content must remain intact: AFTER',
  '',
].join('\n');

function fixture(t, { project = 'mgm-helpdesk', source = original } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mgm-startup-helper-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: project, type: 'module' }));
  const demo = join(directory, 'scripts', 'demo.mjs');
  const backup = demo + '.before-public-url.bak';
  writeFileSync(demo, source);
  const run = () => {
    const result = spawnSync(process.execPath, [helper], {
      cwd: directory, env: { PATH: process.env.PATH || '' }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    return result;
  };
  const evaluate = (settings = {}) => {
    // This is only the tiny fixture above, never the real Helpdesk bootstrap.
    const result = spawnSync(process.execPath, [demo], {
      cwd: directory, env: { PATH: process.env.PATH || '', ...settings }, encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { directory, demo, backup, run, evaluate };
}

test('helper applies PUBLIC_URL and keeps readiness local, without changing surrounding source', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.backup, 'utf8'), original);
  const changed = readFileSync(f.demo, 'utf8');
  assert.ok(changed.startsWith('// surrounding content must remain intact: BEFORE\n'));
  assert.ok(changed.endsWith('// surrounding content must remain intact: AFTER\n'));
  const actual = f.evaluate({ PUBLIC_URL: 'https://helpdesk.example.test///', DEMO_PORT: '8088' });
  assert.equal(actual.url, 'https://helpdesk.example.test');
  assert.equal(actual.env.PUBLIC_URL, actual.url);
  assert.deepEqual(actual.calls, ['http://127.0.0.1:8088/api/health']);
});

test('helper retains localhost fallback when PUBLIC_URL is not configured', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const actual = f.evaluate();
  assert.equal(actual.url, 'http://localhost:8080');
  assert.equal(actual.env.PUBLIC_URL, actual.url);
  assert.deepEqual(actual.calls, ['http://127.0.0.1:8080/api/health']);
});

test('running helper twice is idempotent and preserves the original backup', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const once = readFileSync(f.demo, 'utf8');
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(f.demo, 'utf8'), once);
  assert.equal(readFileSync(f.backup, 'utf8'), original);
});

test('helper refuses another project without touching source or creating a backup', t => {
  const f = fixture(t, { project: 'chatbot-telegram-workers' });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.demo, 'utf8'), original);
  assert.equal(existsSync(f.backup), false);
});

test('helper refuses unexpected layout before modifying source', t => {
  for (const source of [
    original.replace('const URL_BASE = `http://localhost:${PORT}`;', 'const ANOTHER_URL = "http://localhost:8080";'),
    original.replace('  PUBLIC_URL: URL_BASE,', '  OTHER_URL: URL_BASE,'),
  ]) {
    const f = fixture(t, { source });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(f.demo, 'utf8'), source);
    assert.equal(existsSync(f.backup), false);
  }
});

test('helper preserves a backup file that already exists', t => {
  const f = fixture(t);
  const saved = 'Pre-existing backup owned by the user.\n';
  writeFileSync(f.backup, saved);
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(f.backup, 'utf8'), saved);
  assert.equal(f.evaluate({ PUBLIC_URL: 'https://helpdesk.example.test' }).url, 'https://helpdesk.example.test');
});
