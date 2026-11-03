/**
 * Provider no celular: o que as telas mostram a partir das respostas reais do piu-node
 * (lib/nodeApi.ts). TypeScript puro, testado com node:test. Nada de valor inventado: sem resposta do
 * nó, a tela diz que não há dado.
 */
import { formatLunes } from './lunesRpc';
import type { ClaimsView, DeviceLimits, DeviceView, LunesWalletView, NodeWalletView, PeerView, ReceiptsView, RelayView } from './nodeApi';
import { NodeApiError } from './nodeApi';

// ── regras do equipamento ────────────────────────────────

/** As mesmas opções do painel (Equipamentos → Regras) e do assistente. */
export const LIMIT_BW: { value: DeviceLimits['bw']; label: string }[] = [5, 20, 50].map(v => ({ value: v as DeviceLimits['bw'], label: `${v} Mbps` }));
export const LIMIT_STO: { value: DeviceLimits['sto']; label: string }[] = [1, 4, 8].map(v => ({ value: v as DeviceLimits['sto'], label: `${v} GB` }));
export const LIMIT_HOURS: { value: DeviceLimits['hours']; label: string }[] = [
  { value: 'always', label: 'Sempre' }, { value: 'night', label: '22h–7h' }, { value: 'day', label: '8h–18h' },
];
export const LIMIT_DEFAULT: DeviceLimits = { bw: 20, sto: 4, hours: 'always' };

export const limitsLabel = (l: DeviceLimits | undefined | null) =>
  l ? `${l.bw} Mbps · ${l.sto} GB · ${LIMIT_HOURS.find(h => h.value === l.hours)?.label ?? l.hours}` : 'sem regras próprias';

/** Onde a regra vale: no próprio nó, no motor na hora; nos outros equipamentos, só fica registrada. */
export function limitsNote(d: Pick<DeviceView, 'self' | 'limits'>): string {
  if (!d.limits) return 'Sem regras próprias: valem só os limites globais do nó.';
  return d.self
    ? 'Valem neste nó agora. Os limites globais do nó continuam valendo: fica o mais restrito.'
    : 'Ficam registradas neste nó. O outro equipamento ainda não as recebe daqui.';
}

// ── revogação ────────────────────────────────────────────

/** Texto do resultado de `DELETE /api/devices/:id`. */
export function revokeMessage(name: string, r: { revoked: boolean; appliedHere: boolean }): { title: string; body: string } {
  if (!r.revoked) return { title: 'Equipamento removido', body: `${name} saiu da lista. Ele não tinha identidade técnica vinculada: não havia chave para revogar.` };
  return r.appliedHere
    ? { title: 'Equipamento revogado', body: `A chave de ${name} entrou na lista de revogação assinada pela chave de operador. Vale neste nó agora (enlace recusado) e segue para os vizinhos do mesmo operador.` }
    : { title: 'Equipamento revogado', body: `A chave de ${name} entrou na lista de revogação desta conta. Este nó não é do dono: a lista vale quando chegar ao nó do dono.` };
}

// ── vizinhos por endereço ────────────────────────────────

const PEER_STATE: Record<PeerView['state'], string> = { connecting: 'conectando', connected: 'conectado', failed: 'falhou' };

/** Código de confirmação do enlace com este vizinho (o outro nó mostra o mesmo), ou null. */
export function peerConfirmCode(p: Pick<PeerView, 'pk' | 'nodeId' | 'state'>, neighbors: RelayView['neighbors']): string | null {
  if (p.state !== 'connected') return null;
  const n = (neighbors ?? []).find(x => (p.pk && x.pk === p.pk) || (p.nodeId && x.id === p.nodeId));
  return n?.confirmCode && /^[0-9]{6}$/.test(n.confirmCode) ? n.confirmCode : null;
}

/** Linha de estado de um vizinho fixo, como no painel (Malha → Vizinhos por endereço). */
export function peerLine(p: PeerView): string {
  return `${PEER_STATE[p.state]}${p.nodeId ? ` · nó ${p.nodeId}` : ''}${p.state !== 'connected' && p.error ? ` · ${p.error}` : ''}${p.source === 'config' ? ' · PIU_LNNP_PEERS' : ''}`;
}

/** Forma de `host:porta` (o nó confere de novo). */
export function looksLikePeerAddress(a: string): boolean {
  const s = a.trim();
  if (!s || /[/\s]|^[a-z]+:\/\//i.test(s)) return false;
  const m = s.match(/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 65535;
}

/** Resultado de "Adicionar por endereço" (o nó espera o handshake até ~6 s). */
export function addPeerMessage(p: PeerView | null): { ok: boolean; text: string } {
  if (!p) return { ok: false, text: 'O nó não devolveu o estado deste vizinho. Atualize a lista.' };
  if (p.state === 'connected') return { ok: true, text: `Conectado ao nó ${p.nodeId ?? '?'}. Confira o código do enlace nos dois equipamentos.` };
  if (p.state === 'failed') return { ok: false, text: `Não conectou: ${p.error ?? 'motivo desconhecido'}. O nó continua tentando a cada poucos segundos.` };
  return { ok: false, text: 'Ainda conectando. Quando o handshake terminar, o estado aparece na lista.' };
}

// ── step-up ──────────────────────────────────────────────

/** O nó pediu um código novo do equipamento (403 com `reauth`). */
export const needsReauth = (e: unknown) => e instanceof NodeApiError && e.status === 403 && e.reauth;

// ── ganhos ───────────────────────────────────────────────

export interface NodeEarnings {
  /** LUNES que o nó registrou como liquidação recebida (`kind: 'in'`). */
  received: number;
  /** Saldo que o nó mostra (recebido menos transferido). */
  balance: number;
  /** Lotes liquidados (entradas), mais recentes primeiro. */
  lots: { id: string; from: string; amount: number; at: number }[];
  receipts: { kept: number; keptOwn: number } | null;
}

/** Ganhos de um nó a partir de `/api/wallet` e `/api/relay/receipts`. Sem entradas, `received` é 0 e `lots` vazio. */
export function nodeEarnings(w: NodeWalletView | null, r: ReceiptsView | null): NodeEarnings {
  const ins = (w?.txs ?? []).filter(t => t.kind === 'in');
  return {
    received: Math.round(ins.reduce((a, t) => a + t.amount, 0) * 100) / 100,
    balance: w?.balance ?? 0,
    lots: ins.map(t => ({ id: t.id, from: t.from ?? 'liquidação', amount: t.amount, at: t.at })).sort((a, b) => b.at - a.at),
    receipts: r?.enabled ? { kept: r.kept ?? 0, keptOwn: r.keptOwn ?? 0 } : null,
  };
}

/** "Esta semana · 2026-S45" / "Próxima · 2026-S46". */
export const epochLabel = (e: string, i: number) => `${i === 0 ? 'Esta semana' : 'Próxima'} · ${e}`;

/** O que dizer sobre a declaração do lote escolhido. */
export function claimNote(claims: ClaimsView, epoch: string): string {
  if (!claims.enabled) return 'Retransmissão LNNP desligada neste nó: sem chave de nó para assinar.';
  const d = claims.claims.find(c => c.epoch === epoch);
  return d
    ? `Já declarada para ${epoch}: ${shortAddress(d.address)}. Declarar de novo troca a carteira; se a anterior já foi entregue ao validador, as duas se anulam e o lote não paga ninguém.`
    : 'O nó confere o endereço inteiro antes de assinar. Pede um código novo do equipamento.';
}

export const shortAddress = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** Linha do saldo on-chain que o nó leu da carteira de provider. */
export function lunesWalletLine(lw: LunesWalletView | null): string {
  if (!lw) return 'Lendo a carteira de provider no nó…';
  if (!lw.address) return 'Sem endereço configurado: o nó não lê saldo nenhum.';
  const r = lw.onchain;
  if (!r) return lw.error ? `O nó não conseguiu ler a Lunes Mainnet: ${lw.error}` : 'O nó ainda não leu o saldo.';
  const where = `bloco #${r.block} · ${r.endpoint.replace(/^wss?:\/\//, '').replace(/\/.*$/, '')}`;
  const free = r.exists ? formatLunes(BigInt(r.free)) : '0,00';
  return lw.error ? `Sem conexão agora · última leitura: ${free} LUNES · ${where}` : `Na Lunes Mainnet: ${free} LUNES · ${where}${r.exists ? '' : ' · conta ainda sem saldo'}`;
}
