/**
 * Preferências vindas da interface (B-01): só chaves conhecidas, com o tipo e os valores esperados.
 * `walletAddress` e `peers` ficam de fora: têm métodos próprios com validação (`setWalletAddress`,
 * `addPeer`/`removePeer`). Qualquer coisa fora disso é recusada (a interface legítima nunca manda).
 */
import { isLangPref, isRegion } from '../shared/i18n/core';
import type { Prefs } from '../shared/types';
import { tm } from './i18n';

const isBool = (v: unknown) => typeof v === 'boolean';
const oneOf = (...xs: string[]) => (v: unknown) => typeof v === 'string' && xs.includes(v);

const UI_PREFS: { [K in keyof Prefs]?: (v: unknown) => boolean } = {
  theme: oneOf('light', 'dark', 'system'),
  notifications: isBool, animations: isBool, relay: isBool, hideBalance: isBool, screenSecurity: isBool,
  shareWalletAddress: isBool, lan: isBool, notifSound: isBool, enterSends: isBool,
  // O núcleo corta em 40 depois do trim; aqui só barra lixo grande.
  displayName: v => typeof v === 'string' && v.length <= 200,
  notifPreview: oneOf('always', 'name', 'never'),
  identity: oneOf('public', 'anon'),
  fontSize: oneOf('s', 'm', 'l'),
  density: oneOf('comfort', 'compact'),
  notifGroups: isBool, notifChannels: isBool, notifWallet: isBool, notifAlerts: isBool, badge: isBool, dnd: isBool,
  readReceipts: isBool, typing: isBool, randomDelay: isBool, pad: isBool,
  lockOnSuspend: isBool, openAtLogin: isBool, tray: isBool,
  find: oneOf('all', 'contacts', 'none'),
  lockAfter: oneOf('5', '15', '60', 'never'),
  relayBandwidth: oneOf('1', '5', '20'),
  relayRetention: oneOf('24', '48', '168'),
  tempDefault: oneOf('off', '24h', '7d'),
  updateNotify: isBool,
  relayStorage: oneOf('100', '250', '500'),
  lang: isLangPref,
  region: isRegion,
  spellcheck: isBool,
};

export function sanitizePrefsPatch(patch: unknown): Partial<Prefs> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(tm('main.err.badPrefs'));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const ok = Object.hasOwn(UI_PREFS, k) ? UI_PREFS[k as keyof Prefs] : undefined;
    if (!ok || !ok(v)) throw new Error(tm('main.err.badPref', { key: k }));
    out[k] = v;
  }
  return out as Partial<Prefs>;
}

/**
 * Preferências gravadas por versões antigas: "Atualizar: Automático / Perguntar" (`updateMode`) virou
 * "Avisar quando sair versão nova" (`updateNotify`). Automático → avisar; Perguntar → não avisar.
 * Nada passa a baixar sozinho.
 */
export function migratePrefs<T extends Record<string, unknown>>(saved: T): Omit<T, 'updateMode'> & { updateNotify?: boolean } {
  const { updateMode, ...rest } = saved as T & { updateMode?: unknown };
  if (updateMode === undefined || typeof rest.updateNotify === 'boolean') return rest;
  return { ...rest, updateNotify: updateMode === 'auto' };
}
