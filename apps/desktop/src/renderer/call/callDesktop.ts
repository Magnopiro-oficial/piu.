/**
 * Regras só do Desktop para a chamada de voz (design "Piu 15 Chamada Desktop"): atalhos, título da
 * janela, posições no painel da conversa, ícone dos aparelhos de áudio, avisos. Puro (testado em
 * test/callDesktop.test.ts); o resto vem do núcleo comum em apps/mobile/src/calls.
 */
import { fmtDuration, type CallState, type Effect, type Phase } from '../../../../mobile/src/calls/callMachine';
import type { Contact, Tr } from '../../../../mobile/src/calls/callView';
import { DESKTOP_GEOMETRY, fitGeometry, type CallGeometry } from '../../../../mobile/src/calls/callVisual';

export type CallAction = 'open' | 'answer' | 'decline' | 'mute' | 'hangup';

/** Ctrl⇧C ligar · Ctrl⇧A atender · Ctrl⇧D recusar · Ctrl D mudo · Ctrl⇧E desligar (⌘ no macOS). */
export const CALL_KEYS: Record<CallAction, { key: string; shift: boolean; phases: readonly Phase[] }> = {
  open: { key: 'c', shift: true, phases: ['idle'] },
  answer: { key: 'a', shift: true, phases: ['ringing', 'reqIn'] },
  decline: { key: 'd', shift: true, phases: ['ringing', 'reqIn'] },
  mute: { key: 'd', shift: false, phases: ['active', 'calling'] },
  hangup: { key: 'e', shift: true, phases: ['active', 'calling'] },
};

export type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

/** Qual atalho da chamada esta tecla aciona agora (ou null). No macOS vale o ⌘; nos outros, o Ctrl. */
export function matchCallKey(e: KeyLike, mac: boolean, phase: Phase): CallAction | null {
  if (e.altKey || !(mac ? e.metaKey : e.ctrlKey)) return null;
  const k = e.key.toLowerCase();
  for (const a of Object.keys(CALL_KEYS) as CallAction[]) {
    const d = CALL_KEYS[a];
    if (d.key === k && d.shift === e.shiftKey && d.phases.includes(phase)) return a;
  }
  return null;
}

/** Rótulo do atalho nas dicas: "Ctrl Shift C" (Linux/Windows) ou "⌘ ⇧ C" (macOS). */
export function callKeyLabel(a: CallAction, mac: boolean): string {
  const d = CALL_KEYS[a];
  return [mac ? '⌘' : 'Ctrl', ...(d.shift ? [mac ? '⇧' : 'Shift'] : []), d.key.toUpperCase()].join(' ');
}

/** Fases em que a chamada ocupa o painel da conversa. */
export const onStage = (p: Phase) => p === 'calling' || p === 'active' || p === 'ending';
/** Em chamada (cronômetro no título, selo na lista). */
export const inCall = (p: Phase) => p === 'calling' || p === 'active';

/** Cronômetro da pílula do título: mm:ss em chamada, "··:··" enquanto chama. */
export function callTimer(s: CallState, now: number): string {
  if (s.phase === 'active') return fmtDuration(now - (s.connectedAt ?? now));
  if (s.phase === 'calling') return '··:··';
  return '';
}

/** Título da janela: "{nome} · mm:ss" durante a chamada; fora dela, o título de sempre. */
export function callWindowTitle(base: string, scene: { state: CallState; contact: Contact } | null, now: number): string {
  const timer = scene ? callTimer(scene.state, now) : '';
  return timer ? `${scene!.contact.name} · ${timer}` : base;
}

/**
 * Posições no palco. No protótipo o painel tem 916×754, centro do efeito em (458, 260), avatar de
 * 120 px em (398, 200), nome em y=372 e o popover de áudio em x=300; em outro tamanho tudo segue o centro.
 */
export function stageLayout(width: number, height: number): { g: CallGeometry; avatar: { left: number; top: number }; textTop: number; audioLeft: number } {
  const base = DESKTOP_GEOMETRY;
  const g = !width || !height || (width === base.width && height === base.height) ? base : fitGeometry(base, width, height);
  return { g, avatar: { left: g.cx - 60, top: g.cy - 60 }, textTop: g.cy + 112, audioLeft: g.cx - 158 };
}

export type AudioDevice = { id: string; label: string; icon?: string };

/** Ícone do aparelho de áudio pelo nome (fone/Bluetooth, microfone embutido, alto-falantes). */
export function deviceIcon(kind: 'mic' | 'out', d: AudioDevice): string {
  if (d.icon) return d.icon;
  if (/bluetooth|airpods|headset|headphone|\bfones?\b|earbud|buds/i.test(d.label)) return 'headphones';
  if (kind === 'mic' && /built-?in|embutido|interno|internal|macbook|laptop/i.test(d.label)) return 'laptop';
  return kind === 'mic' ? 'mic' : 'speaker';
}

/** Texto do aviso (toast) que a máquina pede. */
export function callToastText(t: Tr, text: Extract<Effect, { kind: 'toast' }>['text'], contact?: Contact): string {
  if (text === 'verified') return t('call.toast.verified');
  if (text === 'remindLater') return t('call.toast.remind');
  return t('call.toast.requestLater', { first: contact?.first ?? '' });
}

/** Pro celular: a faixa varre em 1,2 s, "Continua no …" aparece em 1,3 s e o painel volta à conversa em 3,2 s. */
export const HANDOFF = { sweepMs: 1200, doneMs: 1300, closeMs: 3200 } as const;
/** Atendida no celular: o aviso mostra "Atendida no …" por 2,4 s e some. */
export const ELSEWHERE_MS = 2400;
