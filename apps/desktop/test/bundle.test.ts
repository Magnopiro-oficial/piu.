import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');

test('pacote do processo principal: import.meta.url vira a URL do main.cjs (o openpgp derrubava o app ao carregar)', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' });
  const main = readFileSync(join(root, 'dist/main.cjs'), 'utf8');
  assert.equal(/import_meta\.url/.test(main), false, 'import.meta.url sem definição no CommonJS');
  assert.match(main.slice(0, 400), /__piuImportMetaUrl = require\('node:url'\)\.pathToFileURL\(__filename\)\.href/);
  assert.match(main, /createRequire\)\(__piuImportMetaUrl\)/);
});
