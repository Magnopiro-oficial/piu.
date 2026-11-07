import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveIdentity, deriveNodeKey } from '../../mobile/src/protocol/keys';
import { seedFromPhrase } from '../../mobile/src/protocol/phrase';
import { createIdentity, identityFromPhrase, normalizePhrase } from '../src/main/identity';

test('identidade nova: frase de 12 palavras válida e chaves derivadas dela', () => {
  const { phrase, keys } = createIdentity();
  assert.equal(phrase.length, 12);
  // Mesma derivação do celular: restaurar a frase dá as mesmas identidades.
  const again = identityFromPhrase(phrase);
  assert.equal(again.identities.public.id, keys.identities.public.id);
  assert.equal(again.identities.anon.id, keys.identities.anon.id);
  assert.notEqual(keys.identities.public.id, keys.identities.anon.id, 'pública e anônima não compartilham ids');
  assert.deepEqual(again.node.pk, keys.node.pk);
});

test('identidade restaurada bate com as funções do app do celular (mesma semente, mesmos ids)', () => {
  const words = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');
  const seed = seedFromPhrase(words);
  const k = identityFromPhrase(words);
  assert.equal(k.identities.public.id, deriveIdentity(seed, 'public').id);
  assert.equal(k.identities.anon.id, deriveIdentity(seed, 'anon').id);
  assert.deepEqual(k.node.pk, deriveNodeKey(seed).pk);
  assert.equal(k.walletSeed.length, 32);
});

test('frase: normaliza espaços e maiúsculas; frase errada é recusada com mensagem clara', () => {
  assert.deepEqual(normalizePhrase('  Legal  WINNER thank\nyear '), ['legal', 'winner', 'thank', 'year']);
  assert.throws(() => identityFromPhrase('legal winner thank year wave sausage worth useful legal winner thank zebra'.split(' ')), /frase/i);
  assert.throws(() => identityFromPhrase(['so', 'tres', 'palavras']), /12 palavras/i);
});

test('endereço da carteira: o MESMO que o celular deriva da frase (vetor conferido com @polkadot)', async () => {
  const { DEV_MNEMONIC, DEV_ADDR_57 } = await import('../../mobile/src/lib/__tests__/walletFixture');
  const { walletAddressFromPhrase } = await import('../../mobile/src/lib/walletKey');
  const words = DEV_MNEMONIC.split(' ');
  const k = identityFromPhrase(words);
  assert.equal(k.walletAddress, DEV_ADDR_57);
  assert.equal(k.walletAddress, walletAddressFromPhrase(words));
  // Frase com maiúsculas e espaços extras dá o mesmo endereço (normalização igual à do celular).
  assert.equal(identityFromPhrase(words.map(w => ` ${w.toUpperCase()} `)).walletAddress, DEV_ADDR_57);
});
