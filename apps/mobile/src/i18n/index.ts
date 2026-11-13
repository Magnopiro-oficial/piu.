/**
 * Idioma do app para a UI: hooks sobre o núcleo puro (./core.ts). Todos os dicionários vêm no
 * pacote e são registrados aqui; a preferência fica salva pelo SettingsProvider (`set.lang`,
 * `set.region`), que chama `applyLangPref` ao montar e a cada troca.
 */
import { useSyncExternalStore } from 'react';
import { registerDict, getLang, getRegion, isLang, isRegion, subscribe, t, setLang, setRegion, resolveLang, type Lang, type LangPref, type Region } from './core';
import { dict as ptPT } from './pt-PT';
import { dict as en } from './en';
import { dict as es } from './es';
import { dict as fr } from './fr';
import { dict as de } from './de';
import { dict as it } from './it';
import { dict as ja } from './ja';
import { dict as zh } from './zh';
import { dict as ar } from './ar';
import { dict as hi } from './hi';

registerDict('pt-PT', ptPT);
registerDict('en', en);
registerDict('es', es);
registerDict('fr', fr);
registerDict('de', de);
registerDict('it', it);
registerDict('ja', ja);
registerDict('zh', zh);
registerDict('ar', ar);
registerDict('hi', hi);

export * from './core';

/** Aplica a preferência salva (idioma + região) ao estado global. */
export function applyLangPref(pref: LangPref, region: Region) {
  setLang(resolveLang(pref));
  setRegion(region);
}

/**
 * Preferência salva sem o SettingsProvider (núcleo sem tela, core/index.ts), com as mesmas regras de
 * leitura de state/settings.tsx: valor estranho vale 'auto'.
 */
export function applySavedLangPref(read: (key: string) => unknown) {
  const lang = read('set.lang');
  const region = read('set.region');
  applyLangPref(lang === 'auto' || isLang(lang) ? lang : 'auto', isRegion(region) ? region : 'auto');
}

/** Idioma em uso; o componente renderiza de novo quando muda. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}
export function useRegion(): Region {
  return useSyncExternalStore(subscribe, getRegion, getRegion);
}

/** `t` para componentes: além de traduzir, assina a troca de idioma e de região. */
export function useT(): typeof t {
  useLang();
  useRegion();
  return t;
}
