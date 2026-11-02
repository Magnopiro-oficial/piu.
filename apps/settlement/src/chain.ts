/**
 * O que o liquidante precisa da chain, separado da biblioteca (polkadot.ts) para testar a lógica
 * sem nó (test/fake-chain.ts) e para trocar de cliente sem mexer nas regras.
 */
import type { PlannedLot } from './lot.js';

export interface ChainInfo {
  chain: string;
  specName: string;
  specVersion: number;
  genesisHash: string;
  decimals: number;
  symbol: string;
  ss58: number;
  existentialDeposit: bigint;
  finalized: number;
}

/** Transação do lote assinada e ainda não enviada: os bytes exatos que vão (e voltam) para a chain. */
export interface SignedLot {
  hash: string;
  hex: string;
  nonce: number;
  /** Bloco a partir do qual vale e último bloco em que ainda pode entrar (era mortal). */
  fromBlock: number;
  validUntil: number;
  fee: bigint;
}

export type TxOutcome =
  | { status: 'finalized'; blockHash: string; blockNumber: number }
  | { status: 'failed'; blockHash: string; blockNumber: number; error: string };

export interface ChainClient {
  info(): Promise<ChainInfo>;
  freeBalance(address: string): Promise<bigint>;
  /** Próximo nonce da conta (inclui o que está na fila do nó). */
  nonce(address: string): Promise<number>;
  /** Taxa estimada da transação do lote (sem assinar de verdade). */
  estimateFee(lot: PlannedLot, from: string): Promise<bigint>;
  /** Monta `utility.batchAll(transferências + remark)` e assina com era mortal. Não envia. */
  sign(lot: PlannedLot, signer: unknown, nonce: number): Promise<SignedLot>;
  /** Envia os bytes assinados e espera finalizar (ou falhar). Reenviar os mesmos bytes é seguro. */
  submit(hex: string): Promise<TxOutcome>;
  /** Procura a transação pelo hash nos blocos finalizados [from, to]. */
  find(hash: string, from: number, to: number): Promise<TxOutcome | null>;
}

/** O que o código do lunes-nightly diz (dez/2025). `mainnet:check` confere contra o nó ao vivo. */
export const EXPECTED = {
  specName: 'lunes-nightly',
  decimals: 8,
  symbol: 'LUNES',
  /** O chain spec da Mainnet declara 57; o runtime e o explorador usam 42. Aceitamos os dois na entrada. */
  ss58: [57, 42],
  existentialDeposit: 500n,
  /** Taxa por byte (`TransactionByteFee` = 1 NANOUNIT). A parte por peso é zero no runtime (`1 / 100` inteiro). */
  byteFee: 1000n,
  blockMs: 6000,
};

/** Diferenças entre a chain e o esperado: lista vazia = pode liquidar. */
export function preflight(info: ChainInfo): string[] {
  const p: string[] = [];
  if (info.specName !== EXPECTED.specName) p.push(`runtime "${info.specName}" (esperado "${EXPECTED.specName}")`);
  if (info.decimals !== EXPECTED.decimals) p.push(`${info.decimals} casas decimais (esperado ${EXPECTED.decimals})`);
  if (info.symbol !== EXPECTED.symbol) p.push(`símbolo ${info.symbol} (esperado ${EXPECTED.symbol})`);
  return p;
}

/**
 * O nó não aceitou os bytes enviados. `known`: já estão na fila ou num bloco; `stale`: o nonce já foi
 * usado (a transação, ou outra com o mesmo nonce, já entrou); `other`: inválida, sem conexão etc.
 */
export class TxRejected extends Error {
  constructor(readonly kind: 'known' | 'stale' | 'other', message: string) { super(message); }
}
