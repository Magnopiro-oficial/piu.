/**
 * Chain simulada com as regras que importam para não pagar duas vezes: nonce por conta (cada nonce
 * executa uma vez), era mortal (fora da validade, a transação não entra), finalização por bloco,
 * `batchAll` tudo ou nada e reenvio dos mesmos bytes.
 */
import { createHash } from 'node:crypto';
import type { ChainClient, ChainInfo, SignedLot, TransferInfo, TxOutcome } from '../src/chain.js';
import { EXPECTED, TxRejected } from '../src/chain.js';
import type { PlannedLot } from '../src/lot.js';

interface Pending { hash: string; from: string; nonce: number; validUntil: number; lot: PlannedLot; fee: bigint }

export class FakeChain implements ChainClient {
  head = 100;
  balances = new Map<string, bigint>();
  nonces = new Map<string, number>();
  blocks = new Map<number, { hash: string; ok: boolean; error?: string }[]>();
  pool: Pending[] = [];
  private byHex = new Map<string, Pending>();
  /** Falhas a injetar. */
  dropSubmits = 0;          // o envio "some" (rede caiu) sem entrar no bloco
  failDispatch: string | null = null;
  crashAfterInclude = false;  // a conexão cai depois de a transação entrar (resultado não chega)
  info_: Partial<ChainInfo> = {};
  readonly ed = 500n;

  async info(): Promise<ChainInfo> {
    return { chain: 'Lunes (simulada)', specName: 'lunes-nightly', specVersion: 107, genesisHash: EXPECTED.genesisHash, decimals: 8, symbol: 'LUNES', ss58: 57, existentialDeposit: this.ed, finalized: this.head, ...this.info_ };
  }
  async freeBalance(a: string) { return this.balances.get(a) ?? 0n; }
  async nonce(a: string) { return this.nonces.get(a) ?? 0; }
  async estimateFee(lot: PlannedLot) { return 1000n * BigInt(120 + 40 * lot.payouts.length); }

  async sign(lot: PlannedLot, signer: unknown, nonce: number): Promise<SignedLot> {
    const from = String(signer);
    const fee = await this.estimateFee(lot);
    const hex = `0x${Buffer.from(JSON.stringify({ from, nonce, lot: lot.digest, at: this.head })).toString('hex')}`;
    const hash = `0x${createHash('sha256').update(hex).digest('hex')}`;
    this.byHex.set(hex, { hash, from, nonce, validUntil: this.head + 64, lot, fee });
    return { hash, hex, nonce, fromBlock: this.head, validUntil: this.head + 64, fee };
  }

  /** Produz e finaliza um bloco com o que estiver válido na fila. */
  mine() {
    this.head++;
    const included: { hash: string; ok: boolean; error?: string }[] = [];
    for (const p of this.pool.splice(0)) {
      if (p.validUntil < this.head) continue;                       // venceu: nunca mais entra
      if ((this.nonces.get(p.from) ?? 0) !== p.nonce) continue;      // nonce usado
      this.nonces.set(p.from, p.nonce + 1);
      const bal = this.balances.get(p.from) ?? 0n;
      this.balances.set(p.from, bal - p.fee);
      if (this.failDispatch || bal - p.fee - p.lot.total < this.ed) { included.push({ hash: p.hash, ok: false, error: this.failDispatch ?? 'balances.InsufficientBalance' }); continue; }
      this.balances.set(p.from, bal - p.fee - p.lot.total);
      for (const x of p.lot.payouts) this.balances.set(x.address, (this.balances.get(x.address) ?? 0n) + x.planck);
      included.push({ hash: p.hash, ok: true });
    }
    this.blocks.set(this.head, included);
  }

  async submit(hex: string): Promise<TxOutcome> {
    const p = this.byHex.get(hex);
    if (!p) throw new TxRejected('other', 'bytes desconhecidos');
    if ((this.nonces.get(p.from) ?? 0) > p.nonce) throw new TxRejected('stale', '1010: Invalid Transaction: Transaction is outdated');
    if (this.pool.some(x => x.hash === p.hash)) throw new TxRejected('known', '1013: Transaction Already Imported');
    if (p.validUntil < this.head) throw new TxRejected('other', 'Transaction has an ancient birth block');
    if (this.dropSubmits > 0) { this.dropSubmits--; throw new TxRejected('other', 'conexão perdida'); }
    this.pool.push(p);
    this.mine();
    if (this.crashAfterInclude) { this.crashAfterInclude = false; throw new TxRejected('other', 'conexão perdida depois do envio'); }
    const r = await this.find(p.hash, this.head, this.head);
    if (!r) throw new TxRejected('other', 'não entrou');
    return r;
  }

  async find(hash: string, from: number, to: number): Promise<TxOutcome | null> {
    for (let n = from; n <= to; n++) {
      const x = this.blocks.get(n)?.find(b => b.hash === hash);
      if (x) return x.ok ? { status: 'finalized', blockHash: `0xb${n}`, blockNumber: n } : { status: 'failed', blockHash: `0xb${n}`, blockNumber: n, error: x.error! };
    }
    return null;
  }

  /** Transferências simples (caução dos celulares): hash → transferência, no bloco dela. */
  transfers = new Map<string, TransferInfo>();
  /** Registra uma transferência finalizada (devolve o hash). `ok: false` = entrou e falhou. */
  addTransfer(from: string, to: string, amount: bigint, o: { ok?: boolean; at?: number } = {}): { txHash: string; block: number } {
    this.head++;
    const txHash = `0x${createHash('sha256').update(`${from}:${to}:${amount}:${this.head}:${this.transfers.size}`).digest('hex')}`;
    this.transfers.set(txHash, { from, to, amount, ok: o.ok ?? true, blockNumber: this.head, at: o.at ?? 0 });
    return { txHash, block: this.head };
  }
  async transferOf(hash: string, block: number): Promise<TransferInfo | null> {
    const t = this.transfers.get(hash);
    return t && t.blockNumber === block && block <= this.head ? { ...t } : null;
  }

  /** Quanto cada carteira recebeu do lote (para conferir pagamento único). */
  paidTo(a: string) { return this.balances.get(a) ?? 0n; }
}
