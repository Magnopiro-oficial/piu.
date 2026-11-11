/**
 * O que atravessa a ponte com o Piu bloqueado (D1), puro para teste (test/lockGate.test.ts).
 * Bloqueado, o renderer só mostra a tela de bloqueio: recebe o mínimo para desenhá-la (sessão, preferências
 * de aparência, rede, estado do bloqueio e da atualização) e nada com nomes, conversas, carteira, vínculo ou o
 * ponto Piu (o QR do ponto leva a senha do Wi-Fi). Ao desbloquear, cada tela pede de novo o que precisa.
 * A voz de uma chamada em curso continua (`callAudio`/`callFrame` só levam áudio, sem nome nem conteúdo).
 */
import type { NetworkStatus, Prefs, SessionInfo } from '../shared/types';
import type { PiuEventName } from '../shared/types';

export const ALLOWED_WHEN_LOCKED: ReadonlySet<string> = new Set(['getSession', 'getPrefs', 'networkStatus', 'appLockState', 'unlockApp', 'updateState', 'callFrame']);
const HIDDEN_WHEN_LOCKED: ReadonlySet<string> = new Set(['conversations', 'message', 'typing', 'wallet', 'walletPayment', 'notice', 'link', 'guardian', 'call', 'callToast', 'callDraft'] satisfies PiuEventName[]);

export const methodAllowed = (locked: boolean, method: string) => !locked || ALLOWED_WHEN_LOCKED.has(method);
export const eventAllowed = (locked: boolean, event: PiuEventName) => !locked || !HIDDEN_WHEN_LOCKED.has(event);

/**
 * Bloqueado, o que passa vai reduzido (baixo 30): sessão sem nome nem ids, preferências sem nome, carteira e
 * vizinhos fixos, rede sem a lista de vizinhos. O formato fica o mesmo (a tela de bloqueio depende dele).
 * `name`: o método (getSession/getPrefs/networkStatus) ou o evento (session/prefs/network). Não altera o original.
 */
export function lockedView(name: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (name === 'getSession' || name === 'session') {
    const s = value as SessionInfo;
    return { ...s, me: s.me ? { publicId: '', anonId: '', name: '', nodePk: '' } : null };
  }
  if (name === 'getPrefs' || name === 'prefs') return { ...(value as Prefs), displayName: '', walletAddress: null, peers: [] };
  if (name === 'networkStatus' || name === 'network') {
    const n = value as NetworkStatus;
    return { ...n, lan: { ...n.lan, peers: [] } };
  }
  return value;
}
