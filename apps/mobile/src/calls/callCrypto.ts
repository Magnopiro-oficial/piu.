/**
 * Cifra da chamada de voz. A sinalização (convite, aceite) viaja cifrada pela sessão do contato e
 * leva uma chave X25519 efêmera de cada lado; daqui sai:
 * - uma chave por sentido para os quadros de voz (XChaCha20-Poly1305, nonce = rótulo ‖ sequência);
 * - uma etiqueta de 8 bytes que identifica a chamada nos quadros (o vizinho que repassa não sabe quem é);
 * - as 4 palavras (44 bits da lista da frase) que os dois leem em voz alta: se alguém trocou as chaves
 *   no meio, as palavras saem diferentes.
 * Quadro: 'V' (1) ‖ etiqueta (8) ‖ sequência u32 (4) ‖ Opus cifrado + 16 de autenticação.
 */
import { aead, agree, hash, kdf, random, KEY_BYTES } from '../protocol/suite';
import { concat, equal, utf8 } from '../protocol/bytes';
import { codeWords } from '../lib/migration';

export const VOICE_FRAME = 0x56; // 'V'
const HEADER = 13;

export type CallRole = 'caller' | 'callee';
export type CallKeys = { send: Uint8Array; recv: Uint8Array; tag: Uint8Array; words: string[] };

export function newCallKeypair() {
  const sk = random(KEY_BYTES);
  return { sk, pk: agree.publicKey(sk) };
}

/** Deriva as chaves da chamada. `callId` e as duas chaves públicas entram na transcrição. */
export function callKeys(o: { callId: string; role: CallRole; mySk: Uint8Array; myPk: Uint8Array; theirPk: Uint8Array }): CallKeys {
  const shared = agree.shared(o.mySk, o.theirPk);
  if (shared.every(b => b === 0)) throw new Error('chave efêmera inválida');
  const [pkCaller, pkCallee] = o.role === 'caller' ? [o.myPk, o.theirPk] : [o.theirPk, o.myPk];
  const th = hash(concat(utf8('piu/call/v1/transcript'), utf8(o.callId), pkCaller, pkCallee));
  const c2e = kdf(shared, th, 'piu/call/v1/caller-to-callee');
  const e2c = kdf(shared, th, 'piu/call/v1/callee-to-caller');
  shared.fill(0);
  return {
    send: o.role === 'caller' ? c2e : e2c,
    recv: o.role === 'caller' ? e2c : c2e,
    tag: kdf(th, undefined, 'piu/call/v1/tag', 8),
    words: codeWords(kdf(th, c2e, 'piu/call/v1/words', 8)),
  };
}

const nonceFor = (key: Uint8Array, seq: number) => {
  const n = new Uint8Array(24);
  n.set(kdf(key, undefined, 'piu/call/v1/nonce', 20));
  new DataView(n.buffer).setUint32(20, seq >>> 0);
  return n;
};

export function sealVoice(k: CallKeys, seq: number, opus: Uint8Array): Uint8Array {
  const head = new Uint8Array(HEADER);
  head[0] = VOICE_FRAME;
  head.set(k.tag, 1);
  new DataView(head.buffer).setUint32(9, seq >>> 0);
  return concat(head, aead.seal(k.send, nonceFor(k.send, seq), opus, head));
}

/** A etiqueta do quadro, para achar a chamada antes de abrir (null se não for quadro de voz). */
export function voiceTag(frame: Uint8Array): Uint8Array | null {
  return frame.length > HEADER + 16 && frame[0] === VOICE_FRAME ? frame.subarray(1, 9) : null;
}

/** Abre um quadro desta chamada; null se for de outra, adulterado ou repetido. */
export function openVoice(k: CallKeys, frame: Uint8Array, replay: VoiceReplay): { seq: number; payload: Uint8Array } | null {
  const tag = voiceTag(frame);
  if (!tag || !equal(tag, k.tag)) return null;
  const head = frame.subarray(0, HEADER);
  const seq = new DataView(frame.buffer, frame.byteOffset).getUint32(9);
  if (!replay.fresh(seq)) return null;
  const payload = aead.open(k.recv, nonceFor(k.recv, seq), frame.subarray(HEADER), head);
  if (!payload || !replay.accept(seq)) return null;
  return { seq, payload };
}

/** Janela deslizante de sequências já vistas (aceita fora de ordem, recusa repetido e muito antigo). */
export class VoiceReplay {
  private top = -1;
  private seen = new Set<number>();
  constructor(private readonly window = 256) {}
  fresh(seq: number) { return !this.seen.has(seq) && (this.top < 0 || seq > this.top - this.window); }
  accept(seq: number): boolean {
    if (!this.fresh(seq)) return false;
    this.seen.add(seq);
    if (seq > this.top) {
      this.top = seq;
      for (const s of this.seen) if (s <= seq - this.window) this.seen.delete(s);
    }
    return true;
  }
}
