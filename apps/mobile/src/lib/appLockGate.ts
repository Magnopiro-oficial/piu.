/**
 * Regras puras do bloqueio do app (ui/AppLock.tsx) e do "estou vendo a conversa" (state/store.tsx),
 * testadas em __tests__/appLockGate.test.ts. O bloqueio é uma barreira de interface: cobre a tela,
 * mas os dados continuam decifrados na memória do app (não é cifragem).
 */

/** Chave do FLAG_SECURE do bloqueio do app, separada das telas (ex.: 'backup') e da conversa. */
export const APP_LOCK_KEY = 'applock';

/**
 * Proteção da troca de apps com o bloqueio ligado (`os`: Platform.OS).
 * - iPhone: desfoca a prévia do alternador.
 * - Android: FLAG_SECURE no app inteiro. A miniatura dos recentes é tirada antes de a cobertura
 *   aparecer, então só a flag deixa a miniatura em branco (efeito colateral: sem print no app).
 */
export function lockCapture(os: string, enabled: boolean): { iosSwitcher: boolean; androidSecure: boolean } {
  return { iosSwitcher: enabled && os === 'ios', androidSecure: enabled && os === 'android' };
}

/**
 * Resultado de `confirmDevice`. Sem bloqueio no aparelho não há como autenticar: o app abre,
 * mas a pessoa é avisada de que o ajuste está sem efeito (antes abria em silêncio).
 */
export function unlockOutcome(r: 'ok' | 'denied' | 'unavailable'): { open: boolean; warnNoLock: boolean } {
  return { open: r !== 'denied', warnNoLock: r === 'unavailable' };
}

/**
 * A conversa `cid` conta como vista (lida, sem não lida, sem notificação)? Só com ela aberta, o app
 * em primeiro plano e destravado. Em segundo plano ou sob o bloqueio, a mensagem fica não lida.
 */
export function isViewingNow(viewing: string | null, cid: string, o: { active: boolean; locked: boolean }): boolean {
  return viewing === cid && o.active && !o.locked;
}

/**
 * O que fazer quando a conversa passa a ser vista (`seen`: isViewingNow). `opening`: acabou de abrir
 * (zera e confirma, como sempre). Ao voltar para a frente ou destravar, só confirma o que chegou sem
 * ser visto (as últimas `unread` recebidas); sem nada novo, nada sai pela rede.
 */
export function readOnView(
  c: { unread: number; msgs?: { from: string; id: string }[] } | undefined, seen: boolean, opening: boolean,
): { clear: true; ids?: string[] } | null {
  if (!seen || !c) return null;
  if (opening) return { clear: true };
  if (!c.unread) return null;
  const ids = (c.msgs ?? []).filter(m => m.from === 'them').slice(-c.unread).map(m => m.id).filter(id => id.startsWith('in-'));
  return { clear: true, ids };
}

// Estado do bloqueio, para quem está fora da árvore do AppLock (o store fica acima dos ajustes).
let locked = false;
const listeners = new Set<(v: boolean) => void>();
export const isAppLocked = () => locked;
export function setAppLocked(v: boolean) {
  if (v === locked) return;
  locked = v;
  listeners.forEach(f => f(v));
}
export function onAppLockChange(f: (v: boolean) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
