/**
 * Regras de tela da transferência pela malha (Piu 11: N8 Enviar sem internet, N8a–b, N9 Em trânsito,
 * N9a atividade, N9b o que um gateway informa, N9c recusa informada, N9d bloqueio de gasto duplo).
 * Sem React e sem texto (testado em __tests__/piu11View.test.ts). Regras de envio em lib/walletCarry.ts
 * (docs/carteira/transacoes-pela-malha.md): o recibo de um gateway é DICA; "Confirmada" só com a leitura
 * da Mainnet feita pelo próprio aparelho.
 */
import { formatLunes } from './lunesRpc';
import { CARRY_FEE_MARGIN, OFFLINE_CONTEXT_MAX_AGE_MS } from './walletCarry';
import type { WalletTransferRecord } from './walletTransfer';

const DAY_MS = 86_400_000;
/** "25" no lugar de "25,00" (valor grande do N8/N9 e da atividade, como no protótipo). */
export const wholeLunes = (planck: string | bigint) => formatLunes(BigInt(planck)).replace(/,00$/, '');
export const readingAgeDays = (at: number, now: number) => Math.max(0, Math.floor((now - at) / DAY_MS));

/**
 * O que a folha Enviar mostra:
 * - `inTransit` (N9d): uma transferência ainda está a caminho; nada novo sai (evita gastar duas vezes);
 * - `online`: com rede, o envio normal (aprovado, sem mudança);
 * - `unavailable`: sem rede e sem malha neste aparelho (o mensageiro não abriu);
 * - `noReading` / `stale` (N8a): sem leitura da rede, ou mais velha que 7 dias;
 * - `mesh` (N8): dá para assinar aqui e soltar na malha (`days`: idade da leitura).
 */
export type MeshMode = { kind: 'inTransit' } | { kind: 'online' } | { kind: 'unavailable' } | { kind: 'noReading' } | { kind: 'stale'; days: number } | { kind: 'mesh'; days: number };
export function meshModeOf(o: { offline: boolean; inTransit: boolean; ctxAt: number | null; now: number; bridge: boolean }): MeshMode {
  if (o.inTransit) return { kind: 'inTransit' };
  if (!o.offline) return { kind: 'online' };
  if (!o.bridge) return { kind: 'unavailable' };
  if (o.ctxAt === null) return { kind: 'noReading' };
  if (o.now - o.ctxAt > OFFLINE_CONTEXT_MAX_AGE_MS) return { kind: 'stale', days: readingAgeDays(o.ctxAt, o.now) };
  return { kind: 'mesh', days: readingAgeDays(o.ctxAt, o.now) };
}

/** Sem internet a taxa vai com folga (o dobro da última lida, `CARRY_FEE_MARGIN`): N8 "Taxa estimada · com folga", N8b. */
export function meshFunds(o: { value: bigint; fee: bigint; available: bigint }) {
  const fee = o.fee * CARRY_FEE_MARGIN;
  const total = o.value + fee;
  return { ok: total <= o.available, fee, total, have: o.available, need: total };
}

const enteredMesh = (r: WalletTransferRecord) => !!r.carried && !/^0+$/.test(r.carried.envelopeId) && !r.error;

export type TransitKey = 'signed' | 'mesh' | 'gateway' | 'confirmed';
export type TransitNote = 'meshError' | 'waiting' | 'pool' | 'included' | 'finalized' | 'invalid' | 'error';
export interface TransitStep { key: TransitKey; state: 'done' | 'current' | 'pending' | 'failed'; at?: number; note?: TransitNote }
/**
 * Etapas do N9: assinada neste celular → na malha → o que um gateway informou (não conferido) →
 * confirmada (leitura do próprio aparelho). O número de aparelhos por onde passou não existe no
 * protocolo (o envelope não conta saltos): a etapa "Na malha" mostra só a hora em que saiu daqui.
 */
export function transitSteps(r: WalletTransferRecord): TransitStep[] {
  const signed: TransitStep = { key: 'signed', state: 'done', at: r.createdAt };
  const settled = r.status === 'finalized' || r.status === 'failed';
  if (settled) {
    return [signed, { key: 'mesh', state: 'done', at: r.carried?.at }, { key: 'gateway', state: 'done', at: r.carried?.report?.at },
      { key: 'confirmed', state: r.status === 'finalized' ? 'done' : 'failed', at: r.updatedAt }];
  }
  if (!enteredMesh(r)) return [signed, { key: 'mesh', state: 'current', note: 'meshError' }, { key: 'gateway', state: 'pending' }, { key: 'confirmed', state: 'pending' }];
  const rep = r.carried!.report;
  return [signed, { key: 'mesh', state: 'done', at: r.carried!.at },
    rep ? { key: 'gateway', state: 'current', at: rep.at, note: rep.status } : { key: 'gateway', state: 'current', note: 'waiting' },
    { key: 'confirmed', state: 'pending' }];
}

/** Selo do N9 e linha da atividade (N9a). */
export type TransitPill = 'traveling' | 'reported' | 'refused' | 'meshError' | 'confirmed' | 'failed';
export function transitPill(r: WalletTransferRecord): TransitPill {
  if (r.status === 'finalized') return 'confirmed';
  if (r.status === 'failed') return 'failed';
  if (!enteredMesh(r)) return 'meshError';
  const s = r.carried?.report?.status;
  if (s === 'invalid') return 'refused';
  if (s === 'pool' || s === 'included' || s === 'finalized') return 'reported';
  return 'traveling';
}

/** N9b: o que um gateway pode dizer (nada conferido) e a única etapa conferida pelo próprio aparelho. */
export const gatewayRows = () => ([
  { key: 'pool', verified: false }, { key: 'included', verified: false }, { key: 'finalized', verified: false }, { key: 'invalid', verified: false }, { key: 'confirmed', verified: true },
] as const);
