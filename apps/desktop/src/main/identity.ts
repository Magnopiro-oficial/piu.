/**
 * Identidade do computador: as MESMAS funções do celular (apps/mobile/src/protocol), para que uma
 * frase restaurada aqui dê as mesmas identidades, chave de nó e semente da carteira de lá.
 * Nada de criptografia própria: só composição.
 */
import { deriveIdentity, deriveNodeKey, deriveWalletSeed, type Identity, type KeyPair } from '../../../mobile/src/protocol/keys';
import { isValidPhrase, newPhrase, PHRASE_WORDS, seedFromPhrase, suggestWords } from '../../../mobile/src/protocol/phrase';

export interface DerivedKeys {
  identities: { public: Identity; anon: Identity };
  /** Chave técnica do nó LNNP (assina o handshake e recibos). Nunca conversa. */
  node: KeyPair;
  walletSeed: Uint8Array;
}

export const normalizePhrase = (text: string | string[]): string[] =>
  (Array.isArray(text) ? text.join(' ') : text).toLowerCase().split(/\s+/).map(w => w.trim()).filter(Boolean);

export function identityFromPhrase(words: string[]): DerivedKeys {
  const w = normalizePhrase(words);
  if (w.length !== PHRASE_WORDS) throw new Error(`A frase tem ${PHRASE_WORDS} palavras (você digitou ${w.length}).`);
  if (!isValidPhrase(w)) throw new Error('Frase inválida: confira as palavras (lista BIP39 em inglês) e a ordem.');
  const seed = seedFromPhrase(w);
  const keys: DerivedKeys = {
    identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') },
    node: deriveNodeKey(seed),
    walletSeed: deriveWalletSeed(seed),
  };
  seed.fill(0);
  return keys;
}

/** Identidade nova neste computador: frase gerada pelo gerador seguro do sistema e chaves derivadas. */
export function createIdentity(): { phrase: string[]; keys: DerivedKeys } {
  const phrase = newPhrase();
  return { phrase, keys: identityFromPhrase(phrase) };
}

export { suggestWords };
