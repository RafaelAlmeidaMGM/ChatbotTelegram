// Execute este arquivo na raiz do MGM Helpdesk, nunca na raiz do chatbot Workers.
// Ajusta somente a inicialização da demonstração, sem executar o sistema ou ler senhas.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { constants } from 'node:fs';

const urlLine = "const URL_BASE = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\\/+$/, '');";
const oldHealth = 'await waitHealthy(`${URL_BASE}/api/health`);';
const newHealth = 'await waitHealthy(`http://127.0.0.1:${PORT}/api/health`);';

try {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'mgm-helpdesk') {
    throw new Error('Abra o terminal na pasta MGM Helpdesk que contem package.json com name mgm-helpdesk. Nenhum arquivo foi alterado.');
  }
  const path = resolve(root, 'scripts', 'demo.mjs');
  const original = await readFile(path, 'utf8');
  const urlPattern = /^[ \t]*const URL_BASE[ \t]*=[^;\r\n]*;[ \t]*$/gm;
  const matches = [...original.matchAll(urlPattern)];
  if (matches.length !== 1 || !/PUBLIC_URL\s*:\s*URL_BASE\b/.test(original) ||
      (!original.includes(oldHealth) && !original.includes(newHealth))) {
    throw new Error('O scripts/demo.mjs tem um formato diferente do analisado. Nenhum arquivo foi alterado; envie apenas as linhas URL_BASE e PUBLIC_URL para revisao.');
  }
  const adjusted = original.replace(urlPattern, () => urlLine).replace(oldHealth, newHealth);
  if (adjusted === original) {
    console.log('O arquivo ja esta ajustado para PUBLIC_URL. Nenhuma alteracao necessaria.');
  } else {
    const backup = path + '.before-public-url.bak';
    try { await copyFile(path, backup, constants.COPYFILE_EXCL); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log('Backup anterior preservado.');
    }
    await writeFile(path, adjusted, 'utf8');
    console.log('scripts/demo.mjs ajustado. Backup preservado em scripts/demo.mjs.before-public-url.bak.');
  }
  console.log('Pare a instancia antiga com Ctrl+C. Defina PUBLIC_URL no mesmo terminal e rode npm run demo uma unica vez.');
} catch (error) {
  console.error(error.code === 'ENOENT'
    ? 'Nao encontrei package.json ou scripts/demo.mjs. Execute na raiz do MGM Helpdesk.'
    : error.message);
  process.exitCode = 1;
}
