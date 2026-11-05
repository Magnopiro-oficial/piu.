import { t } from '../i18n';
import type { PageId } from '../types';

/**
 * Primeiros passos do operador, tirados do estado real do nó. `null` = o painel ainda não leu
 * aquele dado do nó (o passo fica pendente, sem contar como feito nem como falta).
 */
export interface SetupSignals {
  keyBackedUp: boolean | null;
  payoutAddress: boolean | null;
  phoneConfirmed: boolean | null;
  neighbors: number | null;
  /** Equipamentos registrados além do nó que serve o painel. */
  otherDevices: number;
}

export type StepId = 'pair' | 'backup' | 'payout' | 'phone' | 'neighbor' | 'device';
export type StepGo = { page: PageId; anchor?: string } | { wizard: true };

export interface SetupStep {
  id: StepId; icon: string; title: string; why: string; cta: string;
  done: boolean | null; optional?: boolean; go: StepGo;
}

const has = (n: number | null) => (n === null ? null : n > 0);

/** Na ordem de importância: o que não dá para refazer depois (backup) vem antes. Textos no idioma atual. */
export function setupSteps(s: SetupSignals): SetupStep[] {
  return [
    { id: 'pair', icon: 'devices', title: t('step.pair.title'), cta: '', done: true, go: { page: 'overview' }, why: t('step.pair.why') },
    { id: 'backup', icon: 'key', title: t('step.backup.title'), cta: t('step.backup.cta'), done: s.keyBackedUp, go: { page: 'settings', anchor: 'cfg-key' }, why: t('step.backup.why') },
    { id: 'payout', icon: 'account_balance_wallet', title: t('step.payout.title'), cta: t('step.payout.cta'), done: s.payoutAddress, go: { page: 'wallet' }, why: t('step.payout.why') },
    { id: 'phone', icon: 'smartphone', title: t('step.phone.title'), cta: t('step.phone.cta'), done: s.phoneConfirmed, go: { page: 'settings', anchor: 'cfg-phones' }, why: t('step.phone.why') },
    { id: 'neighbor', icon: 'hub', title: t('step.neighbor.title'), cta: t('step.neighbor.cta'), done: has(s.neighbors), go: { page: 'mesh' }, why: t('step.neighbor.why') },
    { id: 'device', icon: 'router', title: t('step.device.title'), cta: t('step.device.cta'), done: s.otherDevices > 0, optional: true, go: { wizard: true }, why: t('step.device.why') },
  ];
}

/** Só os passos obrigatórios contam: o guia termina sem o equipamento extra. */
export function setupProgress(steps: SetupStep[]) {
  const req = steps.filter(s => !s.optional);
  const done = req.filter(s => s.done === true).length;
  return { done, total: req.length, complete: done === req.length };
}

/** O primeiro obrigatório que sabidamente falta (destacado no guia). */
export function nextStep(steps: SetupStep[]): SetupStep | null {
  return steps.find(s => !s.optional && s.done === false) ?? null;
}

const HIDE_KEY = 'piu.guide.hidden';

/** Guia escondido neste navegador (conveniência local; sem armazenamento, ele só volta a aparecer). */
export function guideHidden(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
export function setGuideHidden(hidden: boolean) {
  try { if (hidden) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch { /* sem armazenamento */ }
}
