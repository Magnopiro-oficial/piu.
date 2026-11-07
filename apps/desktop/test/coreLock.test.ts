import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiuCore } from '../src/main/core';

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};
const opts = (dir: string) => ({ userData: dir, safeStorage, platform: 'test', version: 'test', hostname: 't',
  lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] },
  walletBalance: async () => { throw new Error('sem rede nos testes'); } });

test('PiuCore: senha do Piu — criar, conferir, trocar, remover; ajustes de bloqueio exigem a senha', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-lock-'));
  const c = new PiuCore(opts(dir));
  t.after(async () => { await c.close(); rmSync(dir, { recursive: true, force: true }); });
  await c.open();
  assert.deepEqual(c.lockConfig(), { hasPassword: false, storable: true });
  assert.throws(() => c.setPrefs({ lockOnSuspend: true }), /senha do Piu/);
  assert.throws(() => c.setPrefs({ lockAfter: '15' }), /senha do Piu/);
  c.setPrefs({ lockAfter: 'never', lockOnSuspend: false }); // desligar sempre pode

  await assert.rejects(c.setLockPassword(null, '123'), /6 caracteres/);
  await c.setLockPassword(null, 'pato42!');
  assert.equal(c.lockConfig().hasPassword, true);
  assert.ok(!readFileSync(join(dir, 'state.bin')).includes(Buffer.from('pato42!')), 'a senha não vai para o disco');
  assert.ok(!JSON.stringify(c.prefs()).includes('scrypt'), 'nada da senha nas preferências (vão para a interface)');
  c.setPrefs({ lockOnSuspend: true, lockAfter: '15' });

  assert.equal((await c.checkLockPassword('errada', 1000)).ok, false);
  assert.equal((await c.checkLockPassword('pato42!', 2000)).ok, true);
  assert.equal(c.lockAttempts(2000).triesLeft, 5, 'acerto zera');

  await assert.rejects(c.setLockPassword('errada', 'outra-senha'), /incorreta/);
  await assert.rejects(c.setLockPassword(null, 'outra-senha'), /incorreta/, 'trocar exige a atual');
  await c.setLockPassword('pato42!', 'outra-senha');
  assert.equal((await c.checkLockPassword('outra-senha', 3000)).ok, true);

  await assert.rejects(c.removeLockPassword('pato42!'), /incorreta/);
  await c.removeLockPassword('outra-senha');
  assert.equal(c.lockConfig().hasPassword, false);
  assert.equal(c.prefs().lockOnSuspend, false, 'sem senha, os bloqueios automáticos desligam');
  assert.equal(c.prefs().lockAfter, 'never');
});

test('PiuCore: 5 erros começam a espera e ela sobrevive a fechar e abrir o Piu', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-lock2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const t0 = 10_000_000;
  const a = new PiuCore(opts(dir));
  await a.open();
  await a.setLockPassword(null, 'pato42!');
  for (let i = 0; i < 4; i++) assert.equal((await a.checkLockPassword('x', t0)).ok, false);
  assert.equal(a.lockAttempts(t0).triesLeft, 1);
  const r = await a.checkLockPassword('x', t0);
  assert.equal(r.ok, false);
  assert.equal(r.wait?.totalSec, 30);
  // Na espera nem a senha certa entra (e não conta erro novo).
  const during = await a.checkLockPassword('pato42!', t0 + 5000);
  assert.equal(during.ok, false);
  assert.equal(during.wait?.totalSec, 30);
  await a.close();

  const b = new PiuCore(opts(dir));
  t.after(() => b.close());
  await b.open();
  assert.equal(b.lockAttempts(t0 + 6000).wait?.remainingSec, 24, 'reabrir não zera a espera');
  assert.equal((await b.checkLockPassword('x', t0 + 31_000)).wait?.totalSec, 60, 'erro depois da espera: dobra');
  assert.equal((await b.checkLockPassword('pato42!', t0 + 92_000)).ok, true);
  assert.equal(b.lockAttempts(t0 + 92_000).wait, null);
});
