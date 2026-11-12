/**
 * Carteira pessoal LUNES: preparar → autorizar → assinar → persistir → enviar os MESMOS bytes.
 * Sem React/Expo, seed ou chave em estado persistido. O callback sign deriva/zera a chave no cofre.
 * Confirmação mobile: índice/hash e finalização vêm do RPC; resultado vem do indexador público da
 * Lunes, com hash do bloco cruzado. proofSource='indexer' é explícito: difere do piu-node, cujo
 * decoder lê System.Events diretamente. Sem resposta/resultado, o pagamento continua ativo.
 */
import { decodeCompact, encodeSignedExtrinsic, signedExtra, signingPayload, transferKeepAliveCall, type SigningContext } from './extrinsic';
import { accountBalance, accountNextIndex, extrinsicHash, finalizedHead, findExtrinsicInBlock, fromHex, isHash, LUNES_EXISTENTIAL_DEPOSIT, LunesRpc, paymentQueryInfo, submitExtrinsic, validateTransaction } from './lunesRpc';
import { fetchLunesHistory, LUNES_INDEXER } from './lunesHistory';
import { decodeSs58, encodeSs58 } from './ss58';
import { verifyWalletSignature } from './walletKey';

export const WALLET_RUNTIME = { specVersion: 107, transactionVersion: 2 } as const;
export const LUNES_GENESIS_HASH = '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac';
export type WalletSigningContext = Omit<SigningContext, 'tip' | 'period'> & { tip: string; period: number };
export interface WalletQuote {
  from: string; dest: string; value: string; fee: string; total: string;
  /** Free já exclui reserved. Retém max(frozen, ED-reserved); total=value+fee deve caber aqui. */
  available: string; ctx: WalletSigningContext; preparedAt: number;
}
export interface WalletTransferRecord {
  id: string; from: string; dest: string; value: string; fee: string; hash: string; hex: string;
  ctx: WalletSigningContext; validUntil: number;
  status: 'signed' | 'submitted' | 'included' | 'finalized' | 'failed';
  createdAt: number; updatedAt: number; block?: { number: number; hash: string; index: number };
  error?: string; scanned?: number; proofSource?: 'indexer';
  /** Desde quando (ms, relógio do aparelho) o nó RPC diz "não entrou" sem o indexador confirmar. */
  unconfirmedSince?: number;
  /**
   * Levada pela malha até um gateway (lib/walletCarry.ts): assinada sem internet, com era imortal
   * (`ctx.period` 0). Enquanto `status` for `signed`, está "em trânsito pela malha". `report`: o que um
   * gateway disse no recibo (dica, não prova; a confirmação é a da Mainnet, lida pelo aparelho).
   */
  carried?: WalletCarryInfo;
}
export interface WalletCarryInfo {
  /** Envelope na malha (muda se a carga for solta de novo). */
  envelopeId: string;
  /** Quando saiu deste aparelho (ms) e até quando o envelope vive na malha (s). */
  at: number; expiresAt: number;
  report?: { status: 'pool' | 'included' | 'finalized' | 'invalid' | 'error'; at: number; block?: { number: number; hash: string; index: number }; reason?: string };
}
export type WalletExecutionOutcome = { ok: true } | { ok: false; error: string } | { ok: null; error: string };
export interface WalletTransferDeps {
  rpc?: LunesRpc; now?: () => number; fetch?: typeof fetch; indexer?: string;
  readExecution?: (record: WalletTransferRecord, block: NonNullable<WalletTransferRecord['block']>) => Promise<WalletExecutionOutcome>;
  /** Blocos com uma saída deste valor para este destino depois do bloco dado (indexador). `null`: indisponível. */
  outgoingBlocks?: (record: WalletTransferRecord) => Promise<number[] | null>;
}
export interface WalletTransferSave { save: (record: WalletTransferRecord) => Promise<void> }
export interface WalletTransferSend extends WalletTransferSave {
  authorize: (quote: WalletQuote) => Promise<boolean>;
  sign: (quote: WalletQuote) => Promise<{ hex: string; hash: string }> | { hex: string; hash: string };
  active: () => WalletTransferRecord | null;
  /** Optional session guard; absent for ordinary local transfers. */
  guard?: () => boolean;
}
export class WalletTransferError extends Error {
  constructor(readonly code: 'cancelled' | 'review_required' | 'busy' | 'invalid' | 'runtime' | 'funds' | 'signing' | 'persistence' | 'session_lost' | 'offline_context', message: string, readonly quote?: WalletQuote) { super(message); }
}
const U128 = (1n << 128n) - 1n;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const amount = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= U128;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const ctxOf = (ctx: WalletSigningContext): SigningContext => ({ ...ctx, tip: BigInt(ctx.tip) });
const nowOf = (deps: WalletTransferDeps) => (deps.now ?? Date.now)();
export const normalized = (address: string) => {
  const d = decodeSs58(address);
  if (!d.ok) throw new WalletTransferError('invalid', d.error);
  return { ...d, address: encodeSs58(d.publicKey, 57) };
};
export function checkedRuntime(rv: { specVersion: number; transactionVersion: number }, genesisHash: string) {
  if (rv?.specVersion !== WALLET_RUNTIME.specVersion || rv?.transactionVersion !== WALLET_RUNTIME.transactionVersion || genesisHash?.toLowerCase() !== LUNES_GENESIS_HASH) {
    throw new WalletTransferError('runtime', 'Rede ou runtime da Lunes diferente do conferido. Atualize o Piu antes de transferir.');
  }
}
async function withRpc<T>(deps: WalletTransferDeps, fn: (rpc: LunesRpc) => Promise<T>): Promise<T> {
  const rpc = deps.rpc ?? new LunesRpc();
  try { return await fn(rpc); } finally { if (!deps.rpc) rpc.close(); }
}
export async function saveRecord(record: WalletTransferRecord, callbacks: WalletTransferSave): Promise<WalletTransferRecord> {
  try { await callbacks.save(record); } catch { throw new WalletTransferError('persistence', 'Não foi possível guardar o pagamento no aparelho. Não crie outro pagamento; confira o histórico.'); }
  return record;
}
/**
 * Segunda fonte antes de dizer "falhou": o indexador Lunes (serviço separado dos nós RPC) lista as saídas
 * desta conta. `null` quando não respondeu. Um nó RPC sozinho, defeituoso ou comprometido, não pode fazer
 * o app mostrar "falhou" para um pagamento liquidado (a pessoa pagaria de novo).
 */
export async function indexedOutgoing(record: WalletTransferRecord, deps: WalletTransferDeps): Promise<number[] | null> {
  if (deps.outgoingBlocks) return deps.outgoingBlocks(record);
  try {
    const h = await fetchLunesHistory(record.from, { fetch: deps.fetch, indexer: deps.indexer });
    const dest = normalized(record.dest).address;
    return h.moves.filter(m => m.direction === 'out' && m.amount === BigInt(record.value) && m.block > record.ctx.blockNumber && normalized(m.counterparty).address === dest).map(m => m.block);
  } catch { return null; }
}
/** Prazo para o indexador confirmar um "não entrou" do nó RPC antes de liberar o envio com aviso. */
export const UNCONFIRMED_LIMIT_MS = 24 * 3_600_000;
/**
 * "Falhou" pedido pelo nó RPC. Com o indexador concordando (nenhuma saída igual até `upTo`), falha já.
 * Sem ele (fora do ar, ou listando uma saída igual que o nó não confirma), segue acompanhando; depois de
 * `UNCONFIRMED_LIMIT_MS` falha mesmo assim, com aviso para conferir antes de pagar de novo. Sem esse prazo o
 * registro ficaria ativo e bloquearia todo envio novo da carteira para sempre.
 */
export async function failWithSecondSource(
  record: WalletTransferRecord, listed: number[] | null, upTo: number, failure: string, waiting: string,
  callbacks: WalletTransferSave, deps: WalletTransferDeps,
): Promise<WalletTransferRecord> {
  const same = listed?.find(n => n <= upTo);
  const now = nowOf(deps);
  if (listed !== null && same === undefined) return saveRecord({ ...record, status: 'failed', updatedAt: now, error: failure }, callbacks);
  const doubt = listed === null ? 'o indexador Lunes não respondeu para confirmar' : `o indexador Lunes lista uma saída igual no bloco #${same}, que o nó não confirmou`;
  const since = record.unconfirmedSince ?? now;
  if (now - since >= UNCONFIRMED_LIMIT_MS) {
    return saveRecord({ ...record, status: 'failed', updatedAt: now, unconfirmedSince: since, error: `${failure} Atenção: há 24 h ${doubt}. O envio foi liberado; antes de pagar de novo, confira no histórico ou no explorador se este pagamento não saiu.` }, callbacks);
  }
  return saveRecord({ ...record, updatedAt: now, unconfirmedSince: since, error: `${waiting}, mas ${doubt}. Acompanhando; não refaça o pagamento.` }, callbacks);
}
export const isActiveWalletTransfer = (record: WalletTransferRecord | null | undefined): boolean => !!record && record.status !== 'finalized' && record.status !== 'failed';

/** O callback não pode trocar destino/valor/contexto nem devolver assinatura de outra conta. */
export function checkedSigned(quote: Pick<WalletQuote, 'from' | 'dest' | 'value' | 'ctx'>, signed: { hex: string; hash: string }): string {
  try {
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(signed.hex)) throw new Error('extrinsic não é hex');
    const bytes = fromHex(signed.hex), prefix = decodeCompact(bytes);
    if (Number(prefix.value) + prefix.length !== bytes.length) throw new Error('tamanho do extrinsic inválido');
    const body = bytes.subarray(prefix.length), from = normalized(quote.from), dest = normalized(quote.dest);
    if (body[0] !== 0x84 || body[1] !== 0 || body[34] !== 1 || !sameBytes(body.subarray(2, 34), from.publicKey)) throw new Error('assinante ou formato inválido');
    const ctx = ctxOf(quote.ctx), extra = signedExtra(ctx), call = transferKeepAliveCall(dest.publicKey, BigInt(quote.value));
    if (body.length !== 99 + extra.length + call.length || !sameBytes(body.subarray(99, 99 + extra.length), extra) || !sameBytes(body.subarray(99 + extra.length), call)) throw new Error('destino, valor, nonce ou era não correspondem à revisão');
    if (!verifyWalletSignature(signingPayload(call, ctx), body.subarray(35, 99), from.publicKey)) throw new Error('assinatura inválida');
    const hash = extrinsicHash(bytes);
    if (hash !== signed.hash.toLowerCase()) throw new Error('hash não corresponde aos bytes assinados');
    return hash;
  } catch (e) { throw new WalletTransferError('signing', `Não foi possível conferir a assinatura: ${e instanceof Error ? e.message : String(e)}`); }
}

const CARRY_REPORT = ['pool', 'included', 'finalized', 'invalid', 'error'];
function isCarryInfo(c: unknown): c is WalletCarryInfo {
  if (!c || typeof c !== 'object') return false;
  const x = c as WalletCarryInfo;
  if (typeof x.envelopeId !== 'string' || !/^[0-9a-f]{32}$/.test(x.envelopeId) || !integer(x.at) || !integer(x.expiresAt)) return false;
  const r = x.report;
  if (r === undefined) return true;
  if (!r || !CARRY_REPORT.includes(r.status) || !integer(r.at) || (r.reason !== undefined && (typeof r.reason !== 'string' || r.reason.length > 200))) return false;
  return r.block === undefined || (integer(r.block.number) && integer(r.block.index) && isHash(r.block.hash));
}

/** Validação do registro restaurado: nenhum BigInt/segredo em disco, bytes/hash/call/assinatura conferem. */
export function isWalletTransferRecord(value: unknown): value is WalletTransferRecord {
  try {
    if (!value || typeof value !== 'object') return false;
    const r = value as WalletTransferRecord;
    if (!['signed', 'submitted', 'included', 'finalized', 'failed'].includes(r.status) || !amount(r.value) || BigInt(r.value) === 0n || !amount(r.fee) || !integer(r.createdAt) || !integer(r.updatedAt)) return false;
    if (!r.ctx || !integer(r.ctx.blockNumber) || !integer(r.ctx.nonce) || r.ctx.nonce > 0xffffffff || r.ctx.tip !== '0' || !isHash(r.ctx.blockHash)) return false;
    // Era mortal de 64 blocos (envio direto) ou imortal (levada pela malha, sempre com `carried`).
    const mortal = r.ctx.period === 64 && r.validUntil === r.ctx.blockNumber + 64 && r.carried === undefined;
    const immortal = r.ctx.period === 0 && r.validUntil === Number.MAX_SAFE_INTEGER && r.ctx.blockHash.toLowerCase() === LUNES_GENESIS_HASH && isCarryInfo(r.carried);
    if (!mortal && !immortal) return false;
    checkedRuntime(r.ctx, r.ctx.genesisHash);
    if (!isHash(r.hash) || r.id !== r.hash || checkedSigned(r, { hex: r.hex, hash: r.hash }) !== r.hash) return false;
    if (r.scanned !== undefined && (!integer(r.scanned) || r.scanned < r.ctx.blockNumber || r.scanned > r.validUntil)) return false;
    if (r.unconfirmedSince !== undefined && !integer(r.unconfirmedSince)) return false;
    if (r.block && (!integer(r.block.number) || !integer(r.block.index) || !isHash(r.block.hash))) return false;
    if (r.status === 'included' && !r.block) return false;
    if (r.status === 'finalized' && (!r.block || r.proofSource !== 'indexer')) return false;
    return true;
  } catch { return false; }
}

/** Quanto pode sair sem tocar no que está preso (frozen) nem no mínimo da conta (depósito existencial). */
export function spendable(balance: { free: bigint; reserved: bigint; frozen: bigint }): bigint {
  // reserved já está fora de free. O depósito existencial é sobre free+reserved; frozen limita free.
  const ed = balance.reserved >= LUNES_EXISTENTIAL_DEPOSIT ? 0n : LUNES_EXISTENTIAL_DEPOSIT - balance.reserved;
  const floor = balance.frozen > ed ? balance.frozen : ed;
  return balance.free > floor ? balance.free - floor : 0n;
}

export async function prepareWalletTransfer(input: { from: string; dest: string; value: string }, deps: WalletTransferDeps = {}): Promise<WalletQuote> {
  const from = normalized(input.from), dest = normalized(input.dest);
  if (from.address === dest.address) throw new WalletTransferError('invalid', 'O destino é a sua própria carteira.');
  if (!amount(input.value) || BigInt(input.value) === 0n) throw new WalletTransferError('invalid', 'Valor inválido em planck.');
  return withRpc(deps, async rpc => {
    const balance = await accountBalance(rpc, from.address);
    const [rv, genesisHash, nonce] = await Promise.all([
      rpc.call<{ specVersion: number; transactionVersion: number }>('state_getRuntimeVersion', [balance.blockHash]),
      rpc.call<string>('chain_getBlockHash', [0]), accountNextIndex(rpc, from.address),
    ]);
    checkedRuntime(rv, genesisHash);
    if (!integer(nonce) || nonce > 0xffffffff || !integer(balance.block) || !isHash(balance.blockHash)) throw new WalletTransferError('invalid', 'Contexto de assinatura inválido.');
    const ctx: WalletSigningContext = { specVersion: rv.specVersion, transactionVersion: rv.transactionVersion, genesisHash, blockHash: balance.blockHash, blockNumber: balance.block, nonce, period: 64, tip: '0' };
    const dummy = encodeSignedExtrinsic(from.publicKey, new Uint8Array(64), signedExtra(ctxOf(ctx)), transferKeepAliveCall(dest.publicKey, BigInt(input.value)));
    const fee = (await paymentQueryInfo(rpc, dummy, balance.blockHash)).partialFee;
    if (fee < 0n || fee > U128) throw new WalletTransferError('invalid', 'Taxa devolvida pela Lunes é inválida.');
    const available = spendable(balance);
    const total = BigInt(input.value) + fee;
    if (total > available) throw new WalletTransferError('funds', 'Saldo disponível insuficiente para o valor e a taxa, preservando bloqueios e o mínimo da conta.');
    return { from: from.address, dest: dest.address, value: input.value, fee: fee.toString(), total: total.toString(), available: available.toString(), ctx, preparedAt: nowOf(deps) };
  });
}

const sending = new Set<string>();
/** A autorização é obrigatória e acontece antes de sign. save criptografado resolve ANTES de submit. */
export async function sendWalletTransfer(quote: WalletQuote, callbacks: WalletTransferSend, deps: WalletTransferDeps = {}): Promise<WalletTransferRecord> {
  checkedRuntime(quote.ctx, quote.ctx.genesisHash);
  const from = normalized(quote.from).address;
  if (sending.has(from) || isActiveWalletTransfer(callbacks.active())) throw new WalletTransferError('busy', 'Já existe um pagamento em andamento. Acompanhe o mesmo hash.');
  sending.add(from);
  try {
    const requireSession = () => { if (callbacks.guard && !callbacks.guard()) throw new WalletTransferError('session_lost', 'Conexão com o computador encerrada.'); };
    requireSession();
    const authorized = await callbacks.authorize(quote);
    requireSession();
    if (!authorized) throw new WalletTransferError('cancelled', 'Assinatura cancelada. Nada foi enviado.');
    const fresh = await prepareWalletTransfer(quote, deps);
    if (fresh.fee !== quote.fee || fresh.available !== quote.available || fresh.total !== quote.total || fresh.ctx.nonce !== quote.ctx.nonce || fresh.ctx.specVersion !== quote.ctx.specVersion || fresh.ctx.transactionVersion !== quote.ctx.transactionVersion || fresh.ctx.genesisHash !== quote.ctx.genesisHash) {
      throw new WalletTransferError('review_required', 'Saldo, taxa ou nonce mudaram. Confira os valores novamente antes de assinar.', fresh);
    }
    if (isActiveWalletTransfer(callbacks.active())) throw new WalletTransferError('busy', 'Já existe um pagamento em andamento.');
    requireSession();
    const signed = await callbacks.sign(fresh);
    const hash = checkedSigned(fresh, signed);
    return withRpc(deps, async rpc => {
      const actualFee = (await paymentQueryInfo(rpc, signed.hex, fresh.ctx.blockHash)).partialFee;
      if (actualFee.toString() !== fresh.fee) {
        const revised = await prepareWalletTransfer(fresh, { ...deps, rpc });
        if (callbacks.guard) throw new WalletTransferError('session_lost', 'A taxa mudou após a assinatura. Não repita o pedido automaticamente.');
        throw new WalletTransferError('review_required', 'A taxa mudou. Confira novamente antes de assinar.', revised);
      }
      const validity = await validateTransaction(rpc, signed.hex);
      if (!validity.ok) throw new WalletTransferError('signing', `A Lunes recusou a validação antes do envio: ${validity.reason}. Nada foi enviado.`);
      const at = nowOf(deps);
      const record: WalletTransferRecord = { id: hash, from: fresh.from, dest: fresh.dest, value: fresh.value, fee: fresh.fee, hash, hex: signed.hex.toLowerCase(), ctx: fresh.ctx, validUntil: fresh.ctx.blockNumber + 64, status: 'signed', createdAt: at, updatedAt: at, scanned: fresh.ctx.blockNumber };
      await saveRecord(record, callbacks); // Não mover depois de author_submitExtrinsic.
      return broadcast(record, callbacks, { ...deps, rpc }, callbacks.guard);
    });
  } finally { sending.delete(from); }
}

async function broadcast(record: WalletTransferRecord, callbacks: WalletTransferSave, deps: WalletTransferDeps, guard?: () => boolean): Promise<WalletTransferRecord> {
  return withRpc(deps, async rpc => {
    let next: WalletTransferRecord;
    if (guard && !guard()) return saveRecord({ ...record, error: 'Computador desconectado antes do envio. Assinatura guardada; não repita o pagamento.', updatedAt: nowOf(deps) }, callbacks);
    try {
      const returned = await submitExtrinsic(rpc, record.hex);
      next = returned.toLowerCase() === record.hash ? { ...record, status: 'submitted', updatedAt: nowOf(deps), error: undefined } : { ...record, updatedAt: nowOf(deps), error: 'A resposta devolveu outro hash. Acompanhando apenas o hash calculado neste aparelho; não refaça o pagamento.' };
    } catch (e) {
      // O RPC pode ter feito failover depois de um endpoint aceitar os bytes e perder a resposta.
      // Inclusive Stale/Payment/AlreadyImported são ambíguos após author_submitExtrinsic.
      next = { ...record, updatedAt: nowOf(deps), error: `Envio ainda não confirmado: ${e instanceof Error ? e.message : String(e)}. Acompanhe este hash; não refaça o pagamento.` };
    }
    return saveRecord(next, callbacks);
  });
}

export const WALLET_EXECUTION_QUERY = `query WalletExecution($id: String!, $block: String!) {
  extrinsic(id: $id) { id blockNumber extrinsicIndex success }
  block(id: $block) { id number hash }
}`;
/** Schema público verificado em 05/11/2026. Resultado do indexador, não decoder System.Events. */
export async function readWalletExecution(_record: WalletTransferRecord, block: NonNullable<WalletTransferRecord['block']>, deps: WalletTransferDeps = {}): Promise<WalletExecutionOutcome> {
  return readBlockExecution(block, deps);
}

/**
 * A mesma prova do indexador, só pelo bloco (número, hash e índice do extrínseco): serve para conferir
 * uma transação que não saiu desta carteira (o hash que o pagador informou num pedido de pagamento).
 */
export async function readBlockExecution(block: { number: number; hash: string; index: number }, deps: Pick<WalletTransferDeps, 'fetch' | 'indexer'> = {}): Promise<WalletExecutionOutcome> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const fetcher = deps.fetch ?? globalThis.fetch.bind(globalThis);
    const id = `${block.number}-${block.index}`;
    const response = await fetcher(deps.indexer ?? LUNES_INDEXER, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: WALLET_EXECUTION_QUERY, variables: { id, block: String(block.number) } }), signal: ctl.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json() as { errors?: unknown[]; data?: { extrinsic?: { id?: unknown; blockNumber?: unknown; extrinsicIndex?: unknown; success?: unknown } | null; block?: { id?: unknown; number?: unknown; hash?: unknown } | null } };
    if (result.errors?.length) throw new Error('Consulta recusada pelo indexador.');
    const row = result.data?.extrinsic, indexedBlock = result.data?.block;
    if (!row || !indexedBlock || row.id !== id || String(row.blockNumber) !== String(block.number) || row.extrinsicIndex !== block.index || String(indexedBlock.id) !== String(block.number) || String(indexedBlock.number) !== String(block.number) || typeof indexedBlock.hash !== 'string' || indexedBlock.hash.toLowerCase() !== block.hash.toLowerCase() || typeof row.success !== 'boolean') {
      return { ok: null, error: 'O indexador ainda não comprova a execução deste hash no bloco finalizado.' };
    }
    return row.success ? { ok: true } : { ok: false, error: 'A transferência falhou na execução, conforme o indexador Lunes. A taxa pode ter sido cobrada.' };
  } catch (e) { return { ok: null, error: `Execução ainda não confirmada pelo indexador Lunes: ${e instanceof Error ? e.message : String(e)}` }; }
  finally { clearTimeout(timer); }
}

async function settle(record: WalletTransferRecord, block: NonNullable<WalletTransferRecord['block']>, callbacks: WalletTransferSave, deps: WalletTransferDeps): Promise<WalletTransferRecord> {
  const outcome = await (deps.readExecution ? deps.readExecution(record, block) : readWalletExecution(record, block, deps));
  if (outcome.ok === true) return saveRecord({ ...record, status: 'finalized', block, proofSource: 'indexer', updatedAt: nowOf(deps), error: undefined }, callbacks);
  if (outcome.ok === false) return saveRecord({ ...record, status: 'failed', block, proofSource: 'indexer', updatedAt: nowOf(deps), error: outcome.error }, callbacks);
  return saveRecord({ ...record, status: 'included', block, updatedAt: nowOf(deps), error: `${outcome.error} Não refaça o pagamento.` }, callbacks);
}

export async function trackWalletTransfer(record: WalletTransferRecord, callbacks: WalletTransferSave, deps: WalletTransferDeps = {}): Promise<WalletTransferRecord> {
  if (!isWalletTransferRecord(record)) throw new WalletTransferError('invalid', 'Registro do pagamento inválido.');
  if (!isActiveWalletTransfer(record)) return record;
  return withRpc(deps, async rpc => {
    try {
      const fin = await finalizedHead(rpc);
      if (record.block) {
        const canonical = await rpc.call<string | null>('chain_getBlockHash', [record.block.number]);
        const index = canonical ? await findExtrinsicInBlock(rpc, canonical, record.hash) : null;
        if (canonical === record.block.hash && index === record.block.index) {
          if (fin.number >= record.block.number) return await settle(record, record.block, callbacks, { ...deps, rpc });
          return record;
        }
        if (!canonical || index === null) return saveRecord({ ...record, error: 'Bloco temporariamente indisponível. Acompanhando; não refaça o pagamento.', updatedAt: nowOf(deps) }, callbacks);
        record = { ...record, status: 'submitted', block: undefined, scanned: record.ctx.blockNumber, error: 'Bloco reorganizado. Procurando o mesmo hash.' };
      }
      const header = await rpc.call<{ number: string }>('chain_getHeader');
      const best = parseInt(header.number, 16);
      if (!integer(best) || !integer(fin.number)) throw new Error('Altura do bloco inválida.');
      const to = Math.min(best, record.validUntil);
      let scanned = record.scanned ?? record.ctx.blockNumber;
      for (let number = scanned + 1; number <= to; number++) {
        const hash = await rpc.call<string | null>('chain_getBlockHash', [number]);
        if (!hash) break;
        const index = await findExtrinsicInBlock(rpc, hash, record.hash);
        if (index === null) break;
        if (index >= 0) {
          const block = { number, hash, index };
          const included = { ...record, status: 'included' as const, block, updatedAt: nowOf(deps), error: undefined };
          if (number <= fin.number) return await settle(included, block, callbacks, { ...deps, rpc });
          return saveRecord(included, callbacks);
        }
        scanned = number;
      }
      scanned = Math.min(scanned, fin.number);
      if (fin.number > record.validUntil && scanned >= record.validUntil) {
        // O nó RPC não achou o hash; o indexador precisa concordar (sem saída igual no período) para virar "falhou".
        const listed = await indexedOutgoing(record, deps);
        return failWithSecondSource({ ...record, scanned }, listed, record.validUntil,
          'A era expirou e o hash não está em nenhum bloco finalizado do período. Nenhum novo pagamento foi criado.',
          'A era expirou e o nó não achou o hash', callbacks, deps);
      }
      return saveRecord({ ...record, scanned, updatedAt: nowOf(deps) }, callbacks);
    } catch (e) {
      if (e instanceof WalletTransferError && e.code === 'persistence') throw e;
      return saveRecord({ ...record, updatedAt: nowOf(deps), error: `Acompanhamento indisponível: ${e instanceof Error ? e.message : String(e)}. Não refaça o pagamento.` }, callbacks);
    }
  });
}

/** Reenvia só o extrinsic já assinado/persistido. Nunca deriva chave, reassina ou altera nonce/valor. */
export async function retryWalletTransfer(record: WalletTransferRecord, callbacks: WalletTransferSave, deps: WalletTransferDeps = {}): Promise<WalletTransferRecord> {
  if (sending.has(record.from)) throw new WalletTransferError('busy', 'O pagamento já está sendo enviado.');
  sending.add(record.from);
  try {
    const tracked = await trackWalletTransfer(record, callbacks, deps);
    if (!isActiveWalletTransfer(tracked) || tracked.block) return tracked;
    return withRpc(deps, async rpc => {
      try {
        const validity = await validateTransaction(rpc, tracked.hex);
        if (!validity.ok) return saveRecord({ ...tracked, error: `Resultado anterior ainda incerto (${validity.reason}). Acompanhando o mesmo hash; não refaça o pagamento.`, updatedAt: nowOf(deps) }, callbacks);
      } catch (e) { return saveRecord({ ...tracked, error: `Ainda não foi possível validar o reenvio: ${e instanceof Error ? e.message : String(e)}`, updatedAt: nowOf(deps) }, callbacks); }
      await saveRecord(tracked, callbacks);
      return broadcast(tracked, callbacks, { ...deps, rpc });
    });
  } finally { sending.delete(record.from); }
}
