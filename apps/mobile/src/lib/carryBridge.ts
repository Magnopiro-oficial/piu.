/**
 * Ponte entre a carteira (state/wallet.tsx) e o mensageiro (state/messaging.tsx) para a carga pela malha:
 * o MessagingProvider fica DENTRO do WalletProvider, então a carteira não enxerga o mensageiro. O
 * mensageiro registra quem solta a carga e repassa os recibos; a carteira só chama `carry` e escuta.
 * Sem React, testável no Node.
 */
import type { CarryItem, CarryReceipt } from '../protocol/carry';

export type Carrier = (item: CarryItem, ref: string) => { envelopeId: string; expiresAt: number };
type Listener = (envelopeId: string, rc: CarryReceipt) => void;

let carrier: Carrier | null = null;
const listeners = new Set<Listener>();

export const carryBridge = {
  /** O mensageiro está pronto (chaves carregadas) e aceita cargas? */
  available: () => carrier !== null,
  setCarrier(c: Carrier | null) { carrier = c; },
  /** Solta a carga na malha. Lança se o mensageiro ainda não subiu. */
  carry(item: CarryItem, ref: string) {
    if (!carrier) throw new Error('A malha ainda não está pronta neste aparelho.');
    return carrier(item, ref);
  },
  onReceipt(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  receipt(envelopeId: string, rc: CarryReceipt) { for (const fn of [...listeners]) { try { fn(envelopeId, rc); } catch { /* um ouvinte com erro não derruba os outros */ } } },
};
