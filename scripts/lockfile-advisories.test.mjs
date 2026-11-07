// node --test scripts/lockfile-advisories.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ADVISORIES, LOCKFILES, ROOT, compareVersions, findVulnerable, isVulnerable } from './lockfile-advisories.mjs';

const adv = id => ADVISORIES.find(a => a.id === id);

test('faixa vulnerável: "desde" incluso, "corrigido" excluído', () => {
  const mm = adv('GHSA-g3hv-75wg-m249');
  assert.equal(isVulnerable('6.2.0', mm), false);
  assert.equal(isVulnerable('7.0.0', mm), true);
  assert.equal(isVulnerable('9.0.9', mm), true);
  assert.equal(isVulnerable('10.2.6', mm), true, 'a 10.x mais nova ainda é vulnerável');
  assert.equal(isVulnerable('11.0.0', mm), true);
  assert.equal(isVulnerable('11.0.1', mm), false);
  assert.equal(isVulnerable('3.1.5', mm), false, 'minimatch 3 (glob 7, asar) fica fora');
  const gl = adv('GHSA-3g3m-2fjr-6pw4');
  assert.equal(isVulnerable('7.2.3', gl), false);
  assert.equal(isVulnerable('13.0.6', gl), true);
  assert.equal(isVulnerable('14.0.1', gl), true);
  assert.equal(isVulnerable('14.0.2', gl), false);
  assert.equal(isVulnerable('11.0.0-rc.1', mm), true, 'pré-lançamento conta como a própria versão');
  assert.equal(compareVersions('10.10.0', '10.9.9'), 1, 'compara número, não texto');
});

test('acha pacote vulnerável em qualquer profundidade do lockfile, inclusive com alias', () => {
  const lock = { packages: {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/minimatch': { version: '11.0.5' },
    'node_modules/@electron/universal/node_modules/minimatch': { version: '9.0.9' },
    'node_modules/meu-glob': { name: 'glob', version: '13.0.6' },
    'node_modules/glob': { version: '7.2.3' },
  } };
  assert.deepEqual(findVulnerable(lock).map(h => `${h.path}@${h.version}`), [
    'node_modules/@electron/universal/node_modules/minimatch@9.0.9',
    'node_modules/meu-glob@13.0.6',
  ]);
});

for (const rel of LOCKFILES) {
  test(`${rel}: nenhuma versão com alerta conhecido`, { skip: !existsSync(join(ROOT, rel)) && 'lockfile ausente' }, () => {
    assert.deepEqual(findVulnerable(JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))), []);
  });
}

test('a correção fica nos overrides do app (o lockfile não volta sozinho para a versão vulnerável)', () => {
  for (const app of ['apps/mobile', 'apps/desktop', 'apps/provider-desktop']) {
    const ov = JSON.parse(readFileSync(join(ROOT, app, 'package.json'), 'utf8')).overrides ?? {};
    assert.equal(ov['minimatch@>=7.0.0 <11.0.1'], '^11.0.5', app);
  }
  const mobile = JSON.parse(readFileSync(join(ROOT, 'apps/mobile/package.json'), 'utf8')).overrides;
  assert.equal(mobile['glob@>=9.0.0 <14.0.2'], '^14.0.4');
});
