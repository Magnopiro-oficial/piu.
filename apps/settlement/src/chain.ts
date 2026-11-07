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
  /**
   * Transferência de LUNES (`balances.transferKeepAlive` / `transferAllowDeath` / `transfer`) com
   * este hash no bloco finalizado `block`, ou `null` se não está lá (ou o bloco ainda não finalizou).
   * Só leitura: usada para conferir a caução dos celulares (bond.ts).
   */
  transferOf(hash: string, block: number): Promise<TransferInfo | null>;
}

/** Transferência lida da chain. `ok`: executou (ExtrinsicSuccess). `at`: horário do bloco (s). */
export interface TransferInfo { from: string; to: string; amount: bigint; ok: boolean; blockNumber: number; at: number }

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
  /**
   * Hash de gênese da Lunes Mainnet (`chain_getBlockHash(0)`, docs/carteira/proposta-carteira-propria.md;
   * o mesmo de apps/mobile/src/lib/walletTransfer.ts). Um nó RPC de outra rede, ou que mente sobre qual
   * rede é, é recusado antes de assinar (auditoria final, M-3 / B-06).
   */
  genesisHash: '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac',
};

/**
 * Gênese esperada: a da Mainnet, ou a de uma rede de desenvolvimento declarada de propósito em
 * `PIU_SETTLEMENT_GENESIS` (hex de 32 bytes).
 */
export function expectedGenesis(env: NodeJS.ProcessEnv = process.env): string {
  const g = env.PIU_SETTLEMENT_GENESIS?.trim().toLowerCase();
  if (!g) return EXPECTED.genesisHash;
  if (!/^0x[0-9a-f]{64}$/.test(g)) throw new Error('PIU_SETTLEMENT_GENESIS: use o hash de gênese em hex (0x + 64).');
  return g;
}

/**
 * Endereços do nó RPC: só `wss://`, e `ws://` apenas para este computador (rede de desenvolvimento).
 * Um `ws://` pela rede deixaria qualquer um no caminho trocar as respostas (finalização, nonce).
 */
export function checkEndpoints(list: string[]): string[] {
  for (const u of list) {
    let url: URL;
    try { url = new URL(u); } catch { throw new Error(`Endereço do nó inválido: ${u}`); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)) throw new Error(`Use wss:// para o nó (${u}); ws:// só em localhost.`);
  }
  return list;
}

/** Diferenças entre a chain e o esperado: lista vazia = pode liquidar. */
export function preflight(info: ChainInfo, genesis: string = EXPECTED.genesisHash): string[] {
  const p: string[] = [];
  if (info.genesisHash?.toLowerCase() !== genesis.toLowerCase()) p.push(`gênese ${info.genesisHash} (esperada ${genesis})`);
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
