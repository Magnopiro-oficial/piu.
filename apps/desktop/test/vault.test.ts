import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type SafeStorageLike, Vault } from '../src/main/vault';

/** Cofre falso: "cifra" invertendo bytes, para o teste ver que nada fica em claro no disco. */
function fakeSafeStorage(available = true): SafeStorageLike & { calls: number } {
  const f = {
    calls: 0,
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => { f.calls++; return Buffer.from(Buffer.from(s, 'utf8').map(b => 255 - b)); },
    decryptString: (b: Buffer) => Buffer.from(b.map(x => 255 - x)).toString('utf8'),
  };
  return f;
}

const words = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ');

test('cofre: frase gravada cifrada pelo cofre do sistema e lida de volta', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const v = new Vault(dir, fakeSafeStorage());
    assert.equal(v.secure, true);
    assert.equal(await v.getPhrase(), null);
    await v.setPhrase(words);
    assert.deepEqual(await v.getPhrase(), words);
    const raw = readFileSync(join(dir, 'phrase.bin'));
    assert.ok(!raw.toString('utf8').includes('abandon'), 'a frase não pode estar em claro no disco');
    // Outra instância (reabrir o app) lê a mesma frase.
    assert.deepEqual(await new Vault(dir, fakeSafeStorage()).getPhrase(), words);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cofre: chave de dados é criada uma vez e reaproveitada', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const v = new Vault(dir, fakeSafeStorage());
    const k1 = await v.dataKey();
    assert.equal(k1.length, 32);
    assert.deepEqual(await v.dataKey(), k1);
    assert.deepEqual(await new Vault(dir, fakeSafeStorage()).dataKey(), k1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cofre: sem cifra disponível no sistema, recusa guardar a frase (nunca em claro)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const v = new Vault(dir, fakeSafeStorage(false));
    assert.equal(v.secure, false);
    await assert.rejects(v.setPhrase(words), /cofre/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cofre: apagar remove frase e chave', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const v = new Vault(dir, fakeSafeStorage());
    await v.setPhrase(words);
    await v.dataKey();
    await v.clear();
    assert.equal(await v.getPhrase(), null);
    assert.deepEqual(await new Vault(dir, fakeSafeStorage()).getPhrase(), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
