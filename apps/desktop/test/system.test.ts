import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkForUpdates, compareVersions, desktopReleases, linuxAutostartDir, linuxAutostartEntry, setLinuxAutostart, RELEASES_API } from '../src/main/system';

test('autostart no Linux: entrada .desktop com Exec entre aspas e caracteres especiais escapados', () => {
  const e = linuxAutostartEntry('/opt/Piu $x/piu"a`b\\c');
  assert.match(e, /^\[Desktop Entry\]\n/);
  assert.match(e, /\nType=Application\n/);
  assert.match(e, /\nName=Piu\n/);
  assert.ok(e.includes('Exec="/opt/Piu \\$x/piu\\"a\\`b\\\\c"\n'), e);
  assert.equal(linuxAutostartDir({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/ana'), '/x/cfg/autostart');
  assert.equal(linuxAutostartDir({}, '/home/ana'), '/home/ana/.config/autostart');
});

test('autostart no Linux: liga grava o arquivo (0600 não é exigido, só o do Piu), desliga apaga; repetir não quebra', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-autostart-'));
  try {
    const auto = join(dir, 'autostart');
    setLinuxAutostart(true, { dir: auto, exec: '/usr/bin/piu' });
    const f = join(auto, 'piu.desktop');
    assert.ok(readFileSync(f, 'utf8').includes('Exec="/usr/bin/piu"'));
    setLinuxAutostart(true, { dir: auto, exec: '/usr/bin/piu' });
    setLinuxAutostart(false, { dir: auto, exec: '/usr/bin/piu' });
    assert.equal(existsSync(f), false);
    setLinuxAutostart(false, { dir: auto, exec: '/usr/bin/piu' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('versões: compara x.y.z numericamente', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.2.0', '1.0.0'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

const rel = (tag: string, o: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `https://github.com/Magnopiro-oficial/piu./releases/tag/${tag}`, draft: false, prerelease: false, ...o });

test('releases: só tags desktop-vX.Y.Z publicadas (sem rascunho/pré-lançamento) e página do próprio repositório', () => {
  const list = desktopReleases([
    rel('desktop-v0.3.0'), rel('desktop-v0.4.0', { draft: true }), rel('desktop-v0.5.0', { prerelease: true }), rel('mobile-v9.0.0'), rel('provider-desktop-v2.0.0'),
    rel('desktop-v0.3.1', { html_url: 'https://evil.example/x' }), rel('desktop-v0.2.9'), { tag_name: 7 }, null,
  ]);
  assert.deepEqual(list.map(r => r.version), ['0.3.0', '0.2.9']);
  assert.throws(() => desktopReleases({ message: 'rate limit' }), /inesperada/);
});

test('verificar atualizações: versão mais nova → available com a página; igual ou mais velha → latest; erro de rede vira mensagem', async () => {
  let asked = '';
  const fetchOk = async (url: string) => { asked = url; return { ok: true, status: 200, json: async () => [rel('desktop-v0.1.0'), rel('desktop-v0.2.1'), rel('desktop-v0.2.0')] }; };
  const r = await checkForUpdates('0.1.0', fetchOk);
  assert.equal(asked, RELEASES_API);
  assert.deepEqual(r, { state: 'available', current: '0.1.0', latest: '0.2.1', url: 'https://github.com/Magnopiro-oficial/piu./releases/tag/desktop-v0.2.1' });
  assert.deepEqual(await checkForUpdates('0.2.1', fetchOk), { state: 'latest', current: '0.2.1', latest: '0.2.1', url: 'https://github.com/Magnopiro-oficial/piu./releases/tag/desktop-v0.2.1' });
  assert.deepEqual(await checkForUpdates('0.1.0', async () => ({ ok: true, status: 200, json: async () => [] })), { state: 'latest', current: '0.1.0', latest: null, url: null });
  await assert.rejects(checkForUpdates('0.1.0', async () => ({ ok: false, status: 403, json: async () => ({}) })), /403/);
  await assert.rejects(checkForUpdates('0.1.0', async () => { throw new Error('offline'); }), /sem conexão/i);
});
