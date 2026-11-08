/**
 * O que atravessa a ponte com o Piu bloqueado (D1), puro para teste (test/lockGate.test.ts).
 * Bloqueado, o renderer só mostra a tela de bloqueio: recebe o mínimo para desenhá-la (sessão, preferências
 * de aparência, rede, estado do bloqueio e da atualização) e nada com nomes, conversas, carteira, vínculo ou o
 * ponto Piu (o QR do ponto leva a senha do Wi-Fi). Ao desbloquear, cada tela pede de novo o que precisa.
 * A voz de uma chamada em curso continua (`callAudio`/`callFrame` só levam áudio, sem nome nem conteúdo).
 */
import type { PiuEventName } from '../shared/types';

export const ALLOWED_WHEN_LOCKED: ReadonlySet<string> = new Set(['getSession', 'getPrefs', 'networkStatus', 'appLockState', 'unlockApp', 'updateState', 'callFrame']);
const HIDDEN_WHEN_LOCKED: ReadonlySet<string> = new Set(['conversations', 'message', 'typing', 'wallet', 'walletPayment', 'notice', 'link', 'guardian', 'call', 'callToast', 'callDraft'] satisfies PiuEventName[]);

export const methodAllowed = (locked: boolean, method: string) => !locked || ALLOWED_WHEN_LOCKED.has(method);
export const eventAllowed = (locked: boolean, event: PiuEventName) => !locked || !HIDDEN_WHEN_LOCKED.has(event);
