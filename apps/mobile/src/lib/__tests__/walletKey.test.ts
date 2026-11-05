/// <reference types="node" />
/**
 * Etapa 1 da carteira própria: frase BIP39 → mini-secret (substrate-bip39) → sr25519 → SS58.
 * Vetores conferidos com @polkadot/util-crypto (walletFixture.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, seedFromPhrase } from '../../protocol';
import { fromHex, toHex } from '../lunesRpc';
import { decodeSs58 } from '../ss58';
import {
  deriveHard, miniSecretFromPhrase, signWithWalletKey, verifyWalletSignature, walletAddressFromPhrase,
  walletKeyFromPhrase, wipe, withWalletKey,
} from '../walletKey';
import { ALICE_PUB, DEV_ADDR_42, DEV_ADDR_57, DEV_MINI, DEV_MNEMONIC, DEV_PUB } from './walletFixture';

const WORDS = DEV_MNEMONIC.split(' ');

test('mini-secret substrate-bip39 da mnemônica dev (igual ao mnemonicToMiniSecret do @polkadot)', () => {
  assert.equal(toHex(miniSecretFromPhrase(WORDS)), DEV_MINI);
  // Palavras com espaço e maiúsculas são normalizadas como no resto do app.
  assert.equal(toHex(miniSecretFromPhrase(WORDS.map(w => ` ${w.toUpperCase()} `))), DEV_MINI);
  assert.throws(() => miniSecretFromPhrase([...WORDS.slice(0, 11), 'zoo']), /Frase inválida/, 'checksum errado');
  assert.throws(() => miniSecretFromPhrase([...WORDS.slice(0, 11), 'naoexiste']), /Frase inválida/, 'palavra fora da lista');
  assert.throws(() => miniSecretFromPhrase(WORDS.slice(0, 11)), /Frase inválida/);
});

test('chave sr25519 e endereços 57 (Lunes) e 42 (explorador) da mnemônica dev', () => {
  const k = walletKeyFromPhrase(WORDS);
  assert.equal(k.secret.length, 64, 'segredo sr25519 expandido (escalar ‖ nonce)');
  assert.equal(toHex(k.publicKey), DEV_PUB);
  assert.equal(k.address, DEV_ADDR_57);
  assert.equal(walletAddressFromPhrase(WORDS), DEV_ADDR_57);
  assert.equal(walletAddressFromPhrase(WORDS, 42), DEV_ADDR_42);
  // Os dois endereços são a mesma conta.
  const d57 = decodeSs58(DEV_ADDR_57), d42 = decodeSs58(DEV_ADDR_42);
  assert.ok(d57.ok && d42.ok);
  assert.equal(toHex(d57.publicKey), DEV_PUB);
  assert.equal(toHex(d42.publicKey), DEV_PUB);
  wipe(k.secret);
  assert.ok(k.secret.every(b => b === 0));
});

test('//Alice: derivação dura reproduz o vetor canônico do Substrate', () => {
  const k = walletKeyFromPhrase(WORDS);
  const alice = deriveHard(k.secret, 'Alice');
  assert.equal(toHex(alice.publicKey), ALICE_PUB);
  // Rótulo com mais de 32 bytes vira blake2b-256 do SCALE(rótulo): só precisa ser determinístico e diferente.
  const long = deriveHard(k.secret, 'um rótulo bem comprido, com mais de trinta e dois bytes');
  assert.equal(long.publicKey.length, 32);
  assert.notEqual(toHex(long.publicKey), ALICE_PUB);
  assert.deepEqual(deriveHard(k.secret, 'um rótulo bem comprido, com mais de trinta e dois bytes').publicKey, long.publicKey);
  wipe(k.secret, alice.secret, long.secret);
});

test('a chave da carteira é independente das identidades do Piu (mesma frase, árvores diferentes)', () => {
  const k = walletKeyFromPhrase(WORDS);
  const seed = seedFromPhrase(WORDS);
  for (const kind of ['public', 'anon'] as const) {
    const id = deriveIdentity(seed, kind);
    assert.notEqual(toHex(id.signPk), toHex(k.publicKey));
    assert.notEqual(toHex(id.agreePk), toHex(k.publicKey));
    assert.ok(!id.id.includes(toHex(k.publicKey).slice(2, 18)));
  }
  assert.notEqual(toHex(seed), DEV_MINI, 'o KDF da identidade (HKDF) não é o da carteira (PBKDF2)');
  wipe(k.secret);
});

test('withWalletKey: entrega a chave ao chamador e zera o segredo depois, mesmo com erro ou Promise', async () => {
  let seen: Uint8Array | null = null;
  const addr = withWalletKey(WORDS, k => { seen = k.secret; return k.address; });
  assert.equal(addr, DEV_ADDR_57);
  assert.ok(seen!.every(b => b === 0), 'zerado após o retorno');

  seen = null;
  assert.throws(() => withWalletKey(WORDS, k => { seen = k.secret; throw new Error('boom'); }), /boom/);
  assert.ok(seen!.every(b => b === 0), 'zerado após erro');

  seen = null;
  const r = withWalletKey(WORDS, async k => { seen = k.secret; await Promise.resolve(); return toHex(k.publicKey); });
  assert.ok(r instanceof Promise);
  assert.ok(!seen!.every(b => b === 0), 'ainda em uso enquanto a Promise não resolve');
  assert.equal(await r, DEV_PUB);
  assert.ok(seen!.every(b => b === 0), 'zerado após a Promise');
});

test('assinatura sr25519: verifica com a chave pública, falha com mensagem ou chave trocada', () => {
  const k = walletKeyFromPhrase(WORDS);
  const msg = new TextEncoder().encode('piu');
  const sig = signWithWalletKey(k, msg);
  assert.equal(sig.length, 64);
  assert.ok(verifyWalletSignature(msg, sig, k.publicKey));
  assert.ok(!verifyWalletSignature(new TextEncoder().encode('piX'), sig, k.publicKey));
  assert.ok(!verifyWalletSignature(msg, sig, fromHex(ALICE_PUB)));
  // Com `random` fixo a assinatura é determinística (usado nas fixtures); sem ele, muda a cada vez.
  const r = new Uint8Array(32).fill(7);
  assert.equal(toHex(signWithWalletKey(k, msg, r)), toHex(signWithWalletKey(k, msg, r)));
  assert.notEqual(toHex(signWithWalletKey(k, msg)), toHex(signWithWalletKey(k, msg)));
  wipe(k.secret);
});
