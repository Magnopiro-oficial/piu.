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

/** Na ordem de importância: o que não dá para refazer depois (backup) vem antes. */
export function setupSteps(s: SetupSignals): SetupStep[] {
  return [
    { id: 'pair', icon: 'devices', title: 'Entrar no painel', cta: '', done: true, go: { page: 'overview' },
      why: 'Você já fez: este navegador está ligado ao seu nó com o código de 8 dígitos.' },
    { id: 'backup', icon: 'key', title: 'Guardar uma cópia da sua chave', cta: 'Fazer o backup', done: s.keyBackedUp, go: { page: 'settings', anchor: 'cfg-key' },
      why: 'A chave prova que os equipamentos e os ganhos são seus. Se este computador quebrar sem a cópia, você perde o controle deles. Guarde o arquivo fora daqui (pendrive ou nuvem).' },
    { id: 'payout', icon: 'account_balance_wallet', title: 'Dizer onde receber os ganhos', cta: 'Informar a carteira', done: s.payoutAddress, go: { page: 'wallet' },
      why: 'Os ganhos são pagos em LUNES numa carteira sua. Em Carteira, toque em Receber e cole o endereço dela.' },
    { id: 'phone', icon: 'smartphone', title: 'Ligar o seu celular', cta: 'Parear o celular', done: s.phoneConfirmed, go: { page: 'settings', anchor: 'cfg-phones' },
      why: 'Com o app Piu no celular, você aprova transferências com um toque, em vez de pegar um código novo no equipamento.' },
    { id: 'neighbor', icon: 'hub', title: 'Encontrar o primeiro vizinho', cta: 'Ver a malha', done: has(s.neighbors), go: { page: 'mesh' },
      why: 'O nó só passa mensagens adiante quando outro aparelho com o Piu está na mesma rede. Assim que um aparecer, este passo se marca sozinho.' },
    { id: 'device', icon: 'router', title: 'Colocar mais um equipamento', cta: 'Adicionar equipamento', done: s.otherDevices > 0, optional: true, go: { wizard: true },
      why: 'Opcional. Um roteador, um Raspberry Pi ou um rádio leva o sinal mais longe e aumenta o que você recebe.' },
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
