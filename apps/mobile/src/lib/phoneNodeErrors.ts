/**
 * Erros das ações do modo nó (state/phoneNode.tsx), com `code` estável para a tela escolher o texto
 * (lib/phoneNodeView.ts: `errorAction`, `bondFailOf`, `confirmOutcomeOf`). Sem React: testável no Node.
 * - `notFinal`: "Confirmar caução" (N4) antes de a transferência finalizar na rede (N4b).
 */
export type PhoneNodeErrorCode = 'noKeys' | 'soon' | 'requirements' | 'cancelled' | 'recover' | 'wrongWallet' | 'bond' | 'insufficient' | 'endorse' | 'notEligible' | 'notFinal';
export class PhoneNodeError extends Error {
  constructor(readonly code: PhoneNodeErrorCode, readonly detail?: string) { super(detail ? `${code}: ${detail}` : code); }
}
