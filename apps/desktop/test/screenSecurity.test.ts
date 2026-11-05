import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINUX_NOTE, screenSecurityFor, screenSecuritySupported } from '../src/shared/screenSecurity';
import { DEFAULT_PREFS } from '../src/shared/types';

test('segurança da tela: padrão ligado', () => {
  assert.equal(DEFAULT_PREFS.screenSecurity, true);
});

test('segurança da tela: macOS e Windows protegem SÓ com uma conversa aberta', () => {
  for (const os of ['darwin', 'win32']) {
    assert.equal(screenSecuritySupported(os), true);
    // Conversa aberta + ajuste ligado → bloqueia.
    assert.deepEqual(screenSecurityFor(os, true, true), { supported: true, protect: true, note: null });
    // Lista sem conversa, Ajustes, Carteira → captura liberada, mesmo com o ajuste ligado.
    assert.deepEqual(screenSecurityFor(os, true, false), { supported: true, protect: false, note: null });
    // Ajuste desligado → nunca bloqueia.
    assert.equal(screenSecurityFor(os, false, true).protect, false);
    assert.equal(screenSecurityFor(os, false, false).protect, false);
  }
});

test('segurança da tela: Linux não tem suporte — nunca protege e explica o motivo, mesmo com conversa aberta', () => {
  assert.equal(screenSecuritySupported('linux'), false);
  const d = screenSecurityFor('linux', true, true);
  assert.equal(d.supported, false);
  assert.equal(d.protect, false);
  assert.equal(d.note, LINUX_NOTE);
  assert.equal(screenSecurityFor('freebsd', true, true).protect, false);
});
