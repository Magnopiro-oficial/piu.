import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppLock, lockTrigger, reasonOf } from '../src/main/appLock';
import { DEFAULT_PREFS } from '../src/shared/types';

test('bloqueio: suspender/bloquear a tela só bloqueia com o ajuste ligado; inatividade pelo prazo escolhido', () => {
  const p = { ...DEFAULT_PREFS };
  assert.equal(lockTrigger(p, { kind: 'suspend' }), false);
  assert.equal(lockTrigger({ ...p, lockOnSuspend: true }, { kind: 'suspend' }), true);
  assert.equal(lockTrigger({ ...p, lockOnSuspend: true }, { kind: 'lock-screen' }), true);
  assert.equal(lockTrigger({ ...p, lockAfter: 'never' }, { kind: 'idle', idleSec: 1e9 }), false);
  assert.equal(lockTrigger({ ...p, lockAfter: '5' }, { kind: 'idle', idleSec: 299 }), false);
  assert.equal(lockTrigger({ ...p, lockAfter: '5' }, { kind: 'idle', idleSec: 300 }), true);
  assert.equal(lockTrigger({ ...p, lockAfter: '60' }, { kind: 'idle', idleSec: 3599 }), false);
  assert.equal(lockTrigger({ ...p, lockAfter: '15' }, { kind: 'idle', idleSec: Number.NaN }), false);
  assert.equal(lockTrigger({ ...p, lockAfter: '15' }, { kind: 'manual' }), true);
});

test('bloqueio: desbloquear exige a reautenticação; recusa ou erro mantém bloqueado (falha fechada)', async () => {
  const seen: boolean[] = [];
  const l = new AppLock(v => seen.push(v));
  assert.equal(l.locked, false);
  assert.equal(await l.unlock(async () => true), true, 'desbloqueado não pede nada');
  l.lock(); l.lock();
  assert.deepEqual(seen, [true], 'avisa só na mudança');
  assert.equal(await l.unlock(async () => false), false);
  assert.equal(await l.unlock(async () => { throw new Error('x'); }), false);
  assert.equal(l.locked, true);
  assert.equal(await l.unlock(async () => true), true);
  assert.equal(l.locked, false);
  assert.deepEqual(seen, [true, false]);
});

test('bloqueio: ao abrir só bloqueia com algum bloqueio automático ligado; motivo, hora e contagem de novas', async () => {
  const p = { ...DEFAULT_PREFS };
  assert.equal(lockTrigger(p, { kind: 'start' }), false);
  assert.equal(lockTrigger({ ...p, lockOnSuspend: true }, { kind: 'start' }), true);
  assert.equal(lockTrigger({ ...p, lockAfter: '15' }, { kind: 'start' }), true);
  assert.equal(reasonOf({ kind: 'lock-screen' }), 'suspend');
  assert.equal(reasonOf({ kind: 'idle', idleSec: 900 }), 'idle');
  let t = 1000;
  const l = new AppLock(() => {}, () => t);
  l.received();
  assert.equal(l.newMessages, 0, 'desbloqueado não conta');
  l.lock('idle');
  assert.equal(l.reason, 'idle'); assert.equal(l.at, 1000);
  l.received(); l.received();
  t = 5000; l.lock('manual');
  assert.equal(l.reason, 'idle', 'já bloqueado: mantém o primeiro motivo');
  assert.equal(l.newMessages, 2);
  assert.equal(await l.unlock(async () => true), true);
  assert.equal(l.newMessages, 0);
});

test('bloqueio: chamadas perdidas enquanto bloqueado ficam guardadas (sem repetir) para o aviso ao desbloquear', async () => {
  const seen: string[][] = [];
  const l = new AppLock(locked => { if (!locked) seen.push(l.takeMissedCalls()); });
  l.missedCall('piu:ana');
  l.lock();
  l.missedCall('piu:ana'); l.missedCall('piu:bia'); l.missedCall('piu:ana');
  assert.equal(await l.unlock(async () => false), false);
  assert.equal(await l.unlock(async () => true), true);
  assert.deepEqual(seen, [['piu:ana', 'piu:bia']], 'desbloqueado não conta; ao desbloquear, cada um uma vez');
  assert.deepEqual(l.takeMissedCalls(), [], 'lidas uma vez só');
  l.lock(); l.missedCall('piu:caio');
  l.lock();
  assert.equal(await l.unlock(async () => true), true);
  assert.deepEqual(seen.at(-1), ['piu:caio']);
});
