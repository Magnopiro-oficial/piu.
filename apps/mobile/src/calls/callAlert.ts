/**
 * Chamada fora do app (Android): toque e vibração, notificação de chamada recebida em tela cheia, a
 * tela da chamada por cima do bloqueio e o serviço do microfone com o aviso "Em chamada com X".
 * Puro: decide o que o aparelho mostra a partir do estado da máquina (./callMachine) e de onde o app
 * está (aberto? tela bloqueada?). Quem executa é o módulo nativo (modules/piu-voice/alert.ts), pelo
 * provedor do celular (src/state/callAlerts.ts). Design: CHAMADA-DE-VOZ.md §3, §4.4 e §8.
 */
import type { CallState, LiveRoute } from './callMachine';
import { routeVia, type Tr } from './callView';

/** App em primeiro plano (AppState `active`) e tela de bloqueio ativa. */
export type AlertEnv = { foreground: boolean; locked: boolean };

/** Notificação de chamada recebida: `full` = abre a tela cheia (só quando a chamada começa a tocar). */
export type IncomingNote = { callId: string; full: boolean };

export type AlertPlan = {
  /** Toque do sistema e vibração (o nativo respeita silencioso, vibrar e Não perturbe). */
  ring: boolean;
  incoming: IncomingNote | null;
  /** Serviço em primeiro plano do microfone + aviso contínuo (id da chamada). */
  ongoing: string | null;
  /** A tela do app aparece por cima do bloqueio. */
  overLock: boolean;
  /** Acende a tela ao abrir (só tocando). */
  wake: boolean;
};

export const NO_ALERT: AlertPlan = { ring: false, incoming: null, ongoing: null, overLock: false, wake: false };

/** Vibração ao tocar: acompanha o ícone do trilho, 0,55 s a cada 1,5 s (§5.2 e §8). Repete do início. */
export const ALERT_VIBRATION: readonly number[] = [0, 550, 950];

/**
 * O que o aparelho deve mostrar agora. `prev` é o plano anterior: a notificação, depois de posta, fica
 * até a chamada parar de tocar (apagar e acender a tela não a repete nem reabre o app sozinho).
 */
export function planAlert(s: CallState, env: AlertEnv, prev: AlertPlan = NO_ALERT): AlertPlan {
  const id = s.callId ?? null;
  const ringing = s.phase === 'ringing' && !!id;
  let incoming: IncomingNote | null = null;
  if (ringing) {
    if (prev.incoming?.callId === id) incoming = prev.incoming;
    // App aberto e desbloqueado: o aviso in-app já aparece. Tela cheia só no começo do toque.
    else if (!env.foreground || env.locked) incoming = { callId: id, full: !prev.ring };
  }
  // Por cima do bloqueio só a tela da chamada: minimizada (conversas à mostra), volta a pedir o desbloqueio.
  const overLock = ringing || (s.phase === 'calling' && !!id) || (s.phase === 'active' && !s.mini) || (s.phase === 'ending' && prev.overLock);
  return { ring: ringing, incoming, ongoing: s.phase === 'active' && id ? id : null, overLock, wake: ringing };
}

export type AlertCmd =
  | { do: 'ring'; on: boolean }
  | { do: 'incoming'; note: IncomingNote | null }
  | { do: 'ongoing'; callId: string | null }
  | { do: 'lock'; overLock: boolean; wake: boolean };

const sameNote = (a: IncomingNote | null, b: IncomingNote | null) => a?.callId === b?.callId;

/** Comandos para ir de um plano ao outro: primeiro para o que sai (o toque para antes do microfone abrir), a trava antes da notificação. */
export function alertDiff(a: AlertPlan, b: AlertPlan): AlertCmd[] {
  const out: AlertCmd[] = [];
  if (a.ring && !b.ring) out.push({ do: 'ring', on: false });
  if (a.incoming && !sameNote(a.incoming, b.incoming)) out.push({ do: 'incoming', note: null });
  if (a.ongoing && a.ongoing !== b.ongoing) out.push({ do: 'ongoing', callId: null });
  if (a.overLock !== b.overLock || a.wake !== b.wake) out.push({ do: 'lock', overLock: b.overLock, wake: b.wake });
  if (b.ring && !a.ring) out.push({ do: 'ring', on: true });
  if (b.incoming && !sameNote(a.incoming, b.incoming)) out.push({ do: 'incoming', note: b.incoming });
  if (b.ongoing && a.ongoing !== b.ongoing) out.push({ do: 'ongoing', callId: b.ongoing });
  return out;
}

export type AlertAction = 'answer' | 'decline' | 'hangup' | 'show';

/** Toque numa ação da notificação: só vale para a chamada daquele aviso e na fase certa. */
export function alertAction(s: CallState, action: string, callId: string): AlertAction | null {
  if (!callId || s.callId !== callId) return null;
  switch (action) {
    case 'answer': case 'decline': return s.phase === 'ringing' ? action : null;
    case 'hangup': return s.phase === 'active' || s.phase === 'calling' ? 'hangup' : null;
    case 'show': return s.phase === 'ringing' || s.phase === 'active' || s.phase === 'calling' ? 'show' : null;
    default: return null;
  }
}

/**
 * Hora de pedir a permissão de notificação (Android 13+), sem atrapalhar a chamada: quando a primeira
 * chamada (feita ou recebida) termina. Nunca ao ligar (o pedido do microfone vem em seguida e o Android
 * cancela um segundo pedido aberto), durante o toque ou com a tela bloqueada.
 */
export function askNotifNow(prev: CallState, next: CallState, env: AlertEnv): boolean {
  if (!env.foreground || env.locked || next.phase !== 'idle') return false;
  return prev.phase === 'calling' || prev.phase === 'ringing' || prev.phase === 'active' || prev.phase === 'ending';
}

export type AlertTexts = {
  incoming: { title: string; body: string; answer: string; decline: string; publicTitle: string; publicBody: string };
  ongoing: { title: string; body: string; hangup: string; publicTitle: string };
  channels: { incoming: string; incomingDesc: string; ongoing: string; ongoingDesc: string };
};

/**
 * Textos das notificações: só o nome do contato e o caminho, como o aviso in-app (nada de mensagem).
 * `hideName`: pré-visualização "Nunca". A versão pública (tela bloqueada que esconde conteúdo) nunca tem nome.
 */
export function alertTexts(t: Tr, o: { name: string; route?: LiveRoute; hideName?: boolean }): AlertTexts {
  const name = o.hideName ? '' : o.name.trim();
  return {
    incoming: {
      title: name || 'Piu',
      body: t('call.incoming.banner', { via: routeVia(t, o.route) }),
      answer: t('call.answer'),
      decline: t('call.decline'),
      publicTitle: 'Piu',
      publicBody: t('call.voice'),
    },
    ongoing: {
      title: name ? t('callAlert.ongoing', { name }) : t('callAlert.ongoingHidden'),
      body: t('call.e2e'),
      hangup: t('call.ctl.hangup'),
      publicTitle: t('callAlert.ongoingHidden'),
    },
    channels: {
      incoming: t('callAlert.channel.incoming'),
      incomingDesc: t('callAlert.channel.incoming.desc'),
      ongoing: t('callAlert.channel.ongoing'),
      ongoingDesc: t('callAlert.channel.ongoing.desc'),
    },
  };
}
