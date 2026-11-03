/**
 * Cliente da Lunes Mainnet (Substrate) com @polkadot/api, a mesma biblioteca do explorador
 * (lunes-platform/blockexplorer-ui). As chamadas e os índices vêm dos metadados do próprio nó, não
 * estão fixos aqui.
 *
 * Endereços de produção informados pela Lunes, nesta ordem (o WsProvider passa ao seguinte quando um
 * falha). Explorador: https://blockexplorer.lunes.io/. Outros endereços: `--ws` ou PIU_SETTLEMENT_WS.
 */
import '@polkadot/api-augment';
import { ApiPromise, WsProvider } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { ChainClient, ChainInfo, SignedLot, TxOutcome } from './chain.js';
import { TxRejected } from './chain.js';
import type { PlannedLot } from './lot.js';

export const MAINNET_ENDPOINTS = [
  'wss://ws.lunes.io',
  'wss://ws-lunes-main-01.lunes.io',
  'wss://ws-lunes-main-02.lunes.io',
  // Nó de arquivo: guarda o estado de blocos antigos (útil para conferir um lote pago há tempo).
  'wss://ws-archive.lunes.io',
];

/** Validade da transação: 64 blocos (~6,4 min com blocos de 6 s). Depois disso ela nunca mais entra. */
export const ERA_PERIOD = 64;

export async function connect(endpoints: string[], timeoutMs = 30_000): Promise<ApiPromise> {
  const provider = new WsProvider(endpoints, 2500, {}, timeoutMs);
  try {
    return await Promise.race([
      ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), timeoutMs).unref()),
    ]);
  } catch (e) {
    await provider.disconnect().catch(() => {});
    const why = e instanceof Error ? e.message : 'conexão recusada ou bloqueada';
    throw new Error(`Não conectou à Lunes (${endpoints.join(', ')}): ${why}. Confira a rede (domínios liberados) e os endereços (--ws).`);
  }
}

type Tx = SubmittableExtrinsic<'promise'>;

export class PolkadotChain implements ChainClient {
  constructor(readonly api: ApiPromise) {}

  async info(): Promise<ChainInfo> {
    const api = this.api;
    const [chain, head] = await Promise.all([api.rpc.system.chain(), api.rpc.chain.getFinalizedHead()]);
    const header = await api.rpc.chain.getHeader(head);
    return {
      chain: chain.toString(),
      specName: api.runtimeVersion.specName.toString(),
      specVersion: api.runtimeVersion.specVersion.toNumber(),
      genesisHash: api.genesisHash.toHex(),
      decimals: api.registry.chainDecimals[0] ?? 0,
      symbol: api.registry.chainTokens[0] ?? '',
      ss58: api.registry.chainSS58 ?? 42,
      existentialDeposit: BigInt(api.consts.balances.existentialDeposit.toString()),
      finalized: header.number.toNumber(),
    };
  }

  async freeBalance(address: string): Promise<bigint> {
    const acc = await this.api.query.system.account(address);
    return BigInt(acc.data.free.toString());
  }

  async nonce(address: string): Promise<number> {
    return (await this.api.rpc.system.accountNextIndex(address)).toNumber();
  }

  /** `utility.batchAll`: tudo ou nada. `transferKeepAlive` não deixa a conta pagadora sumir. */
  build(lot: PlannedLot): Tx {
    const tx = this.api.tx;
    return tx.utility.batchAll([
      ...lot.payouts.map(p => tx.balances.transferKeepAlive(p.address, p.planck)),
      tx.system.remarkWithEvent(lot.remark),
    ]);
  }

  async estimateFee(lot: PlannedLot, from: string): Promise<bigint> {
    const info = await this.build(lot).paymentInfo(from);
    return BigInt(info.partialFee.toString());
  }

  async sign(lot: PlannedLot, signer: unknown, nonce: number): Promise<SignedLot> {
    const pair = signer as KeyringPair;
    const head = await this.api.rpc.chain.getFinalizedHead();
    const header = await this.api.rpc.chain.getHeader(head);
    const current = header.number.toNumber();
    const tx = this.build(lot);
    const fee = BigInt((await tx.paymentInfo(pair.address)).partialFee.toString());
    await tx.signAsync(pair, { nonce, blockHash: head, era: this.api.createType('ExtrinsicEra', { current, period: ERA_PERIOD }) });
    return { hash: tx.hash.toHex(), hex: tx.toHex(), nonce, fromBlock: current, validUntil: current + ERA_PERIOD, fee };
  }

  submit(hex: string): Promise<TxOutcome> {
    const tx = this.api.tx(hex) as Tx;
    return new Promise((resolve, reject) => {
      let unsub: (() => void) | undefined;
      tx.send(result => {
        const s = result.status;
        if (s.isDropped || s.isInvalid || s.isUsurped) { unsub?.(); reject(new TxRejected('other', `Transação ${s.type} pelo nó.`)); return; }
        if (!s.isFinalized) return;
        unsub?.();
        const blockHash = s.asFinalized.toHex();
        void this.api.rpc.chain.getHeader(blockHash).then(h => {
          const blockNumber = h.number.toNumber();
          if (result.dispatchError) resolve({ status: 'failed', blockHash, blockNumber, error: this.describe(result.dispatchError) });
          else resolve({ status: 'finalized', blockHash, blockNumber });
        }, reject);
      }).then(u => { unsub = u; }, (err: Error) => {
        const m = String(err?.message ?? err);
        // 1013 "Transaction Already Imported", 1014 "Priority is too low", 1010 "Transaction is outdated" (nonce usado)
        if (/1013|already imported|1014|priority is too low/i.test(m)) reject(new TxRejected('known', m));
        else if (/outdated|stale|1010/i.test(m)) reject(new TxRejected('stale', m));
        else reject(new TxRejected('other', m));
      });
    });
  }

  async find(hash: string, from: number, to: number): Promise<TxOutcome | null> {
    for (let n = to; n >= Math.max(0, from); n--) {
      const blockHash = await this.api.rpc.chain.getBlockHash(n);
      const block = await this.api.rpc.chain.getBlock(blockHash);
      const index = block.block.extrinsics.findIndex(x => x.hash.toHex() === hash);
      if (index < 0) continue;
      const events = await (await this.api.at(blockHash)).query.system.events();
      for (const { phase, event } of events) {
        if (!phase.isApplyExtrinsic || phase.asApplyExtrinsic.toNumber() !== index) continue;
        if (this.api.events.system.ExtrinsicSuccess.is(event)) return { status: 'finalized', blockHash: blockHash.toHex(), blockNumber: n };
        if (this.api.events.system.ExtrinsicFailed.is(event)) {
          return { status: 'failed', blockHash: blockHash.toHex(), blockNumber: n, error: this.describe(event.data[0]) };
        }
      }
    }
    return null;
  }

  private describe(err: { isModule?: boolean; asModule?: unknown; toString(): string }): string {
    if (err.isModule) {
      try { const d = this.api.registry.findMetaError(err.asModule as never); return `${d.section}.${d.name}`; } catch { /* abaixo */ }
    }
    return err.toString();
  }

  /** Tempo médio de bloco medido nos últimos `n` blocos finalizados (ms). */
  async measuredBlockMs(n = 20): Promise<number> {
    const head = (await this.api.rpc.chain.getHeader(await this.api.rpc.chain.getFinalizedHead())).number.toNumber();
    const at = async (b: number) => BigInt((await (await this.api.at(await this.api.rpc.chain.getBlockHash(b))).query.timestamp.now()).toString());
    const [a, z] = await Promise.all([at(Math.max(1, head - n)), at(head)]);
    return Number(z - a) / Math.min(n, head - 1);
  }
}
