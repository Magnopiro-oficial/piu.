import type { Chat, Msg } from '../data/types';
import { isLora } from '../transport/select';
import { MESSAGE_TTL_SEC } from '../messaging/messenger';
import { Priority } from '../protocol/envelope';
import type { IconName } from '../ui/Icon';
import { msgSummary } from './chatCore';
import { fmtBytes, VIA_ICON, viaLabel } from './networkCore';
import { priorityLabel, type RouteRec, routeIcon, routeLabel } from './routeCore';
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;


export interface RouteView {
  text: string;
  steps: { label: string; done: boolean; current: boolean }[];
  hops: { n: string; k: string; reached: boolean; last: boolean; via: string; viaIcon: IconName; solid: boolean }[];
  meta: { l: string; v: string }[];
  /** Linha curta quando o LoRa Automático trocou de rádio (desenho Piu 17, 5 · M). */
  why?: string;
}

const ORDER = ['criada', 'aguardando', 'encaminhada', 'entregue'];

/** Validade da mensagem na fila (messenger.ts, MESSAGE_TTL_SEC): 48 h. */


/**
 * Rota de uma mensagem: pontas, meio real do enlace com o vizinho, etapa atual e metadados reais do
 * envelope (tamanho, blocos no meio e prioridade do cabeçalho), lidos de `rec` (lib/routeCore.ts).
 * Os nós intermediários não se identificam para quem envia (o envelope é selado): a folha mostra só
 * as pontas. Sem registro (ainda na fila, ou rota não guardada), envelope e blocos ficam em “—”.
 * `prio`: prioridade com que a conversa envia (canal de alerta), para mensagem ainda sem registro.
 */
export function buildRoute(chat: Chat, msg: Msg, rec?: RouteRec, prio: Priority = Priority.Normal, t: Tr = tGlobal): RouteView {
  const dest = chat.kind === 'direct' ? chat.name : t('route.members', { name: chat.name });
  const mine = msg.from === 'me';
  // Lida também é entregue (a rota é a mesma).
  const st = mine ? (msg.status === 'lida' ? 'entregue' : msg.status ?? 'entregue') : 'entregue';
  const bad = st === 'expirada' || st === 'falha';
  const si = bad ? 3 : ORDER.indexOf(st);
  const waiting = mine && !rec && (st === 'criada' || st === 'aguardando');
  const via = rec ? routeLabel(rec, t) : waiting ? t('route.waitingRoute') : '—';
  const icon: IconName = rec ? routeIcon(rec) : 'schedule';
  const ends = mine
    ? [{ n: t('common.you'), k: t('route.thisDevice') }, { n: dest, k: t('route.destination') }]
    // Mensagem recebida: a rota vem do outro lado até você.
    : [{ n: msg.sender ?? chat.name, k: chat.kind === 'group' ? t('route.groupMember') : t('route.origin') }, { n: t('common.you'), k: t('route.destination') }];
  // LoRa (desenho 4b): o meu rádio LoRa (Meshtastic ou o do Piu) no meio, ligado ao celular por Bluetooth LE. Os rádios
  // da malha entre os dois lados não se identificam ao Piu, então não aparecem.
  const lora = isLora(rec?.md);
  const piu = rec?.md === 'piulora';
  const nodes = lora ? [ends[0], { n: t(piu ? 'piu.route.radio' : 'lora.route.radio'), k: t('lora.route.yours') }, ends[1]] : ends;
  const ble = { via: viaLabel('ble', t), icon: VIA_ICON.ble }, air = { via: t(piu ? 'piu.route.via' : 'lora.route.via'), icon: VIA_ICON.lora };
  const legs = lora ? (mine ? [ble, air] : [air, ble]) : [{ via, icon }];
  // Enviada: o destino só conta como alcançado com a confirmação de entrega (pelo LoRa, o rádio já recebeu).
  const reached = !mine || (!bad && si === 3) ? nodes.length : lora ? 2 : 1;

  const labels = [t('route.step.created'), t('route.step.waiting'), t('route.step.forwarded'), bad ? (st === 'expirada' ? t('route.step.expired') : t('route.step.failed')) : t('route.step.delivered')];
  // Mensagens temporárias têm prazo menor que o limite da fila (48 h).
  const created = msg.at ?? Date.now();
  const deadline = Math.min(created + MESSAGE_TTL_SEC * 1000, msg.expiresAt ?? Infinity);
  const durationH = Math.max(0, Math.ceil((deadline - created) / 3_600_000));
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 3_600_000));
  const ttl = bad ? (st === 'expirada' ? t('route.ttl.exhausted', { h: durationH }) : t('route.ttl.notSent')) : st === 'entregue' ? t('route.ttl.removed') : `${left} h`;
  const why = rec?.md === 'lora' && rec.w ? t(rec.w === 'away' ? 'piu.why.away' : 'piu.why.failed') : undefined;
  return {
    ...(why ? { why } : {}),
    text: msgSummary(msg, t),
    steps: labels.map((label, i) => ({ label, done: i <= si, current: i === si })),
    hops: nodes.map((x, i) => ({ n: x.n, k: x.k, reached: i < reached, last: i === nodes.length - 1, via: legs[i]?.via ?? '', viaIcon: legs[i]?.icon ?? icon, solid: i + 1 < reached && legs[i] !== air })),
    meta: [
      { l: t('route.envelope'), v: rec ? fmtBytes(rec.b) : '—' },
      { l: t('route.fragments'), v: rec ? t('route.fragments.of', { n: rec.f, total: rec.f }) : '—' },
      { l: st === 'entregue' ? t('route.copiesInTransit') : t('route.expiresIn'), v: ttl },
      { l: t('newChannel.priority.label'), v: priorityLabel(rec?.p ?? prio, t) },
    ],
  };
}
