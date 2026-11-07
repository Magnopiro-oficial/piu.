// Reconhecimento dos arquivos de cada release (scripts/release-products.mjs, usado por sync-release.mjs).
// Os nomes conferidos são de verdade: os que já estão publicados (src/lib/releases.json) e os que os
// empacotadores do piu-node geram com a versão e as revisões atuais do repositório.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assetId, PRODUCTS, tagVersion } from './release-products.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => readFileSync(repo + p, 'utf8');
const releases = JSON.parse(read('apps/site/src/lib/releases.json'));

test('arquivos já publicados continuam reconhecidos com o mesmo id', () => {
  let n = 0;
  for (const product of ['android', 'desktop', 'provider']) {
    const r = releases[product];
    for (const [id, a] of Object.entries(r.assets)) {
      assert.equal(assetId(product, r.version, a.name), id, `${product}: ${a.name}`);
      n++;
    }
  }
  assert.ok(n >= 10);
});

test('node: o .ipk e o .deb que os empacotadores geram hoje', () => {
  const version = JSON.parse(read('apps/piu-node/package.json')).version;
  const ipkRel = /^PKG_RELEASE:=(\S+)$/m.exec(read('packaging/openwrt/Makefile'))[1];
  const debRev = JSON.parse(read('packaging/linux/package.json')).debRevision;
  assert.equal(assetId('node', version, `piu-node_${version}-${ipkRel}_all.ipk`), 'ipk');
  assert.equal(assetId('node', version, `piu-node_${version}-${debRev}_all.deb`), 'deb');
  assert.equal(assetId('node', version, 'SHA256SUMS.txt'), 'sums');
  assert.equal(assetId('node', version, 'SHA256SUMS.txt.asc'), 'sig');
  // Outra versão, outro produto ou arquitetura específica: não é deste release.
  assert.equal(assetId('node', version, `piu-node_9.9.9-1_all.ipk`), null);
  assert.equal(assetId('node', version, `piu-node_${version}-1_arm64.deb`), null);
  assert.equal(assetId('node', version, `Piu-${version}.apk`), null);
});

test('node: as revisões esperadas no site batem com as dos empacotadores', () => {
  const ipkRel = /^PKG_RELEASE:=(\S+)$/m.exec(read('packaging/openwrt/Makefile'))[1];
  const debRev = JSON.parse(read('packaging/linux/package.json')).debRevision;
  const ts = read('apps/site/src/lib/nodeRelease.ts');
  assert.match(ts, new RegExp(`IPK_RELEASE = '${ipkRel}'`), 'nodeRelease.ts: IPK_RELEASE = PKG_RELEASE do Makefile');
  assert.match(ts, new RegExp(`DEB_REVISION = '${debRev}'`), 'nodeRelease.ts: DEB_REVISION = debRevision de packaging/linux');
});

test('tags: produto-vX.Y.Z, só do próprio produto', () => {
  assert.equal(tagVersion('node', 'node-v0.1.0'), '0.1.0');
  assert.equal(tagVersion('android', 'android-v0.1.1'), '0.1.1');
  assert.equal(tagVersion('node', 'openwrt-v0.1.0'), null);
  assert.equal(tagVersion('node', 'node-v0.1'), null);
  assert.deepEqual(Object.keys(PRODUCTS), ['android', 'desktop', 'provider', 'node']);
});
