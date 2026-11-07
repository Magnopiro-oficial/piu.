/**
 * Papel de gateway (docs/carteira/transacoes-pela-malha.md): o nó que tem internet recebe pela malha
 * transações já assinadas e pacotes selados para o validador, entrega (Lunes Mainnet ou caixa de
 * entrada do validador) e devolve recibos pela malha. Puro TypeScript, sem React: roda no celular, no
 * piu-node (cópia em apps/piu-node/src/lunes por scripts/sync-lunes.mjs) e no computador.
 *
 * Segurança e abuso:
 * - Só aceita `transfer_keep_alive` assinada (decodeSignedTransfer), até 512 bytes; o resto nem gasta
 *   consulta. A assinatura, o nonce e o saldo quem confere é o runtime (`validate_transaction`).
 * - Idempotente: os mesmos bytes dão o mesmo hash; repetido (outra cópia, outro caminho) não reenvia,
 *   só responde o estado que já se sabe. `author_submitExtrinsic` de algo que já está no pool também conta
 *   como aceito.
 * - Tetos: validações por minuto, envios por minuto, pacotes por minuto, transações acompanhadas, hashes
 *   lembrados, respostas por hash, leituras de bloco por rodada. Acima disso a carga espera numa fila
 *   curta ou é descartada (outro gateway pode pegar uma cópia).
 * - Ordem (auditoria final, M-N1): decodifica e deduplica pelo hash (de graça), depois `validate_transaction`
 *   (cota de validação) e só então gasta a cota de envio. Lixo bem formado que a Lunes recusa não gasta a
 *   cota de envio das transações boas.
 * - Acompanhamento (B-N3): cada bloco é lido uma vez por rodada para todas as transações acompanhadas.
 * - O gateway não sabe quem mandou: responde para a identidade descartável da carga.
 * - "finalized" aqui é inclusão em bloco finalizado, não o resultado da execução; o celular confere a
 *   execução no indexador quando tiver internet.
 */
import { bundleRef, type CarryReceipt, CarryKind, type OpenedCarry } from '../protocol/carry';
import type { PublicIdentity } from '../protocol/keys';
import { decodeSignedTransfer } from './extrinsic';
import { extrinsicHash, finalizedHead, fromHex, type LunesRpc, submitExtrinsic, toHex, validateTransaction } from './lunesRpc';

export interface GatewayLimits {
  /** Consultas `validate_transaction` por minuto (o resto espera numa fila curta). */
  validationsPerMinute: number;
  /** Transações enviadas à Mainnet por minuto; só conta as que passaram na validação. */
  submitsPerMinute: number;
  /** Pacotes entregues à caixa do validador por minuto. */
  bundlesPerMinute: number;
  /** Transações acompanhadas até o bloco finalizado. */
  maxTracked: number;
  /** Itens esperando nova tentativa (sem rota agora). */
  maxQueued: number;
  /** Hashes/pacotes lembrados para deduplicar. */
  maxKnown: number;
  /** Respostas guardadas por item (cópias que chegaram por caminhos diferentes). */
  repliesPerItem: number;
  /** Blocos acompanhados depois do envio; depois disso o celular confere sozinho. */
  trackBlocks: number;
  /** Blocos olhados por transação por rodada (`tick`). */
  blocksPerTick: number;
  /** Leituras de bloco (hash + conteúdo) por rodada, somando todas as transações acompanhadas. */
  blockReadsPerTick: number;
  /** Tentativas de um item sem rota antes de responder "error". */
  maxAttempts: number;
}
export const DEFAULT_GATEWAY_LIMITS: GatewayLimits = { validationsPerMinute: 60, submitsPerMinute: 20, bundlesPerMinute: 10, maxTracked: 500, maxQueued: 200, maxKnown: 5000, repliesPerItem: 4, trackBlocks: 50, blocksPerTick: 10, blockReadsPerTick: 100, maxAttempts: 6 };
/** Uma recusa da Lunes (saldo, nonce) pode mudar; esquece depois de 1 h para uma cópia nova tentar. */
const INVALID_MEMORY_SEC = 3600;
const RETRY_BASE_SEC = 30;

export interface GatewayDeps {
  /** Cliente da Lunes (fechado pelo chamador). Sem internet: as chamadas falham e o item espera. */
  rpc: () => LunesRpc;
  /** Relógio em segundos. */
  now: () => number;
  /** Entrega o pacote selado à caixa do validador. `null`/ausente: este nó não entrega pacotes. */
  postBundle?: ((sealed: Uint8Array) => Promise<{ ok: boolean; error?: string }>) | null;
  /** Sela e põe na malha o recibo para a identidade descartável (`sealCarryReceipt` + roteador). */
  reply: (to: PublicIdentity, rc: CarryReceipt) => void;
  log?: (msg: string) => void;
}

export type HandleResult = 'submitted' | 'pool' | 'invalid' | 'duplicate' | 'queued' | 'rejected' | 'forwarded' | 'no-inbox' | 'full';

interface Known { ref: string; about: CarryKind.Tx | CarryKind.Evidence; status: CarryReceipt['status']; at: number; block?: { number: number; hash: string; index: number }; reason?: string; replies: PublicIdentity[] }
interface Tracked { hash: string; from: number; scanned: number; block?: { number: number; hash: string; index: number } }
interface Queued { ref: string; about: CarryKind.Tx | CarryKind.Evidence; bytes: Uint8Array; attempts: number; nextAt: number }
/** Cotas da janela de 1 min: validações, envios à Mainnet e pacotes para a caixa. */
type Budget = 'checks' | 'tx' | 'bundles';

const cleanReason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 120);
/** Respostas do nó que significam "esses bytes já estão no pool": envio idempotente. */
const ALREADY = /already imported|already in the pool|already exists|1013|temporarily banned/i;

export class CarryGateway {
  readonly limits: GatewayLimits;
  private known = new Map<string, Known>();
  private tracked = new Map<string, Tracked>();
  private queue = new Map<string, Queued>();
  private window: Record<Budget, number> & { start: number } = { start: 0, checks: 0, tx: 0, bundles: 0 };
  readonly counters = { submitted: 0, pool: 0, invalid: 0, duplicates: 0, rejected: 0, forwarded: 0, finalized: 0, errors: 0 };

  constructor(private d: GatewayDeps, limits: Partial<GatewayLimits> = {}) { this.limits = { ...DEFAULT_GATEWAY_LIMITS, ...limits }; }

  get trackedCount() { return this.tracked.size; }
  get queuedCount() { return this.queue.size; }
  /** Estado conhecido de uma transação (hash 0x…) ou pacote (ref hex). */
  statusOf(ref: string) { const k = this.known.get(ref.toLowerCase()); return k ? { status: k.status, block: k.block, reason: k.reason } : null; }

  /** Carga já aberta (openCarry/carryOf). */
  async handle(c: OpenedCarry): Promise<HandleResult> {
    const now = this.d.now();
    let ref: string, bytes: Uint8Array;
    if (c.item.kind === CarryKind.Tx) {
      bytes = c.item.extrinsic;
      if (!decodeSignedTransfer(bytes)) { this.counters.rejected++; return 'rejected'; }
      ref = extrinsicHash(bytes);
    } else {
      if (!this.d.postBundle) return 'no-inbox';
      bytes = c.item.sealed;
      ref = toHex(bundleRef(bytes));
    }
    const about = c.item.kind;
    const cur = this.known.get(ref);
    // Repetida: responde o que já se sabe. Volta a tentar só depois de desistir ("error" com motivo) ou
    // de uma recusa antiga (saldo e nonce mudam).
    const retry = cur && ((cur.status === 'invalid' && now - cur.at > INVALID_MEMORY_SEC) || (cur.status === 'error' && !!cur.reason && !this.queue.has(ref)));
    if (cur && !retry) {
      this.counters.duplicates++;
      this.addReply(cur, c.replyTo);
      this.send(c.replyTo, cur);
      return 'duplicate';
    }
    const k: Known = { ref, about, status: 'error', at: now, replies: cur?.replies ?? [] };
    this.addReply(k, c.replyTo);
    this.remember(k);
    // Transação: aqui só gasta a cota de VALIDAÇÃO; a de envio só depois que a Lunes aceitar (M-N1).
    if (!this.take(about === CarryKind.Tx ? 'checks' : 'bundles', now)) return this.enqueue(k, bytes, now, 0);
    return about === CarryKind.Tx ? this.submit(k, bytes, 0) : this.forward(k, bytes, 0);
  }

  /**
   * Rodada periódica: tenta de novo o que ficou sem rota e acompanha as transações enviadas até um
   * bloco finalizado (um recibo a cada mudança: no pool → em bloco → finalizada).
   */
  async tick(): Promise<void> {
    // Uma rodada por vez (o temporizador não espera a anterior terminar): sem recibo nem contagem em dobro.
    if (this.ticking) return;
    this.ticking = true;
    try { await this.round(); } finally { this.ticking = false; }
  }
  private ticking = false;

  private async round(): Promise<void> {
    const now = this.d.now();
    for (const q of [...this.queue.values()]) {
      if (q.nextAt > now) continue;
      // Sem cota de envio agora: nem valida (seria consulta jogada fora); espera a próxima janela.
      if (q.about === CarryKind.Tx && !this.room('tx', now)) continue;
      if (!this.take(q.about === CarryKind.Tx ? 'checks' : 'bundles', now)) continue;
      this.queue.delete(q.ref);
      const k = this.known.get(q.ref);
      if (!k) continue;
      await (q.about === CarryKind.Tx ? this.submit(k, q.bytes, q.attempts) : this.forward(k, q.bytes, q.attempts));
    }
    if (!this.tracked.size) return;
    const rpc = this.d.rpc();
    // Leituras da rodada compartilhadas por todas as transações acompanhadas (B-N3): hash do bloco por
    // número e, por hash, o índice de cada transação nele. `undefined`: o teto da rodada acabou.
    const hashes = new Map<number, string | null>();
    const blocks = new Map<string, Map<string, number> | null>();
    let reads = 0;
    const hashAt = async (n: number): Promise<string | null | undefined> => {
      if (hashes.has(n)) return hashes.get(n);
      if (reads >= this.limits.blockReadsPerTick) return undefined;
      reads++;
      const h = await rpc.call<string | null>('chain_getBlockHash', [n]);
      hashes.set(n, h);
      return h;
    };
    const txsIn = async (hash: string): Promise<Map<string, number> | null | undefined> => {
      if (blocks.has(hash)) return blocks.get(hash);
      if (reads >= this.limits.blockReadsPerTick) return undefined;
      reads++;
      const b = await rpc.call<{ block: { extrinsics: string[] } } | null>('chain_getBlock', [hash]);
      let m: Map<string, number> | null = null;
      if (b) {
        m = new Map();
        // Primeira ocorrência vale (como o `findIndex` de antes).
        b.block.extrinsics.forEach((x, i) => { const h = extrinsicHash(fromHex(x)); if (!m!.has(h)) m!.set(h, i); });
      }
      blocks.set(hash, m);
      return m;
    };
    try {
      const fin = await finalizedHead(rpc);
      const best = parseInt((await rpc.call<{ number: string }>('chain_getHeader')).number, 16);
      for (const t of [...this.tracked.values()]) {
        const k = this.known.get(t.hash);
        if (!k) { this.tracked.delete(t.hash); continue; }
        if (!t.block) {
          const to = Math.min(best, t.scanned + this.limits.blocksPerTick, t.from + this.limits.trackBlocks);
          for (let n = t.scanned + 1; n <= to; n++) {
            const hash = await hashAt(n);
            if (!hash) break;
            const txs = await txsIn(hash);
            if (!txs) break;
            t.scanned = n;
            const index = txs.get(t.hash.toLowerCase());
            if (index !== undefined) { t.block = { number: n, hash, index }; this.update(k, 'included', t.block); break; }
          }
          if (!t.block && t.scanned >= t.from + this.limits.trackBlocks) { this.tracked.delete(t.hash); continue; }
        }
        if (t.block && fin.number >= t.block.number) {
          // Confere que o bloco ainda é o canônico antes de dizer "finalizada".
          const canonical = await hashAt(t.block.number);
          if (canonical === undefined) continue; // teto da rodada: confere na próxima
          if (canonical === t.block.hash) { this.update(k, 'finalized', t.block); this.counters.finalized++; this.tracked.delete(t.hash); }
          else { t.block = undefined; t.scanned = t.from; }
        }
      }
    } catch (e) {
      this.d.log?.(`gateway: acompanhamento indisponível (${cleanReason(e)})`);
    } finally { rpc.close(); }
  }

  private async submit(k: Known, bytes: Uint8Array, attempts: number): Promise<HandleResult> {
    const rpc = this.d.rpc();
    try {
      const fin = await finalizedHead(rpc);
      const v = await validateTransaction(rpc, bytes, fin.hash);
      if (!v.ok) {
        this.counters.invalid++;
        // Stale = nonce já usado: pode ser esta mesma transação já incluída por outro gateway.
        this.update(k, 'invalid', undefined, v.reason);
        return 'invalid';
      }
      // Só agora gasta a cota de envio (M-N1). Sem cota: espera a janela abrir, sem contar tentativa.
      const now = this.d.now();
      if (!this.take('tx', now)) return this.enqueue(k, bytes, now, attempts, undefined, this.window.start + 60);
      try {
        const h = await submitExtrinsic(rpc, bytes);
        if (h.toLowerCase() !== k.ref) this.d.log?.(`gateway: o nó devolveu outro hash (${h}); acompanhando o calculado aqui`);
        this.counters.submitted++;
      } catch (e) {
        if (!ALREADY.test(cleanReason(e))) throw e;
        this.counters.pool++;
      }
      this.track(k.ref, fin.number);
      this.update(k, 'pool');
      return 'submitted';
    } catch (e) {
      this.counters.errors++;
      this.d.log?.(`gateway: envio sem resposta (${cleanReason(e)}); tenta de novo`);
      return this.enqueue(k, bytes, this.d.now(), attempts + 1, cleanReason(e));
    } finally { rpc.close(); }
  }

  private async forward(k: Known, bytes: Uint8Array, attempts: number): Promise<HandleResult> {
    const post = this.d.postBundle;
    if (!post) return 'no-inbox';
    let r: { ok: boolean; error?: string };
    try { r = await post(bytes); } catch (e) { r = { ok: false, error: cleanReason(e) }; }
    if (r.ok) { this.counters.forwarded++; this.update(k, 'accepted'); return 'forwarded'; }
    this.counters.errors++;
    return this.enqueue(k, bytes, this.d.now(), attempts + 1, r.error);
  }

  /** `nextAt`: por padrão, espera crescente pelo número de tentativas falhas. */
  private enqueue(k: Known, bytes: Uint8Array, now: number, attempts: number, reason?: string, nextAt = now + (attempts ? RETRY_BASE_SEC * 2 ** (attempts - 1) : 0)): HandleResult {
    if (attempts >= this.limits.maxAttempts) { this.update(k, 'error', undefined, reason ?? 'sem rota'); return 'full'; }
    if (!this.queue.has(k.ref) && this.queue.size >= this.limits.maxQueued) { this.known.delete(k.ref); return 'full'; }
    this.queue.set(k.ref, { ref: k.ref, about: k.about, bytes, attempts, nextAt });
    return 'queued';
  }

  private track(hash: string, from: number) {
    if (this.tracked.has(hash)) return;
    if (this.tracked.size >= this.limits.maxTracked) this.tracked.delete(this.tracked.keys().next().value!);
    this.tracked.set(hash, { hash, from, scanned: from });
  }

  /** Janela de 1 min para os tetos: ainda cabe mais um em `b`? (não gasta) */
  private room(b: Budget, now: number): boolean {
    if (now - this.window.start >= 60) this.window = { start: now, checks: 0, tx: 0, bundles: 0 };
    const cap = b === 'checks' ? this.limits.validationsPerMinute : b === 'tx' ? this.limits.submitsPerMinute : this.limits.bundlesPerMinute;
    return this.window[b] < cap;
  }

  /** Gasta uma unidade da cota `b`; false se a janela já encheu. */
  private take(b: Budget, now: number): boolean {
    if (!this.room(b, now)) return false;
    this.window[b]++;
    return true;
  }

  private remember(k: Known) {
    this.known.delete(k.ref);
    this.known.set(k.ref, k);
    while (this.known.size > this.limits.maxKnown) this.known.delete(this.known.keys().next().value!);
  }

  private addReply(k: Known, to: PublicIdentity) {
    const same = (a: PublicIdentity) => a.agreePk.length === to.agreePk.length && a.agreePk.every((x, i) => x === to.agreePk[i]);
    if (k.replies.some(same)) return;
    k.replies.push(to);
    if (k.replies.length > this.limits.repliesPerItem) k.replies.shift();
  }

  private update(k: Known, status: CarryReceipt['status'], block?: Known['block'], reason?: string) {
    k.status = status; k.at = this.d.now(); k.block = block; k.reason = reason;
    for (const to of k.replies) this.send(to, k);
  }

  private send(to: PublicIdentity, k: Known) {
    if (k.status === 'error' && !k.reason) return; // ainda tentando: nada a dizer
    try {
      this.d.reply(to, { about: k.about, ref: fromHex(k.ref), status: k.status, ...(k.block ? { block: { number: k.block.number, hash: fromHex(k.block.hash), index: k.block.index } } : {}), ...(k.reason ? { reason: k.reason } : {}) });
    } catch (e) { this.d.log?.(`gateway: recibo não saiu (${cleanReason(e)})`); }
  }
}
