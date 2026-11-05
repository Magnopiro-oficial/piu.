// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/protocol/phrase.ts. Não edite aqui.
/**
 * Frase de recuperação: 12 palavras da lista BIP39 em inglês, a lista padrão (128 bits de entropia + checksum).
 * A semente do Piu é derivada da entropia com um rótulo próprio. A lista e o checksum são
 * padrão, mas a semente NÃO é compatível com carteiras BIP39: aqui ela gera identidades,
 * chave do nó e carteira separadas (keys.ts).
 */
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { utf8 } from './bytes.js';
import { kdf } from './suite.js';

export const PHRASE_WORDS = 12;
export const WORDLIST: readonly string[] = wordlist;

const normalize = (words: string[]) => words.map(w => w.trim().toLowerCase()).filter(Boolean).join(' ');

export const newPhrase = (): string[] => generateMnemonic(wordlist, 128).split(' ');

/**
 * Confere se as palavras são da lista e o checksum. Com 12 palavras o checksum tem 4 bits:
 * uma palavra trocada é detectada em ~15 de 16 casos. A confirmação de 3 palavras no backup
 * existe para reduzir esse risco na hora de anotar.
 */
export const isValidPhrase = (words: string[]) => words.length === PHRASE_WORDS && validateMnemonic(normalize(words), wordlist);

export function seedFromPhrase(words: string[]): Uint8Array {
  if (!isValidPhrase(words)) throw new Error('Frase inválida.');
  return kdf(mnemonicToEntropy(normalize(words), wordlist), utf8('piu/v0/root'), 'phrase/seed');
}

/** Sugestões para digitar a frase (autocompletar). */
export const suggestWords = (prefix: string, max = 4) => {
  const p = prefix.trim().toLowerCase();
  return p.length < 2 ? [] : wordlist.filter(w => w.startsWith(p)).slice(0, max);
};
