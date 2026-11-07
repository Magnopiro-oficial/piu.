/**
 * i18n leve do painel: dicionários planos por idioma, `t(chave, vars)` com interpolação `{var}` e
 * plural simples (`Intl.PluralRules` + `{count}`), formatação de número/data por `Intl` na região do
 * idioma. O idioma fica salvo neste navegador (localStorage, com try/catch); sem escolha salva, o do
 * navegador se for suportado, senão pt-BR. Nada de React aqui: `./react.ts` tem o hook.
 */
import { ptBR } from './pt-BR';

export type Lang = 'pt-BR' | 'pt-PT' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'zh' | 'ar' | 'hi';

/** Formas de plural (categorias CLDR); `other` é obrigatória. */
export interface Plural { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
export type Dict = Record<string, string | Plural>;
/** Chaves válidas: as do pt-BR (referência). Erro de digitação vira erro de compilação. */
export type Key = keyof typeof ptBR;
export type Vars = Record<string, string | number>;

/** Idiomas do painel, na ordem do design: código, nome nativo e locale usado em `Intl`. */
export const LANGS: readonly { code: Lang; native: string; locale: string }[] = [
  { code: 'pt-BR', native: 'Português (Brasil)', locale: 'pt-BR' },
  { code: 'pt-PT', native: 'Português (Portugal)', locale: 'pt-PT' },
  { code: 'en', native: 'English', locale: 'en' },
  { code: 'es', native: 'Español', locale: 'es' },
  { code: 'fr', native: 'Français', locale: 'fr' },
  { code: 'de', native: 'Deutsch', locale: 'de' },
  { code: 'it', native: 'Italiano', locale: 'it' },
  { code: 'ja', native: '日本語', locale: 'ja' },
  { code: 'zh', native: '中文（简体）', locale: 'zh-Hans' },
  // Algarismos latinos: o painel mostra números técnicos (portas, hashes, LUNES) ao lado de texto.
  { code: 'ar', native: 'العربية', locale: 'ar-u-nu-latn' },
  { code: 'hi', native: 'हिन्दी', locale: 'hi' },
];

export const DEFAULT_LANG: Lang = 'pt-BR';
const STORAGE_KEY = 'piu-lang';

const CODES = LANGS.map(l => l.code);
export const isLang = (x: unknown): x is Lang => typeof x === 'string' && (CODES as string[]).includes(x);

/** Dicionários carregados sob demanda (um arquivo por idioma no build); o pt-BR vem junto e é a reserva. */
const LOADERS: Record<Lang, () => Promise<{ dict: Dict }>> = {
  'pt-BR': () => Promise.resolve({ dict: ptBR }),
  'pt-PT': () => import('./pt-PT').then(m => ({ dict: m.dict })),
  en: () => import('./en').then(m => ({ dict: m.dict })),
  es: () => import('./es').then(m => ({ dict: m.dict })),
  fr: () => import('./fr').then(m => ({ dict: m.dict })),
  de: () => import('./de').then(m => ({ dict: m.dict })),
  it: () => import('./it').then(m => ({ dict: m.dict })),
  ja: () => import('./ja').then(m => ({ dict: m.dict })),
  zh: () => import('./zh').then(m => ({ dict: m.dict })),
  ar: () => import('./ar').then(m => ({ dict: m.dict })),
  hi: () => import('./hi').then(m => ({ dict: m.dict })),
};

const dicts: Partial<Record<Lang, Dict>> = { 'pt-BR': ptBR };
let current: Lang = DEFAULT_LANG;
const listeners = new Set<() => void>();

/** Idioma salvo neste navegador, ou null. */
function savedLang(): Lang | null {
  try { const v = localStorage.getItem(STORAGE_KEY); return isLang(v) ? v : null; } catch { return null; }
}
function saveLang(lang: Lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* sem armazenamento: vale só nesta aba */ }
}

/** `pt-BR` → pt-BR; `pt-PT`/`pt` → pt-PT/pt-BR; `en-GB` → en; `zh-TW` → zh (sem variante própria). */
export function matchLang(tags: readonly string[]): Lang | null {
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    if (isLang(tag)) return tag;
    const lower = tag.toLowerCase();
    if (lower === 'pt-br') return 'pt-BR';
    if (lower === 'pt-pt' || lower === 'pt') return lower === 'pt' ? 'pt-BR' : 'pt-PT';
    const base = lower.split('-')[0]!;
    if (isLang(base)) return base;
  }
  return null;
}

/** Idioma inicial: o salvo; senão o do navegador, se suportado; senão pt-BR. */
export function detectLang(): Lang {
  const saved = savedLang();
  if (saved) return saved;
  const tags = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return matchLang(tags.filter(Boolean)) ?? DEFAULT_LANG;
}

export const getLang = (): Lang => current;
export const localeOf = (lang: Lang = current) => LANGS.find(l => l.code === lang)?.locale ?? 'pt-BR';

// ── formato de números e datas (Configurações → "Formato de números e datas") ──
/** `auto`: o da região do idioma; `br`: 1.234,56 · 31/10; `us`: 1,234.56 · 10/31. Salvo neste navegador. */
export type Region = 'auto' | 'br' | 'us';
export const REGIONS: readonly Region[] = ['auto', 'br', 'us'];
const REGION_KEY = 'piu-region';
const REGION_LOCALE: Record<Exclude<Region, 'auto'>, string> = { br: 'pt-BR', us: 'en-US' };
let region: Region = 'auto';
const isRegion = (x: unknown): x is Region => typeof x === 'string' && (REGIONS as readonly string[]).includes(x);
function savedRegion(): Region {
  try { const v = localStorage.getItem(REGION_KEY); return isRegion(v) ? v : 'auto'; } catch { return 'auto'; }
}
export const getRegion = (): Region => region;
/** Locale dos números (e das datas só com números) no idioma `lang`, respeitando o formato escolhido. */
const numberLocaleOf = (lang: Lang) => (region === 'auto' ? localeOf(lang) : REGION_LOCALE[region]);
/** Troca o formato de números e datas, salva a escolha e avisa quem escuta (sem trocar o idioma). */
export function setRegion(r: Region, { persist = true }: { persist?: boolean } = {}) {
  if (persist) { try { localStorage.setItem(REGION_KEY, r); } catch { /* sem armazenamento: vale só nesta aba */ } }
  if (r === region) return;
  region = r;
  nfCache.clear(); dfCache.clear();
  for (const fn of listeners) fn();
}
/** Muda quando o idioma ou o formato muda (para o React renderizar de novo). */
export const getLocaleKey = (): string => `${current}|${region}`;

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Reflete o idioma no documento (`<html lang>` e título). */
function applyToDocument(lang: Lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.title = t('app.title');
}

/** Garante o dicionário carregado (sem trocar o idioma atual). */
export async function loadLang(lang: Lang): Promise<Dict> {
  const have = dicts[lang];
  if (have) return have;
  const { dict } = await LOADERS[lang]();
  dicts[lang] = dict;
  return dict;
}

/** Troca o idioma do painel: carrega o dicionário, salva a escolha e avisa quem escuta. */
export async function setLang(lang: Lang, { persist = true }: { persist?: boolean } = {}): Promise<void> {
  await loadLang(lang);
  if (persist) saveLang(lang);
  if (current === lang && dicts[lang]) { applyToDocument(lang); return; }
  current = lang;
  pluralCache.delete(lang);
  applyToDocument(lang);
  for (const fn of listeners) fn();
}

/** Inicializa com o idioma detectado (chamado antes da primeira renderização). */
export async function initI18n(): Promise<Lang> {
  const lang = detectLang();
  region = savedRegion();
  try { await setLang(lang, { persist: false }); } catch { current = DEFAULT_LANG; applyToDocument(current); }
  return current;
}

const pluralCache = new Map<Lang, Intl.PluralRules>();
function pluralRules(lang: Lang) {
  let r = pluralCache.get(lang);
  if (!r) { r = new Intl.PluralRules(localeOf(lang)); pluralCache.set(lang, r); }
  return r;
}

/** `{count}` numérico sai formatado na região (24880 → "24.880" em pt-BR); o resto entra como texto. */
const interpolate = (lang: Lang, s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (k === 'count' && typeof vars[k] === 'number' ? numberFormat(undefined, lang).format(vars[k]) : String(vars[k])) : m)) : s;

/** Texto no idioma atual. Plural: o valor é um objeto de formas e `vars.count` escolhe a forma. */
export function t(key: Key, vars?: Vars): string {
  return tIn(current, key, vars);
}

/** Como `t`, num idioma já carregado (reserva: pt-BR). */
export function tIn(lang: Lang, key: Key, vars?: Vars): string {
  const d = dicts[lang] ?? ptBR;
  let v: string | Plural | undefined = d[key] ?? ptBR[key];
  if (v === undefined) return key;
  if (typeof v !== 'string') {
    const n = Number(vars?.count ?? 0);
    // No pt-BR o CLDR põe o 0 no singular ("0 vizinho"); no Brasil se diz "0 vizinhos".
    const cat = (lang === 'pt-BR' && n === 0 ? 'other' : pluralRules(lang).select(n)) as keyof Plural;
    v = v[cat] ?? v.other;
  }
  return interpolate(lang, v, vars);
}

/** Dicionário de um idioma carregado (testes e ferramentas). */
export const dictOf = (lang: Lang): Dict | undefined => dicts[lang];

// ── formatação por região ───────────────────────────────
const nfCache = new Map<string, Intl.NumberFormat>();
export function numberFormat(opts?: Intl.NumberFormatOptions, lang: Lang = current): Intl.NumberFormat {
  const k = lang + JSON.stringify(opts ?? {});
  let f = nfCache.get(k);
  if (!f) { f = new Intl.NumberFormat(numberLocaleOf(lang), opts); nfCache.set(k, f); }
  return f;
}
const dfCache = new Map<string, Intl.DateTimeFormat>();
/**
 * Datas só com números (31/10, 10/31) seguem o formato escolhido; com mês ou dia da semana por
 * extenso, ficam no idioma do painel (o formato não troca palavras de idioma).
 */
export function dateFormat(opts?: Intl.DateTimeFormatOptions, lang: Lang = current): Intl.DateTimeFormat {
  const k = lang + JSON.stringify(opts ?? {});
  let f = dfCache.get(k);
  const words = !!opts && (opts.weekday !== undefined || opts.era !== undefined || opts.dateStyle !== undefined || (typeof opts.month === 'string' && !['numeric', '2-digit'].includes(opts.month)));
  if (!f) { f = new Intl.DateTimeFormat(words ? localeOf(lang) : numberLocaleOf(lang), opts); dfCache.set(k, f); }
  return f;
}
/** Separador decimal da região atual ("," em pt-BR, "." em en). */
export function decimalSeparator(lang: Lang = current): string {
  return numberFormat({ minimumFractionDigits: 1 }, lang).formatToParts(1.1).find(p => p.type === 'decimal')?.value ?? '.';
}
