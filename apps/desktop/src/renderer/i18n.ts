/**
 * Idioma no renderer: hooks sobre o núcleo (../shared/i18n). A preferência fica em `prefs.lang` e
 * `prefs.region` (processo principal); App.tsx chama `applyLangPref` a cada troca.
 * `auto` segue `navigator.languages` (o idioma do sistema que o Chromium recebe).
 */
import { useSyncExternalStore } from 'react';
import { getLang, getRegion, isRtl, resolveLang, setLang, setRegion, subscribe, t, type Lang, type LangPref, type Region } from '../shared/i18n';

export * from '../shared/i18n';

export const systemLangs = (): readonly string[] => (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []);

/** Aplica a preferência salva e ajusta `lang`/`dir` da página (árabe da direita para a esquerda). */
export function applyLangPref(pref: LangPref | undefined, region: Region | undefined) {
  const lang = resolveLang(pref ?? 'auto', systemLangs());
  setLang(lang);
  setRegion(region ?? 'auto');
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** `t` para componentes: traduz e assina a troca de idioma e de região. */
export function useT(): typeof t {
  useLang();
  useSyncExternalStore(subscribe, getRegion, getRegion);
  return t;
}
