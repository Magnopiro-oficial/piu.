import type { Chat, Msg } from '../data/types';
import { MESSAGE_TTL_SEC } from '../messaging/messenger';
import { Priority } from '../protocol/envelope';
import type { IconName } from '../ui/Icon';
import { msgSummary } from './chatCore';
import { fmtBytes } from './networkCore';
import { PRIORITY_LABEL, type RouteRec, routeIcon, routeLabel } from './routeCore';

export interface RouteView {
  text: string;
  steps: { label: string; done: boolean; current: boolean }[];
  hops: { n: string; k: string; reached: boolean; last: boolean; via: string; viaIcon: IconName; solid: boolean }[];
  meta: { l: string; v: string }[];
}

const ORDER = ['criada', 'aguardando', 'encaminhada', 'entregue'];

/** Validade da mensagem na fila (messenger.ts, MESSAGE_TTL_SEC): 48 h. */
const TTL_H = MESSAGE_TTL_SEC / 3600;

/**
 * Rota de uma mensagem: pontas, meio real do enlace com o vizinho, etapa atual e metadados reais do
 * envelope (tamanho, blocos no meio e prioridade do cabeçalho), lidos de `rec` (lib/routeCore.ts).
 * Os nós intermediários não se identificam para quem envia (o envelope é selado): a folha mostra só
 * as pontas. Sem registro (ainda na fila, ou rota não guardada), envelope e blocos ficam em “—”.
 * `prio`: prioridade com que a conversa envia (canal de alerta), para mensagem ainda sem registro.
 */
export function buildRoute(chat: Chat, msg: Msg, rec?: RouteRec, prio: Priority = Priority.Normal): RouteView {
  const dest = chat.kind === 'direct' ? chat.name : `${chat.name} · membros`;
  const mine = msg.from === 'me';
  // Lida também é entregue (a rota é a mesma).
  const st = mine ? (msg.status === 'lida' ? 'entregue' : msg.status ?? 'entregue') : 'entregue';
  const bad = st === 'expirada' || st === 'falha';
  const si = bad ? 3 : ORDER.indexOf(st);
  const waiting = mine && !rec && (st === 'criada' || st === 'aguardando');
  const via = rec ? routeLabel(rec) : waiting ? 'aguardando rota' : '—';
  const icon: IconName = rec ? routeIcon(rec) : 'schedule';
  const nodes = mine
    ? [{ n: 'Você', k: 'Este aparelho' }, { n: dest, k: 'Destino' }]
    // Mensagem recebida: a rota vem do outro lado até você.
    : [{ n: msg.sender ?? chat.name, k: chat.kind === 'group' ? 'Membro do grupo' : 'Origem' }, { n: 'Você', k: 'Destino' }];
  // Enviada: o destino só conta como alcançado com a confirmação de entrega.
  const reached = !mine || (!bad && si === 3) ? 2 : 1;

  const labels = ['Criada', 'Aguardando rota', 'Encaminhada', bad ? (st === 'expirada' ? 'Expirou' : 'Falhou') : 'Entregue'];
  const left = msg.at ? Math.max(0, Math.ceil(TTL_H - (Date.now() - msg.at) / 3_600_000)) : TTL_H;
  const ttl = bad ? (st === 'expirada' ? `${TTL_H} h esgotadas` : 'não saiu') : st === 'entregue' ? 'removida' : `${left} h`;
  return {
    text: msgSummary(msg),
    steps: labels.map((label, i) => ({ label, done: i <= si, current: i === si })),
    hops: nodes.map((x, i) => ({ n: x.n, k: x.k, reached: i < reached, last: i === nodes.length - 1, via: i === 0 ? via : '', viaIcon: icon, solid: i + 1 < reached })),
    meta: [
      { l: 'Envelope', v: rec ? fmtBytes(rec.b) : '—' },
      { l: 'Fragmentos', v: rec ? `${rec.f} de ${rec.f}` : '—' },
      { l: st === 'entregue' ? 'Cópias em trânsito' : 'Expira em', v: ttl },
      { l: 'Prioridade', v: PRIORITY_LABEL[rec?.p ?? prio] },
    ],
  };
}
