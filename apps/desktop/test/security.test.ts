import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exportBackupAfterReauth, externalUrlAllowed, forbiddenDebugSwitches, isRendererUrl, mediaAllowed, isTrustedSender, profileFromEnv, reauthForPhrase, RENDERER_ORIGIN, rendererFileFor, rendererMime, rendererOriginOf,
} from '../src/main/security';
import { join } from 'node:path';

test('M-05: switches de depuração no app empacotado são detectados (--remote-debugging-port, --inspect, --js-flags…)', () => {
  const exe = '/Applications/Piu.app/Contents/MacOS/Piu';
  assert.deepEqual(forbiddenDebugSwitches([exe]), []);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--remote-debugging-port=9222']), ['remote-debugging-port']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--remote-debugging-pipe']), ['remote-debugging-pipe']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '-remote-debugging-address=0.0.0.0', '--REMOTE-DEBUGGING-PORT', '9222']), ['remote-debugging-address', 'remote-debugging-port']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--inspect']), ['inspect']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--inspect-brk=0']), ['inspect-brk']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--inspect-port=9229']), ['inspect-port']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--js-flags=--allow-natives-syntax']), ['js-flags']);
  assert.deepEqual(forbiddenDebugSwitches([exe, '--remote-allow-origins=*']), ['remote-allow-origins']);
  // Windows aceita `/switch`.
  assert.deepEqual(forbiddenDebugSwitches(['C:\\Piu\\Piu.exe', '/remote-debugging-port=9222'], 'win32'), ['remote-debugging-port']);
  // Argumentos comuns (arquivos, URL do protocolo, -psn do Finder) passam.
  assert.deepEqual(forbiddenDebugSwitches([exe, '-psn_0_12345', '/Users/ana/piu-identidade.piu', '--lang=pt-BR']), []);
  // Depois de `--` nada é switch.
  assert.deepEqual(forbiddenDebugSwitches([exe, '--', '--inspect']), []);
  // O `app.commandLine` também conta (switch acrescentado por outro caminho).
  assert.deepEqual(forbiddenDebugSwitches([exe], 'darwin', s => s === 'remote-debugging-port'), ['remote-debugging-port']);
});

test('B-06: origem do renderer termina em "/" (pasta irmã com o mesmo prefixo não passa)', () => {
  const origin = rendererOriginOf('file:///Applications/Piu.app/Contents/Resources/app.asar/dist/renderer');
  assert.equal(origin, 'file:///Applications/Piu.app/Contents/Resources/app.asar/dist/renderer/');
  assert.equal(rendererOriginOf(origin), origin, 'não duplica a barra');
  assert.equal(isRendererUrl(origin + 'index.html', origin), true);
  assert.equal(isRendererUrl(origin + 'assets/index-abc.js', origin), true);
  assert.equal(isRendererUrl('file:///Applications/Piu.app/Contents/Resources/app.asar/dist/renderer-evil/index.html', origin), false);
  assert.equal(isRendererUrl('file:///Applications/Piu.app/Contents/Resources/app.asar/dist/renderer', origin), false);
  assert.equal(isRendererUrl('https://example.com/', origin), false);
});

test('B-04: interface servida por piu-app://app/ (sem privilégios extras do file://), só de dentro da pasta', () => {
  const dir = '/Applications/Piu.app/Contents/Resources/app.asar/dist/renderer';
  assert.equal(RENDERER_ORIGIN, 'piu-app://app/');
  assert.equal(rendererFileFor('piu-app://app/index.html', dir), join(dir, 'index.html'));
  assert.equal(rendererFileFor('piu-app://app/', dir), join(dir, 'index.html'));
  assert.equal(rendererFileFor('piu-app://app/assets/index-abc.js?x=1#y', dir), join(dir, 'assets/index-abc.js'));
  assert.equal(rendererFileFor('piu-app://app/assets/a%20b.woff2', dir), join(dir, 'assets/a b.woff2'));
  assert.equal(rendererFileFor('piu-app://app/../../../etc/passwd', dir), join(dir, 'etc/passwd'), 'a URL normaliza ".." antes: fica na pasta');
  assert.equal(rendererFileFor('piu-app://app/%2e%2e/%2e%2e/etc/passwd', dir), join(dir, 'etc/passwd'), '"%2e%2e" também é normalizado pela URL');
  assert.equal(rendererFileFor('piu-app://app/assets/%2e%2e%2f..%2fx', dir), null);
  assert.equal(rendererFileFor('piu-app://app/a%00b', dir), null);
  assert.equal(rendererFileFor('piu-app://outro/index.html', dir), null);
  assert.equal(rendererFileFor('piu-app://u:p@app/index.html', dir), null);
  assert.equal(rendererFileFor('file:///etc/passwd', dir), null);
  assert.equal(rendererFileFor('nada', dir), null);
  assert.equal(rendererMime('/x/assets/index-abc.js'), 'text/javascript; charset=utf-8');
  assert.equal(rendererMime('/x/a.WOFF2'), 'font/woff2');
  assert.equal(rendererMime('/x/sem-tipo'), 'application/octet-stream');
  assert.equal(isRendererUrl('piu-app://app/index.html', RENDERER_ORIGIN), true);
  assert.equal(isRendererUrl('piu-app://app.evil/index.html', RENDERER_ORIGIN), false);
});

test('B-02: links externos só para a allowlist (https, origem exata)', () => {
  assert.equal(externalUrlAllowed('https://lunes.io/'), true);
  assert.equal(externalUrlAllowed('https://explorer.lunes.io/account/6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse'), true);
  assert.equal(externalUrlAllowed('https://github.com/lunes-platform'), true);
  assert.equal(externalUrlAllowed('https://lunes.io.evil.com/'), false);
  assert.equal(externalUrlAllowed('https://evil.com/?https://lunes.io'), false);
  assert.equal(externalUrlAllowed('http://lunes.io/'), false);
  assert.equal(externalUrlAllowed('https://user@lunes.io/'), false, 'credenciais na URL: não');
  assert.equal(externalUrlAllowed('file:///etc/passwd'), false);
  assert.equal(externalUrlAllowed('javascript:alert(1)'), false);
  assert.equal(externalUrlAllowed('não é url'), false);
});

test('B-01: IPC só aceita o quadro principal da janela do Piu com URL do próprio renderer', () => {
  const origin = 'file:///app/dist/renderer/';
  assert.equal(isTrustedSender({ url: origin + 'index.html', isMain: true }, origin), true);
  assert.equal(isTrustedSender({ url: origin + 'index.html', isMain: false }, origin), false, 'iframe/subquadro: não');
  assert.equal(isTrustedSender({ url: 'https://evil.com/', isMain: true }, origin), false);
  assert.equal(isTrustedSender({ url: 'file:///app/dist/renderer-x/index.html', isMain: true }, origin), false);
  assert.equal(isTrustedSender(null, origin), false);
});

test('M-01: mostrar a frase pede Touch ID quando há; sem Touch ID, confirmação nativa; cancelar recusa', async () => {
  const calls: string[] = [];
  const deps = (o: { platform: string; touch: boolean; touchOk?: boolean; confirm?: boolean }) => ({
    platform: o.platform,
    canPromptTouchID: () => o.touch,
    promptTouchID: async (reason: string) => { calls.push(`touch:${reason}`); if (!o.touchOk) throw new Error('cancelado'); },
    confirm: async () => { calls.push('confirm'); return o.confirm ?? false; },
  });
  assert.equal(await reauthForPhrase(deps({ platform: 'darwin', touch: true, touchOk: true })), true);
  assert.match(calls.pop()!, /^touch:.*frase/);
  assert.equal(await reauthForPhrase(deps({ platform: 'darwin', touch: true, touchOk: false, confirm: true })), false, 'Touch ID recusado não cai para um clique');
  assert.deepEqual(calls.splice(0), ['touch:mostrar a frase de recuperação do Piu']);
  assert.equal(await reauthForPhrase(deps({ platform: 'darwin', touch: false, confirm: true })), true);
  assert.equal(await reauthForPhrase(deps({ platform: 'win32', touch: false, confirm: false })), false);
  assert.equal(await reauthForPhrase(deps({ platform: 'linux', touch: true, confirm: true })), true, 'Touch ID só existe no macOS');
  assert.deepEqual(calls.splice(0), ['confirm', 'confirm', 'confirm']);
  // Erro na própria confirmação também recusa (falha fechada).
  assert.equal(await reauthForPhrase({ ...deps({ platform: 'win32', touch: false }), confirm: async () => { throw new Error('sem janela'); } }), false);
});

test('M-01: exportar o backup da identidade passa pela mesma reautenticação da frase; recusa não cifra nem grava', async () => {
  const calls: string[] = [];
  const deps = (o: { reauth: boolean | Error; path: string | null }) => ({
    reauth: async () => { calls.push('reauth'); if (o.reauth instanceof Error) throw o.reauth; return o.reauth; },
    choosePath: async () => { calls.push('path'); return o.path; },
    encrypt: async () => { calls.push('encrypt'); return 'cifrado'; },
    write: async (path: string, data: string) => { calls.push(`write:${path}:${data}`); },
  });
  await assert.rejects(exportBackupAfterReauth(deps({ reauth: false, path: '/tmp/a.piu' })), /recusada/);
  assert.deepEqual(calls.splice(0), ['reauth'], 'sem reautenticação: nem diálogo de salvar, nem arquivo');
  // Erro na reautenticação também recusa (falha fechada).
  await assert.rejects(exportBackupAfterReauth(deps({ reauth: new Error('sem janela'), path: '/tmp/a.piu' })), /recusada/);
  assert.deepEqual(calls.splice(0), ['reauth']);
  assert.equal(await exportBackupAfterReauth(deps({ reauth: true, path: null })), 'cancelled');
  assert.deepEqual(calls.splice(0), ['reauth', 'path'], 'cancelar o salvar não lê a frase');
  assert.equal(await exportBackupAfterReauth(deps({ reauth: true, path: '/tmp/a.piu' })), 'saved');
  assert.deepEqual(calls.splice(0), ['reauth', 'path', 'encrypt', 'write:/tmp/a.piu:cifrado']);
});

test('PIU_PROFILE: perfil separado (pasta de dados e nome) só com nome curto e seguro; sem ele, o perfil normal', () => {
  assert.equal(profileFromEnv({}), null);
  assert.equal(profileFromEnv({ PIU_PROFILE: '' }), null);
  assert.equal(profileFromEnv({ PIU_PROFILE: 'smoke-1' }), 'smoke-1');
  for (const bad of ['../x', 'a/b', 'A B', 'x'.repeat(25), '.', 'ção', 'a\\b']) assert.equal(profileFromEnv({ PIU_PROFILE: bad }), null, bad);
});

test('microfone só para a chamada: áudio, janela do Piu e chamada aberta', () => {
  const origin = 'piu-app://app/';
  assert.equal(mediaAllowed({ types: ['audio'], url: 'piu-app://app/index.html', origin, inCall: true }), true);
  assert.equal(mediaAllowed({ types: ['audio'], url: 'piu-app://app', origin, inCall: true, check: true }), true);
  assert.equal(mediaAllowed({ types: ['unknown'], url: 'piu-app://app', origin, inCall: true, check: true }), true);
  assert.equal(mediaAllowed({ types: ['audio'], url: 'piu-app://app/index.html', origin, inCall: false }), false, 'sem chamada, nada');
  assert.equal(mediaAllowed({ types: ['audio', 'video'], url: 'piu-app://app/index.html', origin, inCall: true }), false, 'câmera nunca');
  assert.equal(mediaAllowed({ types: ['unknown'], url: 'piu-app://app/index.html', origin, inCall: true }), false);
  assert.equal(mediaAllowed({ types: [], url: 'piu-app://app/index.html', origin, inCall: true }), false);
  assert.equal(mediaAllowed({ types: ['audio'], url: 'https://evil.example/', origin, inCall: true }), false, 'outra origem');
});
