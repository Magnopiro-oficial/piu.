import type { Chat, Msg } from '../data/types';
import type { IconName } from '../ui/Icon';

export interface RouteView {
  text: string;
  steps: { label: string; done: boolean; current: boolean }[];
  hops: { n: string; k: string; reached: boolean; last: boolean; via: string; viaIcon: IconName; solid: boolean }[];
  meta: { l: string; v: string }[];
}

const ORDER = ['criada', 'aguardando', 'encaminhada', 'entregue'];
const viaIcon = (v: string): IconName =>
  /LoRa/.test(v) ? 'settings_input_antenna' : /Bluetooth/.test(v) ? 'bluetooth' : /Direct/.test(v) ? 'wifi_tethering' : /aguard/.test(v) ? 'schedule' : 'hub';
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** Validade do envelope na fila (messenger.ts, TTL_SEC). */
const TTL_H = 72;

/**
 * Rota de uma mensagem: saltos, transporte por salto, etapa atual e metadados do envelope.
 * Os nós intermediários não se identificam para quem envia (o envelope é selado): sem a rota
 * gravada, mostra só as pontas, ligadas pelo meio por onde a conversa anda.
 */
export function buildRoute(chat: Chat, msg: Msg): RouteView {
  const dest = chat.kind === 'direct' ? chat.name : `${chat.name} · membros`;
  const r = chat.route ?? { nodes: [{ n: 'Você', k: 'Este aparelho' }, { n: dest, k: 'Destino' }], vias: [chat.via ?? 'Por perto'] };
  let nodes = r.nodes, vias = r.vias;
  const mine = msg.from === 'me';
  if (!mine) {
    // Mensagem recebida: a rota vem do outro lado até você.
    nodes = [...nodes].reverse().map((x, i, a) =>
      i === 0 ? { n: msg.sender ?? x.n, k: chat.kind === 'group' ? 'Membro do grupo' : x.k === 'Destino' ? 'Origem' : x.k } : i === a.length - 1 ? { n: 'Você', k: 'Destino' } : x);
    vias = [...vias].reverse();
  }
  const st = mine ? msg.status ?? 'entregue' : 'entregue';
  const bad = st === 'expirada' || st === 'falha';
  const si = bad ? 3 : ORDER.indexOf(st);
  let reached = nodes.length;
  if (mine) reached = si <= 0 ? 1 : si === 1 ? (chat.offline ? 2 : 1) : si === 2 ? nodes.length - 1 : nodes.length;
  if (bad) reached = 1;

  const labels = ['Criada', 'Aguardando rota', 'Encaminhada', bad ? (st === 'expirada' ? 'Expirou' : 'Falhou') : 'Entregue'];
  const left = msg.at ? Math.max(0, Math.ceil(TTL_H - (Date.now() - msg.at) / 3_600_000)) : TTL_H;
  const ttl = bad ? (st === 'expirada' ? `${TTL_H} h esgotadas` : 'não saiu') : st === 'entregue' ? 'removida' : `${left} h`;
  return {
    text: msg.text,
    steps: labels.map((label, i) => ({ label, done: i <= si, current: i === si })),
    hops: nodes.map((x, i) => ({
      n: x.n, k: x.k, reached: i < reached, last: i === nodes.length - 1,
      via: vias[i] ?? '', viaIcon: viaIcon(vias[i] ?? ''), solid: i + 1 < reached,
    })),
    meta: [
      { l: 'Envelope', v: utf8Len(msg.text) + 164 + ' B' },
      { l: 'Fragmentos', v: '1 de 1' },
      { l: st === 'entregue' ? 'Cópias em trânsito' : 'Expira em', v: ttl },
      { l: 'Prioridade', v: chat.priority ?? 'Normal' },
    ],
  };
}
