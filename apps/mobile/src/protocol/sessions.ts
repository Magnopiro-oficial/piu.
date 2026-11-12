/**
 * Sessões por contato (Double Ratchet) sobre o envelope selado.
 * - Primeira mensagem: destino lógico pela chave pública do contato (ele ainda não tem a sessão).
 * - Depois que a sessão está estabelecida (já recebemos algo dela): destino derivado do segredo
 *   da sessão, que muda por dia.
 * - Se os dois começarem ao mesmo tempo, vale a sessão que já recebeu algo; senão, a nova.
 * - Sessão nova por cima de uma estabelecida (o contato reinstalou ou migrou) só se a mensagem for
 *   mais recente que o início da sessão atual (`sentAt` é assinado pelo remetente): o replay de uma
 *   primeira mensagem antiga por um relay não derruba a conversa (auditoria 2026-11-06, M-02).
 *   Comparar com o início, e não com a última mensagem, tolera relógio atrasado no aparelho novo.
 *   A sessão trocada fica como alternativa, para mensagens dela que ainda estejam a caminho.
 */
import { Writer } from './bytes';
import { MsgType, type Opened, sealDirect, type SealOptions } from './envelope';
import { identityId, type Identity, type PublicIdentity } from './keys';
import { Session } from './ratchet';
import { kdf } from './suite';

export const sessionDest = (tagKey: Uint8Array, expiresAt: number) =>
  kdf(tagKey, new Writer().u32(Math.floor(expiresAt / 86400)).done(), 'piu/v0/dest/session', 16);

/** Campos extras no item salvo (a versão antiga do app os ignora). */
interface Extra { piuPrev?: 1; piuSince?: number }
const withExtra = (exported: string, x: Extra) => JSON.stringify({ ...JSON.parse(exported), ...x });

/** Sessão de quem recebe; `null` se a chave do remetente não serve para o acordo (dado de fora nunca lança aqui). */
function respond(me: Identity, them: PublicIdentity): Session | null {
  try { return Session.respond(me, them); } catch { return null; }
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  /** Sessão substituída por uma nova do mesmo contato: ainda abre o que dela estiver a caminho. */
  private previous = new Map<string, Session>();
  /** `sentAt` (s) da mensagem autêntica mais antiga do contato na sessão atual (o início dela). */
  private since = new Map<string, number>();
  constructor(private me: Identity) {}

  get(peerId: string) { return this.sessions.get(peerId); }

  /** Cifra para um contato dentro de um envelope selado (MsgType.Session). */
  seal(to: PublicIdentity, plaintext: Uint8Array, o: Omit<SealOptions, 'from' | 'type' | 'body'>) {
    const id = identityId(to.signPk, to.agreePk);
    let s = this.sessions.get(id);
    if (!s) { s = Session.initiate(this.me, to); this.sessions.set(id, s); }
    const body = s.encrypt(plaintext);
    const destFor = s.established ? (exp: number) => sessionDest(s!.tagKey, exp) : undefined;
    return sealDirect({ ...o, from: this.me, to, type: MsgType.Session, body, destFor });
  }

  /** Mensagem autêntica da sessão atual: o início é o menor `sentAt` visto nela. */
  private seen(id: string, sentAt: number) { const s = this.since.get(id); if (s === undefined || sentAt < s) this.since.set(id, sentAt); }

  /** Decifra o conteúdo de sessão de um envelope já aberto. */
  open(m: Opened): Uint8Array | null {
    if (m.type !== MsgType.Session) return null;
    const cur = this.sessions.get(m.fromId);
    const pt = cur?.decrypt(m.body);
    if (pt) { this.seen(m.fromId, m.sentAt); return pt; }
    // Mensagem atrasada da sessão que acabou de ser trocada (não mexe no início da atual).
    const old = this.previous.get(m.fromId)?.decrypt(m.body);
    if (old) return old;
    // Sessão nova (ou o contato reinstalou o app) por cima de uma estabelecida: só se for mais recente
    // que o início da atual. Igual ou mais antiga = replay de uma primeira mensagem antiga.
    if (cur?.established) {
      if (m.sentAt <= (this.since.get(m.fromId) ?? -1)) return null;
      const fresh = respond(this.me, m.from);
      const p2 = fresh?.decrypt(m.body);
      if (!fresh || !p2) return null;
      this.previous.set(m.fromId, cur);
      this.sessions.set(m.fromId, fresh);
      this.since.set(m.fromId, m.sentAt);
      return p2;
    }
    const fresh = respond(this.me, m.from);
    const p2 = fresh?.decrypt(m.body);
    if (!fresh || !p2) return null;
    // Início simultâneo: as duas pontas criaram sessão. Fica a de quem tem o id menor como iniciador.
    if (cur && !cur.established && this.myId < m.fromId) { this.seen(m.fromId, m.sentAt); return p2; } // mantém a nossa; a mensagem foi lida
    this.sessions.set(m.fromId, fresh);
    this.since.set(m.fromId, m.sentAt);
    return p2;
  }

  /** Destinos lógicos que este aparelho aceita além do da própria chave (sessões estabelecidas). */
  acceptsDest = (dest: Uint8Array, expiresAt: number): boolean => {
    for (const s of this.sessions.values()) {
      const d = sessionDest(s.tagKey, expiresAt);
      if (d.length === dest.length && d.every((b, i) => b === dest[i])) return true;
    }
    return false;
  };

  private get myId() { return identityId(this.me.signPk, this.me.agreePk); }
  /**
   * Lista de sessões, como sempre. As anteriores vão antes (`piuPrev`) e as atuais levam `piuSince`:
   * a versão antiga do app, que fica com o último item de cada contato, continua lendo a atual.
   */
  export() {
    return JSON.stringify([
      ...[...this.previous.values()].map(s => withExtra(s.export(), { piuPrev: 1 })),
      ...[...this.sessions.values()].map(s => { const at = this.since.get(s.peerId); return at !== undefined ? withExtra(s.export(), { piuSince: at }) : s.export(); }),
    ]);
  }
  static import(me: Identity, json: string) {
    const m = new SessionManager(me);
    for (const e of JSON.parse(json) as string[]) {
      const s = Session.import(e);
      const x = JSON.parse(e) as Extra;
      if (x.piuPrev === 1) { m.previous.set(s.peerId, s); continue; }
      m.sessions.set(s.peerId, s);
      if (Number.isInteger(x.piuSince) && x.piuSince! >= 0) m.since.set(s.peerId, x.piuSince!);
    }
    return m;
  }
}
