/**
 * Regras puras em volta da frase de recuperação (auditoria 2026-11-06, A-01 e M-01).
 * Sem React nem módulos nativos: a guarda de navegação, o KeysProvider e as telas usam daqui.
 */
import type { AuthResult } from './deviceAuth';

/** Telas acessíveis antes do onboarding. Todo o resto exige identidade criada (inclusive por link piu://). */
export const PRE_ONBOARDING = new Set(['welcome', 'identity', 'keys', 'restore', 'migrate']);

/**
 * Telas que trocam a frase do aparelho: só antes do onboarding. Com identidade existente, um
 * `piu://restore` ou `piu://migrate` vindo de um golpe ("suporte", "airdrop") volta para as abas.
 * `welcome`/`identity`/`keys` seguem abertas ("Ver boas-vindas"; `keys` nunca troca as chaves).
 */
export const RESTORE_SCREENS = new Set(['restore', 'migrate']);

/** Para onde a guarda de navegação manda quem abriu `first` (primeiro segmento da rota); null = fica. */
export function onboardingRedirect(onboarded: boolean, first: string | undefined): '/welcome' | '/(tabs)' | null {
  if (!first) return null;
  if (onboarded) return RESTORE_SCREENS.has(first) ? '/(tabs)' : null;
  return PRE_ONBOARDING.has(first) ? null : '/welcome';
}

/** Já existe outra frase no aparelho: restaurar só com confirmação explícita da tela. */
export class PhraseExistsError extends Error {
  readonly code = 'EXISTS';
  constructor() { super('Já existe uma identidade neste aparelho. Confirme a troca ou apague os dados locais antes de restaurar outra.'); }
}

/** A frase nova substituiria uma frase diferente que já está no cofre? */
export const replacesPhrase = (cur: readonly string[] | null, next: readonly string[]) => !!cur && cur.join(' ') !== next.join(' ');

/** Recusa trocar a frase existente, a não ser com `replace` (posto só pelo diálogo de confirmação). */
export function checkRestore(cur: readonly string[] | null, next: readonly string[], o?: { replace?: boolean }) {
  if (replacesPhrase(cur, next) && o?.replace !== true) throw new PhraseExistsError();
}

/**
 * Revelar ou transferir a frase: mesma regra da carteira (quem tem a frase tem tudo).
 * Sem bloqueio no aparelho (`unavailable`) recusa e pede para ativar um; na web, que é só
 * demonstração e não tem bloqueio, segue com o aviso de sempre.
 */
export function lockGate(r: AuthResult, web: boolean): 'ok' | 'denied' | 'needLock' {
  if (r === 'ok') return 'ok';
  if (r === 'denied') return 'denied';
  return web ? 'ok' : 'needLock';
}
