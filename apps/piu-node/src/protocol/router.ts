// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/protocol/router.ts. Não edite aqui.
/**
 * Roteamento store-and-forward de um nó (documento, seções 5 e 10):
 * - guarda envelopes cifrados e os repassa quando surge um contato (FUN-010);
 * - respeita TTL e retenção máxima e apaga sozinho o que venceu, sem comando remoto (FUN-011);
 * - descarta duplicatas pelo id criptográfico, sem gerar crédito duplicado (FUN-012);
 * - evita loops: limite de saltos, não devolve a quem enviou, não repete o envio ao mesmo vizinho,
 *   e limita o número de cópias por envelope;
 * - aplica os limites do nó: espaço, quantidade, tamanho e retenção (FUN-018);
 * - nunca manda conteúdo pesado (mídia) por LoRa;
 * - só retransmite para terceiros com o Modo nó ligado (FUN-017).
 * O nó não precisa de chave nenhuma para rotear: lê só o cabeçalho.
 */
import { ProtocolError, toHex } from './bytes.js';
import { random } from './suite.js';
import { type AcceptDest, envelopeId, type GroupKey, type Header, MAX_TTL_SEC, CLOCK_SKEW_SEC, openDirect, openGroup, type Opened, parseHeader, withHops } from './envelope.js';
import type { Identity, KeyPair } from './keys.js';
import { makeRelayReceipt, type RelayReceipt } from './receipts.js';

export type TransportClass = 'ble' | 'direct' | 'mesh' | 'lora' | 'eth';

export interface RouterLimits {
  maxBytes: number; maxCount: number; maxRetentionSec: number; maxEnvelopeBytes: number;
  /** Cópias por envelope (spray limitado): evita inundar a malha. */
  maxCopies: number;
  /** Quantos ids lembrar para deduplicar (protege a memória contra enxurrada de envelopes). */
  maxSeen: number;
  /**
   * Limite por vizinho (balde de fichas): envelopes por minuto e rajada máxima.
   * Um vizinho que inunda o nó é recusado sem custo de criptografia nem de armazenamento.
   */
  peerPerMinute: number;
  peerBurst: number;
}

export const DEFAULT_LIMITS: RouterLimits = { maxBytes: 512 * 1024 * 1024, maxCount: 20000, maxRetentionSec: 48 * 3600, maxEnvelopeBytes: 32 * 1024, maxCopies: 6, maxSeen: 100_000, peerPerMinute: 600, peerBurst: 120 };

export type IngestResult =
  | { status: 'delivered'; message: Opened; stored: boolean; /** Saltos que ainda restavam ao chegar. */ hopsLeft: number }
  | { status: 'stored' | 'duplicate' | 'expired' | 'relay-off' | 'full'; id: string }
  | { status: 'rejected'; reason: string };

interface Entry { id: string; bytes: Uint8Array; header: Header; from: string | null; own: boolean; storedAt: number; dropAt: number; sentTo: Set<string>; copies: number; releaseAt: number }

export interface RouterOptions {
  node: KeyPair;
  identities: Identity[];
  groupKeys?: GroupKey[];
  /** Membros atuais de cada grupo (ver `openGroup`). */
  isMember?: (fromId: string, groupId: string) => boolean;
  /** Destinos de sessões estabelecidas (SessionManager.acceptsDest). */
  acceptDest?: AcceptDest;
  /**
   * Abertura por destino conhecido, antes das identidades (carry.ts: gateway e identidades descartáveis
   * de retorno). Quem implementa compara o destino do cabeçalho e só abre com a chave certa, para não
   * custar uma troca de chaves a mais em cada envelope que chega.
   */
  openExtra?: (bytes: Uint8Array, h: Header, now: number) => Opened | null;
  relay: boolean;
  limits?: Partial<RouterLimits>;
}

export class Router {
  private store = new Map<string, Entry>();
  /** Ids já vistos até vencerem: duplicata chegando por outro caminho é descartada. */
  private seen = new Map<string, number>();
  private bytesUsed = 0;
  private buckets = new Map<string, { tokens: number; at: number }>();
  readonly limits: RouterLimits;
  readonly receipts: RelayReceipt[] = [];
  readonly inbox: Opened[] = [];
  relay: boolean;
  identities: Identity[];
  groupKeys: GroupKey[];

  constructor(private o: RouterOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...o.limits };
    this.relay = o.relay;
    this.identities = o.identities;
    this.groupKeys = o.groupKeys ?? [];
  }

  get size() { return this.store.size; }
  /** Tamanho e validade de um envelope guardado (para o crédito do recibo). */
  infoOf(id: string) { const e = this.store.get(id); return e ? { bytes: e.bytes.length, expiresAt: e.header.expiresAt, copies: e.copies } : null; }
  /** Já passou por aqui (vale para provas de entrega: só repassa prova de envelope conhecido). */
  hasSeen(id: string) { return this.seen.has(id); }
  /** Bytes guardados de terceiros (diagnóstico). */
  thirdPartyBytes() { let n = 0; for (const e of this.store.values()) if (!e.own) n += e.bytes.length; return n; }
  /** Envelopes de terceiros guardados agora (painel do ponto Piu: só contagem e bytes). */
  thirdPartyStats() { let count = 0, bytes = 0; for (const e of this.store.values()) if (!e.own) { count++; bytes += e.bytes.length; } return { count, bytes }; }
  /** Apaga todos os envelopes de terceiros guardados (encerrar o ponto Piu). As próprias mensagens ficam. */
  dropThirdParty() { let n = 0; for (const e of [...this.store.values()]) if (!e.own) { this.drop(e.id); n++; } return n; }
  /** Envelope criado neste aparelho (não é de terceiros)? */
  isOwn(id: string) { return this.store.get(id)?.own ?? false; }
  has(id: string) { return this.store.has(id); }

  /**
   * Mensagem criada aqui: entra na fila mesmo com o Modo nó desligado.
   * `delaySec` (ajuste "Atraso aleatório no envio"): só sai depois desse tempo, dificultando
   * correlacionar o envio com o momento em que a pessoa digitou. Use `randomDelaySec()`.
   */
  send(bytes: Uint8Array, now: number, opts: { delaySec?: number } = {}): IngestResult {
    const r = this.ingest(bytes, null, now);
    if (r.status === 'stored' && opts.delaySec) this.store.get(r.id)!.releaseAt = now + opts.delaySec;
    return r;
  }

  /** Envelope que chegou de um vizinho (`from`), ou criado aqui (`from = null`). */
  ingest(bytes: Uint8Array, from: string | null, now: number): IngestResult {
    if (from !== null && !this.take(from, now)) return { status: 'rejected', reason: 'limite do vizinho' };
    if (bytes.length > this.limits.maxEnvelopeBytes) return { status: 'rejected', reason: 'grande demais' };
    let h: Header;
    try { h = parseHeader(bytes); } catch (e) { return { status: 'rejected', reason: e instanceof ProtocolError ? e.code : 'inválido' }; }
    const id = envelopeId(bytes);
    if (h.expiresAt <= now) return { status: 'expired', id };
    if (h.expiresAt > now + MAX_TTL_SEC + CLOCK_SKEW_SEC) return { status: 'rejected', reason: 'TTL acima do máximo' };
    this.purge(now);
    if (this.seen.has(id)) return { status: 'duplicate', id };
    this.seen.set(id, h.expiresAt);
    if (this.seen.size > this.limits.maxSeen) this.seen.delete(this.seen.keys().next().value!); // esquece o mais antigo

    const own = from === null;
    // Tenta abrir: o destino valida integridade e autenticidade antes de mostrar o conteúdo.
    const opened = own ? null : this.tryOpen(bytes, h, now);
    if (opened) {
      this.inbox.push(opened);
      // Direta: chegou ao destino, não segue adiante. Grupo: os outros membros ainda precisam receber.
      const stored = h.kind === 2 && this.relay ? this.keep(id, bytes, h, from, false, now) === 'stored' : false;
      return { status: 'delivered', message: opened, stored, hopsLeft: h.hops };
    }
    if (!own && !this.relay) return { status: 'relay-off', id };
    const r = this.keep(id, bytes, h, from, own, now);
    return { status: r, id };
  }

  /** Balde de fichas por vizinho: repõe `peerPerMinute` por minuto, até `peerBurst`. */
  private take(peer: string, now: number): boolean {
    const b = this.buckets.get(peer) ?? { tokens: this.limits.peerBurst, at: now };
    b.tokens = Math.min(this.limits.peerBurst, b.tokens + ((now - b.at) * this.limits.peerPerMinute) / 60);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(peer, b);
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value!);
    return ok;
  }

  private tryOpen(bytes: Uint8Array, h: Header, now: number): Opened | null {
    const extra = this.o.openExtra?.(bytes, h, now);
    if (extra) return extra;
    for (const me of this.identities) { const m = openDirect(bytes, me, now, this.o.acceptDest); if (m) return m; }
    return this.groupKeys.length ? openGroup(bytes, this.groupKeys, now, this.o.isMember) : null;
  }

  private keep(id: string, bytes: Uint8Array, h: Header, from: string | null, own: boolean, now: number): 'stored' | 'full' {
    const e: Entry = { id, bytes, header: h, from, own, storedAt: now, dropAt: own ? h.expiresAt : Math.min(h.expiresAt, now + this.limits.maxRetentionSec) /* a retenção limita o que é de terceiros; as próprias ficam até o TTL */, sentTo: new Set(), copies: 0, releaseAt: now };
    if (!this.makeRoom(e)) return 'full';
    this.store.set(id, e);
    this.bytesUsed += bytes.length;
    return 'stored';
  }

  /** Abre espaço tirando primeiro o que é de terceiros, de menor prioridade e que vence antes. */
  private makeRoom(e: Entry): boolean {
    const fits = () => this.store.size + 1 <= this.limits.maxCount && this.bytesUsed + e.bytes.length <= this.limits.maxBytes;
    if (fits()) return true;
    const rank = (x: Entry) => [x.own ? 1 : 0, x.header.priority, x.dropAt] as const;
    const victims = [...this.store.values()].filter(x => !x.own).sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });
    for (const v of victims) {
      const rv = rank(v), re = rank(e);
      if (rv[0] > re[0] || (rv[0] === re[0] && (rv[1] > re[1] || (rv[1] === re[1] && rv[2] >= re[2])))) break; // só tira o que vale menos
      this.drop(v.id);
      if (fits()) return true;
    }
    return fits();
  }

  private drop(id: string) {
    const e = this.store.get(id);
    if (!e) return;
    this.store.delete(id);
    this.bytesUsed -= e.bytes.length;
  }

  /** Remove o que venceu (TTL ou retenção) e esquece ids vencidos. Sem comando remoto. */
  purge(now: number) {
    for (const e of [...this.store.values()]) if (e.dropAt <= now) this.drop(e.id);
    for (const [id, exp] of this.seen) if (exp <= now) this.seen.delete(id);
  }

  /**
   * Envelopes para entregar a um vizinho que acabou de aparecer, por um transporte.
   * Ordem: prioridade, depois o que vence antes. Cada envelope vai no máximo uma vez a cada vizinho.
   */
  outgoing(peer: string, via: TransportClass, now: number, opts: { thirdPartyBudget?: number; maxBytes?: number } = {}): Uint8Array[] {
    this.purge(now);
    const out: Entry[] = [];
    // Limite de banda para terceiros (bytes nesta rodada); as próprias mensagens não entram na conta.
    let budget = opts.thirdPartyBudget ?? Infinity;
    for (const e of this.store.values()) {
      if (e.releaseAt > now) continue;                         // atraso aleatório ainda correndo
      if (e.header.hops === 0) continue;                       // limite de saltos (anti-loop)
      if (e.from === peer || e.sentTo.has(peer)) continue;     // não devolve, não repete
      if (e.copies >= this.limits.maxCopies) continue;         // spray limitado
      if (e.header.bulk && via === 'lora') continue;           // mídia nunca por LoRa
      if (opts.maxBytes !== undefined && e.bytes.length > opts.maxBytes) continue; // grande demais para este meio (fica para outro)
      if (!e.own && !this.relay) continue;                     // Modo nó desligado: só as próprias
      out.push(e);
    }
    out.sort((a, b) => b.header.priority - a.header.priority || a.header.expiresAt - b.header.expiresAt);
    const chosen = out.filter(e => {
      if (e.own) return true;
      if (e.bytes.length > budget) return false; // fica para a próxima rodada, sem marcar como enviado
      budget -= e.bytes.length;
      return true;
    });
    return chosen.map(e => {
      e.sentTo.add(peer);
      e.copies += 1;
      // Evidência de contribuição: só para mensagens de terceiros, uma por envelope por nó.
      if (!e.own && e.copies === 1) this.receipts.push(makeRelayReceipt(this.o.node, e.id, e.header.ackHash, now));
      return withHops(e.bytes, e.header.hops - 1);
    });
  }

  /** Para uma mensagem direta entregue, o destino pode parar de guardar cópias dela (confirmação). */
  forget(id: string) { this.drop(id); }

  /**
   * O envio a este vizinho não se completou (o enlace caiu ou o rádio desistiu): o envelope volta a
   * poder ir para ele. Não mexe nas cópias nem nos recibos (a primeira cópia já gerou o recibo).
   */
  unsent(peer: string, id: string) { this.store.get(id)?.sentTo.delete(peer); }

  /**
   * Ids já vistos, para salvar no aparelho. Sem isto, depois de reabrir o app um envelope antigo
   * repetido (replay) seria aceito de novo até vencer.
   */
  exportSeen(): [string, number][] { return [...this.seen]; }
  /** Restaura os ids vistos (os vencidos são ignorados). */
  importSeen(list: [string, number][], now: number) {
    for (const [id, exp] of list) if (exp > now && !this.seen.has(id)) this.seen.set(id, exp);
    while (this.seen.size > this.limits.maxSeen) this.seen.delete(this.seen.keys().next().value!);
  }

  /**
   * Envelopes guardados, para salvar em disco (um nó que reinicia não perde o que guardava: o
   * conteúdo continua cifrado de ponta a ponta, o nó só guarda os bytes). Leva também a quem cada
   * um já foi e quantas cópias saíram, para o reinício não repetir envio nem recibo.
   */
  exportStored(): StoredEnvelope[] {
    return [...this.store.values()].map(e => ({ bytes: e.bytes, from: e.from, own: e.own, storedAt: e.storedAt, dropAt: e.dropAt, sentTo: [...e.sentTo], copies: e.copies, releaseAt: e.releaseAt }));
  }

  /**
   * Restaura envelopes salvos com `exportStored`. Cada um é conferido de novo como se tivesse
   * acabado de chegar: cabeçalho válido, tamanho, TTL (vencido é descartado), retenção, espaço e
   * quantidade (`maxBytes`, `maxCount`). O id passa a contar como visto (deduplicação).
   * Devolve quantos voltaram.
   */
  importStored(list: StoredEnvelope[], now: number): number {
    let n = 0;
    // Do mais importante ao menos: se o limite diminuiu, o que fica de fora é o que valeria menos.
    const parsed: { s: StoredEnvelope; h: Header; id: string }[] = [];
    for (const s of list) {
      if (!(s.bytes instanceof Uint8Array) || s.bytes.length > this.limits.maxEnvelopeBytes) continue;
      let h: Header;
      try { h = parseHeader(s.bytes); } catch { continue; }
      if (h.expiresAt <= now || h.expiresAt > now + MAX_TTL_SEC + CLOCK_SKEW_SEC) continue;
      parsed.push({ s, h, id: envelopeId(s.bytes) });
    }
    parsed.sort((a, b) => Number(b.s.own) - Number(a.s.own) || b.h.priority - a.h.priority || a.h.expiresAt - b.h.expiresAt);
    for (const { s, h, id } of parsed) {
      if (this.store.has(id)) continue;
      const own = !!s.own;
      const dropAt = own ? h.expiresAt : Math.min(h.expiresAt, s.dropAt, s.storedAt + this.limits.maxRetentionSec);
      if (dropAt <= now) continue;
      if (this.keep(id, s.bytes, h, own ? null : s.from, own, s.storedAt) !== 'stored') continue;
      const e = this.store.get(id)!;
      e.dropAt = dropAt;
      e.sentTo = new Set(s.sentTo);
      e.copies = Math.max(0, Math.min(s.copies, this.limits.maxCopies));
      e.releaseAt = s.releaseAt;
      if (!this.seen.has(id)) this.seen.set(id, h.expiresAt);
      n++;
    }
    while (this.seen.size > this.limits.maxSeen) this.seen.delete(this.seen.keys().next().value!);
    return n;
  }

  stats() { return { stored: this.store.size, bytes: this.bytesUsed, seen: this.seen.size, nodePk: toHex(this.o.node.pk).slice(0, 8) }; }
}

/** Envelope guardado, na forma em que sai de `exportStored` (para salvar em disco e restaurar). */
export interface StoredEnvelope { bytes: Uint8Array; from: string | null; own: boolean; storedAt: number; dropAt: number; sentTo: string[]; copies: number; releaseAt: number }

/** Atraso uniforme de 0 a `maxSec` segundos, com aleatoriedade criptográfica. */
export function randomDelaySec(maxSec = 30): number {
  const r = random(4);
  return ((r[0]! << 24 | r[1]! << 16 | r[2]! << 8 | r[3]!) >>> 0) % (maxSec + 1);
}
