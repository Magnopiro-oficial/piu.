/**
 * Identidade do computador: as MESMAS funções do celular (apps/mobile/src/protocol), para que uma
 * frase restaurada aqui dê as mesmas identidades, chave de nó e semente da carteira de lá.
 * Nada de criptografia própria: só composição.
 */
import { walletAddressFromPhrase } from '../../../mobile/src/lib/walletKey';
import { deriveIdentity, deriveNodeKey, deriveWalletSeed, type Identity, type KeyPair } from '../../../mobile/src/protocol/keys';
import { isValidPhrase, newPhrase, PHRASE_WORDS, seedFromPhrase, suggestWords } from '../../../mobile/src/protocol/phrase';
import { tm } from './i18n';

export interface DerivedKeys {
  identities: { public: Identity; anon: Identity };
  /** Chave técnica do nó LNNP (assina o handshake e recibos). Nunca conversa. */
  node: KeyPair;
  walletSeed: Uint8Array;
  /**
   * Endereço SS58 (prefixo 57) da carteira LUNES: a MESMA derivação do celular (apps/mobile/src/lib/walletKey.ts,
   * substrate-bip39 + sr25519). Só a parte pública fica guardada; o segredo é zerado na hora pelo próprio
   * `walletAddressFromPhrase`. O Desktop nunca assina: quem assina é o celular.
   */
  walletAddress: string;
}

export const normalizePhrase = (text: string | string[]): string[] =>
  (Array.isArray(text) ? text.join(' ') : text).toLowerCase().split(/\s+/).map(w => w.trim()).filter(Boolean);

export function identityFromPhrase(words: string[]): DerivedKeys {
  const w = normalizePhrase(words);
  if (w.length !== PHRASE_WORDS) throw new Error(tm('main.identity.wordCount', { words: PHRASE_WORDS, typed: w.length }));
  if (!isValidPhrase(w)) throw new Error(tm('main.identity.badPhrase'));
  const seed = seedFromPhrase(w);
  const keys: DerivedKeys = {
    identities: { public: deriveIdentity(seed, 'public'), anon: deriveIdentity(seed, 'anon') },
    node: deriveNodeKey(seed),
    walletSeed: deriveWalletSeed(seed),
    walletAddress: walletAddressFromPhrase(w),
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
