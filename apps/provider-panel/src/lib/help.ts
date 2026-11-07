import { t, type Key } from '../i18n';
import type { PageId } from '../types';

export interface Term { term: string; plain: string }

/** Ids dos termos do glossário; os textos vêm do dicionário (`glossary.<id>.term` / `.plain`). */
export const TERM_IDS = [
  'node', 'neighbor', 'envelope', 'receipt', 'duplicate', 'batch', 'validator', 'settlement', 'lunes', 'providerWallet',
  'operatorKey', 'backup', 'deviceCode', 'techId', 'link', 'accessPoint', 'parentNode', 'publicName', 'clientIsolation',
  'multicast', 'signedPackage', 'bandwidth', 'storage', 'hours',
] as const;

export type TermId = (typeof TERM_IDS)[number];

/** Um termo do painel em palavras simples, no idioma atual. */
export const term = (id: TermId): Term => ({ term: t(`glossary.${id}.term` as Key), plain: t(`glossary.${id}.plain` as Key) });

/** Termos do painel em palavras simples, para quem nunca operou uma rede (idioma atual). */
export const glossary = (): Record<TermId, Term> => Object.fromEntries(TERM_IDS.map(id => [id, term(id)])) as Record<TermId, Term>;

export interface PageHelp { what: string; todo: string[]; terms: TermId[] }

/** Termos que cada página usa (os textos "o que mostra" e "o que fazer" vêm do dicionário). */
export const HELP_TERMS: Record<PageId, TermId[]> = {
  overview: ['node', 'neighbor', 'envelope', 'receipt', 'duplicate'],
  devices: ['node', 'techId', 'accessPoint', 'parentNode', 'publicName'],
  mesh: ['neighbor', 'link', 'multicast'],
  gateway: ['node', 'validator', 'lunes', 'deviceCode'],
  earnings: ['receipt', 'batch', 'validator', 'settlement', 'lunes'],
  wallet: ['providerWallet', 'lunes', 'settlement', 'deviceCode'],
  settings: ['bandwidth', 'storage', 'hours', 'operatorKey', 'backup'],
};

const TODO = [1, 2, 3] as const;

/** O que uma página mostra e o que fazer nela, sem jargão (idioma atual). */
export const help = (page: PageId): PageHelp => ({
  what: t(`help.${page}.what` as Key),
  todo: TODO.map(i => t(`help.${page}.todo.${i}` as Key)),
  terms: HELP_TERMS[page],
});

export const termsOf = (page: PageId): Term[] => [...new Set(HELP_TERMS[page])].map(term);
