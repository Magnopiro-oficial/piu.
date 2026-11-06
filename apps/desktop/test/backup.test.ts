import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openBackup, parseBackupHeader } from '../../mobile/src/lib/backupFile';
import { createIdentityBackup } from '../src/main/backup';
import { identityFromPhrase } from '../src/main/identity';

const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');
const password = 'senha-de-teste-4937';

test('backup Desktop é cifrado e restaurável pelo leitor do mobile, sem histórico', async () => {
  let issued: string[] = [];
  const vault = { secure: true, getPhrase: async () => (issued = [...phrase]) };
  const file = await createIdentityBackup(vault, password);
  assert.equal(issued.every(w => w === ''), true, 'cópia transitória é limpa depois do uso');
  assert.equal(file.includes(phrase.join(' ')), false);
  assert.equal(parseBackupHeader(file).kdf.N, 65536);
  const restored = await openBackup(file, password);
  assert.deepEqual(restored.phrase, phrase);
  assert.equal(restored.from, 'Piu Desktop');
  assert.equal(restored.data, undefined, 'não promete restaurar conversas');
  assert.equal(identityFromPhrase(restored.phrase).identities.public.id, identityFromPhrase(phrase).identities.public.id);
  await assert.rejects(openBackup(file, 'senha-incorreta-4937'), { code: 'AUTH' });
  const parsed = JSON.parse(file); const first = parsed.ct[0]; parsed.ct = (first === 'A' ? 'B' : 'A') + parsed.ct.slice(1);
  await assert.rejects(openBackup(JSON.stringify(parsed), password), { code: 'AUTH' });
});

test('backup recusa senha fraca, cofre indisponível e identidade ausente', async () => {
  let calls = 0;
  const vault = { secure: true, getPhrase: async () => { calls++; return [...phrase]; } };
  await assert.rejects(createIdentityBackup(vault, 'curta'), /10 caracteres/);
  assert.equal(calls, 0, 'não lê frase para senha inválida');
  await assert.rejects(createIdentityBackup({ secure: false, getPhrase: vault.getPhrase }, password), /cofre/);
  assert.equal(calls, 0);
  await assert.rejects(createIdentityBackup({ secure: true, getPhrase: async () => null }, password), /identidade/);
});


test('frase transitória é limpa mesmo se a identidade for inválida', async () => {
  const invalid = Array(12).fill('wrong');
  await assert.rejects(createIdentityBackup({ secure: true, getPhrase: async () => invalid }, password), { code: 'CONTENT' });
  assert.equal(invalid.every(w => w === ''), true);
});
