// GERADO por scripts/sync-lunes.mjs a partir de apps/mobile/src/i18n/core.ts. Não edite aqui.
/**
 * Núcleo do idioma do app (puro, sem React nem React Native; testado em src/lib/__tests__/i18n.test.ts).
 * - Dicionários planos por idioma; `t(chave, vars)` interpola `{var}` e escolhe o plural pela
 *   categoria CLDR (`Intl.PluralRules`) quando o valor é um objeto de formas e `vars.count` existe.
 * - O pt-BR é a referência: toda chave existe nele e é a reserva quando um idioma não a tiver.
 * - "Região" (formato de número e data): do idioma, 1.234,56 (pt-BR) ou 1,234.56 (en-US).
 * - Estado global simples com assinatura (`subscribe`): a UI usa `useT()` em src/i18n/index.ts.
 */
import { ptBR } from './pt-BR.js';

export type Lang = 'pt-BR' | 'pt-PT' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'zh' | 'ar' | 'hi';
/** Preferência salva: um idioma ou `auto` (o do sistema). */
export type LangPref = Lang | 'auto';
export type Region = 'auto' | 'br' | 'us';

/** Formas de plural (categorias CLDR); `other` é obrigatória. */
export interface Plural { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
export type Dict = Record<string, string | Plural>;
/** Chaves válidas: as do pt-BR. Erro de digitação vira erro de compilação. */
export type Key = keyof typeof ptBR;
export type Vars = Record<string, string | number>;

/** Idiomas do design (Perfil → Idioma), na ordem da lista: código, nome nativo, nome em português e locale do `Intl`. */
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
export const isRegion = (x: unknown): x is Region => x === 'auto' || x === 'br' || x === 'us';

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

/** Idioma do sistema (`Intl`), se suportado. */
export function systemLang(): Lang | null {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    return matchLang([loc]);
  } catch { return null; }
}

/** Idioma efetivo a partir da preferência salva: `auto` = sistema se suportado, senão pt-BR. */
export function resolveLang(pref: LangPref | null | undefined, system: Lang | null = systemLang()): Lang {
  if (pref && pref !== 'auto' && isLang(pref)) return pref;
  return system ?? DEFAULT_LANG;
}

export const localeOf = (lang: Lang): string => LANGS.find(l => l.code === lang)?.locale ?? 'pt-BR';

/** Locale de número/data pela Região: `auto` segue o idioma. */
export function regionLocale(lang: Lang, region: Region): string {
  if (region === 'br') return 'pt-BR';
  if (region === 'us') return 'en-US';
  return localeOf(lang);
}

// ── estado global ───────────────────────────────────────
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

/** Registra o dicionário de um idioma (todos vêm no pacote: src/i18n/index.ts registra na carga). */
export function registerDict(lang: Lang, dict: Dict) { dicts[lang] = dict; }
export const dictOf = (lang: Lang): Dict | undefined => dicts[lang];

/** Troca o idioma em uso (quem persiste é SettingsProvider). */
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

/**
 * Cardinal CLDR para os 11 idiomas do app quando o Hermes não oferece Intl.PluralRules.
 * Regras: Unicode CLDR 49, supplemental/plurals.json (pt, pt-PT, en, es, fr, de, it, ja, zh, ar, hi).
 * https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/plurals.json
 * O app passa números, sem notação compacta: o operando CLDR e é sempre zero.
 */
function fallbackPlural(lang: Lang, value: number): keyof Plural {
  // Como PluralRules sem opções, NumberFormat arredonda para no máximo 3 casas antes de
  // selecionar a categoria. Não usar toFixed: seu arredondamento binário difere do Intl.
  const n = Number(numberFormat({ useGrouping: false, maximumFractionDigits: 3 }, 'en', 'auto').format(Math.abs(value)));
  const i = Math.floor(n);
  const integer = Number.isInteger(n);
  if (lang === 'ja' || lang === 'zh') return 'other';
  if (lang === 'ar') {
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    if (n === 2) return 'two';
    const mod = n % 100;
    if (integer && mod >= 3 && mod <= 10) return 'few';
    if (integer && mod >= 11 && mod <= 99) return 'many';
    return 'other';
  }
  if (lang === 'hi') return i === 0 || n === 1 ? 'one' : 'other';
  if (lang === 'pt-BR' || lang === 'fr') {
    if (i === 0 || i === 1) return 'one';
  } else if (n === 1) {
    // en/de/it/pt-PT exigem i=1 e v=0; para Number sem zeros finais, equivale a n=1.
    // es usa n=1 diretamente.
    return 'one';
  }
  if (lang !== 'en' && lang !== 'de' && integer && n !== 0 && n % 1000000 === 0) return 'many';
  return 'other';
}

/** Seleção cardinal com reserva para runtimes sem Intl.PluralRules (Hermes no Android). */
export function selectPlural(lang: Lang, value: number): keyof Plural {
  const n = Number.isFinite(value) ? value : 0;
  if (typeof Intl.PluralRules === 'function') {
    const loc = localeOf(lang);
    let r = pluralCache.get(loc);
    if (!r) {
      // Um runtime pode ter o construtor mas não os dados deste idioma.
      if (Intl.PluralRules.supportedLocalesOf([loc]).length === 0) return fallbackPlural(lang, n);
      r = new Intl.PluralRules(loc);
      pluralCache.set(loc, r);
    }
    return r.select(n) as keyof Plural;
  }
  return fallbackPlural(lang, n);
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
    const n = Number(vars?.count ?? 0);
    const cat = selectPlural(lang, n);
    v = v[cat] ?? v.other;
  }
  return interpolate(v, vars);
}

/** Variáveis `{x}` usadas num valor (todas as formas, no plural). Para o teste de paridade entre idiomas. */
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
/** Separador decimal da região em uso ("," no Brasil, "." nos EUA). */
export function decimalSeparator(lang: Lang = current, region: Region = currentRegion): string {
  return numberFormat({ minimumFractionDigits: 1 }, lang, region).formatToParts(1.1).find(p => p.type === 'decimal')?.value ?? '.';
}
/** Exemplo de número para a tela Idioma → Região. */
export const regionSample = (lang: Lang, region: Region) => fmtNumber(1234.56, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, lang, region);
