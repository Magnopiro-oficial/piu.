/**
 * Quando a rede local (LAN) liga no celular. Lógica pura, testada.
 *
 * - Só com o módulo nativo (Android), depois do onboarding e com a chave do nó carregada.
 * - Chave "Wi-Fi Mesh" da aba Rede ligada (de fábrica: ligada).
 * - Só conectado a uma rede Wi-Fi: em dados móveis fica desligado (não há rede local).
 * - Bateria: o LAN segue ligado (é por ele que as mensagens da própria pessoa passam no ponto), mas
 *   entra no modo econômico — anúncio devagar e sem varredura — quando a bateria está abaixo do limite
 *   do Modo nó (mínimo 30%, phoneNodeEffects.ts) fora da tomada, ou no modo de economia do sistema.
 *   Com o Modo nó pausado, o anúncio e o handshake dizem "não retransmito" (relay = false).
 */
import type { WifiInfo } from './types';

export type LanOffReason = 'unavailable' | 'onboarding' | 'keys' | 'userOff' | 'noWifi';

export interface LanPolicyInputs {
  available: boolean;
  onboarded: boolean;
  hasNode: boolean;
  /** Chave da aba Rede. */
  pref: boolean;
  /** `null` = ainda não lido. */
  wifi: WifiInfo | null;
}

export function lanWanted(i: LanPolicyInputs): { on: boolean; reason: LanOffReason | null } {
  if (!i.available) return { on: false, reason: 'unavailable' };
  if (!i.onboarded) return { on: false, reason: 'onboarding' };
  if (!i.hasNode) return { on: false, reason: 'keys' };
  if (!i.pref) return { on: false, reason: 'userOff' };
  if (!i.wifi?.connected) return { on: false, reason: 'noWifi' };
  return { on: true, reason: null };
}

/** Modo econômico do LAN: bateria abaixo do limite fora da tomada (nível 0–1; `limitPct` em %). */
export function lanLowPower(o: { level: number; charging: boolean | null; limitPct: number; saver?: boolean }): boolean {
  if (o.saver) return true;
  if (o.level < 0 || o.charging === null || o.charging) return false;
  return o.level * 100 <= o.limitPct;
}
