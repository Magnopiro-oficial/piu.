/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b64url, unb64url } from '../../messaging/card';
import { newPhrase } from '../../protocol/phrase';
import { BackupError, openBackup, parseBackupHeader, sealBackup } from '../backupFile';

// Custo mínimo aceito (2^14) para os testes rodarem rápido; o app usa 2^16.
const N = 1 << 14;
const PASS = 'praça do mutirão 2026';
const phrase = newPhrase();

const rejects = (p: Promise<unknown>, code: BackupError['code']) =>
  assert.rejects(p, (e: unknown) => e instanceof BackupError && e.code === code);

test('backup: ida e volta com a senha certa traz a mesma frase e os dados', async () => {
  const text = await sealBackup({ phrase, createdAt: 1_800_000_000, from: 'Pixel', data: { profile: { name: 'Cardeal' } } }, PASS, { N });
  assert.ok(!text.includes(phrase.join(' ')), 'a frase não aparece em claro');
  assert.ok(!text.includes('Cardeal'), 'os dados não aparecem em claro');
  assert.equal(parseBackupHeader(text).kdf.N, N);
  const back = await openBackup(text, PASS);
  assert.deepEqual(back.phrase, phrase);
  assert.equal(back.from, 'Pixel');
  assert.deepEqual(back.data, { profile: { name: 'Cardeal' } });
  // A mesma senha em outra forma Unicode (NFD) abre igual (normalização NFKC).
  assert.deepEqual((await openBackup(text, PASS.normalize('NFD'))).phrase, phrase);
});

test('backup: dois arquivos da mesma frase e senha são diferentes (sal e nonce aleatórios)', async () => {
  const a = await sealBackup({ phrase, createdAt: 1 }, PASS, { N });
  const b = await sealBackup({ phrase, createdAt: 1 }, PASS, { N });
  assert.notEqual(a, b);
});

test('backup: senha errada é recusada', async () => {
  const text = await sealBackup({ phrase, createdAt: 1 }, PASS, { N });
  await rejects(openBackup(text, 'praça do mutirão 2027'), 'AUTH');
});

test('backup: arquivo adulterado é recusado (conteúdo, nonce, sal e custo do scrypt)', async () => {
  const text = await sealBackup({ phrase, createdAt: 1 }, PASS, { N });
  const f = JSON.parse(text);
  const flip = (s: string) => { const b = unb64url(s); b[b.length - 1] ^= 1; return b64url(b); };
  await rejects(openBackup(JSON.stringify({ ...f, ct: flip(f.ct) }), PASS), 'AUTH');
  await rejects(openBackup(JSON.stringify({ ...f, nonce: flip(f.nonce) }), PASS), 'AUTH');
  await rejects(openBackup(JSON.stringify({ ...f, kdf: { ...f.kdf, salt: flip(f.kdf.salt) } }), PASS), 'AUTH');
  // Trocar o custo do scrypt muda a chave e o dado associado: não abre.
  await rejects(openBackup(JSON.stringify({ ...f, kdf: { ...f.kdf, N: N * 2 } }), PASS), 'AUTH');
  // Custo baixo demais, versão desconhecida ou lixo: recusado antes de derivar.
  await rejects(openBackup(JSON.stringify({ ...f, kdf: { ...f.kdf, N: 1024 } }), PASS), 'FORMAT');
  await rejects(openBackup(JSON.stringify({ ...f, v: 9 }), PASS), 'FORMAT');
  await rejects(openBackup(JSON.stringify({ ...f, ct: f.ct + '!' }), PASS), 'FORMAT');
  await rejects(openBackup('não é um backup', PASS), 'FORMAT');
});

test('backup: senha curta e frase inválida não geram arquivo', async () => {
  await rejects(sealBackup({ phrase, createdAt: 1 }, 'curta', { N }), 'PASSWORD');
  await rejects(sealBackup({ phrase: ['abc'], createdAt: 1 }, PASS, { N }), 'CONTENT');
});

test('backup: senha previsível (sequência, teclado, palavra comum + números) é recusada', async () => {
  const { passwordIssue } = await import('../backupFile');
  for (const p of ['1234567890', '0987654321', 'abcdefghij', 'qwertyuiop', 'asdfghjkl;', 'senha12345', 'Password2024', 'iloveyou123', 'piupiu2026!', '12345678910', 'admin123456'])
    assert.equal(passwordIssue(p), 'repetitive', p);
  for (const p of [PASS, 'cavalo bateria grampo', 'Tq8#vLm2pZ', 'minha avó fazia bolo'])
    assert.equal(passwordIssue(p), null, p);
  await rejects(sealBackup({ phrase, createdAt: 1 }, 'senha12345', { N }), 'PASSWORD');
});
