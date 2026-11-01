/**
 * Sessões com sigilo futuro e recuperação pós-comprometimento: Double Ratchet (especificação do Signal),
 * com início simplificado (X3DH sem pre-keys): SK = DH(identidade A, identidade B). O passo de DH da
 * primeira mensagem já usa uma chave efêmera, e cada resposta gira a catraca de DH.
 *
 * Na malha offline as mensagens chegam fora de ordem: chaves puladas ficam guardadas (com limite).
 * O conteúdo da sessão viaja DENTRO do envelope selado (envelope.ts): os relays não veem nem a chave
 * da catraca. Depois que os dois lados têm a sessão, o destino lógico do envelope passa a ser
 * derivado de um segredo da sessão, e quem só conhece a chave pública de alguém não liga os envelopes.
 *
 * Limitação: até a primeira resposta, o sigilo depende da chave de identidade do destinatário
 * (como no Signal sem one-time pre-keys).
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, equal, Reader, toHex, Writer } from './bytes';
import type { Identity, KeyPair, PublicIdentity } from './keys';
import { identityId } from './keys';
import { aead, agree, kdf, KEY_BYTES, NONCE_BYTES, random } from './suite';

const MAX_SKIP = 1000;
const MAX_STORED_SKIPPED = 2000;
const ZERO_NONCE = new Uint8Array(NONCE_BYTES); // cada chave de mensagem é usada uma única vez
const DR_HEADER = 32 + 4 + 4;

interface State {
  rk: Uint8Array;
  dhs: KeyPair;
  dhr: Uint8Array | null;
  cks: Uint8Array | null;
  ckr: Uint8Array | null;
  ns: number; nr: number; pn: number;
  skipped: Map<string, Uint8Array>;
  /** Já recebeu algo nesta sessão (então os dois lados a conhecem). */
  received: boolean;
}

const newPair = (): KeyPair => { const sk = random(KEY_BYTES); return { sk, pk: agree.publicKey(sk) }; };

function kdfRk(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const o = kdf(dhOut, rk, 'piu/v0/dr/root', 64);
  return [o.slice(0, 32), o.slice(32)];
}

/** [próxima chave de cadeia, chave da mensagem] */
const kdfCk = (ck: Uint8Array): [Uint8Array, Uint8Array] => [hmac(sha256, ck, Uint8Array.of(2)), hmac(sha256, ck, Uint8Array.of(1))];
const skipKey = (dh: Uint8Array, n: number) => `${toHex(dh)}:${n}`;
const clone = (s: State): State => ({ ...s, skipped: new Map(s.skipped) });

export class Session {
  private constructor(
    private s: State,
    /** Dado associado: chaves de assinatura das duas pontas (quem iniciou primeiro). */
    private ad: Uint8Array,
    /** Segredo para o destino lógico dos envelopes desta sessão. */
    readonly tagKey: Uint8Array,
    readonly peerId: string,
  ) {}

  get established() { return this.s.received; }

  /** Quem fala primeiro. */
  static initiate(me: Identity, them: PublicIdentity): Session {
    const sk = kdf(agree.shared(me.agree.sk, them.agreePk), concat(me.agreePk, them.agreePk), 'piu/v0/dr/init');
    const dhs = newPair();
    const [rk, cks] = kdfRk(sk, agree.shared(dhs.sk, them.agreePk));
    return new Session({ rk, dhs, dhr: them.agreePk, cks, ckr: null, ns: 0, nr: 0, pn: 0, skipped: new Map(), received: false },
      concat(me.signPk, them.signPk), kdf(sk, undefined, 'piu/v0/dr/tag'), identityId(them.signPk, them.agreePk));
  }

  /** Quem recebe a primeira mensagem de uma sessão nova. */
  static respond(me: Identity, them: PublicIdentity): Session {
    const sk = kdf(agree.shared(me.agree.sk, them.agreePk), concat(them.agreePk, me.agreePk), 'piu/v0/dr/init');
    return new Session({ rk: sk, dhs: me.agree, dhr: null, cks: null, ckr: null, ns: 0, nr: 0, pn: 0, skipped: new Map(), received: false },
      concat(them.signPk, me.signPk), kdf(sk, undefined, 'piu/v0/dr/tag'), identityId(them.signPk, them.agreePk));
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    if (!this.s.cks) {
      // O lado que respondeu só envia depois de receber (a catraca de DH cria a cadeia de envio).
      throw new Error('Sessão ainda sem cadeia de envio.');
    }
    const [cks, mk] = kdfCk(this.s.cks);
    this.s.cks = cks;
    const header = new Writer().bytes(this.s.dhs.pk).u32(this.s.pn).u32(this.s.ns).done();
    this.s.ns += 1;
    return concat(header, aead.seal(mk, ZERO_NONCE, plaintext, concat(this.ad, header)));
  }

  /** `null` se não abrir; o estado só muda quando a mensagem é autêntica. */
  decrypt(message: Uint8Array): Uint8Array | null {
    if (message.length < DR_HEADER + 16) return null;
    const r = new Reader(message);
    const dh = r.bytes(32), pn = r.u32(), n = r.u32();
    const header = message.slice(0, DR_HEADER), ct = message.slice(DR_HEADER);
    const ad = concat(this.ad, header);

    const skipped = this.s.skipped.get(skipKey(dh, n));
    if (skipped) {
      const pt = aead.open(skipped, ZERO_NONCE, ct, ad);
      if (pt) { this.s.skipped.delete(skipKey(dh, n)); this.s.received = true; }
      return pt;
    }

    const t = clone(this.s);
    try {
      if (!t.dhr || !equal(dh, t.dhr)) {
        if (!skip(t, pn)) return null;
        // Catraca de DH: nova cadeia de recepção e, em seguida, nova chave e cadeia de envio.
        t.pn = t.ns; t.ns = 0; t.nr = 0; t.dhr = dh;
        [t.rk, t.ckr] = kdfRk(t.rk, agree.shared(t.dhs.sk, dh));
        t.dhs = newPair();
        [t.rk, t.cks] = kdfRk(t.rk, agree.shared(t.dhs.sk, dh));
      }
      if (!skip(t, n)) return null;
      const [ckr, mk] = kdfCk(t.ckr!);
      t.ckr = ckr; t.nr += 1;
      const pt = aead.open(mk, ZERO_NONCE, ct, ad);
      if (!pt) return null;
      t.received = true;
      this.s = t;
      return pt;
    } catch {
      return null;
    }
  }

  /** Estado para salvar no aparelho (cifrado pelo armazenamento seguro). Contém segredos. */
  export(): string {
    const h = (b: Uint8Array | null) => (b ? toHex(b) : null);
    return JSON.stringify({
      v: 0, peerId: this.peerId, ad: h(this.ad), tagKey: h(this.tagKey), rk: h(this.s.rk), dhs: [h(this.s.dhs.sk), h(this.s.dhs.pk)], dhr: h(this.s.dhr),
      cks: h(this.s.cks), ckr: h(this.s.ckr), ns: this.s.ns, nr: this.s.nr, pn: this.s.pn, received: this.s.received, skipped: [...this.s.skipped].map(([k, v]) => [k, h(v)]),
    });
  }

  static import(json: string): Session {
    const j = JSON.parse(json);
    const b = (x: string | null) => (x == null ? null : Uint8Array.from(x.match(/../g)!.map(y => parseInt(y, 16))));
    return new Session({
      rk: b(j.rk)!, dhs: { sk: b(j.dhs[0])!, pk: b(j.dhs[1])! }, dhr: b(j.dhr), cks: b(j.cks), ckr: b(j.ckr), ns: j.ns, nr: j.nr, pn: j.pn, received: j.received,
      skipped: new Map((j.skipped as [string, string][]).map(([k, v]) => [k, b(v)!])),
    }, b(j.ad)!, b(j.tagKey)!, j.peerId);
  }
}

/** Guarda chaves puladas até `until` (mensagens que ainda vão chegar fora de ordem). */
function skip(t: State, until: number): boolean {
  if (!t.ckr) return true;
  if (until - t.nr > MAX_SKIP) return false;
  while (t.nr < until) {
    const [ckr, mk] = kdfCk(t.ckr);
    t.skipped.set(skipKey(t.dhr!, t.nr), mk);
    t.ckr = ckr; t.nr += 1;
    if (t.skipped.size > MAX_STORED_SKIPPED) t.skipped.delete(t.skipped.keys().next().value!);
  }
  return true;
}
