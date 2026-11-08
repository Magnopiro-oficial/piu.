/**
 * Chamada de voz recebida fora da janela (puro, testado em test/callNotify.test.ts): quando o toque soa
 * (renderer, `ring` do `CallSnapshot`), quando sai o aviso nativo "Chamada de {nome}" (main.ts) e o aviso
 * das chamadas perdidas com o Piu bloqueado, mostrado ao desbloquear.
 * - O aviso nativo segue as regras das mensagens diretas (shared/notifyPolicy.ts): "Mensagens" desligado,
 *   conversa silenciada, Não perturbe e janela em foco calam; "Mostrar no aviso" vale igual.
 * - Bloqueado, nem aviso nem toque: o evento `call` não chega à janela (main/lockGate.ts) e a chamada termina
 *   como perdida. Tocar com o Piu bloqueado é decisão do dono do produto; por ora fica assim.
 */
import type { CallState, LiveRoute } from '../../../mobile/src/calls/callMachine';
import { routeVia } from '../../../mobile/src/calls/callView';
import { t, type Key } from './i18n';
import { shouldNotify } from './notifyPolicy';
import type { Prefs } from './types';

/** A chamada que toca aqui agora (recebida, ainda sem resposta), ou null. */
export function ringingCall(s: CallState | null | undefined): { callId: string; peer: string; route?: LiveRoute } | null {
  if (!s || s.phase !== 'ringing' || s.dir !== 'in' || !s.callId || !s.peer) return null;
  return { callId: s.callId, peer: s.peer, ...(s.route ? { route: s.route } : {}) };
}

/**
 * O toque soa enquanto a chamada toca e para ao atender, recusar ou terminar. Não perturbe e conversa
 * silenciada calam o som (o aviso na janela continua). Não depende do som das notificações: é o som da chamada.
 */
export function shouldRing(p: Prefs, s: CallState | null | undefined, muted: boolean): boolean {
  return !!ringingCall(s) && !p.dnd && !muted;
}

/** Aviso nativo da chamada que toca: as regras das mensagens diretas e, com o Piu bloqueado, nada. */
export function shouldNotifyCall(p: Prefs, o: { muted: boolean; focused: boolean; locked: boolean }): boolean {
  return !o.locked && shouldNotify(p, { kind: 'direct', muted: o.muted, focused: o.focused });
}

/** Título e corpo do aviso. "Mostrar no aviso": nome e caminho, só o nome, ou nada (como nas mensagens). */
export function callNoticeText(preview: Prefs['notifPreview'], who: string, route?: LiveRoute): { title: string; body: string } {
  if (preview === 'never') return { title: 'Piu', body: t('call.voice') };
  const body = preview === 'always' ? t('call.incoming.banner', { via: routeVia((k, v) => t(k as Key, v), route) }) : t('call.voice');
  return { title: t('main.notif.callFrom', { name: who }), body };
}

/** Aviso ao desbloquear: quem ligou enquanto o Piu estava bloqueado (sem repetir; vários, os 3 primeiros e +N). */
export function missedCallsText(names: readonly string[]): string | null {
  const u = [...new Set(names)];
  if (!u.length) return null;
  if (u.length === 1) return t('main.notif.missedCall', { name: u[0]! });
  const list = u.slice(0, 3).join(', ') + (u.length > 3 ? ` +${u.length - 3}` : '');
  return t('main.notif.missedCalls', { names: list });
}
