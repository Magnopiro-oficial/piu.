/**
 * Motor de retransmissão do piu-node: o `Router` do protocolo (store-and-forward, deduplicação,
 * TTL, limites, recibos) ligado a enlaces LNNP v1 já autenticados. Não depende do meio: o adapter
 * LAN (lan.ts) entrega enlaces prontos; outros adapters (BLE, LoRa, USB) podem fazer o mesmo.
 *
 * O nó não tem chave social nenhuma: lê só o cabeçalho dos envelopes e nunca decifra conteúdo
 * (INF-011). A única chave é a técnica do nó (`deriveNodeKey`), que assina o handshake e os recibos.
 */
import { toHex } from '../protocol/bytes.js';
import { envelopeId, parseHeader } from '../protocol/envelope.js';
import { fragment, Reassembler } from '../protocol/fragment.js';
import type { Identity, KeyPair } from '../protocol/keys.js';
import {
  type Capabilities, decodeReceipt, defaultCapabilities, encodeCaps, encodeReceipt, Feature, type Frame, FrameType, type HandshakeOptions,
  LNNP_MIN_VERSION, LNNP_VERSION, type LinkSession, Medium, nodeTag, ReplayGuard,
} from '../protocol/lnnp.js';
import { type RelayReceipt, verifyRelayReceipt } from '../protocol/receipts.js';
import { type IngestResult, Router, type TransportClass } from '../protocol/router.js';
import type { HoursPolicy, Settings } from '../store.js';
import {
  decodeCert, decodeRevocationList, encodeCert, encodeRevocationList, FRAME_OPERATOR_CERT, FRAME_REVOCATION_LIST, type OperatorCert,
  type RevocationList, type RotationStep, samePk, trustPath, verifyCert, verifyRevocationList,
} from './operator-frames.js';
import type { RelaySnapshot } from './persist.js';
import { confirmCode } from './confirm.js';

/** Um enlace autenticado, visto pelo motor. O adapter cuida do meio físico. */
export interface LinkPort {
  /** Único por conexão (o mesmo vizinho pode reconectar). */
  id: string;
  session: LinkSession;
  /** Classe do meio para o roteador (mídia nunca vai por LoRa, por exemplo). */
  medium: TransportClass;
  /** Quem abriu a conexão: o vizinho (`true`) ou este nó. */
  inbound: boolean;
  /** Endereço no meio (ex.: `192.168.0.12:8422`), só para o operador. */
  address: string;
  since: number;
  /** `envelope`: id do envelope que o registro leva (o adapter avisa `undelivered` se não chegar). */
  send(record: Uint8Array, envelope?: string): void;
  close(): void;
  /** Capacidades anunciadas neste enlace (o LoRa anuncia MTU pequena e o meio LoRa). */
  caps?: Partial<Capabilities>;
  /** Bytes que o enlace aceita agora (fila do rádio). Ausente: sem limite (TCP). */
  capacity?(): number;
  /** Maior envelope que este meio leva (LoRa: só mensagens pequenas). */
  maxEnvelope?: number;
}

export interface EngineOptions {
  node: KeyPair;
  /** Modo nó: retransmite envelopes de terceiros (o operador ainda pode limitar por horário). */
  relay: boolean;
  /** Teto de memória para envelopes guardados (o armazenamento do painel não passa disto). */
  memoryBytes: number;
  /** Identidades locais (só em testes ou num nó que também é cliente). O piu-node normal não tem nenhuma. */
  identities?: Identity[];
  /** Chaves de nó permitidas (hex). `null`: qualquer nó LNNP. */
  allow?: string[] | null;
  /** Relógio em ms (testes). */
  now?: () => number;
  log?: (msg: string) => void;
  /** A confiança no operador mudou (rotação aprendida, lista nova, certificado novo): salvar. */
  onOperatorChange?: (s: OperatorTrustState) => void;
}

/**
 * O que este nó sabe do operador dono dele (ver operator-frames.ts):
 * - `lineage`: chaves do operador, da primeira à atual (a atual é a última). Reconhece vizinhos do
 *   mesmo operador; só a atual assina listas de revogação aceitas.
 * - `cert`: o certificado deste nó (assinado pelo operador).
 * - `deviceCerts`: certificados de outros equipamentos do operador, entregues a eles quando conectam.
 * - `list`: a lista de revogação em vigor (a de número maior).
 */
export interface OperatorTrust { lineage: string[]; cert: OperatorCert | null; deviceCerts: OperatorCert[]; list: RevocationList | null }
/** O que o motor aprende da malha e precisa sobreviver ao reinício. */
export interface OperatorTrustState { learned: RotationStep[]; cert: OperatorCert | null; list: RevocationList | null }

/** Regras de um equipamento (assistente, passo "Regras"): banda (Mbps), armazenamento (GB) e horário. */
export interface DeviceLimits { bw: number; sto: number; hours: HoursPolicy }

export interface Counters {
  /** Envelopes recebidos de vizinhos. */
  received: number;
  /** Guardados para retransmitir (de terceiros). */
  stored: number;
  /** Enviados a vizinhos (cada cópia conta). */
  forwarded: number;
  /** Entregues a uma identidade local (só nós com identidade). */
  delivered: number;
  duplicates: number;
  /** Recusados: inválidos, acima do limite do vizinho, política do operador. */
  rejected: number;
  /** Não guardados porque a retransmissão está desligada (Modo nó ou horário). */
  relayOff: number;
  /** Sem espaço (limite de armazenamento). */
  full: number;
  expired: number;
  /** Recibos de retransmissão assinados por este nó. */
  receipts: number;
  /** Recibos de outros nós recebidos (assinatura conferida). */
  receiptsReceived: number;
  handshakesOk: number;
  handshakesFailed: number;
  /** Handshakes recusados e enlaces fechados por chave revogada pelo operador. */
  revokedRefused: number;
}

const GiB = 1024 ** 3;
const RECEIPT_LOG = 1000;

/** O horário de operação vale agora? (hora local do equipamento) */
export function inWindow(hours: HoursPolicy, ms: number): boolean {
  if (hours === 'always') return true;
  const h = new Date(ms).getHours();
  return hours === 'night' ? h >= 22 || h < 7 : h >= 8 && h < 18;
}

const mediaNames: [Medium, string][] = [[Medium.Ble, 'ble'], [Medium.Direct, 'wifi-direct'], [Medium.Mesh, 'mesh'], [Medium.Lora, 'lora'], [Medium.Eth, 'ethernet'], [Medium.Usb, 'usb']];

export class RelayEngine {
  readonly router: Router;
  readonly node: KeyPair;
  readonly tag: Uint8Array;
  readonly replay = new ReplayGuard();
  readonly counters: Counters = { received: 0, stored: 0, forwarded: 0, delivered: 0, duplicates: 0, rejected: 0, relayOff: 0, full: 0, expired: 0, receipts: 0, receiptsReceived: 0, handshakesOk: 0, handshakesFailed: 0, revokedRefused: 0 };
  /** Recibos mais recentes (deste nó e recebidos), para entregar ao validador quando houver rota. */
  readonly receiptLog: RelayReceipt[] = [];
  private links = new Map<string, LinkPort>();
  private reassembly = new Map<string, Reassembler>();
  private settings: Settings['limits'] & { media: boolean } = { bw: 50, sto: 8, hours: 'always', media: true };
  /** Regras deste equipamento (assistente, passo "Regras"); valem junto com os limites globais. */
  private device: DeviceLimits | null = null;
  private bucket = { tokens: 0, at: 0 };
  private now: () => number;
  private log: (msg: string) => void;
  private allow: Set<string> | null;
  /** Pausado pelo operador no painel (Equipamentos → Pausar retransmissão). */
  private paused = false;
  /** Quando o motor subiu (ms), para o painel mostrar há quanto tempo o nó está ligado. */
  readonly startedAt: number;
  /** Cresce a cada mudança no que é salvo em disco (envelopes, ids vistos, recibos). */
  changes = 0;
  /** Envelopes e recibos que voltaram do disco ao subir (para o log e o painel). */
  restored = { envelopes: 0, seen: 0, receipts: 0 };
  /** Operador dono deste nó (linhagem de chaves, certificados, revogação). */
  private op: OperatorTrust = { lineage: [], cert: null, deviceCerts: [], list: null };
  /** Passos de rotação aprendidos de vizinhos (além dos que o operador tem aqui). */
  private learned: RotationStep[] = [];
  private revoked = new Set<string>();
  /** Enlaces cujo vizinho mostrou certificado do mesmo operador (id do enlace → chave do operador). */
  private sameOperator = new Map<string, string>();
  /** Última vez que cada vizinho (id) esteve conectado, desde que o motor subiu (só em memória). */
  private lastSeen = new Map<string, number>();

  constructor(private o: EngineOptions) {
    this.node = o.node;
    this.tag = nodeTag(o.node.pk);
    this.now = o.now ?? Date.now;
    this.startedAt = this.now();
    this.log = o.log ?? (() => {});
    this.allow = o.allow ? new Set(o.allow.map(x => x.toLowerCase())) : null;
    this.router = new Router({ node: o.node, identities: o.identities ?? [], relay: o.relay });
    this.applySettings(null);
  }

  private sec() { return Math.floor(this.now() / 1000); }

  /** Limites do operador (`/api/settings`) aplicados ao roteador: banda, armazenamento, horário, mídia. */
  applySettings(s: Settings | null, device?: DeviceLimits | null) {
    const before = this.relaying;
    if (s) this.settings = { ...s.limits, media: s.policies.media };
    if (device !== undefined) this.device = device;
    this.router.limits.maxBytes = Math.min(this.effective.sto * GiB, this.o.memoryBytes);
    this.bucket = { tokens: this.rate(), at: this.now() };
    this.updateRelay();
    if (this.relaying !== before) this.announceCaps();
  }

  /** Banda para terceiros, em bytes por segundo (o painel fala em Mbps). */
  private rate() { return (this.effective.bw * 1_000_000) / 8; }

  /**
   * Limites em vigor: o menor entre o global e o do equipamento (banda e armazenamento) e os dois
   * horários ao mesmo tempo ("Os limites globais de Configurações continuam valendo").
   */
  get effective() {
    const d = this.device;
    return {
      bw: d ? Math.min(this.settings.bw, d.bw) : this.settings.bw,
      sto: d ? Math.min(this.settings.sto, d.sto) : this.settings.sto,
      hours: d ? [this.settings.hours, d.hours] : [this.settings.hours],
    };
  }

  /** Retransmite agora? Modo nó ligado E dentro do horário do operador. */
  get relaying() { return this.router.relay; }

  private updateRelay() { this.router.relay = this.o.relay && !this.paused && this.effective.hours.every(h => inWindow(h, this.now())); }

  /** Pausa (ou retoma) a retransmissão de terceiros; os enlaces continuam abertos e os vizinhos ficam sabendo. */
  setPaused(paused: boolean) {
    const before = this.relaying;
    this.paused = paused;
    this.updateRelay();
    if (this.relaying !== before) { this.log(`LNNP: retransmissão ${this.relaying ? 'retomada' : 'pausada'} pelo operador`); this.announceCaps(); }
  }

  get isPaused() { return this.paused; }

  caps(over: Partial<Capabilities> = {}): Capabilities {
    const free = Math.max(0, this.router.limits.maxBytes - this.router.stats().bytes);
    return defaultCapabilities({ media: Medium.Eth, relay: this.relaying, storageMiB: this.relaying ? Math.floor(free / 1024 ** 2) : 0, ...over });
  }

  /** Opções do handshake; `caps` troca o que o meio anuncia (ex.: MTU e meio do LoRa). */
  handshakeOptions(caps: Partial<Capabilities> = {}): HandshakeOptions {
    return {
      node: this.node, caps: this.caps(caps), now: this.sec(), replay: this.replay,
      versions: { min: LNNP_MIN_VERSION, max: LNNP_VERSION },
      // Lista de permitidos (configuração) e lista de revogação do operador.
      authorize: pk => {
        const h = toHex(pk);
        if (this.revoked.has(h)) { this.counters.revokedRefused++; return false; }
        return this.allow ? this.allow.has(h) : true;
      },
    };
  }

  get linkCount() { return this.links.size; }
  hasPeer(peerId: string) { for (const l of this.links.values()) if (l.session.peerId === peerId) return true; return false; }

  /** Enlace aberto com o vizinho agora (chave completa e desde quando), ou `null`. */
  linkInfo(peerId: string): { pk: string; since: number; address: string } | null {
    for (const l of this.links.values()) if (l.session.peerId === peerId) return { pk: toHex(l.session.peerPk), since: l.since, address: l.address };
    return null;
  }

  /** Para a página de equipamentos: conectado agora e a última vez visto desde que o motor subiu. */
  peerSeen(peerId: string): { online: boolean; lastSeen: number | null; address: string | null } {
    const l = this.linkInfo(peerId);
    return l ? { online: true, lastSeen: this.now(), address: l.address } : { online: false, lastSeen: this.lastSeen.get(peerId) ?? null, address: null };
  }

  /** O vizinho conhece este nó pela etiqueta do anúncio? (evita conexão dupla pela descoberta) */
  hasPeerTag(tag: Uint8Array) {
    const t = toHex(tag);
    for (const l of this.links.values()) if (toHex(nodeTag(l.session.peerPk)) === t) return true;
    return false;
  }

  /**
   * Enlace autenticado pronto. Se já existe outro com o mesmo nó, fica o aberto pelo nó de chave
   * menor (os dois lados decidem igual) e o outro é fechado. Devolve `false` se este foi recusado.
   */
  attach(link: LinkPort): boolean {
    const existing = [...this.links.values()].find(l => l.session.peerId === link.session.peerId);
    if (existing) {
      const iAmLo = toHex(this.node.pk) < toHex(link.session.peerPk);
      const preferred = (l: LinkPort) => (iAmLo ? !l.inbound : l.inbound);
      if (!(preferred(link) && !preferred(existing))) { this.counters.handshakesOk++; return false; }
      this.links.delete(existing.id);
      existing.close();
    }
    this.counters.handshakesOk++;
    this.links.set(link.id, link);
    this.lastSeen.set(link.session.peerId, this.now());
    this.log(`LNNP: vizinho ${link.session.peerId} conectado (${link.address}, v${link.session.version})`);
    this.flush(link);
    this.syncOperator(link);
    return true;
  }

  detach(id: string) {
    const l = this.links.get(id);
    if (!l) return;
    this.links.delete(id);
    this.reassembly.delete(id);
    this.sameOperator.delete(id);
    this.lastSeen.set(l.session.peerId, this.now());
    this.log(`LNNP: vizinho ${l.session.peerId} desconectado`);
  }

  handshakeFailed(reason: string) {
    this.counters.handshakesFailed++;
    this.log(`LNNP: handshake recusado (${reason})`);
  }

  /** Quadro já decifrado de um enlace. Tipos desconhecidos são ignorados (compatibilidade). */
  receive(linkId: string, f: Frame) {
    const link = this.links.get(linkId);
    if (!link) return;
    switch (f.type) {
      case FrameType.Envelope: this.ingest(link, f.body); break;
      case FrameType.Fragment: {
        let r = this.reassembly.get(linkId);
        if (!r) { r = new Reassembler(); this.reassembly.set(linkId, r); }
        let whole: Uint8Array | null = null;
        try { whole = r.push(f.body, this.sec()); } catch { this.counters.rejected++; }
        if (whole) this.ingest(link, whole);
        break;
      }
      case FrameType.RelayReceipt: {
        try {
          const rc = decodeReceipt(f.body);
          if (verifyRelayReceipt(rc)) { this.counters.receiptsReceived++; this.keepReceipt(rc); } else this.counters.rejected++;
        } catch { this.counters.rejected++; }
        break;
      }
      case FRAME_OPERATOR_CERT: { let c: OperatorCert; try { c = decodeCert(f.body); } catch { this.counters.rejected++; break; } this.onCert(link, c); break; }
      case FRAME_REVOCATION_LIST: { let l: RevocationList; try { l = decodeRevocationList(f.body); } catch { this.counters.rejected++; break; } this.onList(link, l); break; }
      case FrameType.Ping: link.send(link.session.seal(FrameType.Pong, f.body.slice(0, 8))); break;
      case FrameType.Close: case FrameType.Error: link.close(); break;
      default: break; // Pong, CapsUpdate (a sessão já atualizou) e tipos de versões futuras
    }
  }

  private ingest(link: LinkPort, bytes: Uint8Array) {
    this.counters.received++;
    this.changes++;
    let bulk = false;
    try { bulk = parseHeader(bytes).bulk; } catch { /* o roteador recusa e conta abaixo */ }
    // Política do operador: sem mídia de terceiros (o roteador ainda deixaria passar).
    if (bulk && !this.settings.media && !this.o.identities?.length) { this.counters.rejected++; return; }
    this.count(this.router.ingest(bytes, link.session.peerId, this.sec()));
  }

  /** Envelope criado aqui (nó com identidade local, ou API local). Sai mesmo com a retransmissão desligada. */
  send(bytes: Uint8Array): IngestResult {
    const r = this.router.send(bytes, this.sec());
    this.changes++;
    if (r.status === 'stored') this.flushAll();
    return r;
  }

  private count(r: IngestResult) {
    switch (r.status) {
      case 'stored': this.counters.stored++; this.flushAll(); break;
      case 'delivered': this.counters.delivered++; if (r.stored) { this.counters.stored++; this.flushAll(); } break;
      case 'duplicate': this.counters.duplicates++; break;
      case 'relay-off': this.counters.relayOff++; break;
      case 'full': this.counters.full++; break;
      case 'expired': this.counters.expired++; break;
      case 'rejected': this.counters.rejected++; break;
    }
  }

  /** Banda para terceiros: balde de fichas em bytes (rajada de 1 s). */
  private budget(): number {
    const now = this.now(), rate = this.rate();
    this.bucket.tokens = Math.min(rate, this.bucket.tokens + ((now - this.bucket.at) / 1000) * rate);
    this.bucket.at = now;
    return Math.floor(this.bucket.tokens);
  }

  flushAll() { for (const l of [...this.links.values()]) this.flush(l); }

  /** Entrega ao vizinho o que o roteador tem para ele, respeitando banda, MTU e recursos negociados. */
  flush(link: LinkPort) {
    if (!this.links.has(link.id)) return;
    // Meio lento (rádio): só entrega o que cabe na fila dele; o resto fica guardado para a próxima rodada.
    const room = link.capacity ? link.capacity() : Infinity;
    if (room <= 0) return;
    const out = this.router.outgoing(link.session.peerId, link.medium, this.sec(), { thirdPartyBudget: Math.min(this.budget(), room), maxBytes: link.maxEnvelope });
    const max = link.session.maxFrame - 1;
    const canFragment = (link.session.negotiated.features & Feature.Fragments) !== 0;
    if (out.length) this.changes++;
    for (const env of out) {
      const id = envelopeId(env);
      const own = this.router.isOwn(id);
      if (!own) this.bucket.tokens -= env.length;
      if (env.length <= max) link.send(link.session.seal(FrameType.Envelope, env), id);
      else if (canFragment) for (const part of fragment(env, max)) link.send(link.session.seal(FrameType.Fragment, part), id);
      else { this.counters.rejected++; continue; }
      if (!own) this.counters.forwarded++;
    }
    // Recibos novos (um por envelope de terceiro, na primeira cópia): guardados para o validador.
    // Tirados do roteador para o array dele não crescer sem limite num nó que fica ligado meses.
    for (const r of this.router.receipts.splice(0)) { this.counters.receipts++; this.keepReceipt(r); }
  }

  /**
   * O envelope não chegou ao vizinho (enlace caiu, rádio desistiu): volta a poder ir para ele, por
   * este ou outro enlace. Sem isto, ele ficaria marcado como entregue a quem nunca recebeu.
   */
  undelivered(peerId: string, envelope: string) { this.router.unsent(peerId, envelope); this.changes++; }

  /** Manda os recibos guardados a um vizinho (ex.: um gateway com rota até o validador). */
  sendReceipts(linkId: string) {
    const l = this.links.get(linkId);
    if (!l || !(l.session.negotiated.features & Feature.RelayReceipts)) return 0;
    for (const r of this.receiptLog) l.send(l.session.seal(FrameType.RelayReceipt, encodeReceipt(r)));
    return this.receiptLog.length;
  }

  private keepReceipt(r: RelayReceipt) {
    this.changes++;
    this.receiptLog.push(r);
    if (this.receiptLog.length > RECEIPT_LOG) this.receiptLog.splice(0, this.receiptLog.length - RECEIPT_LOG);
  }

  private announceCaps() {
    for (const l of this.links.values()) {
      if (l.session.negotiated.features & Feature.CapsUpdate) l.send(l.session.seal(FrameType.CapsUpdate, encodeCaps(this.caps(l.caps))));
    }
  }

  /** Rodada periódica: horário de operação, limpeza do que venceu, envio do que ficou para depois. */
  tick() {
    const before = this.relaying;
    this.updateRelay();
    if (this.relaying !== before) { this.log(`LNNP: retransmissão ${this.relaying ? 'ligada' : 'desligada'} pelo horário`); this.announceCaps(); }
    const before2 = this.router.stats();
    this.router.purge(this.sec());
    const after = this.router.stats();
    if (after.stored !== before2.stored || after.seen !== before2.seen) this.changes++;
    this.flushAll();
  }

  // ── operador: certificados, rotação e revogação (operator-frames.ts) ──

  /** Linhagem em vigor: a do operador aqui, estendida pelos passos aprendidos de vizinhos. */
  get lineage(): string[] {
    const out = [...this.op.lineage];
    let grew = out.length > 0;
    while (grew) {
      grew = false;
      for (const s of this.learned) if (toHex(s.prevPk) === out.at(-1) && !out.includes(toHex(s.nextPk))) { out.push(toHex(s.nextPk)); grew = true; }
    }
    return out;
  }

  /** Chaves de nó revogadas pelo operador (hex). */
  get revokedKeys(): string[] { return [...this.revoked]; }
  get operatorList() { return this.op.list; }
  get operatorCert() { return this.op.cert; }

  /**
   * O operador mudou aqui (chave criada, rotação, equipamento certificado, revogação): aplica e manda
   * aos vizinhos. Lista de número menor que a em vigor não volta atrás.
   */
  setOperator(t: Partial<OperatorTrust>) {
    const list = t.list !== undefined ? this.newer(t.list) : this.op.list;
    const prevCert = this.op.cert;
    this.op = { ...this.op, ...t, list };
    // Certificado recebido da chave mais nova (rotação feita em outro equipamento) vale mais que um
    // assinado aqui com uma chave que já foi substituída.
    const head = this.lineage.at(-1);
    if (prevCert && head && toHex(prevCert.operatorPk) === head && this.op.cert && toHex(this.op.cert.operatorPk) !== head) this.op.cert = prevCert;
    // Passo aprendido que a linhagem local já tem não serve mais.
    this.learned = this.learned.filter(s => !this.op.lineage.includes(toHex(s.nextPk)));
    this.applyRevocation();
    for (const l of [...this.links.values()]) this.syncOperator(l);
  }

  /** Restaura o que foi aprendido antes do reinício (ver `OperatorTrustState`). */
  loadOperatorState(s: OperatorTrustState) {
    this.learned = s.learned;
    if (s.cert && !this.op.cert) this.op.cert = s.cert;
    if (s.list) this.op.list = this.newer(s.list);
    this.applyRevocation();
  }

  operatorState(): OperatorTrustState { return { learned: this.learned, cert: this.op.cert, list: this.op.list }; }

  private newer(l: RevocationList | null): RevocationList | null {
    const cur = this.op.list;
    if (!l) return cur;
    return !cur || l.seq > cur.seq ? l : cur;
  }

  private applyRevocation() {
    const head = this.lineage.at(-1);
    const l = this.op.list;
    // Só vale a lista assinada pela chave atual do operador (uma chave aposentada não revoga mais).
    this.revoked = new Set(l && head && toHex(l.operatorPk) === head ? l.revoked.map(toHex) : []);
    for (const link of [...this.links.values()]) {
      if (this.revoked.has(toHex(link.session.peerPk))) {
        this.counters.revokedRefused++;
        this.log(`LNNP: vizinho ${link.session.peerId} revogado pelo operador; enlace fechado`);
        link.close();
        this.detach(link.id);
      }
    }
  }

  private changed() { this.o.onOperatorChange?.(this.operatorState()); }

  /** Depois do handshake: meu certificado, o do vizinho (se ele é equipamento do operador) e a lista. */
  private syncOperator(link: LinkPort) {
    if (!this.links.has(link.id)) return;
    if (this.op.cert) link.send(link.session.seal(FRAME_OPERATOR_CERT, encodeCert(this.op.cert)));
    const forPeer = this.op.deviceCerts.find(c => samePk(c.nodePk, link.session.peerPk));
    if (forPeer) link.send(link.session.seal(FRAME_OPERATOR_CERT, encodeCert(forPeer)));
    if (this.sameOperator.has(link.id) && this.op.list) link.send(link.session.seal(FRAME_REVOCATION_LIST, encodeRevocationList(this.op.list)));
  }

  /** O certificado se liga à linhagem? `null`: não (outro operador); `true`: aprendeu chave nova. */
  private learn(c: OperatorCert): boolean | null {
    const lineage = this.lineage;
    if (!lineage.length) return null;
    const path = trustPath(c, new Set(lineage));
    if (path === null) return null;
    if (!path.length) return false;
    for (const s of c.chain) if (path.includes(toHex(s.nextPk)) && !this.learned.some(x => samePk(x.nextPk, s.nextPk))) this.learned.push(s);
    // Só conta o que estende a linhagem a partir da chave atual: um ramo aberto a partir de uma chave
    // antiga (talvez vazada) não vale, e o certificado assinado nesse ramo também não.
    const now = this.lineage;
    this.learned = this.learned.filter(s => now.includes(toHex(s.nextPk)));
    if (!now.includes(toHex(c.operatorPk))) return null;
    if (now.length === lineage.length) return false;
    this.log(`LNNP: chave de operador nova recebida na sincronização (${this.lineage.at(-1)!.slice(0, 16)})`);
    this.applyRevocation();
    return true;
  }

  private onCert(link: LinkPort, c: OperatorCert) {
    if (!verifyCert(c)) { this.counters.rejected++; return; }
    const learned = this.learn(c);
    if (learned === null) return; // outro operador (ou este nó ainda não tem operador): só ignora
    if (samePk(c.nodePk, link.session.peerPk)) {
      const fresh = !this.sameOperator.has(link.id);
      this.sameOperator.set(link.id, toHex(c.operatorPk));
      if (fresh) {
        // O vizinho acabou de se mostrar do mesmo operador (talvez porque restaurou a chave agora):
        // devolve o meu certificado, para ele também me reconhecer, e a lista em vigor.
        if (this.op.cert) link.send(link.session.seal(FRAME_OPERATOR_CERT, encodeCert(this.op.cert)));
        if (this.op.list) link.send(link.session.seal(FRAME_REVOCATION_LIST, encodeRevocationList(this.op.list)));
      }
    } else if (samePk(c.nodePk, this.node.pk)) {
      // Certificado deste nó, assinado pela chave mais nova do operador (rotação feita em outro equipamento).
      const head = this.lineage.at(-1);
      if (toHex(c.operatorPk) === head && (!this.op.cert || toHex(this.op.cert.operatorPk) !== head || c.issuedAt > this.op.cert.issuedAt)) {
        this.op.cert = c;
        for (const l of this.links.values()) if (l.id !== link.id) l.send(l.session.seal(FRAME_OPERATOR_CERT, encodeCert(c)));
        this.changed();
        return;
      }
    }
    if (learned) {
      // Chave nova: os outros vizinhos do operador também ficam sabendo.
      for (const l of this.links.values()) if (l.id !== link.id && this.sameOperator.has(l.id)) l.send(l.session.seal(FRAME_OPERATOR_CERT, encodeCert(c)));
      this.changed();
    }
  }

  private onList(link: LinkPort, l: RevocationList) {
    // Só de um vizinho do mesmo operador, assinada pela chave atual, e mais nova que a em vigor.
    if (!this.sameOperator.has(link.id)) return;
    if (toHex(l.operatorPk) !== this.lineage.at(-1) || !verifyRevocationList(l)) { this.counters.rejected++; return; }
    if (this.op.list && l.seq <= this.op.list.seq) return;
    this.op.list = l;
    this.log(`LNNP: lista de revogação nº ${l.seq} recebida (${l.revoked.length} ${l.revoked.length === 1 ? 'chave' : 'chaves'})`);
    this.applyRevocation();
    for (const x of this.links.values()) if (x.id !== link.id && this.sameOperator.has(x.id)) x.send(x.session.seal(FRAME_REVOCATION_LIST, encodeRevocationList(l)));
    this.changed();
  }

  /** O que vai para o disco: envelopes guardados, ids vistos e recibos (ver persist.ts). */
  exportState(): RelaySnapshot {
    return { envelopes: this.router.exportStored(), seen: this.router.exportSeen(), receipts: [...this.receiptLog] };
  }

  /**
   * Restaura o que foi salvo antes do reinício. Tudo passa pelas regras de agora: TTL, retenção,
   * espaço (o limite pode ter mudado) e assinatura dos recibos.
   */
  importState(s: RelaySnapshot) {
    const now = this.sec();
    this.router.importSeen(s.seen, now);
    const envelopes = this.router.importStored(s.envelopes, now);
    let receipts = 0;
    for (const r of s.receipts) if (verifyRelayReceipt(r)) { this.receiptLog.push(r); receipts++; }
    if (this.receiptLog.length > RECEIPT_LOG) this.receiptLog.splice(0, this.receiptLog.length - RECEIPT_LOG);
    this.restored = { envelopes, seen: this.router.stats().seen, receipts };
    return this.restored;
  }

  get inbox() { return this.router.inbox; }

  /**
   * Recibos guardados para o validador, do mais novo ao mais antigo: só o horário e se foi assinado
   * por este nó. Sem id de envelope, segredo de entrega nem chave de quem assinou.
   */
  receiptsView(limit = 20) {
    const me = toHex(this.node.pk);
    const own = this.receiptLog.filter(r => toHex(r.nodePk) === me).length;
    return {
      kept: this.receiptLog.length, keptOwn: own, max: RECEIPT_LOG,
      recent: this.receiptLog.slice(-limit).reverse().map(r => ({ at: r.at * 1000, own: toHex(r.nodePk) === me })),
    };
  }

  /** Estatísticas para o painel (`GET /api/relay`). Sem conteúdo, sem destino, sem chave secreta. */
  stats() {
    const r = this.router.stats();
    return {
      enabled: true,
      relayMode: this.o.relay,
      relaying: this.relaying,
      paused: this.paused,
      startedAt: this.startedAt,
      lnnp: { version: LNNP_VERSION, minVersion: LNNP_MIN_VERSION },
      node: toHex(this.node.pk).slice(0, 16),
      neighbors: [...this.links.values()].map(l => ({
        id: l.session.peerId, pk: toHex(l.session.peerPk), sameOperator: this.sameOperator.has(l.id),
        address: l.address, link: l.medium, inbound: l.inbound, since: l.since, version: l.session.version,
        relay: l.session.peerCaps.relay, mtu: l.session.negotiated.mtu,
        media: mediaNames.filter(([m]) => l.session.peerCaps.media & m).map(([, n]) => n),
        // Igual nos dois nós deste enlace (ver confirm.ts): o operador confere nos dois painéis.
        confirmCode: l.session.transcript ? confirmCode(l.session.transcript, this.node.pk, l.session.peerPk) : null,
      })),
      store: { envelopes: r.stored, bytes: r.bytes, maxBytes: this.router.limits.maxBytes, seen: r.seen, restored: this.restored },
      counters: { ...this.counters },
      operator: { signed: !!this.op.cert && toHex(this.op.cert.operatorPk) === this.lineage.at(-1), revoked: this.revoked.size, listSeq: this.op.list?.seq ?? 0 },
      limits: {
        bwMbps: this.settings.bw, stoGB: this.settings.sto, hours: this.settings.hours, media: this.settings.media,
        device: this.device, effective: { bwMbps: this.effective.bw, stoGB: this.effective.sto, hours: this.effective.hours },
      },
    };
  }
}

export type RelayStats = ReturnType<RelayEngine['stats']>;
