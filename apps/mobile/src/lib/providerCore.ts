/**
 * Provider no celular: o que as telas mostram a partir das respostas reais do piu-node
 * (lib/nodeApi.ts). TypeScript puro, testado com node:test. Nada de valor inventado: sem resposta do
 * nó, a tela diz que não há dado.
 */
import { formatLunes } from './lunesRpc';
import type { ClaimsView, DeviceLimits, DeviceView, LunesWalletView, NodeWalletView, PeerView, ReceiptsView, RelayView } from './nodeApi';
import { NodeApiError } from './nodeApi';
import { t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

// ── regras do equipamento ────────────────────────────────

/** As mesmas opções do painel (Equipamentos → Regras) e do assistente. */
export const LIMIT_BW: { value: DeviceLimits['bw']; label: string }[] = [5, 20, 50].map(v => ({ value: v as DeviceLimits['bw'], label: `${v} Mbps` }));
export const LIMIT_STO: { value: DeviceLimits['sto']; label: string }[] = [1, 4, 8].map(v => ({ value: v as DeviceLimits['sto'], label: `${v} GB` }));
export const LIMIT_HOURS: { value: DeviceLimits['hours']; label: string }[] = [
  { value: 'always', label: 'Sempre' }, { value: 'night', label: '22h–7h' }, { value: 'day', label: '8h–18h' },
];
/** Rótulo do horário no idioma em uso (`LIMIT_HOURS` é a referência pt-BR). */
export const hoursLabel = (h: DeviceLimits['hours'], t: Tr = tGlobal) => (h === 'always' ? t('common.always') : LIMIT_HOURS.find(x => x.value === h)?.label ?? h);
export const LIMIT_DEFAULT: DeviceLimits = { bw: 20, sto: 4, hours: 'always' };

export const limitsLabel = (l: DeviceLimits | undefined | null, t: Tr = tGlobal) =>
  l ? `${l.bw} Mbps · ${l.sto} GB · ${hoursLabel(l.hours, t)}` : t('prov.limits.none');

/** Onde a regra vale: no próprio nó, no motor na hora; nos outros equipamentos, só fica registrada. */
export function limitsNote(d: Pick<DeviceView, 'self' | 'limits'>, t: Tr = tGlobal): string {
  if (!d.limits) return t('prov.limits.note.none');
  return d.self ? t('prov.limits.note.self') : t('prov.limits.note.other');
}

// ── revogação ────────────────────────────────────────────

/** Texto do resultado de `DELETE /api/devices/:id`. */
export function revokeMessage(name: string, r: { revoked: boolean; appliedHere: boolean }, t: Tr = tGlobal): { title: string; body: string } {
  if (!r.revoked) return { title: t('prov.revoke.removed'), body: t('prov.revoke.removed.body', { name }) };
  return r.appliedHere
    ? { title: t('prov.revoke.revoked'), body: t('prov.revoke.here.body', { name }) }
    : { title: t('prov.revoke.revoked'), body: t('prov.revoke.elsewhere.body', { name }) };
}

// ── vizinhos por endereço ────────────────────────────────

const PEER_STATE: Record<PeerView['state'], Key> = { connecting: 'prov.peer.connecting', connected: 'network.peer.connected', failed: 'prov.peer.failed' };

/** Código de confirmação do enlace com este vizinho (o outro nó mostra o mesmo), ou null. */
export function peerConfirmCode(p: Pick<PeerView, 'pk' | 'nodeId' | 'state'>, neighbors: RelayView['neighbors']): string | null {
  if (p.state !== 'connected') return null;
  const n = (neighbors ?? []).find(x => (p.pk && x.pk === p.pk) || (p.nodeId && x.id === p.nodeId));
  return n?.confirmCode && /^[0-9]{6}$/.test(n.confirmCode) ? n.confirmCode : null;
}

/** Linha de estado de um vizinho fixo, como no painel (Malha → Vizinhos por endereço). */
export function peerLine(p: PeerView, t: Tr = tGlobal): string {
  return `${t(PEER_STATE[p.state])}${p.nodeId ? ` · ${t('scan.transfer.node', { node: p.nodeId })}` : ''}${p.state !== 'connected' && p.error ? ` · ${p.error}` : ''}${p.source === 'config' ? ' · PIU_LNNP_PEERS' : ''}`;
}

/** Forma de `host:porta` (o nó confere de novo). */
export function looksLikePeerAddress(a: string): boolean {
  const s = a.trim();
  if (!s || /[/\s]|^[a-z]+:\/\//i.test(s)) return false;
  const m = s.match(/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 65535;
}

/** Resultado de "Adicionar por endereço" (o nó espera o handshake até ~6 s). */
export function addPeerMessage(p: PeerView | null, t: Tr = tGlobal): { ok: boolean; text: string } {
  if (!p) return { ok: false, text: t('prov.peer.noState') };
  if (p.state === 'connected') return { ok: true, text: t('prov.peer.connectedTo', { node: p.nodeId ?? '?' }) };
  if (p.state === 'failed') return { ok: false, text: t('prov.peer.failedTo', { error: p.error ?? t('prov.peer.unknownReason') }) };
  return { ok: false, text: t('prov.peer.stillConnecting') };
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
export function nodeEarnings(w: NodeWalletView | null, r: ReceiptsView | null, t: Tr = tGlobal): NodeEarnings {
  const ins = (w?.txs ?? []).filter(x => x.kind === 'in');
  return {
    received: Math.round(ins.reduce((a, x) => a + x.amount, 0) * 100) / 100,
    balance: w?.balance ?? 0,
    lots: ins.map(x => ({ id: x.id, from: x.from ?? t('prov.settlement'), amount: x.amount, at: x.at })).sort((a, b) => b.at - a.at),
    receipts: r?.enabled ? { kept: r.kept ?? 0, keptOwn: r.keptOwn ?? 0 } : null,
  };
}

/** "Esta semana · 2026-S45" / "Próxima · 2026-S46". */
export const epochLabel = (e: string, i: number, t: Tr = tGlobal) => `${i === 0 ? t('prov.epoch.thisWeek') : t('prov.epoch.next')} · ${e}`;

/** O que dizer sobre a declaração do lote escolhido. */
export function claimNote(claims: ClaimsView, epoch: string, t: Tr = tGlobal): string {
  if (!claims.enabled) return t('prov.claim.disabled');
  const d = claims.claims.find(c => c.epoch === epoch);
  return d ? t('prov.claim.declared', { epoch, address: shortAddress(d.address) }) : t('prov.claim.hint');
}

export const shortAddress = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** Linha do saldo on-chain que o nó leu da carteira de provider. */
export function lunesWalletLine(lw: LunesWalletView | null, t: Tr = tGlobal): string {
  if (!lw) return t('prov.lunes.reading');
  if (!lw.address) return t('prov.lunes.noAddress');
  const r = lw.onchain;
  if (!r) return lw.error ? t('prov.lunes.readFail', { error: lw.error }) : t('prov.lunes.notRead');
  const where = `${t('wallet.block')} #${r.block} · ${r.endpoint.replace(/^wss?:\/\//, '').replace(/\/.*$/, '')}`;
  const free = r.exists ? formatLunes(BigInt(r.free)) : '0,00';
  return lw.error ? t('prov.lunes.stale', { free, where }) : `${t('prov.lunes.ok', { free, where })}${r.exists ? '' : ` · ${t('prov.lunes.empty')}`}`;
}
