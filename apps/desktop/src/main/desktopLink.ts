import { parsePaymentStatus } from './paymentJournal';
import type { DesktopPayment } from '../shared/paymentTypes';
import { canSendToConversation } from '../shared/conversations';
/**
 * Servidor do vínculo com o celular (lado do desktop): WebSocket na rede local (no IPv4 anunciado no
 * QR, porta aleatória), QR renovado a cada 30 s enquanto ninguém conectou, handshake pela lib
 * compartilhada (`apps/mobile/src/lib/desktopLink.ts`), 3 palavras, `ready` depois da confirmação,
 * quadros de TEXTO base64url (FrameSealer/FrameOpener), `pong` a cada `ping`, keepalive, espelho das conversas.
 * Robustez do pareamento (M-03): quem conecta e não manda `hello` em 10 s perde o slot; falha antes do
 * handshake só troca a oferta (sem 'dropped'); oferta vencida ou já usada é recusada com 1013.
 * Confirmação (M-04): a pessoa escolhe a 3ª palavra entre 4; errar cancela e gera QR novo.
 */
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:https';
import { hostname, networkInterfaces } from 'node:os';
import { type WebSocket, WebSocketServer } from 'ws';
import { type ConversationsState, emptyState, markRead, messagesOf, summaries } from '../shared/conversations';
import {
  applyLinkEvent, CLOSE_BAD_SESSION, CLOSE_BAD_VERSION, desktopHandshake, type DesktopMessage, type DesktopOffer, DesktopLinkError, FrameOpener, FrameSealer, isPhoneMessage,
  LINK_PING_MS, LINK_RENEW_SEC, LINK_WORDS, newOffer, offerExpired, offerQr, type PhoneMessage, stateFromSnapshot, walletFromLink,
} from '../shared/desktopLink';
import { WORDLIST } from '../../../mobile/src/protocol/phrase';
import type { ContactInfo, LinkState, MeInfo, Message } from '../shared/types';
import { type LinkTls, loadLinkTls } from './linkTls';
import { tm } from './i18n';

/** IPv4 da rede local (não interno). Prefere Wi-Fi/Ethernet comuns (en0, eth0, wlan0). */
export function localHosts(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(/^(en0|eth0|wlan0)$/.test(name) ? `!${i.address}` : i.address);
  }
  return out.sort((a, b) => Number(b.startsWith('!')) - Number(a.startsWith('!'))).map(h => h.replace(/^!/, ''));
}

/** Prazo para o `hello` depois de conectar (o celular manda em milissegundos; folga larga). */
export const HELLO_TIMEOUT_MS = 10_000;
/** Quantas opções para a última palavra na confirmação (M-04). */
export const CONFIRM_OPTIONS = 4;

/**
 * Opções da confirmação: a última palavra do celular + iscas da mesma lista (nenhuma igual às 3
 * palavras), embaralhadas com o gerador seguro. Só quem olha o celular acerta além do chute (1/4).
 */
export function linkConfirmOptions(words: string[], rand: (max: number) => number = randomInt): string[] {
  const answer = words[LINK_WORDS - 1]!;
  const out = new Set<string>([answer]);
  while (out.size < CONFIRM_OPTIONS) { const w = WORDLIST[rand(WORDLIST.length)]!; if (!words.includes(w)) out.add(w); }
  const list = [...out];
  for (let i = list.length - 1; i > 0; i--) { const j = rand(i + 1); [list[i], list[j]] = [list[j]!, list[i]!]; }
  return list;
}

export interface DesktopLinkOptions {
  /** Endereço mostrado no QR (padrão: o primeiro IPv4 local). Testes: 127.0.0.1. */
  host?: string;
  /** Endereço de escuta (padrão: o mesmo do QR, não 0.0.0.0). */
  listen?: string;
  /** Prazo do `hello` (testes). */
  helloTimeoutMs?: number;
  port?: number;
  /** Nome deste computador enviado no `ready`. */
  name?: string;
  /** Pasta do certificado TLS do vínculo (`<userData>/link-tls`). */
  tlsDir: string;
  /** Oferta fixa (vetores de teste). */
  offer?: () => DesktopOffer;
  log?: (m: string) => void;
  now?: () => number;
}

export class DesktopLinkServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private https: Server | null = null;
  private tls: LinkTls | null = null;
  private offer: DesktopOffer | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private sock: WebSocket | null = null;
  private sealer: FrameSealer | null = null;
  private opener: FrameOpener | null = null;
  private words: string[] = [];
  private me: MeInfo | null = null;
  private contacts: ContactInfo[] = [];
  private conv: ConversationsState = emptyState();
  private pendingSnapshot: PhoneMessage | null = null;
  /** Endereço Lunes da carteira do celular (espelho; `walletFromLink`). Some quando o vínculo cai. */
  walletAddress: string | null = null;
  private since = 0;
  private seq = 0;
  state: LinkState = { state: 'off' };
  port = 0;
  /** Endereço em que o servidor escuta agora. */
  boundHost: string | null = null;

  constructor(private o: DesktopLinkOptions) { super(); }

  private log(m: string) { this.o.log?.(`vínculo: ${m}`); }
  private now() { return this.o.now ? this.o.now() : Date.now(); }
  private nowSec() { return Math.floor(this.now() / 1000); }
  private setState(s: LinkState) { this.state = s; this.emit('state', s); }

  /** Sobe o servidor (se preciso) e mostra uma oferta nova. */
  async start(): Promise<LinkState> {
    if (this.state.state === 'linked') return this.state;
    // Trocou de rede desde a última vez (o IP escutado sumiu): sobe de novo no endereço atual.
    if (this.wss && !this.o.listen && !this.o.host && this.boundHost && !localHosts().includes(this.boundHost)) await this.closeServer();
    if (!this.wss) {
      // wss:// com certificado próprio fixado pelo QR (o Android de release não aceita ws:// em claro).
      this.tls = await loadLinkTls(this.o.tlsDir, localHosts());
      const https = createServer({ key: this.tls.key, cert: this.tls.cert, minVersion: 'TLSv1.2' }, (_req, res) => { res.statusCode = 426; res.end('Piu Desktop: vínculo com o celular (WebSocket).'); });
      // Só no endereço anunciado no QR (M-03): outras interfaces (VPN, Docker…) não alcançam o vínculo.
      const bind = this.o.listen ?? this.o.host ?? localHosts()[0] ?? '127.0.0.1';
      await new Promise<void>((res, rej) => { https.once('error', rej); https.listen(this.o.port ?? 0, bind, () => { https.off('error', rej); res(); }); });
      this.boundHost = bind;
      const a = https.address();
      this.port = typeof a === 'object' && a ? a.port : 0;
      const wss = new WebSocketServer({ server: https, maxPayload: 6 * 1024 * 1024 });
      wss.on('connection', s => this.onConnection(s));
      wss.on('error', e => this.log(`servidor: ${e.message}`));
      this.https = https; this.wss = wss;
    }
    this.dropClient();
    this.renew();
    return this.state;
  }

  private renew() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    const fresh = () => {
      if (this.sock) return; // alguém já conectou: a oferta fica até o fim do handshake
      this.offer = this.o.offer ? this.o.offer() : newOffer(this.now());
      const host = this.o.host ?? (this.boundHost && this.boundHost !== '0.0.0.0' ? this.boundHost : localHosts()[0]) ?? '127.0.0.1';
      this.setState({ state: 'waiting', uri: offerQr(this.offer, host, this.port, this.tls!.hash), expiresAt: this.offer.createdAt + LINK_RENEW_SEC * 1000, host, port: this.port });
    };
    fresh();
    this.renewTimer = setInterval(fresh, LINK_RENEW_SEC * 1000);
    this.renewTimer.unref();
  }

  private dropClient(reason?: string, code?: number) {
    const s = this.sock;
    this.sock = null; this.sealer = null; this.opener = null; this.words = []; this.pendingSnapshot = null;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (s) { try { s.close(code ?? 1000, (reason ?? '').slice(0, 120)); } catch { /* já fechado */ } }
    if (reason && this.state.state !== 'off') { this.me = null; this.contacts = []; this.conv = emptyState(); this.setState({ state: 'dropped', reason }); }
    if (this.state.state !== 'linked') this.setWalletAddress(null);
  }

  private onConnection(sock: WebSocket) {
    // Ocupado, sem oferta (já usada) ou oferta vencida: recusa sem tocar no estado.
    if (this.sock || !this.offer || offerExpired(this.offer, this.now())) {
      sock.close(1013, 'ocupado');
      if (!this.sock && this.offer && this.state.state === 'waiting' && offerExpired(this.offer, this.now())) this.renew();
      return;
    }
    this.sock = sock;
    let hs = false;
    // Antes do handshake, a falha só libera o slot e troca a oferta (o QR segue renovando, sem 'dropped').
    const release = (code: number, reason: string) => {
      clearTimeout(helloTimer);
      if (this.sock !== sock) return;
      this.sock = null;
      try { sock.close(code, reason.slice(0, 120)); } catch { /* já fechado */ }
      if (this.wss) this.renew();
    };
    const fail = (reason: string, code?: number) => {
      this.log(`sessão encerrada: ${reason}`);
      if (this.sock !== sock) return;
      if (!hs) { release(code ?? 1008, reason); return; }
      this.dropClient(reason, code);
    };
    const helloTimer = setTimeout(() => { if (!hs) fail('tempo esgotado esperando o celular', 1008); }, this.o.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    helloTimer.unref();
    sock.on('message', (data, isBinary) => {
      try {
        if (isBinary) throw new DesktopLinkError('FORMAT', 'Quadro binário: o protocolo usa texto.');
        const text = data.toString();
        if (!hs) {
          // Lib compartilhada: chaves por HKDF e palavras com o certificado na transcrição (wss com pino).
          const r = desktopHandshake(this.offer!.sk, this.offer!.session, this.tls!.hash, text);
          this.sealer = new FrameSealer(r.keys.send); this.opener = new FrameOpener(r.keys.recv);
          this.words = r.words; hs = true;
          clearTimeout(helloTimer);
          // Oferta consumida: o QR não renova mais e não serve para outra conexão (nem depois de 'dropped').
          if (this.renewTimer) { clearInterval(this.renewTimer); this.renewTimer = null; }
          this.offer = null;
          this.setState({ state: 'confirm', words: r.words.slice(0, LINK_WORDS - 1), options: linkConfirmOptions(r.words) });
          return;
        }
        const m = this.opener!.open(text);
        const paymentStatus = parsePaymentStatus(m);
        if (paymentStatus) { if (this.state.state === 'linked') this.emit('paymentStatus', paymentStatus); return; }
        if (!isPhoneMessage(m)) return;
        this.onMessage(m as PhoneMessage);
      } catch (e) {
        const code = e instanceof DesktopLinkError ? (e.code === 'VERSION' ? CLOSE_BAD_VERSION : e.code === 'AUTH' && !hs ? CLOSE_BAD_SESSION : 1008) : 1011;
        fail(e instanceof Error ? e.message : 'erro', code);
      }
    });
    sock.on('close', () => {
      clearTimeout(helloTimer);
      if (this.sock === sock && !hs) { release(1000, ''); return; }
      if (this.sock === sock) { const linked = this.state.state === 'linked'; this.dropClient(linked ? tm('main.link.dropped') : tm('main.link.leftBeforeConfirm')); } });
    sock.on('error', e => fail(e.message));
  }

  private onMessage(m: PhoneMessage) {
    switch (m.t) {
      case 'ping': this.send({ t: 'pong' }); break;
      case 'pong': break;
      case 'bye': this.dropClient(m.reason ? tm('main.link.phoneEndedWhy', { reason: m.reason }) : tm('main.link.phoneEnded')); break;
      case 'snapshot': {
        // Antes de a pessoa confirmar aqui, o snapshot espera (o celular pode confirmar primeiro).
        if (this.state.state !== 'linked') { this.pendingSnapshot = m; break; }
        this.applySnapshot(m);
        break;
      }
      case 'event': {
        if (this.state.state !== 'linked') break;
        const r = applyLinkEvent(this.contacts, this.conv, m, this.nowSec());
        this.contacts = r.contacts; this.conv = r.conv;
        if (r.touched) this.emit('message', { contactId: r.touched.contactId, message: r.touched });
        this.emit('conversations');
        break;
      }
      case 'ack': {
        if (!m.ok) this.log(`celular recusou o comando ${m.ref ?? ''}: ${m.error ?? ''}`);
        else if (m.ref) {
          // Pedido aceito: a cópia local passa a "encaminhada" até o celular mandar a mensagem dele.
          for (const [cid, list] of Object.entries(this.conv.byContact)) {
            const i = list.findIndex(x => x.id === m.ref);
            if (i >= 0 && list[i]!.status === 'aguardando') { const copy = [...list]; copy[i] = { ...list[i]!, status: 'encaminhada' }; this.conv = { ...this.conv, byContact: { ...this.conv.byContact, [cid]: copy } }; this.emit('message', { contactId: cid, message: copy[i] }); this.emit('conversations'); }
          }
        }
        break;
      }
      default: break; // tipos de versões futuras: ignorados
    }
  }

  private applySnapshot(m: PhoneMessage) {
    if (m.t !== 'snapshot') return;
    const r = stateFromSnapshot(m, this.nowSec());
    this.contacts = r.contacts; this.conv = r.conv;
    this.me = { publicId: '', anonId: '', name: this.me?.name ?? '', nodePk: '' };
    this.setState({ state: 'linked', me: this.me, since: this.since, synced: true });
    this.emit('conversations');
    // Carteira do celular (`Snapshot.wallet`): origem do Enviar e QR do Receber enquanto vinculado.
    this.setWalletAddress(walletFromLink(m.wallet));
  }

  private setWalletAddress(a: string | null) {
    if (a === this.walletAddress) return;
    this.walletAddress = a;
    this.emit('wallet', a);
  }

  /**
   * A pessoa escolheu a última palavra que o celular mostra (M-04). Certa: manda `ready` com o nome do
   * computador e passa a vinculado. Errada: cancela (bye ao celular) e mostra um QR novo.
   */
  confirm(word: string): LinkState {
    if (this.state.state !== 'confirm' || !this.sealer || !this.sock) return this.state;
    if (word !== this.words[LINK_WORDS - 1]) { this.log('palavra da confirmação não confere; cancelando'); return this.cancel('código não confere no computador'); }
    this.since = this.now();
    this.setState({ state: 'linked', me: null, since: this.since, synced: false });
    this.send({ t: 'ready', name: (this.o.name ?? hostname()).slice(0, 40) });
    this.pingTimer = setInterval(() => { try { this.send({ t: 'ping' }); } catch { /* sessão caiu */ } }, LINK_PING_MS);
    this.pingTimer.unref();
    this.log('celular vinculado; aguardando o snapshot');
    if (this.pendingSnapshot) { const s = this.pendingSnapshot; this.pendingSnapshot = null; this.applySnapshot(s); }
    return this.state;
  }

  /** "Não são iguais" ou fechar: derruba o cliente e volta a mostrar um QR novo (se o servidor segue). */
  cancel(reason = 'cancelado no computador'): LinkState {
    try { if (this.sock && this.sealer) this.send({ t: 'bye', reason }); } catch { /* sem sessão */ }
    this.dropClient();
    if (this.wss) this.renew();
    return this.state;
  }

  async stop() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
    this.cancel();
    await this.closeServer();
    this.setState({ state: 'off' });
  }

  private async closeServer() {
    const wss = this.wss, https = this.https; this.wss = null; this.https = null; this.boundHost = null;
    if (wss) await new Promise<void>(res => wss.close(() => res()));
    if (https) await new Promise<void>(res => https.close(() => res()));
  }

  /** `c` do QR (SHA-256 do certificado DER, base64url); testes e diagnóstico. */
  get certPin() { return this.tls?.pin ?? null; }
  get certHash() { return this.tls?.hash ?? null; }

  // ── espelho das conversas do celular ─────────────────────
  get linked() { return this.state.state === 'linked'; }
  meInfo(): MeInfo | null { return this.me; }
  listConversations() { return summaries(this.conv, this.contacts); }
  getMessages(contactId: string): Message[] { return messagesOf(this.conv, contactId); }
  markRead(contactId: string) { this.conv = markRead(this.conv, contactId); this.send({ t: 'cmd', op: 'read', chatId: contactId }); }

  /** Texto para uma conversa do celular: vai como comando (`ref` = id local); o celular cifra, envia e devolve a mensagem/estados. */
  sendText(contactId: string, text: string): Message {
    if (!this.linked) throw new Error(tm('main.link.noPhone'));
    const contact = this.contacts.find(c => c.id === contactId);
    if (!contact) throw new Error(tm('main.link.chatNotFound'));
    if (!canSendToConversation(contact)) throw new Error(tm('main.link.readOnly'));
    if (!text.trim()) throw new Error(tm('main.core.writeSomething'));
    const msgId = `d${this.now().toString(36)}-${(++this.seq).toString(36)}`;
    const message: Message = { id: msgId, contactId, dir: 'out', text, at: this.nowSec(), status: 'aguardando' };
    this.conv = { ...this.conv, byContact: { ...this.conv.byContact, [contactId]: [...(this.conv.byContact[contactId] ?? []), message] } };
    this.conv = markRead(this.conv, contactId);
    this.send({ t: 'cmd', op: 'send', chatId: contactId, text, ref: msgId });
    this.emit('conversations');
    return message;
  }

  requestPayment(p: DesktopPayment) {
    if (this.state.state !== 'linked' || !this.state.synced) throw new Error(tm('main.core.linkFirst'));
    this.send({ t: 'payment_request', id: p.id, expectedFrom: p.expectedFrom, dest: p.dest, amount: p.amount } as unknown as DesktopMessage);
  }

  private send(m: DesktopMessage) {
    if (!this.sock || !this.sealer) throw new Error(tm('main.link.noPhone'));
    this.sock.send(this.sealer.seal(m));
  }
}
