/**
 * Carteira a partir do que existe de verdade neste aparelho (TypeScript puro, testado com node:test).
 * - Saldo disponível: o saldo livre (`free`) da conta Lunes que a pessoa informou, lido na Lunes
 *   Mainnet (lib/lunesRpc.ts), menos o que estiver reservado em convites pagos (nunca abaixo de 0).
 *   Sem endereço informado ou sem nenhuma leitura ainda, é 0.
 * - "A liberar": créditos de rede validados ou em lote (aguardando liquidação), em LUNES. O pagamento
 *   semanal desses lotes depende da liquidação (apps/settlement), que ainda não está ligada ao app.
 * - Movimentações: lotes de créditos de rede e convites pagos reservados, aceitos e devolvidos.
 * Nada de valor inventado: sem dado real, a lista fica vazia.
 */
import type { IconName } from '../ui/Icon';
import { fmtDate, t as tGlobal, type Key, type Vars } from '../i18n/core';
/** Tradutor opcional (padrão: idioma em uso no app; pt-BR nos testes). */
type Tr = (key: Key, vars?: Vars) => string;

export interface CreditTotals { pendente: number; validado: number; em_lote: number; rejeitado: number; pago: number }
export interface LotInfo { id: string; closedAt: number; credits: number; lunes: number; count: number }
/** Convite pago que eu fiz em Por perto (valor reservado por 24 h). `at` em ms. */
export interface InviteMove { id: string; to: string; amt: number; at: number }
/** Taxa recebida ao aceitar um pedido de conversa. `at` em ms. */
export interface EarnedMove { from: string; amt: number; at: number }

export interface ActivityRow { icon: IconName; title: string; at: number; status: string; value: string }

const DAY = 86_400_000;

export const lunes2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/** Créditos → LUNES (100 créditos = 1 LUNES, valor provisório). */
export const creditsToLunes = (credits: number, perLunes = 100) => Math.round((credits / perLunes) * 100) / 100;

/** "Hoje", "Ontem" ou "28 out" (hora local). */
export function dayLabel(ms: number, now: number, t: Tr = tGlobal): string {
  const d = new Date(ms), n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(n) - start(d)) / DAY);
  if (diff === 0) return t('day.today');
  if (diff === 1) return t('day.yesterday');
  // "28 out" (mês curto do idioma, sem ponto) e o ano só quando é outro.
  const month = fmtDate(d, { month: 'short' }).replace(/\./g, '');
  return `${d.getDate()} ${month}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

export interface WalletSummary {
  /** Saldo on-chain disponível (free da conta informada, menos as reservas locais). */
  available: number;
  /** Reservado em convites pagos ainda sem resposta. */
  reserved: number;
  /** Créditos de rede validados ou em lote, ainda não liquidados de verdade, em LUNES (`pago` já é saldo real). */
  toRelease: number;
}

export function walletSummary(o: { onchain?: number; totals: CreditTotals; reserved: InviteMove[]; perLunes?: number }): WalletSummary {
  const reserved = o.reserved.reduce((a, r) => a + r.amt, 0);
  const onchain = o.onchain ?? 0;
  return {
    available: Math.max(0, Math.round((onchain - reserved) * 100) / 100),
    reserved,
    toRelease: creditsToLunes(o.totals.validado + o.totals.em_lote, o.perLunes),
  };
}

/** Movimentações reais, da mais recente para a mais antiga. */
export function activityRows(o: { lots: LotInfo[]; reserved: InviteMove[]; refunded: InviteMove[]; earned: EarnedMove[]; spent?: InviteMove[]; now: number }, t: Tr = tGlobal): ActivityRow[] {
  const rows: ActivityRow[] = [
    ...o.lots.map(l => ({ icon: 'swap_vert' as IconName, title: t('activity.lot', { id: l.id.replace(/^lote-/, '') }), at: l.closedAt * 1000, status: t('activity.lot.status'), value: `+${lunes2(l.lunes)}` })),
    ...o.reserved.map(r => ({ icon: 'waving_hand' as IconName, title: t('activity.inviteTo', { name: r.to }), at: r.at, status: t('activity.reserved24'), value: `−${lunes2(r.amt)}` })),
    ...o.refunded.map(r => ({ icon: 'undo' as IconName, title: t('activity.inviteRefunded', { name: r.to }), at: r.at, status: t('activity.noReply24'), value: `+${lunes2(r.amt)}` })),
    ...o.earned.map(e => ({ icon: 'waving_hand' as IconName, title: t('activity.inviteAccepted', { name: e.from }), at: e.at, status: t('activity.toReceive'), value: `+${lunes2(e.amt)}` })),
    // Aceito por quem eu convidei: o valor é dela. Só registro local enquanto o convite não é pago na Mainnet.
    ...(o.spent ?? []).map(r => ({ icon: 'waving_hand' as IconName, title: t('activity.acceptedYours', { name: r.to }), at: r.at, status: t('activity.paidLocal'), value: `−${lunes2(r.amt)}` })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

/**
 * Etapas do bônus de boas-vindas com o que dá para saber neste aparelho.
 * - "Identidade criada": só com o backup cifrado das chaves feito (sem backup, a identidade se perde
 *   com o aparelho).
 * - "7 dias de uso": dias com entrega confirmada para pelo menos 3 contatos distintos
 *   (messaging/usage.ts), não dias desde a instalação.
 * O pagamento é da Lunes, ainda não ligado.
 */
export function bonusSteps(o: { onboarded: boolean; backupDone: boolean; verifiedContact: boolean; activeDays: number }, t: Tr = tGlobal): [string, number][] {
  const days = Math.min(7, Math.max(0, Math.floor(o.activeDays)));
  return [
    // Conferida pela Lunes na primeira abertura: ainda não existe essa verificação.
    [t('bonus.installVerified'), 0],
    [o.onboarded && !o.backupDone ? t('bonus.identityNoBackup') : t('bonus.identity'), o.onboarded && o.backupDone ? 100 : 0],
    [t('bonus.oneContact'), o.verifiedContact ? 100 : 0],
    [t('bonus.sevenDays', { days }), Math.round((days / 7) * 100)],
  ];
}

/** Convites aceitos (registro local de quem entrou em contato pelo meu QR/link). `at` em ms. */
export interface AcceptedRow { contactId: string; name: string; via: 'public' | 'anon'; at: number }

/**
 * Contadores da distribuição. `accepted`: quantas pessoas usaram meu convite; `thisMonth`: no mês
 * local de `now` (o limite mensal da proposta). Ativos e pagos dependem da Lunes: nenhum ainda.
 */
export function referralStats(list: AcceptedRow[], now: number): { accepted: number; thisMonth: number; paid: number; earned: number } {
  const n = new Date(now);
  const thisMonth = list.filter(a => { const d = new Date(a.at); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }).length;
  return { accepted: list.length, thisMonth, paid: 0, earned: 0 };
}

/**
 * Última leitura do saldo na Lunes Mainnet, guardada no aparelho (cifrada, via persist) para mostrar
 * sem rede. Valores em planck (texto, para não perder precisão: 1 LUNES = 10^8 planck).
 */
export interface OnchainSnapshot {
  address: string; exists: boolean; free: string; reserved: string; frozen: string;
  block: number; blockHash: string; endpoint: string;
  /** Quando foi lido (ms). */
  at: number;
}
export type OnchainStatus = { state: 'idle' | 'loading' | 'ok' } | { state: 'error'; error: string };

export interface OnchainView {
  /** Selo ao lado do título "Carteira". */
  pill: string; pillIcon: IconName;
  /** Linha sob o saldo, com bloco, endereço que respondeu e horário. */
  line: string;
  /** Há leitura para mostrar (mesmo antiga). */
  has: boolean;
  /** A leitura mostrada é de antes (sem rede agora). */
  stale: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "às 14:32" (hoje) ou "em 28 out, 14:32". */
export function whenLabel(ms: number, now: number, t: Tr = tGlobal): string {
  const d = new Date(ms);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const day = dayLabel(ms, now, t);
  return day === t('day.today') ? t('when.today', { hm }) : t('when.onDay', { day: day.toLowerCase(), hm });
}
export const blockLabel = (n: number) => `#${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
export const endpointHost = (url: string) => url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');

/** O que a carteira diz sobre a leitura da Mainnet, sem inventar: sem leitura, diz que não há. */
/**
 * Linha única sob o saldo no cartão (design: "+ 60,00 a liberar · bônus em validação"): com leitura recente,
 * a dos créditos a liberar; sem leitura ou com leitura antiga, a do estado da Mainnet (o número não é ao vivo).
 */
export const balanceCardLine = (view: Pick<OnchainView, 'has' | 'stale' | 'line'>, release: string) => (!view.has || view.stale ? view.line : release);

export function onchainView(o: { address: string | null; snap: OnchainSnapshot | null; status: OnchainStatus; now: number }, t: Tr = tGlobal): OnchainView {
  if (!o.address) return { pill: t('onchain.pill.noAddress'), pillIcon: 'cloud_off', line: t('onchain.line.noAddress'), has: false, stale: false };
  const snap = o.snap && o.snap.address === o.address ? o.snap : null;
  if (!snap) {
    if (o.status.state === 'error') return { pill: t('onchain.pill.offline'), pillIcon: 'cloud_off', line: t('onchain.line.neverRead', { error: o.status.error }), has: false, stale: false };
    return { pill: t('onchain.pill.loading'), pillIcon: 'cloud', line: t('onchain.line.loading'), has: false, stale: false };
  }
  const when = t('wallet.moves.updated', { when: whenLabel(snap.at, o.now, t) });
  const where = `${t('wallet.block')} ${blockLabel(snap.block)} · ${endpointHost(snap.endpoint)}`;
  if (o.status.state === 'error') return { pill: t('onchain.pill.offline'), pillIcon: 'cloud_off', line: t('onchain.line.stale', { where, when }), has: true, stale: true };
  const tail = o.status.state === 'loading' ? t('wallet.moves.updating') : when;
  return { pill: t('onchain.pill.block', { block: blockLabel(snap.block) }), pillIcon: 'cloud', line: t('onchain.line.ok', { where, tail }), has: true, stale: false };
}
