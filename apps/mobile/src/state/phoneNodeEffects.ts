/**
 * Efeitos do modo nó que valem com o app em qualquer tela (chamados pelo MessagingProvider):
 * - certificado da chave do dia emitido pelo próprio aparelho (offline), ao abrir e a cada hora;
 * - registro fechado sozinho quando a caução finaliza (o vínculo da carteira já foi assinado);
 * - devolução da caução notada no histórico da carteira, depois da saída;
 * - aviso "desde quando estou no modo nó" (`ns`) aos contatos verificados pessoalmente.
 * Regras em lib/phoneNodeCore.ts; estado em lib/phoneNodeStore.ts.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { KeyPair } from '../protocol/keys';
import { dayOfSec, makeOperatorCert } from '../protocol/phoneNode';
import { BOND_ADDRESS, bondFromTransfer, certFailed, issueDailyCert, markRefund, nodeModeLimits, nodeSince, refundFromMoves, register } from '../lib/phoneNodeCore';
import { getPhoneNode, subscribePhoneNode, updatePhoneNode } from '../lib/phoneNodeStore';
import { persistNow, readPersisted } from '../lib/persist';
import type { WalletTransferRecord } from '../lib/walletTransfer';

const nowSec = () => Math.floor(Date.now() / 1000);
const TOLD_KEY = 'phone.node.told';

/** Emite (assina) o certificado da chave do dia de hoje; falha vira M3e. */
export async function issueTodayCert(op: KeyPair | null, nodeKeyFor: ((day: number) => KeyPair) | null) {
  const s = getPhoneNode();
  if (s.activeSince === null || s.exit) return;
  const now = nowSec();
  try {
    if (!op || !nodeKeyFor) throw new Error('chaves indisponíveis');
    const day = dayOfSec(now);
    makeOperatorCert(op, nodeKeyFor(day).pk, day * 86400); // a emissão é determinística; o arquivo refaz igual
    await updatePhoneNode(x => issueDailyCert(x, now));
  } catch (e) {
    await updatePhoneNode(x => certFailed(x, now, e instanceof Error ? e.message : 'erro')).catch(() => {});
  }
}

export function usePhoneNodeEffects(o: {
  phoneOperator: KeyPair | null; nodeKeyFor: ((day: number) => KeyPair) | null;
  pendingTransfer: WalletTransferRecord | null;
  historyMoves: readonly { direction: string; counterparty: string; amount: bigint; at: number | null }[] | null;
  /** Contatos públicos aceitos verificados pessoalmente (id do contato no mensageiro). */
  verifiedContacts: readonly string[];
  sendNodeStatus: ((contactId: string, since: number) => void) | null;
}) {
  const state = useSyncExternalStore(subscribePhoneNode, getPhoneNode, getPhoneNode);
  const active = state.activeSince !== null && !state.exit;

  // Certificado do dia: ao abrir e a cada hora (pega a virada do dia).
  useEffect(() => {
    if (!active) return;
    void issueTodayCert(o.phoneOperator, o.nodeKeyFor);
    const t = setInterval(() => { void issueTodayCert(o.phoneOperator, o.nodeKeyFor); }, 3600_000);
    return () => clearInterval(t);
  }, [active, o.phoneOperator, o.nodeKeyFor]);

  // Caução finalizada → registro (só a chave de operador; sem biometria).
  useEffect(() => {
    const op = o.phoneOperator;
    if (!op || state.registration || !state.bond || !state.binding) return;
    const bond = bondFromTransfer(o.pendingTransfer, BOND_ADDRESS);
    if (!bond || bond.txHash !== state.bond.txHash) return;
    void updatePhoneNode(s => (s.registration ? s : register(s, op, bond, nowSec()))).catch(() => {});
  }, [o.phoneOperator, o.pendingTransfer, state.registration, state.bond, state.binding]);

  // Devolução vista na carteira.
  useEffect(() => {
    if (!state.exit || state.refundSeenAt || !o.historyMoves) return;
    const at = refundFromMoves(o.historyMoves, BOND_ADDRESS, state.exit.at);
    if (at !== null) void updatePhoneNode(s => markRefund(s, at)).catch(() => {});
  }, [state.exit, state.refundSeenAt, o.historyMoves]);

  // "Estou no modo nó desde…" para os contatos verificados (uma vez por valor).
  const since = nodeSince(state);
  useEffect(() => {
    if (!o.sendNodeStatus) return;
    const told = readPersisted<Record<string, number>>(TOLD_KEY) ?? {};
    let changed = false;
    for (const id of o.verifiedContacts) {
      if ((told[id] ?? 0) === since) continue;
      try { o.sendNodeStatus(id, since); told[id] = since; changed = true; } catch { /* contato não aceito ainda */ }
    }
    if (changed) void persistNow(TOLD_KEY, { ...told }).catch(() => {});
  }, [since, o.verifiedContacts.join(','), o.sendNodeStatus]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Bateria em que a retransmissão pausa: a escolhida, ou no mínimo 30% com o modo nó do celular ligado. */
export function useRelayBattery(userPct: number): number {
  const s = useSyncExternalStore(subscribePhoneNode, getPhoneNode, getPhoneNode);
  return nodeModeLimits({ dailyBytes: 0, batteryPct: userPct }, s.activeSince !== null && !s.exit).batteryPct;
}
