/**
 * N4e "Confirme a sua frase de novo" — adaptação honesta do Piu 11.
 *
 * O design pede para tocar nas palavras 3, 8 e 11. Isso só funciona se o celular TIVER a frase para
 * comparar. Aqui ele não tem: a cópia da frase protegida pela biometria ficou ilegível (o sistema a
 * invalida quando a biometria muda — docs/seguranca/biometria-cofre.md) e o aparelho guarda só a semente,
 * que é de mão única (não devolve a frase). Três palavras não reconstroem a frase; então a pessoa digita
 * as 12, na ordem, e o app confere derivando a semente e comparando com a guardada (`recoverPhrase`).
 *
 * O que a tela pode dizer de um erro, sem revelar nada além do que a pessoa digitou:
 * - palavra fora da lista BIP39 (`notInList`, com a posição: é a palavra que ela mesma escreveu);
 * - checksum inválido (`checksum`): a lista não diz QUAL palavra está errada, e a tela também não;
 * - frase válida de outra identidade (a tela mostra depois de `recoverPhrase` devolver falso).
 * A regra do design "depois de 3 erros, sorteia outras posições" não se aplica (não há sorteio).
 * As palavras digitadas ficam na tela para corrigir um erro de digitação e somem ao sair dela.
 */
import { isValidPhrase, PHRASE_WORDS, suggestWords, WORDLIST } from '../protocol';

export type SlotState = 'filled' | 'current' | 'empty';
export const phraseSlots = (words: readonly string[], cursor: number): SlotState[] =>
  Array.from({ length: PHRASE_WORDS }, (_, i) => (i === cursor ? 'current' : words[i] ? 'filled' : 'empty'));

const clean = (w: string) => w.trim().toLowerCase().replace(/\s+/g, '');

/** Põe a palavra (ou a frase colada inteira) a partir de `i` e escolhe a próxima posição vazia. */
export function placeWord(words: readonly string[], i: number, text: string): { words: string[]; cursor: number } {
  const next = Array.from({ length: PHRASE_WORDS }, (_, k) => words[k] ?? '');
  const parts = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length > 1) parts.slice(0, PHRASE_WORDS - i).forEach((p, k) => { next[i + k] = p; });
  else next[i] = clean(text);
  const empty = next.findIndex(w => !w);
  return { words: next, cursor: empty === -1 ? PHRASE_WORDS - 1 : empty };
}

export type PhraseIssue = { kind: 'incomplete' } | { kind: 'notInList'; index: number } | { kind: 'checksum' } | { kind: 'ok' };
export function phraseIssue(words: readonly string[]): PhraseIssue {
  const bad = words.findIndex(w => !!w && !WORDLIST.includes(w));
  if (bad !== -1) return { kind: 'notInList', index: bad };
  if (words.length < PHRASE_WORDS || words.some(w => !w)) return { kind: 'incomplete' };
  return isValidPhrase([...words]) ? { kind: 'ok' } : { kind: 'checksum' };
}

/** Sugestões da lista para a grade (N4e: 3 colunas, até 9 palavras). */
export const phraseSuggestions = (prefix: string) => suggestWords(prefix, 9);
