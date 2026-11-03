/**
 * Carteira a partir do que existe de verdade neste aparelho (TypeScript puro, testado com node:test).
 * - Saldo disponível: só o que foi liquidado na Lunes Mainnet. Como a liquidação ainda não está
 *   conectada, é 0 (menos o que estiver reservado em convites pagos, nunca abaixo de 0).
 * - "A liberar": créditos de rede validados ou já em lote (lote semanal SIMULADO), em LUNES.
 * - Movimentações: lotes de créditos de rede e convites pagos reservados, aceitos e devolvidos.
 * Nada de valor inventado: sem dado real, a lista fica vazia.
 */
import type { IconName } from '../ui/Icon';

export interface CreditTotals { pendente: number; validado: number; rejeitado: number; pago: number }
export interface LotInfo { id: string; closedAt: number; credits: number; lunes: number; count: number }
/** Convite pago que eu fiz em Por perto (valor reservado por 24 h). `at` em ms. */
export interface InviteMove { id: string; to: string; amt: number; at: number }
/** Taxa recebida ao aceitar um pedido de conversa. `at` em ms. */
export interface EarnedMove { from: string; amt: number; at: number }

export interface ActivityRow { icon: IconName; title: string; at: number; status: string; value: string }

const DAY = 86_400_000;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const lunes2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/** Créditos → LUNES (100 créditos = 1 LUNES, valor provisório). */
export const creditsToLunes = (credits: number, perLunes = 100) => Math.round((credits / perLunes) * 100) / 100;

/** "Hoje", "Ontem" ou "28 out" (hora local). */
export function dayLabel(ms: number, now: number): string {
  const d = new Date(ms), n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(n) - start(d)) / DAY);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

export interface WalletSummary {
  /** Saldo on-chain disponível (0 enquanto a Mainnet não está conectada). */
  available: number;
  /** Reservado em convites pagos ainda sem resposta. */
  reserved: number;
  /** Créditos de rede validados ou em lote, ainda não liquidados de verdade, em LUNES. */
  toRelease: number;
}

export function walletSummary(o: { onchain?: number; totals: CreditTotals; reserved: InviteMove[]; perLunes?: number }): WalletSummary {
  const reserved = o.reserved.reduce((a, r) => a + r.amt, 0);
  const onchain = o.onchain ?? 0;
  return {
    available: Math.max(0, Math.round((onchain - reserved) * 100) / 100),
    reserved,
    toRelease: creditsToLunes(o.totals.validado + o.totals.pago, o.perLunes),
  };
}

/** Movimentações reais, da mais recente para a mais antiga. */
export function activityRows(o: { lots: LotInfo[]; reserved: InviteMove[]; refunded: InviteMove[]; earned: EarnedMove[]; now: number }): ActivityRow[] {
  const rows: ActivityRow[] = [
    ...o.lots.map(l => ({ icon: 'swap_vert' as IconName, title: `Créditos de rede · lote ${l.id.replace(/^lote-/, '')}`, at: l.closedAt * 1000, status: 'a liberar · liquidação simulada', value: `+${lunes2(l.lunes)}` })),
    ...o.reserved.map(r => ({ icon: 'waving_hand' as IconName, title: `Convite para ${r.to}`, at: r.at, status: 'reservado por 24 h', value: `−${lunes2(r.amt)}` })),
    ...o.refunded.map(r => ({ icon: 'undo' as IconName, title: `Convite devolvido · ${r.to}`, at: r.at, status: 'sem resposta em 24 h', value: `+${lunes2(r.amt)}` })),
    ...o.earned.map(e => ({ icon: 'waving_hand' as IconName, title: `Convite aceito · ${e.from}`, at: e.at, status: 'a receber', value: `+${lunes2(e.amt)}` })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

/** Etapas do bônus de boas-vindas com o que dá para saber neste aparelho. */
export function bonusSteps(o: { onboarded: boolean; verifiedContact: boolean; since: number | null; now: number }): [string, number][] {
  const days = o.since == null ? 0 : Math.min(7, Math.max(0, Math.floor((o.now - o.since) / DAY)));
  return [
    // Conferida pela Lunes na primeira abertura: ainda não existe essa verificação.
    ['Instalação verificada', 0],
    ['Identidade criada', o.onboarded ? 100 : 0],
    ['Confirmada por 1 contato', o.verifiedContact ? 100 : 0],
    [`7 dias de uso · ${days}/7`, Math.round((days / 7) * 100)],
  ];
}
