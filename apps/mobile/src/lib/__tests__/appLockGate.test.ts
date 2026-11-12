/// <reference types="node" />
/**
 * Auditoria 2026-11-09 (baixos): bloqueio do app no Android (miniatura dos recentes), aviso quando o
 * aparelho fica sem bloqueio e conversa aberta com o app em segundo plano ou sob o bloqueio.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_LOCK_KEY, isAppLocked, isViewingNow, lockCapture, onAppLockChange, readOnView, setAppLocked, unlockOutcome } from '../appLockGate';

test('Bloqueio do app · Android: FLAG_SECURE no app inteiro com o bloqueio ligado (miniatura em branco)', () => {
  assert.deepEqual(lockCapture('android', true), { iosSwitcher: false, androidSecure: true });
  assert.deepEqual(lockCapture('android', false), { iosSwitcher: false, androidSecure: false });
  assert.deepEqual(lockCapture('ios', true), { iosSwitcher: true, androidSecure: false });
  assert.deepEqual(lockCapture('web', true), { iosSwitcher: false, androidSecure: false });
  assert.equal(typeof APP_LOCK_KEY, 'string');
});

test('Bloqueio do app · sem bloqueio no aparelho: abre, mas avisa que o ajuste está sem efeito', () => {
  assert.deepEqual(unlockOutcome('ok'), { open: true, warnNoLock: false });
  assert.deepEqual(unlockOutcome('unavailable'), { open: true, warnNoLock: true });
  assert.deepEqual(unlockOutcome('denied'), { open: false, warnNoLock: false });
});

test('Conversa aberta · só conta como vista com o app em primeiro plano e destravado', () => {
  assert.equal(isViewingNow('c1', 'c1', { active: true, locked: false }), true);
  assert.equal(isViewingNow('c1', 'c1', { active: false, locked: false }), false, 'segundo plano: não marca como lida');
  assert.equal(isViewingNow('c1', 'c1', { active: true, locked: true }), false, 'sob o bloqueio do app: não marca como lida');
  assert.equal(isViewingNow('c1', 'c2', { active: true, locked: false }), false);
  assert.equal(isViewingNow(null, 'c1', { active: true, locked: false }), false);
});

test('Estado do bloqueio · avisa quem ouve só quando muda', () => {
  const seen: boolean[] = [];
  const off = onAppLockChange(v => seen.push(v));
  setAppLocked(true); setAppLocked(true); assert.equal(isAppLocked(), true);
  setAppLocked(false);
  off(); setAppLocked(true);
  assert.deepEqual(seen, [true, false]);
  setAppLocked(false);
});

test('Conversa aberta · abrir sob o bloqueio ou em segundo plano não zera nem manda recibo', () => {
  const c = { unread: 2, msgs: [{ from: 'them', id: 'in-a' }, { from: 'them', id: 'in-b' }] };
  assert.equal(readOnView(c, false, true), null);
  assert.deepEqual(readOnView(c, true, true), { clear: true });
});

test('Conversa aberta · voltar para a frente sem nada novo não reenvia recibo', () => {
  const c = { unread: 0, msgs: [{ from: 'them', id: 'in-a' }] };
  assert.equal(readOnView(c, true, false), null);
  assert.equal(readOnView(undefined, true, false), null);
});

test('Conversa aberta · voltar para a frente confirma só o que chegou sem ser visto', () => {
  const c = { unread: 2, msgs: [{ from: 'them', id: 'in-a' }, { from: 'me', id: 'out-x' }, { from: 'them', id: 'in-b' }, { from: 'them', id: 'in-c' }] };
  assert.deepEqual(readOnView(c, true, false), { clear: true, ids: ['in-b', 'in-c'] });
  assert.equal(readOnView(c, false, false), null);
});
