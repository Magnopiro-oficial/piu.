import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINUX_NOTE, screenSecurityFor, screenSecuritySupported, SECRET_SCREENS } from '../src/shared/screenSecurity';
import { DEFAULT_PREFS } from '../src/shared/types';

const none = { conversation: false, secret: false };
const conv = { conversation: true, secret: false };
const secret = { conversation: false, secret: true };

test('segurança da tela: padrão ligado', () => {
  assert.equal(DEFAULT_PREFS.screenSecurity, true);
});

test('segurança da tela: macOS e Windows protegem conversas abertas com o ajuste ligado', () => {
  for (const os of ['darwin', 'win32']) {
    assert.equal(screenSecuritySupported(os), true);
    // Conversa aberta + ajuste ligado → bloqueia.
    assert.deepEqual(screenSecurityFor(os, true, conv), { supported: true, protect: true, note: null });
    // Lista sem conversa nem segredo → captura liberada, mesmo com o ajuste ligado.
    assert.deepEqual(screenSecurityFor(os, true, none), { supported: true, protect: false, note: null });
    // Ajuste desligado → conversa não bloqueia.
    assert.equal(screenSecurityFor(os, false, conv).protect, false);
    assert.equal(screenSecurityFor(os, false, none).protect, false);
  }
});

test('segurança da tela (M-02): frase, QR do vínculo e carteira são protegidos SEMPRE, mesmo com o ajuste desligado', () => {
  for (const os of ['darwin', 'win32']) {
    assert.equal(screenSecurityFor(os, true, secret).protect, true);
    assert.equal(screenSecurityFor(os, false, secret).protect, true);
    assert.equal(screenSecurityFor(os, false, { conversation: true, secret: true }).protect, true);
  }
  assert.deepEqual([...SECRET_SCREENS].sort(), ['link', 'phrase', 'wallet']);
});

test('segurança da tela: Linux não tem suporte — nunca protege e explica o motivo, mesmo com conversa aberta', () => {
  assert.equal(screenSecuritySupported('linux'), false);
  const d = screenSecurityFor('linux', true, { conversation: true, secret: true });
  assert.equal(d.supported, false);
  assert.equal(d.protect, false);
  assert.equal(d.note, LINUX_NOTE);
  assert.equal(screenSecurityFor('freebsd', true, conv).protect, false);
});
