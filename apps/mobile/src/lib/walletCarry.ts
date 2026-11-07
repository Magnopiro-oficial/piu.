/**
 * Transferência levada pela malha (docs/carteira/transacoes-pela-malha.md): o celular SEM internet
 * assina como no envio direto (mesmas conferências de rede, runtime, assinatura e bytes guardados
 * antes de sair) e entrega a carga ao mensageiro; um gateway com internet envia à Mainnet.
 *
 * Diferenças do envio direto (walletTransfer.ts), com o motivo:
 * - Contexto lido da ÚLTIMA vez que houve rede (`WalletOfflineContext`): runtime, gênese, nonce, saldo e
 *   uma estimativa de taxa. Mais velho que 7 dias, recusa (o runtime pode ter mudado; saldo e nonce
 *   também).
 * - Era IMORTAL (extrinsic.ts, `IMMORTAL_PERIOD`): a Lunes guarda só 2400 hashes de bloco, então a mortal
 *   valeria ~4 h. Risco aceito e explicado: enquanto o nonce não for usado (e o runtime não mudar), a
 *   transação assinada pode ser enviada por qualquer um, inclusive dias depois.
 * - Nonce: só UMA transferência em andamento por vez (a regra que já existe: `busy`). Enquanto a levada
 *   não se resolve, nada novo sai; qualquer transação nova da conta usaria o mesmo nonce, então no
 *   máximo uma das duas é liquidada (nunca as duas).
 * - O recibo do gateway é dica (`carried.report`); "confirmada" só com a leitura da Mainnet feita pelo
 *   próprio aparelho (`reconcileCarriedTransfer`).
 */
import { CarryKind, type CarryReceipt } from '../protocol/carry';
import { encodeSignedExtrinsic, IMMORTAL_PERIOD, signedExtra, transferKeepAliveCall } from './extrinsic';
import { accountBalance, accountNextIndex, findExtrinsicInBlock, isHash, LunesRpc, paymentQueryInfo, submitExtrinsic, toHex, validateTransaction } from './lunesRpc';
import { fetchLunesHistory } from './lunesHistory';
import {
  checkedRuntime, checkedSigned, isActiveWalletTransfer, LUNES_GENESIS_HASH, normalized, saveRecord, spendable, trackWalletTransfer, WALLET_RUNTIME,
  type WalletQuote, type WalletSigningContext, type WalletTransferDeps, type WalletTransferRecord, type WalletTransferSave, WalletTransferError,
} from './walletTransfer';

/** Contexto mais velho que isto não serve para assinar sem internet. */
export const OFFLINE_CONTEXT_MAX_AGE_MS = 7 * 86_400_000;
/**
 * A taxa não entra na assinatura; é cobrada na inclusão. Sem rede não dá para cotar: o saldo precisa
 * cobrir o valor mais o dobro da última taxa lida (folga para a taxa subir até chegar a um gateway).
 */
export const CARRY_FEE_MARGIN = 2n;
/** Blocos lidos por conferência quando o nonce já passou e o indexador não apontou o bloco (~40 min). */
export const RECONCILE_SCAN_BLOCKS = 400;

/** O que se lê da Mainnet com rede para poder assinar depois sem ela. Sem segredo (vai cifrado no disco). */
export interface WalletOfflineContext {
  v: 1; from: string;
  specVersion: number; transactionVersion: number; genesisHash: string;
  /** Próximo nonce da conta no bloco finalizado `block`. */
  nonce: number; block: number;
  /** Disponível (planck, já sem frozen e sem o mínimo da conta) e a taxa de uma transferência (planck). */
  available: string; fee: string;
  /** Quando foi lido (ms). */
  at: number;
}

const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const amount = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v);
const nowOf = (deps: WalletTransferDeps) => (deps.now ?? Date.now)();
async function withRpc<T>(deps: WalletTransferDeps, fn: (rpc: LunesRpc) => Promise<T>): Promise<T> {
  const rpc = deps.rpc ?? new LunesRpc();
  try { return await fn(rpc); } finally { if (!deps.rpc) rpc.close(); }
}

export function isOfflineContext(v: unknown): v is WalletOfflineContext {
  try {
    const c = v as WalletOfflineContext;
    if (!c || c.v !== 1 || typeof c.from !== 'string' || !integer(c.nonce) || c.nonce > 0xffffffff || !integer(c.block) || !integer(c.at) || !amount(c.available) || !amount(c.fee)) return false;
    checkedRuntime(c, c.genesisHash);
    return normalized(c.from).address === c.from;
  } catch { return false; }
}

/**
 * Lê (com rede) o contexto para uma futura assinatura sem rede. Chamar junto com a leitura do saldo.
 * A taxa é a de uma transferência imortal de valor grande (o maior tamanho que ela pode ter).
 */
export async function readOfflineContext(address: string, deps: WalletTransferDeps = {}): Promise<WalletOfflineContext> {
  const from = normalized(address);
  return withRpc(deps, async rpc => {
    const balance = await accountBalance(rpc, from.address);
    const [rv, genesisHash, next] = await Promise.all([
      rpc.call<{ specVersion: number; transactionVersion: number }>('state_getRuntimeVersion', [balance.blockHash]),
      rpc.call<string>('chain_getBlockHash', [0]), accountNextIndex(rpc, from.address),
    ]);
    checkedRuntime(rv, genesisHash);
    // O maior entre o do bloco finalizado e o do pool: uma transação minha ainda no pool já gastou o dela.
    const nonce = Math.max(balance.nonce, next);
    if (!integer(nonce) || nonce > 0xffffffff) throw new WalletTransferError('invalid', 'Nonce inválido.');
    const ctx = { specVersion: rv.specVersion, transactionVersion: rv.transactionVersion, genesisHash, blockHash: genesisHash, blockNumber: balance.block, nonce, period: IMMORTAL_PERIOD, tip: 0n };
    const dummy = encodeSignedExtrinsic(from.publicKey, new Uint8Array(64), signedExtra(ctx), transferKeepAliveCall(from.publicKey, (1n << 64n) - 1n));
    const fee = (await paymentQueryInfo(rpc, dummy, balance.blockHash)).partialFee;
    return { v: 1, from: from.address, specVersion: rv.specVersion, transactionVersion: rv.transactionVersion, genesisHash: genesisHash.toLowerCase(), nonce, block: balance.block, available: spendable(balance).toString(), fee: fee.toString(), at: nowOf(deps) };
  });
}

/**
 * Uma transferência minha passou a ocupar um bloco (incluída, deu certo ou não): o nonce dela foi gasto.
 * O contexto guardado anda junto, para a próxima assinatura sem rede não repetir o nonce.
 */
export function advanceOfflineContext(ctx: WalletOfflineContext | null, record: WalletTransferRecord | null): WalletOfflineContext | null {
  if (!ctx || !record?.block || normalized(record.from).address !== ctx.from || record.ctx.nonce < ctx.nonce) return ctx;
  const spent = BigInt(record.value) + BigInt(record.fee);
  const available = BigInt(ctx.available) > spent ? BigInt(ctx.available) - spent : 0n;
  return { ...ctx, nonce: record.ctx.nonce + 1, available: available.toString() };
}

/** Revisão de uma transferência SEM rede, a partir do contexto guardado (mesma forma do envio direto). */
export function prepareCarriedTransfer(input: { from: string; dest: string; value: string }, ctx: WalletOfflineContext | null, now: number): WalletQuote {
  const from = normalized(input.from), dest = normalized(input.dest);
  if (from.address === dest.address) throw new WalletTransferError('invalid', 'O destino é a sua própria carteira.');
  if (!amount(input.value) || BigInt(input.value) === 0n) throw new WalletTransferError('invalid', 'Valor inválido em planck.');
  if (!ctx || !isOfflineContext(ctx) || ctx.from !== from.address) throw new WalletTransferError('offline_context', 'Sem leitura recente desta carteira. Conecte-se uma vez para poder enviar sem internet.');
  if (now - ctx.at > OFFLINE_CONTEXT_MAX_AGE_MS || ctx.at > now + 300_000) throw new WalletTransferError('offline_context', 'A última leitura da carteira tem mais de 7 dias. Conecte-se uma vez para atualizar antes de enviar sem internet.');
  const fee = BigInt(ctx.fee), value = BigInt(input.value);
  if (value + fee * CARRY_FEE_MARGIN > BigInt(ctx.available)) throw new WalletTransferError('funds', 'Saldo da última leitura insuficiente para o valor e a taxa (com folga), preservando bloqueios e o mínimo da conta.');
  const signing: WalletSigningContext = { specVersion: ctx.specVersion, transactionVersion: ctx.transactionVersion, genesisHash: ctx.genesisHash, blockHash: ctx.genesisHash, blockNumber: ctx.block, nonce: ctx.nonce, period: IMMORTAL_PERIOD, tip: '0' };
  return { from: from.address, dest: dest.address, value: input.value, fee: ctx.fee, total: (value + fee).toString(), available: ctx.available, ctx: signing, preparedAt: now };
}

export interface WalletCarrySend extends WalletTransferSave {
  authorize: (quote: WalletQuote) => Promise<boolean>;
  sign: (quote: WalletQuote) => Promise<{ hex: string; hash: string }> | { hex: string; hash: string };
  active: () => WalletTransferRecord | null;
  /** Entrega a carga ao mensageiro (`Messenger.carry`). Lança se não houver malha. */
  carry: (extrinsicHex: string, hash: string) => { envelopeId: string; expiresAt: number };
}

const carrying = new Set<string>();
/**
 * Autoriza (biometria), assina, confere os bytes, GRAVA e só então solta na malha. Se gravar falhar,
 * nada sai. Se a malha recusar, o registro fica `signed` sem envelope: `recarryTransfer` tenta de novo
 * com os MESMOS bytes.
 */
export async function carryWalletTransfer(quote: WalletQuote, callbacks: WalletCarrySend, deps: { now?: () => number } = {}): Promise<WalletTransferRecord> {
  checkedRuntime(quote.ctx, quote.ctx.genesisHash);
  if (quote.ctx.period !== IMMORTAL_PERIOD || quote.ctx.blockHash.toLowerCase() !== LUNES_GENESIS_HASH) throw new WalletTransferError('invalid', 'Contexto de assinatura sem internet inválido.');
  const from = normalized(quote.from).address;
  if (carrying.has(from) || isActiveWalletTransfer(callbacks.active())) throw new WalletTransferError('busy', 'Já existe um pagamento em andamento. Acompanhe o mesmo hash.');
  carrying.add(from);
  try {
    if (!(await callbacks.authorize(quote))) throw new WalletTransferError('cancelled', 'Assinatura cancelada. Nada foi enviado.');
    if (isActiveWalletTransfer(callbacks.active())) throw new WalletTransferError('busy', 'Já existe um pagamento em andamento.');
    const signed = await callbacks.sign(quote);
    const hash = checkedSigned(quote, signed);
    const at = (deps.now ?? Date.now)();
    const record: WalletTransferRecord = {
      id: hash, from: quote.from, dest: quote.dest, value: quote.value, fee: quote.fee, hash, hex: signed.hex.toLowerCase(), ctx: quote.ctx,
      validUntil: Number.MAX_SAFE_INTEGER, status: 'signed', createdAt: at, updatedAt: at, scanned: quote.ctx.blockNumber,
      carried: { envelopeId: '0'.repeat(32), at, expiresAt: 0 },
    };
    await saveRecord(record, callbacks); // Não mover depois de soltar na malha.
    return recarryTransfer(record, callbacks, deps);
  } finally { carrying.delete(from); }
}

/** Solta de novo os MESMOS bytes na malha (envelope vencido, ou a malha recusou antes). Nunca reassina. */
export async function recarryTransfer(record: WalletTransferRecord, callbacks: Pick<WalletCarrySend, 'carry' | 'save'>, deps: { now?: () => number } = {}): Promise<WalletTransferRecord> {
  if (!record.carried || record.status !== 'signed') throw new WalletTransferError('invalid', 'Esta transferência não está em trânsito pela malha.');
  const now = (deps.now ?? Date.now)();
  try {
    const c = callbacks.carry(record.hex, record.hash);
    return saveRecord({ ...record, carried: { ...record.carried, envelopeId: c.envelopeId, at: now, expiresAt: c.expiresAt }, updatedAt: now, error: undefined }, callbacks);
  } catch (e) {
    return saveRecord({ ...record, updatedAt: now, error: `A carga não entrou na malha: ${e instanceof Error ? e.message : String(e)}. A assinatura está guardada; tente de novo.` }, callbacks);
  }
}

/** Recibo do gateway (dica): guarda o que ele disse, sem mudar o estado da transferência. */
export function applyCarryReceipt(record: WalletTransferRecord | null, rc: CarryReceipt, now: number): WalletTransferRecord | null {
  if (!record?.carried || rc.about !== CarryKind.Tx || toHex(rc.ref) !== record.hash) return null;
  const order = ['error', 'pool', 'invalid', 'included', 'finalized'];
  const cur = record.carried.report;
  // Não regride (cópias por caminhos diferentes chegam fora de ordem); "invalid" depois de "pool" vale.
  if (cur && order.indexOf(rc.status) < order.indexOf(cur.status)) return null;
  if (rc.status === 'accepted') return null;
  const block = rc.block ? { number: rc.block.number, hash: toHex(rc.block.hash), index: rc.block.index } : undefined;
  return { ...record, updatedAt: now, carried: { ...record.carried, report: { status: rc.status, at: now, ...(block ? { block } : {}), ...(rc.reason ? { reason: rc.reason.slice(0, 200) } : {}) } } };
}

export interface ReconcileDeps extends WalletTransferDeps {
  /** Blocos com uma saída deste valor para este destino depois do bloco dado (indexador). `null`: indisponível. */
  outgoingBlocks?: (record: WalletTransferRecord) => Promise<number[] | null>;
}

async function indexedOutgoing(record: WalletTransferRecord, deps: ReconcileDeps): Promise<number[] | null> {
  if (deps.outgoingBlocks) return deps.outgoingBlocks(record);
  try {
    const h = await fetchLunesHistory(record.from, { fetch: deps.fetch });
    const dest = normalized(record.dest).address;
    return h.moves.filter(m => m.direction === 'out' && m.amount === BigInt(record.value) && m.block > record.ctx.blockNumber && normalized(m.counterparty).address === dest).map(m => m.block);
  } catch { return null; }
}

/**
 * Com internet, o aparelho resolve sozinho a transferência levada pela malha (não depende do recibo):
 * 1. O gateway disse "em bloco": confere o bloco canônico e passa ao acompanhamento normal.
 * 2. O nonce já foi usado no bloco finalizado: procura o hash nos blocos que o indexador aponta; achou →
 *    acompanhamento normal; não achou (outra transação usou o nonce) → "não concluída".
 * 3. Nonce livre: o próprio aparelho envia os MESMOS bytes (envio idempotente). A Lunes recusou →
 *    "não concluída", com o motivo; a assinatura ainda vale até o nonce ser usado (ver o aviso).
 */
export async function reconcileCarriedTransfer(record: WalletTransferRecord, callbacks: WalletTransferSave, deps: ReconcileDeps = {}): Promise<WalletTransferRecord> {
  if (!record.carried || record.status !== 'signed') return trackWalletTransfer(record, callbacks, deps);
  return withRpc(deps, async rpc => {
    const d = { ...deps, rpc };
    try {
      const report = record.carried!.report;
      if (report?.block) {
        const canonical = await rpc.call<string | null>('chain_getBlockHash', [report.block.number]);
        const index = canonical && isHash(canonical) ? await findExtrinsicInBlock(rpc, canonical, record.hash) : null;
        if (canonical === report.block.hash && index === report.block.index) {
          return trackWalletTransfer({ ...record, status: 'included', block: { ...report.block }, updatedAt: nowOf(deps), error: undefined }, callbacks, d);
        }
      }
      const bal = await accountBalance(rpc, record.from);
      if (bal.nonce > record.ctx.nonce) {
        // O nonce passou: esta transação ou já está num bloco até `bal.block`, ou nunca mais entra.
        // "Não concluída" só com a busca completa (dizer isso de uma que entrou levaria a pagar duas vezes).
        const found = async (n: number) => {
          const hash = await rpc.call<string | null>('chain_getBlockHash', [n]);
          const index = hash ? await findExtrinsicInBlock(rpc, hash, record.hash) : null;
          return hash && index !== null && index >= 0 ? { number: n, hash, index } : null;
        };
        for (const n of [...new Set((await indexedOutgoing(record, deps)) ?? [])].filter(n => n <= bal.block).sort((a, b) => a - b)) {
          const block = await found(n);
          if (block) return trackWalletTransfer({ ...record, status: 'included', block, updatedAt: nowOf(deps), error: undefined }, callbacks, d);
        }
        let scanned = Math.max(record.scanned ?? record.ctx.blockNumber, record.ctx.blockNumber);
        const to = Math.min(bal.block, scanned + RECONCILE_SCAN_BLOCKS);
        for (let n = scanned + 1; n <= to; n++) {
          const block = await found(n);
          if (block) return trackWalletTransfer({ ...record, status: 'included', block, updatedAt: nowOf(deps), error: undefined }, callbacks, d);
          scanned = n;
        }
        if (scanned >= bal.block) return saveRecord({ ...record, status: 'failed', scanned, updatedAt: nowOf(deps), error: 'Outra transação desta carteira usou o mesmo nonce antes desta; esta não será liquidada.' }, callbacks);
        return saveRecord({ ...record, scanned, updatedAt: nowOf(deps), error: `Procurando esta transferência nos blocos (até #${scanned} de #${bal.block}). Não refaça o pagamento.` }, callbacks);
      }
      const validity = await validateTransaction(rpc, record.hex, bal.blockHash);
      if (!validity.ok) {
        // Stale com o nonce livre no finalizado: está num bloco ainda não finalizado. Espera.
        if (validity.reason === 'Stale') return saveRecord({ ...record, updatedAt: nowOf(deps), error: 'Em bloco ainda não finalizado; acompanhando.' }, callbacks);
        return saveRecord({ ...record, status: 'failed', updatedAt: nowOf(deps), error: `A Lunes recusou a transferência levada pela malha (${validity.reason}). Atenção: até outra transação desta carteira ser liquidada, a assinatura ainda pode valer se alguém a enviar.` }, callbacks);
      }
      try { await submitExtrinsic(rpc, record.hex); } catch (e) {
        if (!/already imported|already in the pool|1013/i.test(e instanceof Error ? e.message : String(e))) {
          return saveRecord({ ...record, updatedAt: nowOf(deps), error: `Envio ainda não confirmado: ${e instanceof Error ? e.message : String(e)}. Acompanhe este hash; não refaça o pagamento.` }, callbacks);
        }
      }
      // O nonce estava livre no bloco `bal.block`: a transação não está em nenhum bloco até ele.
      return saveRecord({ ...record, status: 'submitted', scanned: bal.block, updatedAt: nowOf(deps), error: undefined }, callbacks);
    } catch (e) {
      if (e instanceof WalletTransferError && e.code === 'persistence') throw e;
      return saveRecord({ ...record, updatedAt: nowOf(deps), error: `Sem rota até a Mainnet: ${e instanceof Error ? e.message : String(e)}. Segue em trânsito pela malha.` }, callbacks);
    }
  });
}

/** Em trânsito pela malha (assinada, levada, ainda sem confirmação da Mainnet lida por este aparelho). */
export const isInTransit = (r: WalletTransferRecord | null | undefined) => !!r?.carried && r.status === 'signed';
export { WALLET_RUNTIME };
