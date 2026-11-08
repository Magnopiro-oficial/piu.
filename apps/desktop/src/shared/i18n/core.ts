/**
 * Idioma do Piu Desktop (puro, sem React nem Electron; testado em test/i18n.test.ts).
 * Mesmo desenho do celular (apps/mobile/src/i18n/core.ts), sem depender dele em tempo de execução:
 * - `LANGS` é a mesma lista dos 11 idiomas do celular (o teste confere item a item).
 * - Dicionários planos; `t(chave, vars)` interpola `{var}` e escolhe o plural pela categoria CLDR
 *   (`Intl.PluralRules`, sempre presente no Chromium e no Node) quando o valor é um objeto de formas.
 * - O pt-BR é a referência: toda chave nasce nele e ele é a reserva.
 * - "Região" (formato de número e data): do idioma, 1.234,56 (br) ou 1,234.56 (us).
 * O renderer assina as trocas por `subscribe` (src/renderer/i18n.ts); o processo principal usa `tIn`.
 */
import { ptBR } from './pt-BR';

export type Lang = 'pt-BR' | 'pt-PT' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'zh' | 'ar' | 'hi';
/** Preferência salva: um idioma ou `auto` (o do sistema). */
export type LangPref = Lang | 'auto';
export type Region = 'auto' | 'br' | 'us';

/** Formas de plural (categorias CLDR); `other` é obrigatória. */
export interface Plural { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
export type Dict = Record<string, string | Plural>;
/** Textos da chamada de voz vindos do celular (tipados lá como `Dict` solto): as chaves `call.*` do pt-BR. */
export type CallDict = Record<Extract<Key, `call.${string}`>, string>;
/** Chaves válidas: as do pt-BR. Erro de digitação vira erro de compilação. */
export type Key = keyof typeof ptBR;
/** Dicionário completo de um idioma: as mesmas chaves do pt-BR, nem mais nem menos (o compilador cobra). */
export type FullDict = Record<Key, string | Plural>;
export type Vars = Record<string, string | number>;

/** Os 11 idiomas do celular, na ordem da lista: código, nome nativo, nome em português e locale do `Intl`. */
export const LANGS: readonly { code: Lang; native: string; pt: string; locale: string; rtl?: boolean }[] = [
  { code: 'pt-BR', native: 'Português (Brasil)', pt: 'Portuguese · Brazil', locale: 'pt-BR' },
  { code: 'pt-PT', native: 'Português (Portugal)', pt: 'Portuguese · Portugal', locale: 'pt-PT' },
  { code: 'en', native: 'English', pt: 'Inglês', locale: 'en-US' },
  { code: 'es', native: 'Español', pt: 'Espanhol', locale: 'es' },
  { code: 'fr', native: 'Français', pt: 'Francês', locale: 'fr' },
  { code: 'de', native: 'Deutsch', pt: 'Alemão', locale: 'de' },
  { code: 'it', native: 'Italiano', pt: 'Italiano', locale: 'it' },
  { code: 'ja', native: '日本語', pt: 'Japonês', locale: 'ja' },
  { code: 'zh', native: '中文（简体）', pt: 'Chinês simplificado', locale: 'zh-Hans' },
  // Algarismos latinos: o app mostra valores técnicos (LUNES, códigos, portas) ao lado do texto.
  { code: 'ar', native: 'العربية', pt: 'Árabe', locale: 'ar-u-nu-latn', rtl: true },
  { code: 'hi', native: 'हिन्दी', pt: 'Hindi', locale: 'hi' },
];

export const DEFAULT_LANG: Lang = 'pt-BR';
const CODES = LANGS.map(l => l.code);
export const isLang = (x: unknown): x is Lang => typeof x === 'string' && (CODES as string[]).includes(x);
export const isLangPref = (x: unknown): x is LangPref => x === 'auto' || isLang(x);
export const isRegion = (x: unknown): x is Region => x === 'auto' || x === 'br' || x === 'us';
export const isRtl = (lang: Lang) => !!LANGS.find(l => l.code === lang)?.rtl;

/** `pt-BR` → pt-BR; `pt-PT` → pt-PT; `pt` → pt-BR; `en-GB` → en; `zh-TW` → zh; desconhecido → null. */
export function matchLang(tags: readonly string[]): Lang | null {
  for (const raw of tags) {
    const tag = (raw ?? '').trim().replace(/_/g, '-');
    if (!tag) continue;
    if (isLang(tag)) return tag;
    const lower = tag.toLowerCase();
    if (lower === 'pt-br') return 'pt-BR';
    if (lower === 'pt-pt') return 'pt-PT';
    const base = lower.split('-')[0]!;
    if (base === 'pt') return 'pt-BR';
    if (isLang(base)) return base;
  }
  return null;
}

/** Idioma efetivo: `auto` = o primeiro idioma do sistema que o Piu tem, senão pt-BR. */
export function resolveLang(pref: LangPref | null | undefined, system: readonly string[]): Lang {
  if (pref && pref !== 'auto' && isLang(pref)) return pref;
  return matchLang(system) ?? DEFAULT_LANG;
}

export const localeOf = (lang: Lang): string => LANGS.find(l => l.code === lang)?.locale ?? 'pt-BR';

/** Locale de número/data pela Região: `auto` segue o idioma. */
export function regionLocale(lang: Lang, region: Region): string {
  if (region === 'br') return 'pt-BR';
  if (region === 'us') return 'en-US';
  return localeOf(lang);
}

// ── dicionários e estado ────────────────────────────────
const dicts: Partial<Record<Lang, Dict>> = { 'pt-BR': ptBR };
let current: Lang = DEFAULT_LANG;
let currentRegion: Region = 'auto';
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;
export const getRegion = (): Region => currentRegion;
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const emit = () => { for (const fn of listeners) fn(); };

export function registerDict(lang: Lang, dict: Dict) { dicts[lang] = dict; }
export const dictOf = (lang: Lang): Dict | undefined => dicts[lang];

export function setLang(lang: Lang) {
  if (current === lang) return;
  current = lang;
  emit();
}
export function setRegion(region: Region) {
  if (currentRegion === region) return;
  currentRegion = region;
  emit();
}

const pluralCache = new Map<string, Intl.PluralRules>();
export function selectPlural(lang: Lang, value: number): keyof Plural {
  const loc = localeOf(lang);
  let r = pluralCache.get(loc);
  if (!r) { r = new Intl.PluralRules(loc); pluralCache.set(loc, r); }
  return r.select(Number.isFinite(value) ? value : 0) as keyof Plural;
}

/** Troca `{var}` pelos valores; variável ausente fica como está (visível no teste). */
export const interpolate = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** Texto no idioma atual. Plural: valor em objeto de formas, `vars.count` escolhe a forma. */
export function t(key: Key, vars?: Vars): string {
  return tIn(current, key, vars);
}

/** Como `t`, num idioma dado (reserva: pt-BR; chave desconhecida devolve a própria chave). */
export function tIn(lang: Lang, key: Key, vars?: Vars): string {
  const d = dicts[lang] ?? ptBR;
  let v: string | Plural | undefined = d[key] ?? (ptBR as Dict)[key];
  if (v === undefined) return key;
  if (typeof v !== 'string') {
    const cat = selectPlural(lang, Number(vars?.count ?? 0));
    v = v[cat] ?? v.other;
  }
  return interpolate(v, vars);
}

/** Variáveis `{x}` usadas num valor (todas as formas, no plural). Para o teste de paridade. */
export function varsOf(v: string | Plural): string[] {
  const forms = typeof v === 'string' ? [v] : Object.values(v);
  const out = new Set<string>();
  for (const f of forms) for (const m of f.matchAll(/\{(\w+)\}/g)) out.add(m[1]!);
  return [...out].sort();
}

// ── formatação por região ───────────────────────────────
const nfCache = new Map<string, Intl.NumberFormat>();
export function numberFormat(opts?: Intl.NumberFormatOptions, lang: Lang = current, region: Region = currentRegion): Intl.NumberFormat {
  const loc = regionLocale(lang, region);
  const k = loc + JSON.stringify(opts ?? {});
  let f = nfCache.get(k);
  if (!f) { f = new Intl.NumberFormat(loc, opts); nfCache.set(k, f); }
  return f;
}
const dfCache = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(opts?: Intl.DateTimeFormatOptions, lang: Lang = current, region: Region = currentRegion): Intl.DateTimeFormat {
  const loc = regionLocale(lang, region);
  const k = loc + JSON.stringify(opts ?? {});
  let f = dfCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(loc, opts); dfCache.set(k, f); }
  return f;
}
export const fmtNumber = (n: number, opts?: Intl.NumberFormatOptions, lang?: Lang, region?: Region) => numberFormat(opts, lang, region).format(n);
export const fmtDate = (d: Date | number, opts?: Intl.DateTimeFormatOptions, lang?: Lang, region?: Region) => dateFormat(opts, lang, region).format(d);
/** Exemplo para Idioma → Região. */
export const regionSample = (lang: Lang, region: Region) => fmtNumber(1234.56, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, lang, region);
