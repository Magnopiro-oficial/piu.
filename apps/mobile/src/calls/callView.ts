/**
 * O que a tela da chamada mostra, a partir do estado (./callMachine): linha de status, selos do topo,
 * quem fala, botões e cartões de registro na conversa. Igual no celular e no Desktop; cada um passa o
 * seu `t` (dicionários com as chaves `call.*`).
 */
import { failedAttempt, fmtDuration, type CallRecord, type CallState, type LiveRoute } from './callMachine';

type Vars = Record<string, string | number>;
export type Tr = (key: string, vars?: Vars) => string;
export type Contact = { name: string; first: string; initials: string };

/** Como a rota aparece: Wi-Fi Direct (Nearby) anda como `bt` no fio, com a marca `wifiDirect`, mas não é Bluetooth. */
export type RouteKey = LiveRoute | 'nearby';
export const routeKey = (r: LiveRoute, wifiDirect?: boolean): RouteKey => (r === 'bt' && wifiDirect ? 'nearby' : r);

export const ROUTE_ICON: Record<RouteKey | 'switching' | 'mesh', string> = { direct: 'wifi', nearby: 'wifi_tethering', bt: 'bluetooth', point: 'storefront', switching: 'sync', mesh: 'hub' };
const LOST_KEY: Record<RouteKey, string> = { direct: 'call.route.lostWifi', nearby: 'call.route.lostNearby', bt: 'call.route.lostBt', point: 'call.route.lostPoint' };
const SEARCH_KEY: Partial<Record<RouteKey, string>> = { nearby: 'call.stage.searchingNearby', bt: 'call.stage.searchingBt' };

export const routeChip = (t: Tr, s: CallState, latencyMs?: number) => {
  if (s.switching) return { icon: 'sync', text: t(LOST_KEY[routeKey(s.switching.from, s.wifiDirect)]), q: '' };
  const r = routeKey(s.route ?? 'direct', s.wifiDirect);
  return { icon: ROUTE_ICON[r], text: t(`call.route.${r}`), q: latencyMs !== undefined ? t('call.ms', { ms: Math.round(latencyMs) }) : '' };
};
/** "direto pelo Wi-Fi" · "direto por Wi-Fi Direct" · "direto por Bluetooth" · "via Ponto Piu". */
export const routeVia = (t: Tr, r: LiveRoute | undefined, wifiDirect?: boolean) => t(`call.route.via.${routeKey(r ?? 'direct', wifiDirect)}`);

export const encChip = (t: Tr, s: CallState) => (s.verified ? { icon: 'verified', text: t('call.verified') } : { icon: 'lock', text: t('call.e2e') });

export function endTitle(t: Tr, s: CallState): string {
  switch (s.end?.reason) {
    case 'hangup': case 'remote': return t('call.end.done');
    case 'cancel': return t('call.end.cancelled');
    case 'declined': case 'message': case 'later': return t('call.end.declined');
    case 'sas': return t('call.end.sas');
    case 'noanswer': return t('call.end.noanswer');
    case 'nocall': return t('call.end.nocall');
    case 'unreachable': return t('call.end.unreachable');
    case 'busy': return t('call.end.busy');
    case 'lost': return t('call.end.lost');
    default: return t('call.end.done');
  }
}

/**
 * Aviso da tentativa que não deu certo (só de quem ligou), na tela de fim do celular: título claro e o
 * porquê. `null` quando não é falha (eu desliguei, eu recusei, a conversa terminou).
 */
export function failNotice(t: Tr, s: CallState, c: Contact): { icon: string; title: string; sub: string } | null {
  if (!failedAttempt(s)) return null;
  switch (s.end?.reason) {
    case 'noanswer': return { icon: 'phone_missed', title: t('call.end.noanswer'), sub: t('call.fail.noanswerSub', { first: c.first }) };
    case 'declined': return { icon: 'call_end', title: t('call.end.declined'), sub: t('call.fail.declinedSub', { first: c.first }) };
    case 'busy': return { icon: 'call_end', title: t('call.end.busy'), sub: t('call.fail.busySub', { first: c.first }) };
    default: return { icon: 'call_end', title: t('call.fail.title'), sub: endTitle(t, s) }; // nocall · unreachable
  }
}

/** Linha mono embaixo do nome: estágio, cronômetro ou fim. */
export function statusLine(t: Tr, s: CallState, c: Contact, now: number, o: { desktop?: boolean } = {}): string {
  switch (s.phase) {
    case 'ringing': return routeVia(t, s.route, s.wifiDirect);
    case 'calling':
      switch (s.stage) {
        case 'searching': return t((s.route && SEARCH_KEY[routeKey(s.route, s.wifiDirect)]) || 'call.stage.searching', { first: c.first });
        case 'ringing': return t(o.desktop ? 'call.stage.ringingBoth' : 'call.stage.ringing', { first: c.first });
        case 'accepted': return t('call.stage.accepted', { first: c.first });
        case 'notifying': return t('call.stage.notifying', { first: c.first });
        default: return '';
      }
    case 'active': return fmtDuration(now - (s.connectedAt ?? now));
    case 'ending': {
      const d = s.end?.durationMs;
      return d !== undefined && (s.end?.reason === 'hangup' || s.end?.reason === 'remote') ? `${endTitle(t, s)} · ${fmtDuration(d)}` : endTitle(t, s);
    }
    default: return '';
  }
}

/** Texto embaixo do avatar durante a chamada. */
export function speakLine(t: Tr, s: CallState, c: Contact, who: 'me' | 'them' | null, o: { locked?: boolean } = {}): string {
  if (s.phase === 'ringing' && o.locked) return t('call.incoming.unlock');
  if (s.phase !== 'active') return '';
  if (s.switching) return t('call.speak.switching');
  if (who === 'them') return t('call.speak.them', { first: c.first });
  if (who === 'me') return t('call.speak.me');
  if (s.muted) return t('call.speak.muted');
  return '';
}

export type ControlId = 'mute' | 'speaker' | 'words' | 'chat' | 'audio' | 'toPhone';
export type Control = { id: ControlId; icon: string; label: string; on: boolean; tip?: string };

/** Botões redondos: celular Mudo · Alto-falante · Palavras · Conversa; Desktop Mudo · Áudio · Palavras · Pro celular · Conversas. Chamando: só os 2 primeiros. */
export function controls(t: Tr, s: CallState, o: { desktop?: boolean; audioOpen?: boolean; phoneName?: string; keys?: { mute: string } } = {}): Control[] {
  const mute: Control = { id: 'mute', icon: s.muted ? 'mic_off' : 'mic', label: t(s.muted ? 'call.ctl.muted' : 'call.ctl.mute'), on: s.muted, tip: o.keys ? t('call.tip.mute', { keys: o.keys.mute }) : undefined };
  const words: Control = { id: 'words', icon: s.verified ? 'verified' : 'key', label: t(s.verified ? 'call.ctl.wordsDone' : 'call.ctl.words'), on: s.verified, tip: t('call.tip.words') };
  const all: Control[] = o.desktop
    ? [mute, { id: 'audio', icon: 'tune', label: t('call.ctl.audio'), on: !!o.audioOpen, tip: t('call.tip.audio') }, words,
      ...(o.phoneName ? [{ id: 'toPhone' as const, icon: 'phonelink_ring', label: t('call.ctl.toPhone'), on: false, tip: t('call.tip.toPhone', { device: o.phoneName }) }] : []),
      { id: 'chat', icon: 'chat', label: t('call.ctl.chats'), on: false, tip: t('call.tip.chats') }]
    : [mute, { id: 'speaker', icon: 'volume_up', label: t('call.ctl.speaker'), on: s.speaker }, words, { id: 'chat', icon: 'chat', label: t('call.ctl.chat'), on: false }];
  return s.phase === 'calling' ? all.slice(0, 2) : all;
}

/** Cartão de registro na conversa (§4.11). `mine` = eu iniciei. */
export function recordCard(t: Tr, r: CallRecord, c: Contact, o: { desktop?: boolean } = {}): { icon: string; title: string; sub: string; mine: boolean; callBack: boolean } {
  const mine = r.dir === 'out';
  const via = r.route ? routeVia(t, r.route, r.wifiDirect) : '';
  const withDur = (x: string) => (r.durationMs !== undefined ? `${fmtDuration(r.durationMs)}${x ? ' · ' + x : ''}` : x);
  switch (r.outcome) {
    case 'done': return { icon: mine ? 'call_made' : 'call_received', title: t('call.rec.voice'), sub: withDur(via), mine, callBack: false };
    case 'missed': {
      const seconds = Math.max(1, Math.round((r.rangMs ?? 0) / 1000));
      return { icon: 'phone_missed', title: t('call.rec.missed'), sub: t(o.desktop ? 'call.rec.missedSubBoth' : 'call.rec.missedSub', { first: c.first, seconds }), mine: false, callBack: true };
    }
    case 'declined': {
      const sub = r.note === 'message' ? t('call.rec.messageSub') : r.note === 'later' ? t('call.rec.laterSub') : o.desktop && !mine ? t('call.rec.onDesktop') : via;
      return { icon: 'call_end', title: t('call.end.declined'), sub, mine, callBack: false };
    }
    case 'cancelled': return { icon: 'call_end', title: t('call.end.cancelled'), sub: via, mine, callBack: false };
    case 'noanswer': {
      // A oferta não chegou a tocar: "Não foi possível chamar", como na tela de fim.
      const couldNot = r.note === 'nocall' || r.note === 'unreachable';
      const sub = r.note === 'nocall' ? t('call.rec.nocallSub') : r.note === 'unreachable' ? t('call.rec.unreachableSub') : via;
      return { icon: 'call_end', title: t(couldNot ? 'call.fail.title' : 'call.end.noanswer'), sub, mine, callBack: false };
    }
    case 'busy': return { icon: 'call_end', title: t('call.end.busy'), sub: via, mine, callBack: false };
    case 'sas': return { icon: 'call_end', title: t('call.end.sas'), sub: withDur(t('call.rec.sasSub')), mine, callBack: false };
    case 'lost': return { icon: 'call_end', title: t('call.end.lost'), sub: withDur(via), mine, callBack: false };
    case 'elsewhere': return { icon: 'call_received', title: t('call.rec.voice'), sub: t('call.rec.elsewhere', { device: r.note ?? '' }), mine: false, callBack: false };
    case 'handoff': return { icon: mine ? 'call_made' : 'call_received', title: t('call.rec.voice'), sub: t('call.rec.handoff', { duration: fmtDuration(r.durationMs ?? 0), device: r.note ?? '' }), mine, callBack: false };
  }
}

/**
 * Nós no meio do diagrama da folha em modo malha: um por salto quando se sabe (até 5); sem saber, 0
 * (o diagrama mostra só a malha, sem número inventado). LoRa (5a): o rádio e um nó depois dele.
 */
export function meshNodes(hops?: number, lora?: boolean): number {
  if (lora) return 2;
  return hops && hops > 0 ? Math.min(5, Math.round(hops)) : 0;
}

export type RequestStep = 'traveling' | 'delivered' | 'accepted' | 'declined' | 'expired';
/** Cartão "Pedido de chamada" com os 3 traços de progresso. */
export function requestCard(t: Tr, step: RequestStep, c: Contact, hops?: number) {
  const sub = step === 'traveling' ? (hops ? t('call.rec.req.travelingHops', { hops }) : t('call.rec.req.traveling'))
    : step === 'delivered' ? t('call.rec.req.delivered', { first: c.first })
      : step === 'accepted' ? t('call.rec.req.accepted', { first: c.first })
        : step === 'declined' ? t('call.rec.req.declined', { first: c.first }) : t('call.rec.req.expired');
  const lit = step === 'traveling' ? 1 : step === 'delivered' ? 2 : step === 'accepted' ? 3 : 0;
  return { icon: 'schedule_send', title: t('call.rec.request'), sub, dots: [0, 1, 2].map(i => i < lit) };
}

/** Iniciais como no protótipo ("Marina Alves" → "MA"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] ?? '', b = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (a + b).toUpperCase();
}
export const contactOf = (name: string): Contact => ({ name, first: name.trim().split(/\s+/)[0] || name, initials: initialsOf(name) });

/**
 * Tudo o que a tela da chamada recebe (celular e Desktop). Vem do provedor da chamada do aparelho;
 * na galeria de desenvolvimento, de um controlador com portas de exemplo.
 */
export type CallScene = {
  state: CallState;
  contact: Contact;
  /** As 4 palavras da chamada (null antes de conectar). */
  words: string[] | null;
  /** Latência medida no caminho atual (só aparece se medida). */
  latencyMs?: number;
  /** Saltos até o contato pela malha (folha em modo malha). */
  hops?: number;
  /** Só a malha LoRa (Meshtastic) alcança: sem voz ao vivo nem áudio gravado (folha "pre", desenho 5a). */
  lora?: boolean;
  /** Níveis de voz reais 0..1, lidos a cada quadro pela animação. */
  levels: () => { mine: number; theirs: number };
  /** Menos movimento (acessibilidade do sistema ou ajuste): sem onda de choque nem flash. */
  soft: boolean;
};
