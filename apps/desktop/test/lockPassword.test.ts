import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptsAfterFailure, hashLockPassword, lockWait, LOCK_MAX_TRIES, lockPasswordProblem, triesLeft, verifyLockPassword } from '../src/main/lockPassword';

test('senha do Piu: guarda só scrypt com sal; confere a certa, recusa a errada e segredo estragado', async () => {
  const s = await hashLockPassword('pato-amarelo');
  assert.equal(s.kdf, 'scrypt');
  assert.match(s.salt, /^[0-9a-f]{32}$/);
  assert.match(s.hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(s).includes('pato-amarelo'), 'a senha nunca é guardada');
  const s2 = await hashLockPassword('pato-amarelo');
  assert.notEqual(s.salt, s2.salt, 'sal novo a cada senha');
  assert.notEqual(s.hash, s2.hash);
  assert.equal(await verifyLockPassword('pato-amarelo', s), true);
  assert.equal(await verifyLockPassword('pato-amarel0', s), false);
  assert.equal(await verifyLockPassword('', s), false);
  assert.equal(await verifyLockPassword('pato-amarelo', { ...s, hash: 'zz' }), false);
  assert.equal(await verifyLockPassword('pato-amarelo', { ...s, N: 3 }), false, 'parâmetros fora do esperado: recusa');
  assert.equal(await verifyLockPassword('pato-amarelo', null as never), false);
});

test('senha do Piu: regras mínimas', () => {
  assert.ok(lockPasswordProblem('12345'));
  assert.ok(lockPasswordProblem('aaaaaa'), 'repetitiva');
  assert.equal(lockPasswordProblem('pato42'), null);
  assert.ok(lockPasswordProblem('x'.repeat(300)));
});

test('tentativas: 5 erros e depois espera 30 s → 1 min → 2 min (teto); acerto zera', () => {
  let a = { fails: 0, until: 0, wait: 0 };
  const t0 = 1_000_000;
  for (let i = 1; i < LOCK_MAX_TRIES; i++) {
    a = attemptsAfterFailure(a, t0);
    assert.equal(triesLeft(a), LOCK_MAX_TRIES - i);
    assert.equal(lockWait(a, t0), null, 'ainda sem espera');
  }
  a = attemptsAfterFailure(a, t0); // 5ª
  assert.deepEqual(lockWait(a, t0), { remainingSec: 30, totalSec: 30, until: t0 + 30_000 });
  assert.deepEqual(lockWait(a, t0 + 11_000), { remainingSec: 19, totalSec: 30, until: t0 + 30_000 });
  assert.equal(lockWait(a, t0 + 30_000), null, 'terminou a espera');
  a = attemptsAfterFailure(a, t0 + 31_000); // 6ª: dobra
  assert.equal(lockWait(a, t0 + 31_000)!.totalSec, 60);
  a = attemptsAfterFailure(a, t0 + 200_000); // 7ª
  assert.equal(lockWait(a, t0 + 200_000)!.totalSec, 120);
  a = attemptsAfterFailure(a, t0 + 400_000); // 8ª: teto de 2 min
  assert.equal(lockWait(a, t0 + 400_000)!.totalSec, 120);
  assert.equal(triesLeft(a), 0);
});

test('tentativas: relógio voltando para trás não encurta nem estica além do total', () => {
  const a = attemptsAfterFailure({ fails: 4, until: 0, wait: 0 }, 50_000);
  const w = lockWait(a, 10_000)!;
  assert.equal(w.remainingSec, 30, 'nunca mais que a espera total');
});
