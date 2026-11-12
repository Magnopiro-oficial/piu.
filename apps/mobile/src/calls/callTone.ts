/**
 * Som da chamada para quem liga (o motor de áudio do aparelho é que toca, na saída da chamada):
 * `ringback` = "chamando" em loop enquanto espera o outro lado; `fail` = tom curto de ocupado quando a
 * tentativa não deu certo. Puro: decide pelo estado (./callMachine); `null` = silêncio (para na hora).
 */
import { failedAttempt, type CallState } from './callMachine';

export type CallTone = 'ringback' | 'fail';

export function callTone(s: CallState): CallTone | null {
  // `notifying` é quem disse "Posso agora" a um pedido (dir `in`): espera, mas não está ligando.
  if (s.phase === 'calling') return s.dir === 'out' ? 'ringback' : null;
  return failedAttempt(s) ? 'fail' : null;
}
