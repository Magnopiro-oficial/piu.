import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type SafeStorageLike, Vault, VaultLockedError } from '../src/main/vault';

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

// ── A-01: cofre ilegível falha fechado (nunca vira "não existe") ──────────────
/** Cofre que lê o que gravou até alguém "negar" o acesso (Keychain recusado/bloqueado). */
function deniableSafeStorage() {
  const f = { ...fakeSafeStorage(), denied: false };
  const decrypt = f.decryptString;
  f.decryptString = (b: Buffer) => { if (f.denied) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); return decrypt(b); };
  return f;
}

test('cofre (A-01): Keychain negado → erro de cofre bloqueado, sem gerar chave nova nem sobrescrever datakey.bin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const ss = deniableSafeStorage();
    const v = new Vault(dir, ss);
    const k1 = await v.dataKey();
    const before = readFileSync(join(dir, 'datakey.bin'));
    ss.denied = true;
    await assert.rejects(new Vault(dir, ss).dataKey(), (e: unknown) => e instanceof VaultLockedError);
    assert.deepEqual(readFileSync(join(dir, 'datakey.bin')), before, 'a chave antiga continua intacta no disco');
    ss.denied = false;
    assert.deepEqual(await new Vault(dir, ss).dataKey(), k1, 'liberado o acesso, a MESMA chave volta');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cofre (A-01): frase ilegível → erro (não `null`); com frase guardada, `setPhrase` recusa sobrescrever', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const ss = deniableSafeStorage();
    const v = new Vault(dir, ss);
    assert.equal(v.hasPhrase(), false);
    await v.setPhrase(words);
    assert.equal(v.hasPhrase(), true);
    ss.denied = true;
    await assert.rejects(v.getPhrase(), (e: unknown) => e instanceof VaultLockedError);
    ss.denied = false;
    await assert.rejects(v.setPhrase([...words].reverse()), /já existe/i);
    assert.deepEqual(await v.getPhrase(), words, 'a frase original continua lá');
    // Apagar explicitamente libera gravar outra.
    await v.clear();
    await v.setPhrase([...words].reverse());
    assert.deepEqual(await v.getPhrase(), [...words].reverse());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cofre (A-01): datakey.bin com conteúdo inesperado → erro, sem gerar outra por cima', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const ss = fakeSafeStorage();
    new Vault(dir, ss);
    writeFileSync(join(dir, 'datakey.bin'), ss.encryptString('não é hex'));
    const before = readFileSync(join(dir, 'datakey.bin'));
    await assert.rejects(new Vault(dir, ss).dataKey(), (e: unknown) => e instanceof VaultLockedError);
    assert.deepEqual(readFileSync(join(dir, 'datakey.bin')), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── B-05: Linux com backend `basic_text` (senha fixa) não é cofre ─────────────
test('cofre (B-05): no Linux, backend basic_text/unknown conta como cofre indisponível', () => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-vault-'));
  try {
    const withBackend = (backend: string) => ({ ...fakeSafeStorage(), getSelectedStorageBackend: () => backend });
    assert.equal(new Vault(dir, withBackend('basic_text'), 'linux').secure, false);
    assert.equal(new Vault(dir, withBackend('unknown'), 'linux').secure, false);
    assert.equal(new Vault(dir, withBackend('gnome_libsecret'), 'linux').secure, true);
    assert.equal(new Vault(dir, withBackend('kwallet5'), 'linux').secure, true);
    // macOS/Windows não têm essa API: vale o `isEncryptionAvailable`.
    assert.equal(new Vault(dir, fakeSafeStorage(), 'darwin').secure, true);
    const throwing = { ...fakeSafeStorage(), getSelectedStorageBackend: () => { throw new Error('antes do ready'); } };
    assert.equal(new Vault(dir, throwing, 'linux').secure, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
