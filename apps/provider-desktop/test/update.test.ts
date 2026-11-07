import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RELEASES_API, UpdateCheckError, checkForUpdates, compareVersions, latestRelease, providerReleases, releasePageUrl,
  shouldAutoCheck, type FetchLike,
} from '../src/update.ts';

const PAGE = 'https://github.com/Magnopiro-oficial/piu./releases/tag/';
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: PAGE + tag, draft: false, prerelease: false, ...extra });
const ok = (json: unknown): FetchLike => async () => ({ ok: true, status: 200, json: async () => json });

test('API: releases do repositório do Piu, 50 por página', () => {
  assert.equal(RELEASES_API, 'https://api.github.com/repos/Magnopiro-oficial/piu./releases?per_page=50');
});

test('compareVersions: numérico, não alfabético', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.1.9', '0.1.10'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.99'), 1);
  assert.equal(compareVersions('0.1.2', '0.1.2'), 0);
});

test('providerReleases: só provider-v, sem draft/prerelease, da maior para a menor', () => {
  const list = providerReleases([
    rel('provider-v0.1.9'), rel('provider-v0.1.10'), rel('desktop-v9.9.9'), rel('android-v9.9.9'), rel('node-v9.9.9'),
    rel('provider-v0.2.0', { draft: true }), rel('provider-v0.3.0', { prerelease: true }), rel('provider-v1.0'), rel('provider-v0.1.11-rc1'),
    null, 'x', { tag_name: 'provider-v0.4.0' },
  ]);
  assert.deepEqual(list.map(r => r.version), ['0.1.10', '0.1.9']);
  assert.equal(list[0]!.url, PAGE + 'provider-v0.1.10');
});

test('providerReleases: página do release precisa ser do próprio repositório', () => {
  const list = providerReleases([
    rel('provider-v0.9.0', { html_url: 'https://github.com/outro/piu./releases/tag/provider-v0.9.0' }),
    rel('provider-v0.8.0', { html_url: 'https://evil.com/Magnopiro-oficial/piu./releases/tag/provider-v0.8.0' }),
    rel('provider-v0.7.0', { html_url: 'http://github.com/Magnopiro-oficial/piu./releases/tag/provider-v0.7.0' }),
    rel('provider-v0.6.0', { html_url: 'https://github.com/Magnopiro-oficial/piu.evil/releases/tag/provider-v0.6.0' }),
    rel('provider-v0.1.0'),
  ]);
  assert.deepEqual(list.map(r => r.version), ['0.1.0']);
});

test('providerReleases: resposta que não é lista é erro do GitHub', () => {
  assert.throws(() => providerReleases({ message: 'rate limited' }), (e: unknown) => e instanceof UpdateCheckError && e.kind === 'github');
});

test('releasePageUrl: só abre página de release do repositório', () => {
  assert.equal(releasePageUrl(PAGE + 'provider-v0.1.2'), PAGE + 'provider-v0.1.2');
  for (const bad of [
    'https://github.com/outro/piu./releases/tag/provider-v0.1.2', 'http://github.com/Magnopiro-oficial/piu./releases/x',
    'https://github.com.evil.com/Magnopiro-oficial/piu./releases/x', 'https://user@github.com/Magnopiro-oficial/piu./releases/x',
    'https://github.com:8443/Magnopiro-oficial/piu./releases/x', 'https://github.com/Magnopiro-oficial/piu./releases/../../../evil',
    'javascript:alert(1)', '', 'nao é url',
  ]) assert.equal(releasePageUrl(bad), null, bad);
});

test('checkForUpdates: disponível, mais nova e sem nenhum release', async () => {
  const json = [rel('provider-v0.1.2'), rel('provider-v0.1.1'), rel('desktop-v0.5.0')];
  assert.deepEqual(await checkForUpdates('0.1.1', ok(json)), { state: 'available', current: '0.1.1', latest: '0.1.2', url: PAGE + 'provider-v0.1.2' });
  assert.deepEqual(await checkForUpdates('0.1.2', ok(json)), { state: 'latest', current: '0.1.2', latest: '0.1.2', url: PAGE + 'provider-v0.1.2' });
  assert.deepEqual(await checkForUpdates('0.1.3', ok(json)), { state: 'latest', current: '0.1.3', latest: '0.1.2', url: PAGE + 'provider-v0.1.2' });
  assert.deepEqual(await checkForUpdates('0.1.2', ok([])), { state: 'latest', current: '0.1.2', latest: null, url: null });
});

test('latestRelease: chama a API com Accept do GitHub e tempo limite', async () => {
  let seen: { url: string; init?: Parameters<FetchLike>[1] } | null = null;
  await latestRelease(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => [] }; });
  assert.equal(seen!.url, RELEASES_API);
  assert.equal(seen!.init?.headers?.Accept, 'application/vnd.github+json');
  assert.ok(seen!.init?.signal instanceof AbortSignal);
});

test('erros: sem internet vs GitHub com erro vs resposta inesperada', async () => {
  const kind = (k: string) => (e: unknown) => e instanceof UpdateCheckError && e.kind === k;
  await assert.rejects(checkForUpdates('0.1.1', async () => { throw new TypeError('fetch failed'); }), kind('offline'));
  await assert.rejects(checkForUpdates('0.1.1', async () => ({ ok: false, status: 503, json: async () => ({}) })), kind('github'));
  await assert.rejects(checkForUpdates('0.1.1', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })), kind('github'));
  await assert.rejects(checkForUpdates('0.1.1', ok({ message: 'Not Found' })), kind('github'));
});

test('shouldAutoCheck: ligado por padrão, no máximo uma vez por dia, desligável', () => {
  const now = Date.UTC(2026, 10, 7, 12);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(shouldAutoCheck({ updateNotify: true, lastUpdateCheck: 0 }, now), true);
  assert.equal(shouldAutoCheck({ updateNotify: true, lastUpdateCheck: now - day + 1 }, now), false);
  assert.equal(shouldAutoCheck({ updateNotify: true, lastUpdateCheck: now - day }, now), true);
  assert.equal(shouldAutoCheck({ updateNotify: false, lastUpdateCheck: 0 }, now), false);
  // Relógio voltou no tempo: não fica preso sem checar.
  assert.equal(shouldAutoCheck({ updateNotify: true, lastUpdateCheck: now + 10 * day }, now), true);
});
