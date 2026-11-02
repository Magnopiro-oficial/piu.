/**
 * Sessões por contato (Double Ratchet) sobre o envelope selado.
 * - Primeira mensagem: destino lógico pela chave pública do contato (ele ainda não tem a sessão).
 * - Depois que a sessão está estabelecida (já recebemos algo dela): destino derivado do segredo
 *   da sessão, que muda por dia.
 * - Se os dois começarem ao mesmo tempo, vale a sessão que já recebeu algo; senão, a nova.
 */
import { Writer } from './bytes';
import { MsgType, type Opened, sealDirect, type SealOptions } from './envelope';
import { identityId, type Identity, type PublicIdentity } from './keys';
import { Session } from './ratchet';
import { kdf } from './suite';

export const sessionDest = (tagKey: Uint8Array, expiresAt: number) =>
  kdf(tagKey, new Writer().u32(Math.floor(expiresAt / 86400)).done(), 'piu/v0/dest/session', 16);

export class SessionManager {
  private sessions = new Map<string, Session>();
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

  /** Decifra o conteúdo de sessão de um envelope já aberto. */
  open(m: Opened): Uint8Array | null {
    if (m.type !== MsgType.Session) return null;
    const cur = this.sessions.get(m.fromId);
    const pt = cur?.decrypt(m.body);
    if (pt) return pt;
    // Sessão nova (ou o contato reinstalou o app): só substitui a atual se ela nunca recebeu nada.
    if (cur?.established) {
      const fresh = Session.respond(this.me, m.from);
      const p2 = fresh.decrypt(m.body);
      if (p2) { this.sessions.set(m.fromId, fresh); return p2; }
      return null;
    }
    const fresh = Session.respond(this.me, m.from);
    const p2 = fresh.decrypt(m.body);
    if (!p2) return null;
    // Início simultâneo: as duas pontas criaram sessão. Fica a de quem tem o id menor como iniciador.
    if (cur && !cur.established && this.myId < m.fromId) return p2; // mantém a nossa; a mensagem foi lida
    this.sessions.set(m.fromId, fresh);
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
  export() { return JSON.stringify([...this.sessions.values()].map(s => s.export())); }
  static import(me: Identity, json: string) {
    const m = new SessionManager(me);
    for (const e of JSON.parse(json) as string[]) { const s = Session.import(e); m.sessions.set(s.peerId, s); }
    return m;
  }
}
