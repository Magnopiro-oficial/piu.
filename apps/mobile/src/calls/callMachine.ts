/**
 * Máquina de estados da chamada de voz (docs: design CHAMADA-DE-VOZ.md §3). Pura: recebe um evento e
 * devolve o novo estado e os efeitos (sinal para o outro lado, registro na conversa, timer). Quem roda
 * (celular e Desktop) só executa os efeitos e desenha o estado; assim as regras valem igual nos dois.
 *
 *   idle ─open─► pre ─dial─► calling ─peerRinging─► calling(tocando) ─connected─► active ─hangup─► ending ─endDone─► idle
 *   idle ─incoming─► ringing ─answer─► active · ─decline─► idle (registro "Recusada")
 *   idle ─requestIn─► reqIn ─requestNow─► calling(avisando) · ─requestLater─► idle
 *
 * Voz só passa ao vivo (Wi-Fi local, Bluetooth ou Ponto Piu). Sem caminho ao vivo, `open` leva à folha
 * em modo malha, que manda um pedido de chamada em vez de ligar.
 */

/** Caminhos ao vivo, em ordem de preferência. */
export type LiveRoute = 'direct' | 'bt' | 'point';
export const ROUTE_ORDER: readonly LiveRoute[] = ['direct', 'bt', 'point'];
export type Phase = 'idle' | 'pre' | 'calling' | 'ringing' | 'active' | 'ending' | 'reqIn';
export type Dir = 'out' | 'in';
export type CallingStage = 'searching' | 'ringing' | 'accepted' | 'notifying';
export type EndReason = 'hangup' | 'remote' | 'cancel' | 'declined' | 'busy' | 'noanswer' | 'sas' | 'lost' | 'elsewhere' | 'handoff' | 'message' | 'later';

/** Tempos da especificação (§6) e do produto. */
export const CALL_TIMING = {
  endScreenMs: 1700,
  /** Sem resposta: o chamador desiste e o outro lado registra chamada perdida. */
  ringTimeoutMs: 45_000,
  /** Caminho caiu e nenhum outro apareceu: a chamada termina. */
  switchTimeoutMs: 20_000,
  toastMs: 2400,
} as const;

export type CallRecord = {
  callId: string;
  peer: string;
  dir: Dir;
  /** done = conversaram; os outros explicam por que não (ou como) terminou. */
  outcome: 'done' | 'cancelled' | 'declined' | 'missed' | 'sas' | 'lost' | 'elsewhere' | 'handoff' | 'busy' | 'noanswer';
  at: number;
  durationMs?: number;
  route?: LiveRoute;
  /** Quanto tempo tocou (chamada perdida). */
  rangMs?: number;
  /** Detalhe para o subtítulo: mensagem enviada, lembrete, aparelho que atendeu. */
  note?: 'message' | 'later' | string;
};

export type CallState = {
  phase: Phase;
  callId?: string;
  peer?: string;
  dir?: Dir;
  /** Folha "pre": há caminho ao vivo agora? (`null` = só pela malha → pedido de chamada). */
  preRoute?: LiveRoute | null;
  stage?: CallingStage;
  route?: LiveRoute;
  /** Caminho caiu e o Piu procura outro (a chamada continua). */
  switching?: { from: LiveRoute; since: number };
  startedAt?: number;
  connectedAt?: number;
  endedAt?: number;
  muted: boolean;
  speaker: boolean;
  wordsOpen: boolean;
  verified: boolean;
  mini: boolean;
  end?: { reason: EndReason; durationMs?: number };
  /** Pedido de chamada recebido pela malha. */
  requestId?: string;
};

export const IDLE: CallState = { phase: 'idle', muted: false, speaker: false, wordsOpen: false, verified: false, mini: false };

export type Signal =
  | { t: 'invite'; callId: string; route: LiveRoute; requestId?: string }
  | { t: 'ringing'; callId: string }
  | { t: 'accept'; callId: string }
  | { t: 'decline'; callId: string; reason: 'declined' | 'busy' | 'message' | 'later' }
  | { t: 'cancel'; callId: string; rangMs: number }
  | { t: 'end'; callId: string; reason: 'hangup' | 'sas' | 'lost' | 'handoff' }
  | { t: 'request'; requestId: string }
  | { t: 'requestAnswer'; requestId: string; ok: boolean };

export type Effect =
  | { kind: 'send'; signal: Signal; peer?: string }
  | { kind: 'record'; record: CallRecord }
  | { kind: 'timer'; name: 'endDone' | 'ringTimeout' | 'switchTimeout'; ms: number }
  | { kind: 'cancelTimer'; name: 'ringTimeout' | 'switchTimeout' }
  | { kind: 'media'; on: boolean }
  | { kind: 'toast'; text: 'verified' | 'remindLater' | 'requestLater'; peer?: string }
  | { kind: 'draft'; peer: string };

export type CallEvent =
  | { type: 'open'; peer: string; route: LiveRoute | null }
  | { type: 'closePre' }
  | { type: 'dial'; callId: string; now: number }
  | { type: 'peerRinging'; callId: string }
  | { type: 'connected'; callId: string; now: number }
  | { type: 'incoming'; callId: string; peer: string; route: LiveRoute; now: number; requestId?: string }
  | { type: 'answer'; now: number }
  | { type: 'decline'; now: number; how?: 'message' | 'later' }
  | { type: 'hangup'; now: number }
  | { type: 'remoteDecline'; callId: string; reason: 'declined' | 'busy' | 'message' | 'later'; now: number }
  | { type: 'remoteCancel'; callId: string; rangMs: number; now: number }
  | { type: 'remoteEnd'; callId: string; reason: 'hangup' | 'sas' | 'lost' | 'handoff'; now: number }
  | { type: 'answeredElsewhere'; callId: string; device: string; now: number }
  | { type: 'ringTimeout'; now: number }
  | { type: 'routeLost'; now: number }
  | { type: 'routeFound'; route: LiveRoute }
  | { type: 'switchTimeout'; now: number }
  | { type: 'mute' } | { type: 'speaker' } | { type: 'openWords' } | { type: 'closeWords' }
  | { type: 'wordsMatch' } | { type: 'wordsDiffer'; now: number }
  | { type: 'minimize' } | { type: 'restore' }
  | { type: 'handoff'; device: string; now: number }
  | { type: 'sendRequest'; requestId: string }
  | { type: 'requestAccepted'; requestId: string; peer: string; route: LiveRoute; callId: string; now: number }
  | { type: 'requestIn'; requestId: string; peer: string }
  | { type: 'requestNow'; callId: string; now: number }
  | { type: 'requestLater' }
  | { type: 'endDone' };

export type Step = { state: CallState; effects: Effect[] };

const same = (s: CallState): Step => ({ state: s, effects: [] });
const dur = (s: CallState, now: number) => (s.connectedAt !== undefined ? Math.max(0, now - s.connectedAt) : undefined);

/** Vai para a tela de fim (1,7 s) e registra. */
function toEnding(s: CallState, now: number, reason: EndReason, record: Omit<CallRecord, 'callId' | 'peer' | 'dir' | 'at'>, signal?: Signal): Step {
  const effects: Effect[] = [];
  if (signal) effects.push({ kind: 'send', signal });
  effects.push({ kind: 'media', on: false }, { kind: 'cancelTimer', name: 'ringTimeout' }, { kind: 'cancelTimer', name: 'switchTimeout' });
  effects.push({ kind: 'record', record: { callId: s.callId!, peer: s.peer!, dir: s.dir!, at: now, ...record } });
  effects.push({ kind: 'timer', name: 'endDone', ms: CALL_TIMING.endScreenMs });
  return { state: { ...s, phase: 'ending', endedAt: now, end: { reason, durationMs: record.durationMs }, wordsOpen: false, mini: false, switching: undefined }, effects };
}

/** Volta à conversa sem tela de fim (recusar pelo aviso, atendida em outro aparelho). */
function toIdle(s: CallState, now: number, record: Omit<CallRecord, 'callId' | 'peer' | 'dir' | 'at'>, signal?: Signal): Step {
  const effects: Effect[] = [];
  if (signal) effects.push({ kind: 'send', signal });
  effects.push({ kind: 'cancelTimer', name: 'ringTimeout' });
  effects.push({ kind: 'record', record: { callId: s.callId!, peer: s.peer!, dir: s.dir!, at: now, ...record } });
  return { state: IDLE, effects };
}

const live = (p: Phase) => p === 'calling' || p === 'ringing' || p === 'active' || p === 'ending';
const mine = (s: CallState, callId: string) => s.callId === callId;

/** Aplica o evento; cada sinal sai com o destinatário (quem ligou, no caso do "ocupado"). */
export function reduce(s: CallState, e: CallEvent): Step {
  const step = step0(s, e);
  const to = ('peer' in e ? e.peer : undefined) ?? s.peer;
  for (const fx of step.effects) if (fx.kind === 'send' && !fx.peer) fx.peer = to;
  return step;
}

function step0(s: CallState, e: CallEvent): Step {
  switch (e.type) {
    case 'open':
      if (live(s.phase)) return same(s);
      return same({ ...IDLE, phase: 'pre', peer: e.peer, preRoute: e.route });
    case 'closePre':
      return s.phase === 'pre' ? same(IDLE) : same(s);
    case 'dial': {
      if (s.phase !== 'pre' || !s.preRoute || !s.peer) return same(s);
      const next: CallState = { ...IDLE, phase: 'calling', callId: e.callId, peer: s.peer, dir: 'out', stage: 'searching', route: s.preRoute, startedAt: e.now };
      return { state: next, effects: [{ kind: 'send', signal: { t: 'invite', callId: e.callId, route: s.preRoute } }, { kind: 'timer', name: 'ringTimeout', ms: CALL_TIMING.ringTimeoutMs }] };
    }
    case 'peerRinging':
      return s.phase === 'calling' && mine(s, e.callId) && s.stage === 'searching' ? same({ ...s, stage: 'ringing' }) : same(s);
    case 'connected':
      if (s.phase !== 'calling' || !mine(s, e.callId)) return same(s);
      return { state: { ...s, phase: 'active', connectedAt: e.now }, effects: [{ kind: 'cancelTimer', name: 'ringTimeout' }, { kind: 'media', on: true }] };
    case 'incoming': {
      // Quem disse "Posso agora" a um pedido já consentiu: a chamada do pedido conecta sem tocar.
      if (s.phase === 'calling' && s.stage === 'notifying' && e.requestId && e.requestId === s.requestId && e.peer === s.peer) {
        const next: CallState = { ...s, callId: e.callId, dir: 'in', route: e.route, phase: 'active', connectedAt: e.now };
        return { state: next, effects: [{ kind: 'send', signal: { t: 'accept', callId: e.callId } }, { kind: 'cancelTimer', name: 'ringTimeout' }, { kind: 'media', on: true }] };
      }
      if (live(s.phase) || s.phase === 'reqIn' && s.peer !== e.peer) {
        return { state: s, effects: [{ kind: 'send', signal: { t: 'decline', callId: e.callId, reason: 'busy' } }] };
      }
      const next: CallState = { ...IDLE, phase: 'ringing', callId: e.callId, peer: e.peer, dir: 'in', route: e.route, startedAt: e.now };
      return { state: next, effects: [{ kind: 'send', signal: { t: 'ringing', callId: e.callId } }, { kind: 'timer', name: 'ringTimeout', ms: CALL_TIMING.ringTimeoutMs }] };
    }
    case 'answer':
      if (s.phase !== 'ringing') return same(s);
      return { state: { ...s, phase: 'active', connectedAt: e.now }, effects: [{ kind: 'send', signal: { t: 'accept', callId: s.callId! } }, { kind: 'cancelTimer', name: 'ringTimeout' }, { kind: 'media', on: true }] };
    case 'decline': {
      if (s.phase !== 'ringing') return same(s);
      const how = e.how;
      const signal: Signal = { t: 'decline', callId: s.callId!, reason: how ?? 'declined' };
      const step = how
        ? toEnding(s, e.now, 'declined', { outcome: 'declined', route: s.route, note: how }, signal)
        : toIdle(s, e.now, { outcome: 'declined', route: s.route }, signal);
      if (how === 'message') step.effects.push({ kind: 'draft', peer: s.peer! });
      if (how === 'later') step.effects.push({ kind: 'toast', text: 'remindLater' });
      return step;
    }
    case 'hangup':
      if (s.phase === 'active') return toEnding(s, e.now, 'hangup', { outcome: 'done', durationMs: dur(s, e.now), route: s.route }, { t: 'end', callId: s.callId!, reason: 'hangup' });
      if (s.phase === 'calling') {
        const rangMs = e.now - (s.startedAt ?? e.now);
        return toEnding(s, e.now, 'cancel', { outcome: 'cancelled', route: s.route }, { t: 'cancel', callId: s.callId!, rangMs });
      }
      return same(s);
    case 'remoteDecline':
      if (s.phase !== 'calling' || !mine(s, e.callId)) return same(s);
      return toEnding(s, e.now, e.reason === 'busy' ? 'busy' : 'declined', { outcome: e.reason === 'busy' ? 'busy' : 'declined', route: s.route, note: e.reason === 'message' || e.reason === 'later' ? e.reason : undefined });
    case 'remoteCancel':
      if (s.phase !== 'ringing' || !mine(s, e.callId)) return same(s);
      return toIdle(s, e.now, { outcome: 'missed', rangMs: e.rangMs, route: s.route });
    case 'remoteEnd':
      if (!mine(s, e.callId) || (s.phase !== 'active' && s.phase !== 'calling')) return same(s);
      if (e.reason === 'sas') return toEnding(s, e.now, 'sas', { outcome: 'sas', durationMs: dur(s, e.now), route: s.route });
      return toEnding(s, e.now, e.reason === 'lost' ? 'lost' : 'remote', { outcome: e.reason === 'lost' ? 'lost' : 'done', durationMs: dur(s, e.now), route: s.route });
    case 'answeredElsewhere':
      if (s.phase !== 'ringing' || !mine(s, e.callId)) return same(s);
      return toIdle(s, e.now, { outcome: 'elsewhere', route: s.route, note: e.device });
    case 'ringTimeout':
      if (s.phase === 'calling' && s.stage !== 'notifying') {
        const rangMs = e.now - (s.startedAt ?? e.now);
        return toEnding(s, e.now, 'noanswer', { outcome: 'noanswer', route: s.route }, { t: 'cancel', callId: s.callId!, rangMs });
      }
      if (s.phase === 'calling') return toEnding(s, e.now, 'noanswer', { outcome: 'noanswer' });
      if (s.phase === 'ringing') return toIdle(s, e.now, { outcome: 'missed', rangMs: e.now - (s.startedAt ?? e.now), route: s.route });
      return same(s);
    case 'routeLost':
      if (s.phase !== 'active' || s.switching || !s.route) return same(s);
      return { state: { ...s, switching: { from: s.route, since: e.now } }, effects: [{ kind: 'timer', name: 'switchTimeout', ms: CALL_TIMING.switchTimeoutMs }] };
    case 'routeFound':
      if (s.phase !== 'active') return same(s);
      return { state: { ...s, route: e.route, switching: undefined }, effects: s.switching ? [{ kind: 'cancelTimer', name: 'switchTimeout' }] : [] };
    case 'switchTimeout':
      if (s.phase !== 'active' || !s.switching) return same(s);
      return toEnding(s, e.now, 'lost', { outcome: 'lost', durationMs: dur(s, e.now), route: s.switching.from }, { t: 'end', callId: s.callId!, reason: 'lost' });
    case 'mute': return s.phase === 'active' || s.phase === 'calling' ? same({ ...s, muted: !s.muted }) : same(s);
    case 'speaker': return s.phase === 'active' || s.phase === 'calling' ? same({ ...s, speaker: !s.speaker }) : same(s);
    case 'openWords': return s.phase === 'active' ? same({ ...s, wordsOpen: true }) : same(s);
    case 'closeWords': return same({ ...s, wordsOpen: false });
    case 'wordsMatch':
      if (s.phase !== 'active') return same(s);
      return { state: { ...s, wordsOpen: false, verified: true }, effects: [{ kind: 'toast', text: 'verified' }] };
    case 'wordsDiffer':
      if (s.phase !== 'active') return same(s);
      return toEnding(s, e.now, 'sas', { outcome: 'sas', durationMs: dur(s, e.now), route: s.route }, { t: 'end', callId: s.callId!, reason: 'sas' });
    case 'minimize': return s.phase === 'active' ? same({ ...s, mini: true }) : same(s);
    case 'restore': return same({ ...s, mini: false });
    case 'handoff':
      if (s.phase !== 'active') return same(s);
      return { state: { ...IDLE }, effects: [
        { kind: 'media', on: false }, { kind: 'cancelTimer', name: 'switchTimeout' },
        { kind: 'record', record: { callId: s.callId!, peer: s.peer!, dir: s.dir!, at: e.now, outcome: 'handoff', durationMs: dur(s, e.now), route: s.route, note: e.device } },
      ] };
    case 'sendRequest':
      if (s.phase !== 'pre' || s.preRoute !== null || !s.peer) return same(s);
      return { state: IDLE, effects: [{ kind: 'send', signal: { t: 'request', requestId: e.requestId } }] };
    case 'requestAccepted': {
      // O outro disse "Posso agora": quem pediu liga assim que houver caminho ao vivo.
      if (live(s.phase)) return same(s);
      const next: CallState = { ...IDLE, phase: 'calling', callId: e.callId, peer: e.peer, dir: 'out', stage: 'accepted', route: e.route, startedAt: e.now, requestId: e.requestId };
      return { state: next, effects: [{ kind: 'send', signal: { t: 'invite', callId: e.callId, route: e.route, requestId: e.requestId } }, { kind: 'timer', name: 'ringTimeout', ms: CALL_TIMING.ringTimeoutMs }] };
    }
    case 'requestIn':
      if (s.phase !== 'idle') return same(s);
      return same({ ...IDLE, phase: 'reqIn', requestId: e.requestId, peer: e.peer });
    case 'requestNow':
      if (s.phase !== 'reqIn') return same(s);
      return { state: { ...IDLE, phase: 'calling', callId: e.callId, peer: s.peer, dir: 'in', stage: 'notifying', requestId: s.requestId, startedAt: e.now }, effects: [
        { kind: 'send', signal: { t: 'requestAnswer', requestId: s.requestId!, ok: true } },
        { kind: 'timer', name: 'ringTimeout', ms: CALL_TIMING.ringTimeoutMs },
      ] };
    case 'requestLater':
      if (s.phase !== 'reqIn') return same(s);
      return { state: IDLE, effects: [{ kind: 'send', signal: { t: 'requestAnswer', requestId: s.requestId!, ok: false } }, { kind: 'toast', text: 'requestLater', peer: s.peer }] };
    case 'endDone':
      return s.phase === 'ending' ? same(IDLE) : same(s);
  }
}

/** Próximo caminho ao vivo quando o atual cai (Wi-Fi → Bluetooth → Ponto Piu). */
export function nextRoute(available: readonly LiveRoute[], lost?: LiveRoute): LiveRoute | null {
  return ROUTE_ORDER.find(r => r !== lost && available.includes(r)) ?? null;
}

/** mm:ss do cronômetro. */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
