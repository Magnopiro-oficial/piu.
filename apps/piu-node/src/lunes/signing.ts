/**
 * "Assinar no celular" para a carteira de provider na Lunes Mainnet (docs/carteira/contrato-api.md).
 *
 * Decisão do dono: a chave da carteira do provider fica SÓ no celular (derivação dura `//piu-provider`
 * da mesma frase do backup, walletKey.ts). O nó nunca guarda chave Lunes. O que ele faz:
 *
 * 1. `create`: monta o PEDIDO `{dest, value}` e lê da Mainnet o contexto de assinatura (runtime, gênese,
 *    bloco finalizado, nonce via `system_accountNextIndex`, taxa via `payment_queryInfo` de um extrinsic
 *    do mesmo tamanho com assinatura zerada). Recusa se o runtime não for o conferido em extrinsic.ts
 *    (CHECKED_RUNTIME): as signed extensions podem ter mudado e os bytes assinados seriam outros.
 * 2. O celular pareado (sessão própria, como as aprovações de hoje) lista os pendentes, assina com a
 *    cópia de extrinsic.ts e devolve o extrinsic em hex.
 * 3. `submitSigned`: CONFERE antes de enviar — decodifica o extrinsic v4 e exige: assinante = carteira do
 *    provider configurada; call = exatamente `balances.transfer_keep_alive(dest, value)` do pedido; era,
 *    nonce e gorjeta do pedido; assinatura sr25519 válida sobre o payload do pedido (gênese, runtime,
 *    bloco). Depois pede ao runtime `validate_transaction` (sem enviar) e só então `author_submitExtrinsic`.
 * 4. `tick`: acompanha até achar no bloco e até o bloco finalizar; a era (64 blocos) passar sem entrar =
 *    `failed`. Reenviar os mesmos bytes depois de uma queda é seguro (o nó recusa duplicata).
 *
 * Estados: pending → signed → submitted → in_block → finalized | failed | expired.
 */
import { randomUUID } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import type { Store } from '../store.js';
import {
  decodeCompact, DEFAULT_ERA_PERIOD, decodeTransferKeepAlive, encodeSignedExtrinsic, mortalEra, signedExtra, type SigningContext, signingPayload, transferKeepAliveCall,
} from './extrinsic.js';
import {
  accountNextIndex, finalizedHead, findExtrinsicInBlock, fromHex, isHash, LunesRpc, paymentQueryInfo, RpcError, submitExtrinsic, toHex, validateTransaction,
  type WsFactory,
} from './lunesRpc.js';
import { decodeSs58 } from './ss58.js';
import { readExecution } from './execution.js';
import { verifyWalletSignature } from './walletKey.js';

/**
 * Runtime da Lunes Mainnet cujas signed extensions foram conferidas ao vivo (cabeçalho de extrinsic.ts,
 * 2026-11-04). Outro `specVersion`/`transactionVersion` → recusar até reconferir a metadata.
 */
export const CHECKED_RUNTIME = { specVersion: 107, transactionVersion: 2 };
/** Quanto tempo um pedido espera a assinatura do celular (como as aprovações de hoje). */
export const SIGNING_TTL_MS = 5 * 60 * 1000;
/** Intervalo do acompanhamento (um bloco da Lunes). */
export const TRACK_INTERVAL_MS = 6000;

export type TransferStatus = 'pending' | 'signed' | 'submitted' | 'in_block' | 'finalized' | 'failed' | 'expired';
const ACTIVE: ReadonlySet<TransferStatus> = new Set(['pending', 'signed', 'submitted', 'in_block']);

/** Contexto de assinatura como fica no JSON (`tip` em texto). */
export interface StoredSigningContext {
  specVersion: number; transactionVersion: number; genesisHash: string; blockHash: string; blockNumber: number; nonce: number; period: number; tip: string;
}

export interface LunesTransfer {
  id: string;
  operatorId: string;
  /** Carteira do provider (assinante esperado), como configurada. */
  from: string;
  /** Destino SS58 como foi informado (57 ou 42), já conferido. */
  dest: string;
  /** planck em texto (1 LUNES = 10^8). */
  value: string;
  /** Taxa estimada em planck (texto), ou null se a consulta falhou. */
  fee: string | null;
  ctx: StoredSigningContext;
  createdAt: number;
  /** Até quando o celular pode assinar (ms). */
  expiresAt: number;
  /** Último bloco em que a era aceita a transação (ctx.blockNumber + period). */
  validUntil: number;
  updatedAt: number;
  status: TransferStatus;
  /** Extrinsic assinado (hex), depois que o celular devolveu e o nó conferiu. */
  extrinsic: string | null;
  /** blake2b-256 do extrinsic, o hash que o explorador mostra. */
  txHash: string | null;
  signedAt: number | null;
  submittedAt: number | null;
  /** Uma tentativa pode ter sido aceita mesmo se a resposta se perdeu. Persistir antes do envio. */
  submitAttemptedAt?: number;
  block: { number: number; hash: string; index: number } | null;
  error: string | null;
  /** Até que bloco o acompanhamento já procurou (interno). */
  scanned?: number;
}
export type LunesTransferView = Omit<LunesTransfer, 'operatorId' | 'scanned'>;

/** O que vai na API: sem o operador (a sessão já diz) e sem o cursor interno. */
export function transferView(t: LunesTransfer): LunesTransferView {
  const { operatorId: _o, scanned: _s, ...v } = t;
  return v;
}

export class SigningError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

const U128_MAX = (1n << 128n) - 1n;
const ctxOf = (c: StoredSigningContext | (Omit<StoredSigningContext, 'tip' | 'period'> & { tip?: string | bigint | undefined; period?: number })): SigningContext => ({
  specVersion: c.specVersion, transactionVersion: c.transactionVersion, genesisHash: c.genesisHash, blockHash: c.blockHash, blockNumber: c.blockNumber,
  nonce: c.nonce, period: c.period ?? DEFAULT_ERA_PERIOD, tip: c.tip === undefined ? 0n : BigInt(c.tip),
});
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export type CheckedExtrinsic = { ok: true; extrinsic: Uint8Array; hash: string; length: number } | { ok: false; error: string };

/**
 * Confere o extrinsic que o celular devolveu contra o pedido: só passa o que for EXATAMENTE
 * `transfer_keep_alive(dest, value)` assinado pela carteira do provider com a era, o nonce e o
 * contexto (gênese, runtime, bloco) do pedido. Pura, sem rede.
 */
export function checkSignedExtrinsic(req: { from: string; dest: string; value: string; ctx: Parameters<typeof ctxOf>[0] }, hex: string): CheckedExtrinsic {
  if (!/^0x([0-9a-fA-F]{2})+$/.test(hex)) return { ok: false, error: 'O extrinsic precisa vir em hex (0x…).' };
  const bytes = fromHex(hex);
  let prefix: { value: bigint; length: number };
  try { prefix = decodeCompact(bytes, 0); } catch { return { ok: false, error: 'Extrinsic curto demais.' }; }
  if (prefix.length + Number(prefix.value) !== bytes.length) return { ok: false, error: 'O tamanho do extrinsic não bate com o prefixo.' };
  const body = bytes.subarray(prefix.length);
  if (body.length < 1 + 1 + 32 + 1 + 64 + 2 + 1 + 1) return { ok: false, error: 'Extrinsic curto demais.' };
  if (body[0] !== 0x84) return { ok: false, error: 'Esperava um extrinsic v4 assinado (0x84).' };
  if (body[1] !== 0x00) return { ok: false, error: 'O assinante precisa ser MultiAddress::Id (chave de 32 bytes).' };
  const signer = body.subarray(2, 34);
  if (body[34] !== 0x01) return { ok: false, error: 'A assinatura precisa ser sr25519.' };
  const signature = body.subarray(35, 99);
  let o = 99;
  const era = body.subarray(o, o + 2); o += 2;
  let nonce: { value: bigint; length: number }, tip: { value: bigint; length: number };
  try {
    nonce = decodeCompact(body, o); o += nonce.length;
    tip = decodeCompact(body, o); o += tip.length;
  } catch { return { ok: false, error: 'Extrinsic curto demais (extra).' }; }
  const call = body.subarray(o);

  const from = decodeSs58(req.from);
  if (!from.ok) return { ok: false, error: `Carteira do provider inválida: ${from.error}` };
  if (!same(signer, from.publicKey)) return { ok: false, error: 'O assinante não é a carteira do provider configurada.' };

  const ctx = ctxOf(req.ctx);
  if (!same(era, mortalEra(ctx.blockNumber, ctx.period))) return { ok: false, error: 'A era não corresponde ao bloco do pedido.' };
  if (nonce.value !== BigInt(ctx.nonce)) return { ok: false, error: `O nonce (${nonce.value}) não é o do pedido (${ctx.nonce}).` };
  if (tip.value !== (ctx.tip ?? 0n)) return { ok: false, error: 'A gorjeta não é a do pedido.' };

  const decoded = decodeTransferKeepAlive(call);
  if (!decoded) return { ok: false, error: 'O call não é balances.transfer_keep_alive(dest, value).' };
  const dest = decodeSs58(req.dest);
  if (!dest.ok) return { ok: false, error: `Destino do pedido inválido: ${dest.error}` };
  if (!same(decoded.dest, dest.publicKey)) return { ok: false, error: 'O destino não é o do pedido.' };
  if (decoded.value !== BigInt(req.value)) return { ok: false, error: `O valor (${decoded.value} planck) não é o do pedido (${req.value}).` };

  if (!verifyWalletSignature(signingPayload(call, ctx), signature, signer)) {
    return { ok: false, error: 'A assinatura não confere com o pedido (chave, gênese, runtime ou bloco diferentes).' };
  }
  return { ok: true, extrinsic: bytes, hash: toHex(blake2b(bytes, { dkLen: 32 })), length: bytes.length };
}

export interface LunesSignerOptions {
  store: Store;
  endpoints?: readonly string[];
  connect?: WsFactory;
  now?: () => number;
  timeoutMs?: number;
  /** Validade do pedido para o celular assinar (padrão: SIGNING_TTL_MS). */
  ttlMs?: number;
  /** Mensagens do acompanhamento (erros de rede), opcional. */
  log?: (msg: string) => void;
}

export class LunesSigner {
  private readonly store: Store;
  private readonly endpoints: readonly string[] | undefined;
  private readonly connect: WsFactory | undefined;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly ttl: number;
  private readonly log: ((msg: string) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;
  private readonly sending = new Map<string, Promise<void>>();

  constructor(o: LunesSignerOptions) {
    this.store = o.store;
    this.endpoints = o.endpoints?.length ? [...o.endpoints] : undefined;
    this.connect = o.connect;
    this.now = o.now ?? Date.now;
    this.timeoutMs = o.timeoutMs ?? 8000;
    this.ttl = o.ttlMs ?? SIGNING_TTL_MS;
    this.log = o.log;
  }

  private async withRpc<T>(fn: (rpc: LunesRpc) => Promise<T>): Promise<T> {
    const rpc = new LunesRpc({ ...(this.endpoints ? { endpoints: this.endpoints } : {}), timeoutMs: this.timeoutMs, ...(this.connect ? { connect: this.connect } : {}) });
    try { return await fn(rpc); } finally { rpc.close(); }
  }

  /** Pendente que passou da validade vira `expired` (avaliado ao ler, sem depender do acompanhamento). */
  private refresh(t: LunesTransfer): LunesTransfer {
    if (t.status === 'pending' && this.now() > t.expiresAt) {
      return this.store.updateLunesTransfer(t.id, { status: 'expired', error: 'O celular não assinou dentro do prazo.', updatedAt: this.now() }) ?? t;
    }
    return t;
  }

  list(operatorId: string, status?: TransferStatus): LunesTransfer[] {
    const all = this.store.lunesTransfers(operatorId).map(t => this.refresh(t));
    return status ? all.filter(t => t.status === status) : all;
  }

  get(id: string, operatorId: string): LunesTransfer | null {
    const t = this.store.lunesTransfer(id);
    return t && t.operatorId === operatorId ? this.refresh(t) : null;
  }

  /** Pedido em andamento do operador (o nonce é um só: um de cada vez). */
  active(operatorId: string): LunesTransfer | null { return this.list(operatorId).find(t => ACTIVE.has(t.status)) ?? null; }

  /** Só o que ainda não foi enviado sai do registro; o resto fica como histórico. */
  cancel(id: string, operatorId: string): void {
    const t = this.get(id, operatorId);
    if (!t) throw new SigningError(404, 'Pedido não encontrado.');
    if (t.status !== 'pending' && t.status !== 'expired') throw new SigningError(409, `Este pedido já foi ${t.status === 'signed' ? 'assinado' : 'enviado'}; não dá mais para cancelar.`, { status: t.status });
    this.store.removeLunesTransfer(id);
  }

  private async runtimeVersion(rpc: LunesRpc) {
    const rv = await rpc.call<{ specVersion: number; transactionVersion: number }>('state_getRuntimeVersion');
    if (!Number.isInteger(rv?.specVersion) || !Number.isInteger(rv?.transactionVersion)) throw new Error('O nó não devolveu a versão do runtime.');
    return rv;
  }
  private runtimeMismatch(rv: { specVersion: number; transactionVersion: number }, want: { specVersion: number; transactionVersion: number }) {
    return rv.specVersion !== want.specVersion || rv.transactionVersion !== want.transactionVersion
      ? `O runtime da Lunes é specVersion ${rv.specVersion}/transactionVersion ${rv.transactionVersion}; o Piu só assina com ${want.specVersion}/${want.transactionVersion}. Atualize o Piu antes de transferir.`
      : null;
  }
  private rpcFailure(e: unknown, doing: string): SigningError {
    if (e instanceof SigningError) return e;
    if (e instanceof RpcError) return new SigningError(502, `O nó da Lunes recusou ${doing}: ${e.message}`);
    return new SigningError(503, `Sem resposta da Lunes Mainnet ao ${doing}: ${e instanceof Error ? e.message : String(e)}`);
  }

  /** Monta o pedido com o contexto lido ao vivo. `value` em planck. */
  async create(operatorId: string, from: string, dest: string, value: bigint): Promise<LunesTransfer> {
    const d = decodeSs58(dest);
    if (!d.ok) throw new SigningError(400, d.error);
    const f = decodeSs58(from);
    if (!f.ok) throw new SigningError(400, `Carteira do provider inválida: ${f.error}`);
    if (value <= 0n) throw new SigningError(400, 'O valor precisa ser maior que zero (em planck).');
    if (value > U128_MAX) throw new SigningError(400, 'Valor maior que u128.');
    if (same(d.publicKey, f.publicKey)) throw new SigningError(400, 'O destino é a própria carteira do provider.');
    const active = this.active(operatorId);
    if (active) throw new SigningError(409, 'Já existe um pedido em andamento. Conclua ou cancele antes de abrir outro.', { id: active.id, status: active.status });

    const t = await this.withRpc(async rpc => {
      let rv: { specVersion: number; transactionVersion: number };
      try { rv = await this.runtimeVersion(rpc); } catch (e) { throw this.rpcFailure(e, 'ler o runtime'); }
      const mismatch = this.runtimeMismatch(rv, CHECKED_RUNTIME);
      if (mismatch) throw new SigningError(409, mismatch, { runtime: rv, checked: CHECKED_RUNTIME });
      let genesisHash: string, fin: { number: number; hash: string }, nonce: number;
      try {
        genesisHash = await rpc.call<string>('chain_getBlockHash', [0]);
        if (!isHash(genesisHash)) throw new Error('gênese inválida');
        fin = await finalizedHead(rpc);
        nonce = await accountNextIndex(rpc, from);
      } catch (e) { throw this.rpcFailure(e, 'montar o pedido'); }
      const ctx: SigningContext = { specVersion: rv.specVersion, transactionVersion: rv.transactionVersion, genesisHash, blockHash: fin.hash, blockNumber: fin.number, nonce, period: DEFAULT_ERA_PERIOD, tip: 0n };
      // Taxa: mesmo tamanho do extrinsic real (a assinatura zerada tem os mesmos 64 bytes); na Lunes a taxa é só por byte.
      let fee: string | null = null;
      try {
        const dummy = encodeSignedExtrinsic(f.publicKey, new Uint8Array(64), signedExtra(ctx), transferKeepAliveCall(d.publicKey, value));
        fee = (await paymentQueryInfo(rpc, dummy, fin.hash)).partialFee.toString();
      } catch (e) { this.log?.(`Lunes: taxa não estimada (${e instanceof Error ? e.message : String(e)})`); }
      const now = this.now();
      const rec: LunesTransfer = {
        id: randomUUID(), operatorId, from, dest: dest.trim(), value: value.toString(), fee,
        ctx: { specVersion: ctx.specVersion, transactionVersion: ctx.transactionVersion, genesisHash, blockHash: fin.hash, blockNumber: fin.number, nonce, period: DEFAULT_ERA_PERIOD, tip: '0' },
        createdAt: now, expiresAt: now + this.ttl, validUntil: fin.number + DEFAULT_ERA_PERIOD, updatedAt: now,
        status: 'pending', extrinsic: null, txHash: null, signedAt: null, submittedAt: null, block: null, error: null,
      };
      return rec;
    });
    // As consultas levam tempo: se outro pedido entrou nesse meio, este não vale (nonce igual).
    const raced = this.active(operatorId);
    if (raced) throw new SigningError(409, 'Já existe um pedido em andamento. Conclua ou cancele antes de abrir outro.', { id: raced.id, status: raced.status });
    return this.store.addLunesTransfer(t);
  }

  /** O celular devolveu o extrinsic: conferir, validar no runtime, enviar. */
  async submitSigned(id: string, operatorId: string, hex: string): Promise<LunesTransfer> {
    const t = this.get(id, operatorId);
    if (!t) throw new SigningError(404, 'Pedido não encontrado.');
    if (t.status !== 'pending') throw new SigningError(409, `Este pedido não está mais esperando assinatura (estado: ${t.status}).`, { status: t.status });
    const chk = checkSignedExtrinsic(t, hex);
    if (!chk.ok) throw new SigningError(400, chk.error);
    const now = this.now();
    this.store.updateLunesTransfer(id, { status: 'signed', extrinsic: toHex(chk.extrinsic), txHash: chk.hash, signedAt: now, updatedAt: now, error: null });
    await this.send(this.store.lunesTransfer(id)!, true);
    return this.store.lunesTransfer(id)!;
  }

  private fail(t: LunesTransfer, error: string) {
    this.store.updateLunesTransfer(t.id, { status: 'failed', error, updatedAt: this.now() });
  }

  /** Validação pelo runtime e envio de um pedido `signed`. `throwing`: pela API (erros viram SigningError); no tick, só registra. */
  private async send(t: LunesTransfer, throwing: boolean): Promise<void> {
    const running = this.sending.get(t.id);
    if (running) return running;
    const pending = this.sendOnce(t, throwing).finally(() => this.sending.delete(t.id));
    this.sending.set(t.id, pending);
    return pending;
  }

  private async sendOnce(t: LunesTransfer, throwing: boolean): Promise<void> {
    const xt = fromHex(t.extrinsic!);
    const uncertain = t.submitAttemptedAt !== undefined;
    try {
      await this.withRpc(async rpc => {
        let rv: { specVersion: number; transactionVersion: number };
        try { rv = await this.runtimeVersion(rpc); } catch (e) { throw this.rpcFailure(e, 'ler o runtime'); }
        const mismatch = this.runtimeMismatch(rv, t.ctx) ?? this.runtimeMismatch(rv, CHECKED_RUNTIME);
        if (mismatch) {
          if (uncertain) { this.store.updateLunesTransfer(t.id, { error: `${mismatch} O envio anterior segue em acompanhamento pelo hash.`, updatedAt: this.now() }); return; }
          this.fail(t, mismatch); throw new SigningError(409, mismatch, { runtime: rv });
        }
        let validity: Awaited<ReturnType<typeof validateTransaction>>;
        try { validity = await validateTransaction(rpc, xt); } catch (e) { throw this.rpcFailure(e, 'validar a transação'); }
        if (!validity.ok) {
          const msg = `O runtime da Lunes recusou a transação: ${validity.reason} (${validity.kind}). Nada foi enviado.`;
          if (uncertain) {
            this.store.updateLunesTransfer(t.id, { error: `Resultado do envio anterior ainda não confirmado: ${validity.reason}. Acompanhando o hash; não refaça o pagamento.`, updatedAt: this.now() });
            return;
          }
          this.fail(t, msg);
          throw new SigningError(422, msg, { validity });
        }
        let hash: string;
        // Gravar ANTES da chamada: queda do processo ou da conexão depois da aceitação não pode
        // converter uma transferência possivelmente paga em falha definitiva e liberar outra.
        this.store.updateLunesTransfer(t.id, { submitAttemptedAt: t.submitAttemptedAt ?? this.now() });
        try { hash = await submitExtrinsic(rpc, xt); } catch (e) {
          if (e instanceof RpcError) {
            // O cliente RPC pode ter reenviado os MESMOS bytes noutro endpoint após perder uma
            // resposta. Mesmo Payment/BadProof aqui não provam que nenhum endpoint os aceitou.
            this.store.updateLunesTransfer(t.id, { error: `Resultado do envio ainda não confirmado: ${e.message}. Acompanhando o hash; não refaça o pagamento.`, updatedAt: this.now() });
            return;
          }
          throw this.rpcFailure(e, 'enviar');
        }
        const now = this.now();
        this.store.updateLunesTransfer(t.id, {
          status: 'submitted', txHash: t.txHash, submittedAt: now, updatedAt: now, scanned: t.ctx.blockNumber, error: hash.toLowerCase() === t.txHash?.toLowerCase() ? null : 'O hash devolvido pelo nó difere do calculado.',
        });
      });
    } catch (e) {
      // Sem resposta da rede: fica `signed`, com o motivo; o acompanhamento tenta enviar de novo (mesmos bytes).
      if (e instanceof SigningError && e.status === 503) this.store.updateLunesTransfer(t.id, { error: e.message, updatedAt: this.now() });
      if (throwing) throw e;
      this.log?.(`Lunes: pedido ${t.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Só a execução comprovada em bloco finalizado permite informar sucesso ou falha definitiva. */
  private async settleBlock(t: LunesTransfer, rpc: LunesRpc, block: NonNullable<LunesTransfer['block']>): Promise<void> {
    const execution = await readExecution(rpc, block.hash, block.index);
    if (execution.ok === true) this.store.updateLunesTransfer(t.id, { status: 'finalized', block, updatedAt: this.now(), error: null });
    else if (execution.ok === false) this.store.updateLunesTransfer(t.id, { status: 'failed', block, updatedAt: this.now(), error: `A transação foi incluída, mas a transferência falhou na execução: ${execution.error}` });
    else this.store.updateLunesTransfer(t.id, { status: 'in_block', block, updatedAt: this.now(), error: `${execution.error} Aguardando comprovação da execução; não refaça o pagamento.` });
  }

  /** Procura a transação nos blocos ainda não vistos (até o melhor bloco ou o fim da era). */
  private async track(t: LunesTransfer): Promise<void> {
    await this.withRpc(async rpc => {
      const fin = await finalizedHead(rpc);
      const bestHeader = await rpc.call<{ number: string } | null>('chain_getHeader');
      const best = bestHeader ? parseInt(bestHeader.number, 16) : fin.number;
      const txHash = t.txHash!;
      if (t.status === 'in_block' && t.block) {
        // Já visto num bloco: finaliza quando o finalizado passa dele e ele continua lá (sem reorganização).
        if (fin.number < t.block.number) return;
        const hash = await rpc.call<string | null>('chain_getBlockHash', [t.block.number]);
        const idx = hash ? await findExtrinsicInBlock(rpc, hash, txHash) : null;
        if (hash === t.block.hash && idx != null && idx >= 0) {
          await this.settleBlock(t, rpc, t.block);
        } else {
          this.store.updateLunesTransfer(t.id, { status: 'submitted', block: null, scanned: t.ctx.blockNumber, updatedAt: this.now(), error: 'O bloco foi reorganizado; procurando de novo.' });
        }
        return;
      }
      let scanned = t.scanned ?? t.ctx.blockNumber;
      const to = Math.min(best, t.validUntil);
      for (let n = scanned + 1; n <= to; n++) {
        const hash = await rpc.call<string | null>('chain_getBlockHash', [n]);
        if (!hash) break;
        const idx = await findExtrinsicInBlock(rpc, hash, txHash);
        if (idx === null) break; // bloco indisponível não é prova de ausência
        if (idx != null && idx >= 0) {
          const finalized = n <= fin.number;
          const block = { number: n, hash, index: idx };
          this.store.updateLunesTransfer(t.id, { status: 'in_block', block, scanned: n, updatedAt: this.now(), error: null });
          if (finalized) await this.settleBlock(t, rpc, block);
          return;
        }
        scanned = n;
      }
      // Cursor gravado uma vez por passo (não a cada bloco): reiniciar o nó retoma daqui.
      const finalizedScanned = Math.min(scanned, fin.number);
      if (finalizedScanned !== (t.scanned ?? t.ctx.blockNumber)) this.store.updateLunesTransfer(t.id, { scanned: finalizedScanned });
      // Um buraco de RPC não prova ausência. Só encerrar após conferir TODOS os blocos finalizados
      // da era. O cursor não avança sobre blocos ainda reorganizáveis.
      if (fin.number > t.validUntil && finalizedScanned >= t.validUntil) {
        this.fail(t, `A era passou (bloco ${t.validUntil}) sem a transação entrar em bloco. Monte um pedido novo (nonce e bloco novos).`);
      }
    });
  }

  /** Um passo do acompanhamento, para todos os operadores. Erros de rede não derrubam nada: ficam para o próximo. */
  async tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = (async () => {
      for (const t of this.store.lunesTransfers()) {
        const cur = this.refresh(t);
        try {
          if (cur.status === 'signed') {
            // Primeiro procurar o hash: um envio aceito cuja resposta se perdeu pode já estar pago.
            // signed sem marcador pode vir de versão anterior; tratar como resultado incerto também.
            if (cur.submitAttemptedAt === undefined) this.store.updateLunesTransfer(cur.id, { submitAttemptedAt: cur.signedAt ?? this.now() });
            await this.track(cur);
            const latest = this.store.lunesTransfer(cur.id);
            if (latest?.status === 'signed') await this.send(latest, false);
          }
          else if (cur.status === 'submitted' || cur.status === 'in_block') await this.track(cur);
        } catch (e) {
          this.log?.(`Lunes: acompanhamento do pedido ${cur.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })().finally(() => { this.ticking = null; });
    return this.ticking;
  }

  start(intervalMs = TRACK_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
