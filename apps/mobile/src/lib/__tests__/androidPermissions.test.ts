/// <reference types="node" />
/**
 * B-02 (auditoria 2026-11-06): o APK de release não declara sobreposição de tela nem push remoto (nada no
 * app usa). Revisto em 2026-11-07 para a chamada de voz: o microfone (RECORD_AUDIO) volta, declarado só
 * pelo módulo piu-voice e pedido em tempo de execução ao conectar uma chamada (state/calls.tsx), nunca antes.
 * Som do piu (expo-audio, só tocar) e notificações locais seguem iguais.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const BLOCKED = ['android.permission.SYSTEM_ALERT_WINDOW', 'com.google.android.c2dm.permission.RECEIVE'];
const KEPT = ['android.permission.RECORD_AUDIO', 'android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.CAMERA', 'android.permission.USE_BIOMETRIC'];

test('app.json: android.blockedPermissions (sobrevive ao prebuild)', () => {
  const app = JSON.parse(readFileSync(new URL('app.json', root), 'utf8'));
  const blocked: string[] = app.expo.android.blockedPermissions ?? [];
  for (const p of BLOCKED) assert.ok(blocked.includes(p), p);
  for (const p of KEPT) assert.ok(!blocked.includes(p), `não bloquear ${p}`);
});

test('microfone só pela chamada: declarado no módulo piu-voice e pedido só em state/calls.tsx', () => {
  const mod = readFileSync(new URL('modules/piu-voice/android/src/main/AndroidManifest.xml', root), 'utf8');
  assert.match(mod, /android\.permission\.RECORD_AUDIO/);
  const calls = readFileSync(new URL('src/state/calls.tsx', root), 'utf8');
  assert.match(calls, /PERMISSIONS\.RECORD_AUDIO/);
});

// android/ não é versionado (sai do prebuild): no CI só vale o teste do app.json; aqui confere o gerado.
const manifest = new URL('android/app/src/main/AndroidManifest.xml', root);
test('AndroidManifest (main): as duas saem com tools:node="remove"; nada de cleartext', { skip: !existsSync(manifest) && 'android/ não gerado (rode o prebuild)' }, () => {
  const xml = readFileSync(manifest, 'utf8');
  for (const p of BLOCKED) {
    const lines = xml.split('\n').filter(l => l.includes(`"${p}"`));
    assert.equal(lines.length, 1, p);
    assert.match(lines[0]!, /tools:node="remove"/, p);
  }
  assert.ok(!/usesCleartextTraffic/.test(xml), 'release continua sem tráfego em claro');
});
