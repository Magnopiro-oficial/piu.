/**
 * Créditos de rede deste aparelho (FUN-018, seção 11), sem servidor:
 * - Recibo: o roteador assina um recibo (chave técnica do nó) ao repassar um envelope de TERCEIROS.
 * - Prova de entrega: o destino revela o `ackSecret` (estava dentro do conteúdo cifrado e não diz quem
 *   é o destino); a prova circula pela malha. hash(segredo) = ackHash do envelope ⇒ entrega comprovada.
 * - Estados: pendente → validado (com prova) ou rejeitado (sem prova até vencer, duplicata, teto
 *   diário); validado → pago quando o lote da semana fecha.
 * - Valor ESTIMADO: créditos por entrega conforme o tamanho e o meio (proposta econômica, valores
 *   PROVISÓRIOS para teste), DIVIDIDOS entre os relays da entrega, como no validador (seção 3.2);
 *   100 créditos = 1 LUNES (texto do design). O aparelho só conhece os relays até ele (pelo contador
 *   de saltos), então a estimativa é um teto. O teto de 2% do orçamento por nó e por época não entra
 *   aqui: o orçamento da época é da Lunes e não chega ao aparelho. O valor final é o do validador.
 * - Validade: validado e não liquidado em 180 dias expira (seção 3.4) e fica 30 dias na lista.
 *
 * LOTE SEM PAGAMENTO: o app já lê a Lunes Mainnet (lib/lunesRpc.ts: saldo, blocos), mas não paga
 * lotes. O pagamento é da liquidação (apps/settlement), ainda não ligada ao app; um lote fechado aqui
 * fica só registrado neste aparelho, e a tela diz "aguardando liquidação".
 */
import { equal, toHex } from '../protocol/bytes';
import { type RelayReceipt, verifyRelayReceipt } from '../protocol/receipts';
import type { TransportClass } from '../protocol/router';
import { hash } from '../protocol/suite';
import { b64url, unb64url } from './card';

export type CreditState = 'pendente' | 'validado' | 'rejeitado' | 'pago';

/** Parâmetros PROVISÓRIOS (docs/economia/proposta-modelo-economico.md, seção 3), para teste. */
export const CREDIT_PARAMS = {
  /** Créditos por entrega comprovada, pelo tamanho do envelope. */
  sizeWeight: (bytes: number) => (bytes <= 512 ? 1 : bytes <= 1300 ? 1.2 : bytes <= 4300 ? 1.5 : bytes <= 16_500 ? 2 : 2.5),
  /** Multiplicador por meio (LoRa vale mais; ainda não há adapter LoRa). */
  mediumWeight: (via: TransportClass) => (via === 'lora' ? 1.5 : 1),
  creditsPerLunes: 100,
  /** Teto de recibos por dia por nó (antifraude). */
  maxPerDay: 5000,
  /** Mínimo para entrar num lote (5 LUNES); abaixo disso, passa para a semana seguinte. */
  minLotLunes: 5,
  /** Sem prova até este tempo depois do vencimento do envelope: rejeitado. */
  proofGraceSec: 3600,
  /** Teto de relays por envelope (o mesmo do validador, `maxRelaysPerEnvelope`). */
  maxRelays: 8,
  /** Validado e não liquidado expira depois disto (proposta, seção 3.4 [decidir]; validador: 180 dias). */
  validitySec: 180 * 86400,
  /** Quanto tempo o expirado continua na lista antes de sair do aparelho. */
  keepExpiredSec: 30 * 86400,
  /** Pendentes, rejeitados e pagos ficam guardados por este tempo. */
  keepSec: 90 * 86400,
};

const EXPIRED_REASON = 'expirou: 180 dias sem liquidação';

export interface Credit {
  envelopeId: string; at: number; expiresAt: number; bytes: number; via: TransportClass;
  /** Estimativa: peso da entrega ÷ `relays`. */
  credits: number; state: CreditState; reason?: string; lot?: string;
  /** Relays da entrega que este aparelho conhece (ele e os anteriores); a unidade é dividida por eles. */
  relays?: number;
  /** Quando expirou sem liquidação (s). */
  expiredAt?: number;
  receipt: { ackHash: string; nodePk: string; sig: string };
}
export interface Lot { id: string; closedAt: number; credits: number; lunes: number; count: number; simulated: true }

/** Semana (segunda a domingo, hora local) como `AAAA-Sn`. */
export function weekOf(sec: number): string {
  const d = new Date(sec * 1000);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-S${String(n).padStart(2, '0')}`;
}

export class CreditBook {
  private credits = new Map<string, Credit>();
  lots: Lot[] = [];

  constructor(state?: string) {
    if (!state) return;
    const j = JSON.parse(state) as { c: Credit[]; l: Lot[] };
    for (const c of j.c ?? []) this.credits.set(c.envelopeId, c);
    this.lots = j.l ?? [];
  }

  list() { return [...this.credits.values()].sort((a, b) => b.at - a.at); }
  get(envelopeId: string) { return this.credits.get(envelopeId); }

  /** Totais por estado (créditos). */
  totals(): Record<CreditState, number> {
    const t: Record<CreditState, number> = { pendente: 0, validado: 0, rejeitado: 0, pago: 0 };
    for (const c of this.credits.values()) t[c.state] += c.credits;
    return t;
  }

  /**
   * Recibo novo do meu roteador (envelope de terceiro que eu repassei). `relays`: quantos relays a
   * entrega teve até mim, contando comigo (pelo contador de saltos do envelope); a unidade é dividida
   * entre eles, como no validador.
   */
  addReceipt(r: RelayReceipt, h: { bytes: number; expiresAt: number; relays?: number }, via: TransportClass) {
    if (this.credits.has(r.envelopeId) || !verifyRelayReceipt(r)) return;
    const day = Math.floor(r.at / 86400);
    const today = [...this.credits.values()].filter(c => Math.floor(c.at / 86400) === day).length;
    const relays = Math.min(CREDIT_PARAMS.maxRelays, Math.max(1, Math.floor(h.relays ?? 1)));
    const credits = Math.round((CREDIT_PARAMS.sizeWeight(h.bytes) * CREDIT_PARAMS.mediumWeight(via) / relays) * 100) / 100;
    const base = { envelopeId: r.envelopeId, at: r.at, expiresAt: h.expiresAt, bytes: h.bytes, via, credits, relays, receipt: { ackHash: toHex(r.ackHash), nodePk: b64url(r.nodePk), sig: b64url(r.sig) } };
    this.credits.set(r.envelopeId, today >= CREDIT_PARAMS.maxPerDay ? { ...base, state: 'rejeitado', reason: 'teto diário do nó' } : { ...base, state: 'pendente' });
  }

  /** Prova de entrega: valida o crédito se hash(segredo) bate com o ackHash do recibo. */
  applyProof(envelopeId: string, ackSecret: Uint8Array): boolean {
    const c = this.credits.get(envelopeId);
    if (!c || c.state !== 'pendente') return false;
    if (!equal(hash(ackSecret).slice(0, 16), Uint8Array.from(c.receipt.ackHash.match(/../g)!.map(x => parseInt(x, 16))))) return false;
    c.state = 'validado';
    return true;
  }

  /**
   * Rotina periódica: rejeita pendentes sem prova depois do vencimento e fecha os lotes das semanas
   * anteriores (carência de uma semana: o que foi validado na semana S entra no lote quando S+1 termina).
   */
  tick(now: number): { changed: boolean; lot?: Lot } {
    let changed = false;
    for (const c of this.credits.values()) {
      if (c.state === 'pendente' && now > c.expiresAt + CREDIT_PARAMS.proofGraceSec) { c.state = 'rejeitado'; c.reason = 'sem prova de entrega até vencer'; changed = true; }
      // Validado que não entrou em lote em 180 dias: expira (não acumula passivo eterno).
      if (c.state === 'validado' && now - c.at > CREDIT_PARAMS.validitySec) { c.state = 'rejeitado'; c.reason = EXPIRED_REASON; c.expiredAt = now; changed = true; }
    }
    const thisWeek = weekOf(now);
    const lastWeek = weekOf(now - 7 * 86400);
    const due = [...this.credits.values()].filter(c => c.state === 'validado' && weekOf(c.at) < lastWeek);
    const sum = due.reduce((a, c) => a + c.credits, 0);
    const lotId = `lote-${thisWeek}`;
    if (due.length && sum >= CREDIT_PARAMS.minLotLunes * CREDIT_PARAMS.creditsPerLunes && !this.lots.some(l => l.id === lotId)) {
      for (const c of due) { c.state = 'pago'; c.lot = lotId; }
      const lot: Lot = { id: lotId, closedAt: now, credits: Math.round(sum * 10) / 10, lunes: Math.round((sum / CREDIT_PARAMS.creditsPerLunes) * 100) / 100, count: due.length, simulated: true };
      this.lots.unshift(lot);
      return { changed: true, lot };
    }
    return { changed };
  }

  /** Recibo restaurado (para conferir assinatura em auditoria). */
  receiptOf(c: Credit): RelayReceipt {
    return { envelopeId: c.envelopeId, at: c.at, ackHash: Uint8Array.from(c.receipt.ackHash.match(/../g)!.map(x => parseInt(x, 16))), nodePk: unb64url(c.receipt.nodePk), sig: unb64url(c.receipt.sig) };
  }

  /**
   * Guarda 90 dias de créditos (validados ainda não pagos: até expirarem, em 180 dias; expirados: mais
   * 30 dias, para aparecerem na lista) e 52 lotes.
   */
  export(now: number): string {
    const keep = [...this.credits.values()].filter(c =>
      c.state === 'validado' ? now - c.at <= CREDIT_PARAMS.validitySec + 86400
        : c.expiredAt ? now - c.expiredAt < CREDIT_PARAMS.keepExpiredSec
          : now - c.at < CREDIT_PARAMS.keepSec);
    return JSON.stringify({ c: keep, l: this.lots.slice(0, 52) });
  }
}
