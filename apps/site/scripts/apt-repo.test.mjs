// Partes puras de scripts/apt-repo.mjs: escolha do release, leitura do SHA256SUMS.txt e conferência dos .deb.
// O resto (download, apt-ftparchive, gpg) é testado de ponta a ponta num container Debian
// (docs/distribuicao/linux-apt-appimagehub.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APT_PRODUCTS, checkFingerprint, parseSums, pickRelease, verifyDeb } from './apt-repo.mjs';

const H = c => c.repeat(64);
const asset = (name, digest = `sha256:${H('a')}`) => ({ name, browser_download_url: `https://github.com/Magnopiro-oficial/piu./releases/download/x/${name}`, digest, size: 10, state: 'uploaded' });
const rel = (tag, assets, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets, ...extra });

test('produtos do apt: Desktop, Provider e Node, cada um com o seu .deb', () => {
  assert.deepEqual(Object.keys(APT_PRODUCTS), ['desktop', 'provider', 'node']);
});

test('escolhe a maior versão publicada, ignorando rascunho, pré-release, outros produtos e release sem .deb', () => {
  const list = [
    rel('android-v0.1.5', [asset('Piu-0.1.5.apk')]),
    rel('desktop-v0.1.10', [asset('Piu-0.1.10-linux-amd64.deb'), asset('SHA256SUMS.txt')], { draft: true }),
    rel('desktop-v0.1.9', [asset('Piu-0.1.9-linux-amd64.deb'), asset('SHA256SUMS.txt')], { prerelease: true }),
    rel('desktop-v0.1.4', [asset('Piu-0.1.4-linux-amd64.deb'), asset('SHA256SUMS.txt')]),
    rel('desktop-v0.1.8', [asset('Piu-0.1.8-mac-arm64.dmg'), asset('SHA256SUMS.txt')]),
    rel('desktop-v0.1.3', [asset('Piu-0.1.3-linux-amd64.deb'), asset('SHA256SUMS.txt')]),
  ];
  const p = pickRelease(list, 'desktop');
  assert.equal(p.tag, 'desktop-v0.1.4');
  assert.equal(p.version, '0.1.4');
  assert.equal(p.deb.name, 'Piu-0.1.4-linux-amd64.deb');
  assert.equal(p.sums.name, 'SHA256SUMS.txt');
});

test('compara versões como números (0.1.10 > 0.1.9)', () => {
  const list = [
    rel('node-v0.1.9', [asset('piu-node_0.1.9-1_all.deb'), asset('SHA256SUMS.txt')]),
    rel('node-v0.1.10', [asset('piu-node_0.1.10-1_all.deb'), asset('SHA256SUMS.txt')]),
  ];
  assert.equal(pickRelease(list, 'node').tag, 'node-v0.1.10');
});

test('provider: aceita o nome com ponto que o GitHub gera para "Piu Provider"', () => {
  const p = pickRelease([rel('provider-v0.1.3', [asset('Piu.Provider-0.1.3-linux-amd64.deb'), asset('SHA256SUMS.txt')])], 'provider');
  assert.equal(p.deb.name, 'Piu.Provider-0.1.3-linux-amd64.deb');
});

test('sem release com .deb, ou sem SHA256SUMS.txt, é erro', () => {
  assert.throws(() => pickRelease([rel('desktop-v0.1.0', [asset('Piu-0.1.0-win-x64.exe')])], 'desktop'), /nenhum release publicado/);
  assert.throws(() => pickRelease([rel('desktop-v0.1.0', [asset('Piu-0.1.0-linux-amd64.deb')])], 'desktop'), /SHA256SUMS\.txt/);
});

test('arquivo que ainda está subindo não serve', () => {
  const a = { ...asset('Piu-0.1.0-linux-amd64.deb'), state: 'starter' };
  assert.throws(() => pickRelease([rel('desktop-v0.1.0', [a, asset('SHA256SUMS.txt')])], 'desktop'), /ainda não terminou de subir/);
});

test('lê o SHA256SUMS.txt (com e sem *), recusa linha torta e nome repetido', () => {
  const m = parseSums(`${H('a')}  Piu-0.1.4-linux-amd64.deb\n${H('b')} *Piu-0.1.4-win-x64.exe\n\n`);
  assert.equal(m.get('Piu-0.1.4-linux-amd64.deb'), H('a'));
  assert.equal(m.get('Piu-0.1.4-win-x64.exe'), H('b'));
  assert.throws(() => parseSums('xyz  arquivo\n'), /linha inválida/);
  assert.throws(() => parseSums(`${H('a')}  x\n${H('b')}  x\n`), /repetido/);
});

test('confere o .deb baixado contra o SHA256SUMS.txt e o digest do GitHub', () => {
  const sums = new Map([['p.deb', H('a')]]);
  assert.doesNotThrow(() => verifyDeb({ name: 'p.deb', digest: `sha256:${H('a')}` }, H('a'), sums));
  assert.doesNotThrow(() => verifyDeb({ name: 'p.deb', digest: null }, H('a'), sums));
  assert.throws(() => verifyDeb({ name: 'p.deb', digest: null }, H('c'), sums), /não bate com o SHA256SUMS\.txt/);
  assert.throws(() => verifyDeb({ name: 'p.deb', digest: `sha256:${H('d')}` }, H('a'), sums), /digest do GitHub/);
  assert.throws(() => verifyDeb({ name: 'q.deb', digest: null }, H('a'), sums), /não está no SHA256SUMS\.txt/);
});

test('impressão digital: 40 hexa maiúsculos, nada além disso', () => {
  assert.equal(checkFingerprint('abcdef0123456789abcdef0123456789abcdef01'), 'ABCDEF0123456789ABCDEF0123456789ABCDEF01');
  assert.throws(() => checkFingerprint('ABCD'), /impressão digital/);
  assert.throws(() => checkFingerprint(''), /impressão digital/);
});
