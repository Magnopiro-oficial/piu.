/**
 * Dicionários das notificações da chamada (11 idiomas). Ficam fora de src/i18n/<código>.ts de propósito:
 * só o celular Android usa, e o pt-BR principal é copiado pelo piu-node (apps/piu-node/scripts/sync-lunes.mjs).
 * `callAlertT` segue o idioma do app (reserva: pt-BR); chaves que não são `callAlert.*` vêm do dicionário principal.
 */
import { getLang, interpolate, tIn, type Dict, type Key, type Lang, type Vars } from '../core';
import { callAlert as ar } from './ar';
import { callAlert as de } from './de';
import { callAlert as en } from './en';
import { callAlert as es } from './es';
import { callAlert as fr } from './fr';
import { callAlert as hi } from './hi';
import { callAlert as it } from './it';
import { callAlert as ja } from './ja';
import { callAlertPtBR } from './pt-BR';
import { callAlert as ptPT } from './pt-PT';
import { callAlert as zh } from './zh';

export const CALL_ALERT_DICTS: Record<Lang, Dict> = { 'pt-BR': callAlertPtBR, 'pt-PT': ptPT, en, es, fr, de, it, ja, zh, ar, hi };

export function callAlertT(key: string, vars?: Vars, lang: Lang = getLang()): string {
  if (!key.startsWith('callAlert.')) return tIn(lang, key as Key, vars);
  const v = CALL_ALERT_DICTS[lang]?.[key] ?? (CALL_ALERT_DICTS['pt-BR'] as Dict)[key];
  return typeof v === 'string' ? interpolate(v, vars) : key;
}
