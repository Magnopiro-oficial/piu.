import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiuCore } from '../src/main/core';

/** Cofre falso que pode "negar" o acesso (Keychain recusado/bloqueado, libsecret sem resposta). */
function vaultSim() {
  const ss = {
    denied: false,
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => { if (ss.denied) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); return b.toString('utf8'); },
  };
  return ss;
}
const opts = (userData: string, safeStorage: ReturnType<typeof vaultSim>) => ({
  userData, safeStorage, platform: 'test', version: 'test', hostname: 'teste',
  lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] },
  link: { host: '127.0.0.1', listen: '127.0.0.1' },
  walletBalance: async () => { throw new Error('sem rede nos testes'); },
});
const snapshot = (dir: string) => Object.fromEntries(['vault/phrase.bin', 'vault/datakey.bin', 'state.bin', 'payments.bin'].filter(f => existsSync(join(dir, f))).map(f => [f, readFileSync(join(dir, f)).toString('hex')]));

test('PiuCore (A-01): Keychain negado na abertura → estado "locked", nada é recriado nem sobrescrito; "tentar de novo" volta à MESMA identidade', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-vault-'));
  const ss = vaultSim();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = new PiuCore(opts(dir, ss));
  await first.open();
  const created = await first.createIdentity({ kind: 'public', name: 'Ana' });
  assert.equal(created, undefined, 'M-01: a frase não volta ao renderer na criação');
  const id = first.session().me!.publicId;
  await first.close();
  const before = snapshot(dir);
  assert.ok(before['vault/phrase.bin'] && before['vault/datakey.bin'] && before['state.bin']);

  ss.denied = true;
  const core = new PiuCore(opts(dir, ss));
  t.after(() => core.close());
  await core.open();
  const s = core.session();
  assert.equal(s.state, 'locked');
  assert.match(s.lockedReason ?? '', /cofre|Keychain|chaveiro/i);
  await assert.rejects(core.createIdentity({ kind: 'public', name: 'Outra' }), /cofre|frase/i);
  await assert.rejects(core.restoreIdentity({ phrase: 'abandon '.repeat(11).concat('about').split(' '), name: '' }), /cofre|frase/i);
  await assert.rejects(core.linkStart(), /cofre/i);
  core.saveNow();
  assert.deepEqual(snapshot(dir), before, 'nenhum arquivo do cofre/estado mudou com o acesso negado');

  // Ainda negado: tentar de novo continua bloqueado, sem estragar nada.
  assert.equal((await core.retryOpen()).state, 'locked');
  assert.deepEqual(snapshot(dir), before);
  ss.denied = false;
  const again = await core.retryOpen();
  assert.equal(again.state, 'ready');
  assert.equal(again.me!.publicId, id, 'a mesma identidade de antes');
});

test('PiuCore (A-01): com phrase.bin guardada mas ilegível como frase, não abre "vazio" e criar/restaurar recusam', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-vault-'));
  const ss = vaultSim();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const core = new PiuCore(opts(dir, ss));
  t.after(() => core.close());
  // Frase que não deriva (palavras fora da lista): o arquivo existe e não pode ser sobrescrito por engano.
  require('node:fs').mkdirSync(join(dir, 'vault'), { recursive: true });
  writeFileSync(join(dir, 'vault', 'phrase.bin'), ss.encryptString('isto nao e uma frase'));
  await core.open();
  assert.equal(core.session().state, 'locked');
  await assert.rejects(core.createIdentity({ kind: 'anon', name: '' }), /já existe uma frase/i);
  assert.equal(readFileSync(join(dir, 'vault', 'phrase.bin'), 'utf8'), 'isto nao e uma frase');
});

test('PiuCore (A-01): state.bin ilegível com a chave certa vai para quarentena (não é sobrescrito) e o app abre', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-vault-'));
  const ss = vaultSim();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = new PiuCore(opts(dir, ss));
  await a.open();
  await a.createIdentity({ kind: 'public', name: 'Ana' });
  await a.close();
  const raw = readFileSync(join(dir, 'state.bin'));
  raw[raw.length - 1] ^= 0xff;
  writeFileSync(join(dir, 'state.bin'), raw);
  const b = new PiuCore(opts(dir, ss));
  t.after(() => b.close());
  await b.open();
  assert.equal(b.session().state, 'ready', 'a frase está intacta: a identidade sobe');
  const q = readdirSync(dir).find(f => f.startsWith('state.bin.corrupt-'));
  assert.ok(q, 'cópia ilegível guardada');
  assert.deepEqual(readFileSync(join(dir, q!)), raw);
});
