/**
 * Idioma no processo principal (menu, bandeja, notificações, diálogos nativos e mensagens de erro que
 * chegam à interface). Segue `prefs.lang`; `auto` usa os idiomas preferidos do sistema.
 * Sem Electron aqui (testável): quem chama passa a lista de idiomas do sistema.
 */
import { getLang, resolveLang, setLang, setRegion, t, type LangPref, type Region } from '../shared/i18n';

export { t as tm, getLang as mainLang };

/** Aplica a preferência; devolve true quando o idioma efetivo mudou (para refazer o menu). */
export function applyMainLang(pref: LangPref | undefined, region: Region | undefined, system: readonly string[]): boolean {
  const before = getLang();
  setLang(resolveLang(pref ?? 'auto', system));
  setRegion(region ?? 'auto');
  return getLang() !== before;
}
