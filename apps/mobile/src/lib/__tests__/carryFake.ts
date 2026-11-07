/// <reference types="node" />
/**
 * Lunes falsa para os testes da carga pela malha (gateway e carteira): pool, blocos, finalização,
 * validade e nonce controlados pelo teste. Nada vai para a Mainnet.
 */
import { decodeSignedTransfer, IMMORTAL_PERIOD, buildTransferKeepAlive } from '../extrinsic';
import { extrinsicHash, fromHex, LunesRpc } from '../lunesRpc';
import { withWalletKey } from '../walletKey';
import { LUNES_GENESIS_HASH } from '../walletTransfer';
import { accountInfoHex, ALICE_57, fakeSockets, hashOf } from './lunesFake';
import { DEV_MNEMONIC, RANDOM } from './walletFixture';

/** `Ok(ValidTransaction)` mínimo (prioridade, sem tags, longevidade 64, propaga). */
export const VALID = '0x00' + '0000000000000000' + '00' + '00' + '4000000000000000' + '01';
/** `Err(Invalid(Stale))` e `Err(Invalid(Payment))`. */
export const STALE = '0x010003';
export const PAYMENT = '0x010001';

export function fakeLunes() {
  const state = {
    fin: 1000, best: 1000, nonce: 7, free: 1_000_000_000n, fee: 144_000n, spec: 107, tx: 2, genesis: LUNES_GENESIS_HASH,
    validity: VALID, offline: false, submitError: '', blocks: {} as Record<number, string[]>,
    /** Envio entra no próximo bloco (automático, ao avançar `mine`). */
    pool: [] as string[],
  };
  const submissions: string[] = [];
  /** Chamadas por método (o teste confere quantas consultas cada carga gastou). */
  const calls: Record<string, number> = {};
  const byHash = new Map<string, number>();
  const hash = (n: number) => { const h = n === 0 ? state.genesis : hashOf('block ' + n); byHash.set(h, n); return h; };
  const handler = (method: string, params: unknown[]) => {
    calls[method] = (calls[method] ?? 0) + 1;
    if (state.offline) throw new Error('sem rota');
    hash(state.fin); hash(state.best);
    switch (method) {
      case 'chain_getFinalizedHead': return { result: hash(state.fin) };
      case 'chain_getHeader': return { result: { number: '0x' + (params[0] ? byHash.get(params[0] as string)! : state.best).toString(16) } };
      case 'chain_getBlockHash': { const n = params[0] as number; return { result: n > state.best ? null : hash(n) }; }
      case 'chain_getBlock': { const n = byHash.get(params[0] as string); return { result: n === undefined ? null : { block: { extrinsics: state.blocks[n] ?? [] } } }; }
      case 'state_getStorage': return { result: accountInfoHex({ nonce: state.nonce, free: state.free }) };
      case 'state_getRuntimeVersion': return { result: { specVersion: state.spec, transactionVersion: state.tx } };
      case 'system_accountNextIndex': return { result: state.nonce };
      case 'payment_queryInfo': return { result: { partialFee: state.fee.toString(), class: 'Normal' } };
      case 'state_call': return { result: state.validity };
      case 'author_submitExtrinsic': {
        const x = (params[0] as string).toLowerCase();
        submissions.push(x);
        if (state.submitError) return { error: { code: 1013, message: state.submitError } };
        if (!state.pool.includes(x)) state.pool.push(x);
        return { result: extrinsicHash(fromHex(x)) };
      }
      default: return { error: { code: -32601, message: method } };
    }
  };
  const factory = fakeSockets({ 'ws://lunes': 'ok' }, (m, p) => { try { return handler(m, p); } catch (e) { return { error: { code: -1, message: (e as Error).message } }; } });
  const rpc = () => new LunesRpc({ endpoints: ['ws://lunes'], connect: factory.connect, timeoutMs: 3000 });
  /** Produz `n` blocos; o primeiro leva o pool. `finalize`: o finalizado acompanha. */
  const mine = (n = 1, finalize = true) => {
    for (let i = 0; i < n; i++) {
      state.best++;
      if (state.pool.length) {
        state.blocks[state.best] = state.pool.splice(0);
        // Cada transação incluída consome o nonce (a de teste é sempre da mesma conta).
        state.nonce += state.blocks[state.best]!.length;
      }
      if (finalize) state.fin = state.best;
    }
  };
  return { state, submissions, calls, rpc, mine, hash };
}

/** Transferência assinada imortal da conta dev (nonce dado), como a carteira leva pela malha. */
export function signedCarried(nonce = 7, value = 100_000_000n) {
  return withWalletKey(DEV_MNEMONIC.split(' '), key => buildTransferKeepAlive(key, {
    dest: ALICE_57, value, random: fromHex(RANDOM),
    ctx: { specVersion: 107, transactionVersion: 2, genesisHash: LUNES_GENESIS_HASH, blockHash: LUNES_GENESIS_HASH, blockNumber: 1000, nonce, tip: 0n, period: IMMORTAL_PERIOD },
  }));
}
export { decodeSignedTransfer };
