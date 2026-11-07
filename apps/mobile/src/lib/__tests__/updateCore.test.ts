import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTO_CHECK_MS, RELEASES_API, UpdateCheckError, androidReleases, autoCheckDue, checkForUpdates, checkOutcome, compareVersions,
  isReleasePage, latestRelease, outcomeText, UPDATE_NOTIFY_DEFAULT, type FetchLike,
} from '../updateCore';
import { LANGS, tIn } from '../../i18n';

const PAGE = 'https://github.com/Magnopiro-oficial/piu./releases/tag/';
const DL = 'https://github.com/Magnopiro-oficial/piu./releases/download/';

/** Release como o GitHub devolve (só os campos usados). */
function rel(v: string, o: { tag?: string; url?: string; apk?: string; apkName?: string; draft?: boolean; prerelease?: boolean } = {}) {
  const tag = o.tag ?? `android-v${v}`;
  const name = o.apkName ?? `Piu-${v}.apk`;
  return {
    tag_name: tag, html_url: o.url ?? `${PAGE}${tag}`, draft: o.draft ?? false, prerelease: o.prerelease ?? false,
    assets: [{ name, browser_download_url: o.apk ?? `${DL}${tag}/${name}`, size: 1000 }],
  };
}

const ok = (json: unknown): FetchLike => async () => ({ ok: true, status: 200, json: async () => json });

test('comparação numérica: 0.1.10 é mais nova que 0.1.9', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.1.9', '0.1.10'), -1);
  assert.equal(compareVersions('0.1.2', '0.1.2'), 0);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

test('lista do GitHub: só android-vX.Y.Z publicadas, da mais nova para a mais velha', () => {
  const list = androidReleases([rel('0.1.9'), rel('0.1.10'), rel('0.1.2'), rel('9.9.9', { tag: 'desktop-v9.9.9' }), rel('8.0.0', { tag: 'provider-v8.0.0' })]);
  assert.deepEqual(list.map(r => r.version), ['0.1.10', '0.1.9', '0.1.2']);
  assert.equal(list[0]!.url, `${PAGE}android-v0.1.10`);
  assert.equal(list[0]!.apk, `${DL}android-v0.1.10/Piu-0.1.10.apk`);
});

test('tag desktop-v, rascunho e pré-lançamento são ignorados', () => {
  assert.deepEqual(androidReleases([rel('9.0.0', { tag: 'desktop-v9.0.0' })]), []);
  assert.deepEqual(androidReleases([rel('9.0.0', { draft: true })]), []);
  assert.deepEqual(androidReleases([rel('9.0.0', { prerelease: true })]), []);
  assert.deepEqual(androidReleases([rel('9.0.0', { tag: 'android-v9.0' })]), [], 'tag fora do formato X.Y.Z');
});

test('página e APK precisam ser do próprio repositório no github.com', () => {
  const bad = [
    rel('9.0.0', { url: 'https://github.com/outro/piu./releases/tag/android-v9.0.0' }),
    rel('9.0.0', { url: 'https://evil.example/Magnopiro-oficial/piu./releases/tag/android-v9.0.0' }),
    rel('9.0.0', { url: 'http://github.com/Magnopiro-oficial/piu./releases/tag/android-v9.0.0' }),
    rel('9.0.0', { apk: 'https://github.com/outro/piu./releases/download/android-v9.0.0/Piu-9.0.0.apk' }),
    rel('9.0.0', { apk: 'https://objects.githubusercontent.com/Piu-9.0.0.apk' }),
    rel('9.0.0', { apk: `${DL}android-v8.0.0/Piu-9.0.0.apk` }),
    rel('9.0.0', { apkName: 'Piu-8.0.0.apk' }),
    rel('9.0.0', { apkName: 'Piu-9.0.0.zip' }),
  ];
  for (const r of bad) assert.deepEqual(androidReleases([r]), [], JSON.stringify(r));
  // Sem nenhum asset: release sem APK não conta.
  assert.deepEqual(androidReleases([{ ...rel('9.0.0'), assets: [] }]), []);
  assert.equal(androidReleases([rel('0.1.2')]).length, 1);
});

test('isReleasePage: só abre páginas de release do próprio repositório', () => {
  assert.equal(isReleasePage(`${PAGE}android-v0.1.2`), true);
  assert.equal(isReleasePage('https://github.com/outro/piu./releases/tag/android-v0.1.2'), false);
  assert.equal(isReleasePage('javascript:alert(1)'), false);
  assert.equal(isReleasePage(`${PAGE}android-v0.1.2 x`), false, 'sem espaços');
  assert.equal(isReleasePage(null), false);
});

test('resposta inesperada do GitHub: erro "github"', async () => {
  assert.throws(() => androidReleases({ message: 'x' }), UpdateCheckError);
  await assert.rejects(latestRelease(ok({ message: 'rate limit' })), (e: unknown) => e instanceof UpdateCheckError && e.kind === 'github');
  const badJson: FetchLike = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(latestRelease(badJson), (e: unknown) => e instanceof UpdateCheckError && e.kind === 'github');
});

test('sem internet ("offline") é diferente de GitHub com erro ("github")', async () => {
  const offline: FetchLike = async () => { throw new TypeError('Network request failed'); };
  await assert.rejects(latestRelease(offline), (e: unknown) => e instanceof UpdateCheckError && e.kind === 'offline');
  const status: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(latestRelease(status), (e: unknown) => e instanceof UpdateCheckError && e.kind === 'github');
});

test('tempo esgotado conta como sem internet', async () => {
  const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
  await assert.rejects(latestRelease(hang, 20), (e: unknown) => e instanceof UpdateCheckError && e.kind === 'offline');
});

test('pede a lista certa ao GitHub', async () => {
  let asked = '';
  const spy: FetchLike = async (u) => { asked = u; return { ok: true, status: 200, json: async () => [] }; };
  await latestRelease(spy);
  assert.equal(asked, 'https://api.github.com/repos/Magnopiro-oficial/piu./releases?per_page=50');
  assert.equal(RELEASES_API, asked);
});

test('checkForUpdates: maior versão vence; disponível ou já é a mais nova', async () => {
  const f = ok([rel('0.1.1'), rel('0.1.2'), rel('0.1.0'), rel('0.2.0', { tag: 'desktop-v0.2.0' })]);
  assert.deepEqual(await checkForUpdates('0.1.1', f), { state: 'available', current: '0.1.1', latest: '0.1.2', url: `${PAGE}android-v0.1.2` });
  assert.deepEqual(await checkForUpdates('0.1.2', f), { state: 'latest', current: '0.1.2', latest: '0.1.2', url: `${PAGE}android-v0.1.2` });
  assert.deepEqual(await checkForUpdates('0.1.3', f), { state: 'latest', current: '0.1.3', latest: '0.1.2', url: `${PAGE}android-v0.1.2` });
  assert.deepEqual(await checkForUpdates('0.1.1', ok([])), { state: 'latest', current: '0.1.1', latest: null, url: null });
});

test('checkOutcome nunca lança: offline e github viram estados', async () => {
  assert.deepEqual(await checkOutcome('0.1.1', async () => { throw new Error('x'); }), { state: 'offline' });
  assert.deepEqual(await checkOutcome('0.1.1', async () => ({ ok: false, status: 500, json: async () => null })), { state: 'github' });
  assert.equal((await checkOutcome('0.1.1', ok([rel('0.1.2')]))).state, 'available');
});

test('textos dos 4 estados, sem inventar versão', () => {
  assert.equal(outcomeText({ state: 'latest', current: '0.1.2', latest: '0.1.2', url: null }).title, 'Você tem a versão mais nova');
  assert.equal(outcomeText({ state: 'available', current: '0.1.1', latest: '0.1.2', url: `${PAGE}android-v0.1.2` }).title, 'Piu 0.1.2 disponível');
  assert.equal(outcomeText({ state: 'offline' }).title, 'Sem internet');
  assert.equal(outcomeText({ state: 'github' }).title, 'GitHub indisponível');
});

test('aviso automático: no máximo uma checagem por dia', () => {
  const now = 1_800_000_000_000;
  assert.equal(AUTO_CHECK_MS, 24 * 60 * 60 * 1000);
  assert.equal(autoCheckDue(null, now), true, 'nunca checou');
  assert.equal(autoCheckDue(now - 60_000, now), false, 'checou há 1 minuto');
  assert.equal(autoCheckDue(now - AUTO_CHECK_MS + 1, now), false);
  assert.equal(autoCheckDue(now - AUTO_CHECK_MS, now), true, '24 h depois');
  assert.equal(autoCheckDue(now + 3_600_000, now), true, 'relógio voltou: checa de novo');
});

test('"Avisar sobre novas versões" vem ligado, como no Desktop', () => {
  assert.equal(UPDATE_NOTIFY_DEFAULT, true);
});

test('textos de atualização traduzidos de verdade (não são cópia do pt-BR)', () => {
  const keys = ['update.check', 'update.notify', 'update.latest', 'update.offline', 'update.github'] as const;
  for (const { code } of LANGS) {
    if (code === 'pt-BR' || code === 'pt-PT') continue;
    for (const k of keys) assert.notEqual(tIn(code, k), tIn('pt-BR', k), `${code}.${k}`);
    assert.match(tIn(code, 'update.available', { version: '0.1.2' }), /Piu 0\.1\.2/, `${code}: versão no aviso`);
  }
});
