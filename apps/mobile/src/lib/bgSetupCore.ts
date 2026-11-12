/**
 * Ajustes do aparelho para "Receber com o app fechado" (Android). O sistema não deixa o app ligar
 * sozinho a isenção de otimização de bateria nem a Inicialização automática da Xiaomi: o app pede uma
 * vez, logo depois do onboarding (ui/BackgroundSetup.tsx), e depois só a aba Rede mostra o que falta.
 * Puro: sem React nem módulos nativos.
 */

/** Leitura do módulo nativo (PiuTransport.powerInfo). */
export interface PowerInfo { ignoringBattery: boolean; manufacturer: string; brand: string }
export type Oem = 'xiaomi' | 'samsung' | 'other';
export type BgStep = 'battery' | 'autostart';

/** Já pediu uma vez (o pedido do primeiro uso não volta a cada abertura). */
export const BG_SETUP_ASKED_KEY = 'bgSetup.asked';
/**
 * Resposta "Já liguei" da Inicialização automática: o Android não tem API oficial para ler esse
 * ajuste da Xiaomi, então vale o que a pessoa disse.
 */
export const BG_SETUP_AUTOSTART_KEY = 'bgSetup.autostart';

const XIAOMI = new Set(['xiaomi', 'redmi', 'poco']);

/** Fabricante pelo Build.MANUFACTURER/BRAND: Xiaomi, Redmi e POCO usam MIUI/HyperOS. */
export function oemOf(manufacturer: string, brand: string): Oem {
  const m = manufacturer.trim().toLowerCase(), b = brand.trim().toLowerCase();
  if (XIAOMI.has(m) || XIAOMI.has(b)) return 'xiaomi';
  if (m === 'samsung' || b === 'samsung') return 'samsung';
  return 'other';
}

/** O que falta configurar. `null` = sem o módulo nativo (não se sabe: nada a pedir). */
export function missingSteps(p: PowerInfo | null, autostartDone: boolean): BgStep[] {
  if (!p) return [];
  const out: BgStep[] = [];
  if (!p.ignoringBattery) out.push('battery');
  if (oemOf(p.manufacturer, p.brand) === 'xiaomi' && !autostartDone) out.push('autostart');
  return out;
}

/** Orientação curta do fabricante, a mesma da aba Rede. */
export function setupNote(oem: Oem): 'network.receiveClosed.guide.xiaomi' | 'network.receiveClosed.guide.samsung' | null {
  return oem === 'xiaomi' ? 'network.receiveClosed.guide.xiaomi' : oem === 'samsung' ? 'network.receiveClosed.guide.samsung' : null;
}

/** Pede agora? Uma vez, depois do onboarding e com o cofre, só com "Receber com o app fechado" ligado. */
export function shouldAskBgSetup(i: {
  android: boolean; onboarded: boolean; hasKeys: boolean; receiveClosed: boolean; asked: boolean; locked: boolean;
  missing: readonly BgStep[];
}): boolean {
  return i.android && i.onboarded && i.hasKeys && i.receiveClosed && !i.asked && !i.locked && i.missing.length > 0;
}
