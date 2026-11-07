import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as openpgp from 'openpgp';
import { releaseNotes } from '../src/main/system';
import { installKindFor, parseSums, pickAsset, replaceAppImage, Updater, verifySumsSignature } from '../src/main/updater';
import type { UpdateState } from '../src/shared/types';

const REPO = 'https://github.com/Magnopiro-oficial/piu.';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const asset = (tag: string, name: string, size: number) => ({ name, size, browser_download_url: `${REPO}/releases/download/${tag}/${name}` });

async function testKey() {
  const { privateKey, publicKey } = await openpgp.generateKey({ userIDs: [{ name: 'Piu teste' }], format: 'object' });
  return { privateKey, armored: publicKey.armor(), fpr: publicKey.getFingerprint().toUpperCase() };
}
const sign = async (key: openpgp.PrivateKey, data: Uint8Array) => (await openpgp.sign({ message: await openpgp.createMessage({ binary: data }), signingKeys: key, detached: true })) as string;

test('notas do release: só itens de lista, sem marcação nem caracteres de controle', () => {
  assert.deepEqual(releaseNotes('## Novidades\n- **Painel** do nó\n* Corrige [avisos](https://x) repetidos\ntexto solto\n- ‮ao contrário'), ['Painel do nó', 'Corrige avisos repetidos', 'ao contrário']);
  assert.deepEqual(releaseNotes(null), []);
});

test('SHA256SUMS: lê "hash  nome" e "hash *nome"; ignora linha estranha e caminho', () => {
  const m = parseSums(`${'a'.repeat(64)}  Piu-0.2.0-linux-x86_64.AppImage\n${'B'.repeat(64)} *Piu-0.2.0-win-x64.exe\nlixo\n${'c'.repeat(64)}  ../fora\n`);
  assert.equal(m.get('Piu-0.2.0-linux-x86_64.AppImage'), 'a'.repeat(64));
  assert.equal(m.get('Piu-0.2.0-win-x64.exe'), 'b'.repeat(64));
  assert.equal(m.size, 2);
});

test('pacote certo para cada sistema', () => {
  assert.equal(installKindFor('darwin', {}), 'dmg');
  assert.equal(installKindFor('win32', {}), 'nsis');
  assert.equal(installKindFor('linux', { APPIMAGE: '/home/a/Piu.AppImage' }), 'appimage');
  assert.equal(installKindFor('linux', {}), 'deb');
  assert.equal(installKindFor('freebsd', {}), null);
  const list = ['Piu-0.2.0-mac-arm64.dmg', 'Piu-0.2.0-mac-x64.dmg', 'Piu-0.2.0-mac-arm64.zip', 'Piu-0.2.0-linux-x86_64.AppImage', 'Piu-0.2.0-linux-amd64.deb', 'Piu-0.2.0-win-x64.exe', 'Piu-0.1.0-win-x64.exe']
    .map(name => ({ name, url: `${REPO}/releases/download/desktop-v0.2.0/${name}`, size: 1 }));
  assert.equal(pickAsset(list, '0.2.0', 'dmg', 'arm64')?.name, 'Piu-0.2.0-mac-arm64.dmg');
  assert.equal(pickAsset(list, '0.2.0', 'dmg', 'x64')?.name, 'Piu-0.2.0-mac-x64.dmg');
  assert.equal(pickAsset(list, '0.2.0', 'appimage', 'x64')?.name, 'Piu-0.2.0-linux-x86_64.AppImage');
  assert.equal(pickAsset(list, '0.2.0', 'deb', 'x64')?.name, 'Piu-0.2.0-linux-amd64.deb');
  assert.equal(pickAsset(list, '0.2.0', 'nsis', 'x64')?.name, 'Piu-0.2.0-win-x64.exe');
  assert.equal(pickAsset(list, '0.2.0', 'nsis', 'arm64'), null, 'sem pacote para a arquitetura');
  assert.equal(pickAsset(list, '0.3.0', 'nsis', 'x64'), null, 'outra versão não serve');
});

test('assinatura do SHA256SUMS.txt: confere com a chave fixada; outra chave, conteúdo trocado ou impressão digital diferente recusam (sem rede)', async () => {
  const k = await testKey();
  const other = await testKey();
  const sums = new TextEncoder().encode(`${'a'.repeat(64)}  Piu-0.2.0-win-x64.exe\n`);
  const sig = await sign(k.privateKey, sums);
  assert.equal(await verifySumsSignature(sums, sig, k.armored, k.fpr), true);
  assert.equal(await verifySumsSignature(sums, sig, k.armored, k.fpr.toLowerCase().replace(/(.{4})/g, '$1 ')), true, 'aceita a impressão digital com espaços');
  assert.equal(await verifySumsSignature(new TextEncoder().encode(`${'b'.repeat(64)}  Piu-0.2.0-win-x64.exe\n`), sig, k.armored, k.fpr), false);
  assert.equal(await verifySumsSignature(sums, await sign(other.privateKey, sums), k.armored, k.fpr), false);
  assert.equal(await verifySumsSignature(sums, sig, k.armored, other.fpr), false, 'chave que não é a fixada');
  assert.equal(await verifySumsSignature(sums, 'lixo', k.armored, k.fpr), false);
  assert.equal(await verifySumsSignature(sums, sig, '', ''), false);
});

function fakeGithub(files: Record<string, Uint8Array>, release: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchJson = async (url: string) => { asked.push(url); return { ok: true, status: 200, json: async () => [release] }; };
  const fetchBin = async (url: string) => {
    asked.push(url);
    const name = decodeURIComponent(url.split('/').pop()!);
    const b = files[name];
    return b ? new Response(b as unknown as BodyInit) : new Response('não', { status: 404 });
  };
  return { asked, fetchJson, fetchBin };
}

async function setup(opts: { tamper?: 'package' | 'signature' | 'unlisted'; key?: boolean } = {}) {
  const k = await testKey();
  const other = await testKey();
  const tag = 'desktop-v0.2.0';
  const pkg = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff);
  const name = 'Piu-0.2.0-linux-x86_64.AppImage';
  const sums = new TextEncoder().encode(opts.tamper === 'unlisted' ? `${'0'.repeat(64)}  outro\n` : `${sha(pkg)}  ${name}\n`);
  const sig = await sign(opts.tamper === 'signature' ? other.privateKey : k.privateKey, sums);
  const served = opts.tamper === 'package' ? pkg.map((x, i) => (i === 5 ? x ^ 1 : x)) : pkg;
  const files: Record<string, Uint8Array> = { [name]: served, 'SHA256SUMS.txt': sums, 'SHA256SUMS.txt.asc': new TextEncoder().encode(sig) };
  const release = { tag_name: tag, html_url: `${REPO}/releases/tag/${tag}`, draft: false, prerelease: false, body: '- Corrige avisos',
    assets: [asset(tag, name, pkg.length), asset(tag, 'SHA256SUMS.txt', sums.length), asset(tag, 'SHA256SUMS.txt.asc', sig.length)] };
  const gh = fakeGithub(files, release);
  const dir = mkdtempSync(join(tmpdir(), 'piu-upd-'));
  const states: UpdateState[] = [];
  const u = new Updater({ current: '0.1.0', dir: join(dir, 'updates'), platform: 'linux', arch: 'x64', env: { APPIMAGE: join(dir, 'Piu.AppImage') }, packaged: true,
    key: opts.key === false ? { armored: '', fpr: '' } : { armored: k.armored, fpr: k.fpr }, fetchJson: gh.fetchJson, fetchBin: gh.fetchBin, onState: s => states.push(s) });
  return { u, dir, states, pkg, name, gh };
}

test('Updater: acha a versão, baixa do GitHub, confere assinatura e SHA-256 e fica pronto', async t => {
  const { u, dir, states, pkg, name } = await setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = await u.check();
  assert.equal(s1.state, 'available');
  assert.ok(s1.state === 'available' && s1.verify === 'ok' && s1.info.asset === name && s1.info.size === pkg.length && s1.info.notes[0] === 'Corrige avisos');
  const s2 = await u.download();
  assert.equal(s2.state, 'ready', JSON.stringify(s2));
  assert.ok(s2.state === 'ready' && s2.install === 'appimage' && s2.signer.length === 4);
  const steps = states.filter(s => s.state === 'downloading').map(s => s.state === 'downloading' && s.step);
  assert.deepEqual([...new Set(steps)], ['sums', 'package', 'hash']);
  const file = u.readyFile()!;
  assert.equal(sha(readFileSync(file)), sha(pkg));
  assert.deepEqual(readdirSync(join(dir, 'updates')), [name], 'sem .part sobrando');
});

test('Updater: pacote alterado no caminho é apagado e nada fica pronto (D3e)', async t => {
  const { u, dir } = await setup({ tamper: 'package' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await u.check();
  const s = await u.download();
  assert.equal(s.state, 'bad');
  assert.ok(s.state === 'bad' && s.reason === 'hash' && s.expected !== s.got);
  assert.equal(u.readyFile(), null);
  assert.deepEqual(readdirSync(join(dir, 'updates')), [], 'arquivo apagado');
});

test('Updater: assinatura de outra chave ou pacote fora da lista → descartado antes de baixar o pacote', async t => {
  for (const tamper of ['signature', 'unlisted'] as const) {
    const { u, dir, gh, name } = await setup({ tamper });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await u.check();
    const s = await u.download();
    assert.equal(s.state, 'bad', tamper);
    assert.ok(s.state === 'bad' && s.reason === (tamper === 'signature' ? 'signature' : 'unlisted'));
    assert.ok(!gh.asked.some(x => x.endsWith(name)), 'o pacote nem é baixado');
  }
});

test('Updater: sem a chave pública do projeto, mostra "verificação indisponível" e não baixa nada', async t => {
  const { u, dir, gh } = await setup({ key: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = await u.check();
  assert.ok(s.state === 'available' && s.verify === 'no-key');
  const d = await u.download();
  assert.equal(d.state, 'available', 'continua só disponível');
  assert.equal(gh.asked.filter(x => x.includes('/download/')).length, 0);
});

test('Updater: versão igual → latest; erro de rede vira mensagem', async t => {
  const { dir } = await setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const u = new Updater({ current: '0.2.0', dir: join(dir, 'u2'), platform: 'linux', arch: 'x64', env: {}, packaged: true, key: { armored: '', fpr: '' },
    fetchJson: async () => ({ ok: true, status: 200, json: async () => [] }), fetchBin: async () => new Response(''), onState: () => {} });
  assert.equal((await u.check()).state, 'latest');
  const e = new Updater({ current: '0.2.0', dir: join(dir, 'u3'), platform: 'linux', arch: 'x64', env: {}, packaged: true, key: { armored: '', fpr: '' },
    fetchJson: async () => { throw new Error('offline'); }, fetchBin: async () => new Response(''), onState: () => {} });
  const s = await e.check();
  assert.ok(s.state === 'error' && /sem conexão/i.test(s.message));
  // E2d × E2e: sem internet e erro do GitHub têm textos diferentes; a hora da verificação vai junto.
  assert.ok(s.state === 'error' && s.kind === 'offline' && typeof s.at === 'number');
  for (const [fetchJson, kind] of [
    [async () => ({ ok: false, status: 503, json: async () => ({}) }), 'github'],
    [async () => ({ ok: true, status: 200, json: async () => ({ message: 'rate limit' }) }), 'github'],
  ] as const) {
    const g = new Updater({ current: '0.2.0', dir: join(dir, 'u4'), platform: 'linux', arch: 'x64', env: {}, packaged: true, key: { armored: '', fpr: '' }, fetchJson, fetchBin: async () => new Response(''), onState: () => {} });
    const r = await g.check();
    assert.ok(r.state === 'error' && r.kind === kind, JSON.stringify(r));
  }
});

test('E2: "Avisar quando sair versão nova" só procura; versão nova sem chave não baixa nada', async t => {
  const { dir } = await setup();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let bins = 0;
  const rel = { tag_name: 'desktop-v0.5.0', html_url: 'https://github.com/Magnopiro-oficial/piu./releases/tag/desktop-v0.5.0', draft: false, prerelease: false, assets: [], body: '' };
  const u = new Updater({ current: '0.4.2', dir: join(dir, 'u5'), platform: 'linux', arch: 'x64', env: {}, packaged: true, key: { armored: '', fpr: '' },
    fetchJson: async () => ({ ok: true, status: 200, json: async () => [rel] }), fetchBin: async () => { bins++; return new Response(''); }, onState: () => {} });
  const s = await u.check();
  assert.ok(s.state === 'available' && s.info.version === '0.5.0' && s.info.current === '0.4.2' && s.verify === 'no-key' && typeof s.at === 'number');
  assert.equal((await u.download()).state, 'available', 'sem a chave do projeto, "baixar" não faz nada');
  assert.equal(bins, 0, 'nenhum download');
});

test('AppImage: troca o arquivo de uma vez (mesma pasta, executável)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-appimage-'));
  try {
    const target = join(dir, 'Piu.AppImage'), src = join(dir, 'novo');
    writeFileSync(target, 'velho'); chmodSync(target, 0o755);
    writeFileSync(src, 'novo');
    replaceAppImage(target, src);
    assert.equal(readFileSync(target, 'utf8'), 'novo');
    assert.equal(statSync(target).mode & 0o777, 0o755);
    assert.ok(existsSync(src), 'a cópia baixada fica até a limpeza');
    assert.deepEqual(readdirSync(dir).sort(), ['Piu.AppImage', 'novo']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
