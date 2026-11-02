/**
 * Migração aparelho a aparelho: o aparelho NOVO mostra um QR (oferta) com uma chave X25519 efêmera;
 * o aparelho ANTIGO lê a oferta, faz o acordo de chaves com a sua própria chave efêmera e devolve a
 * frase cifrada (XChaCha20-Poly1305) numa resposta. Os dois mostram o mesmo código de 4 palavras,
 * derivado do segredo e de toda a conversa (transcrição): se alguém trocar a resposta no caminho, as
 * palavras não batem e o aparelho novo não aplica nada. TypeScript puro (testado no Node).
 *
 * Por que é seguro: a oferta chega pela câmera (canal autêntico, de perto), então a frase só pode ser
 * aberta por quem tem a chave efêmera do aparelho novo. A conferência das palavras protege o caminho
 * de volta. As chaves efêmeras vivem só na memória da tela e somem ao sair.
 *
 * O canal é plugável (`MigrationChannel`): hoje a resposta volta por um segundo QR (funciona sem
 * rede e antes do onboarding, quando o transporte ainda está desligado); o transporte local pode
 * implementar a mesma interface.
 */
import { b64url, unb64url } from '../messaging/card';
import { concat, fromUtf8, ProtocolError, Reader, utf8, Writer } from '../protocol/bytes';
import { isValidPhrase, WORDLIST } from '../protocol/phrase';
import { aead, agree, hash, kdf, random } from '../protocol/suite';
import type { DevicePlatform } from './devicesCore';

export const MIG_VERSION = 1;
export const OFFER_PREFIX = 'piu-mig1:';
export const REPLY_PREFIX = 'piu-mig2:';
/** A oferta vale 10 minutos. */
export const OFFER_TTL_SEC = 600;
export const CODE_WORDS = 4;
const MAX_NAME = 40;

/** Quem é o aparelho (chave própria do aparelho, para o registro de aparelhos). */
export interface DeviceInfo { pk: Uint8Array; name: string; platform: DevicePlatform }

export interface Offer { v: number; epk: Uint8Array; expiresAt: number; device: DeviceInfo }
/** Segredo do aparelho novo (só em memória). */
export interface OfferSecret { esk: Uint8Array; offer: Offer; text: string }

/** O que o aparelho antigo envia. */
export interface MigrationPayload {
  phrase: string[];
  /** Aparelho de origem (vira registro "origem" no aparelho novo). */
  from: { pk: string; name: string; platform: DevicePlatform };
  /** Nome do perfil público, se houver. */
  profileName?: string;
}

export class MigrationError extends Error {
  constructor(public code: 'FORMAT' | 'EXPIRED' | 'AUTH' | 'CONTENT', message: string) { super(message); this.name = 'MigrationError'; }
}

const PLATFORMS: DevicePlatform[] = ['android', 'ios', 'web', 'other'];

const clamp = (s: string) => { let c = [...s.trim()]; while (utf8(c.join('')).length > MAX_NAME) c = c.slice(0, -1); return c.join(''); };

function encodeOffer(o: Offer): Uint8Array {
  const name = utf8(clamp(o.device.name));
  return new Writer().u8(o.v).bytes(o.epk).u32(o.expiresAt).bytes(o.device.pk).u8(PLATFORMS.indexOf(o.device.platform)).u8(name.length).bytes(name).done();
}

/** Lê o texto do QR de oferta (lido pelo aparelho antigo). */
export function parseOffer(text: string, now: number): { offer: Offer; raw: Uint8Array } {
  const t = text.trim();
  if (!t.startsWith(OFFER_PREFIX)) throw new MigrationError('FORMAT', 'Este QR não é de um aparelho novo do Piu.');
  let raw: Uint8Array;
  let offer: Offer;
  try {
    raw = unb64url(t.slice(OFFER_PREFIX.length));
    const r = new Reader(raw);
    const v = r.u8();
    if (v !== MIG_VERSION) throw new MigrationError('FORMAT', 'Versão do Piu diferente nos dois aparelhos. Atualize os dois.');
    const epk = r.bytes(32), expiresAt = r.u32(), pk = r.bytes(32), plat = PLATFORMS[r.u8()] ?? 'other', name = fromUtf8(r.bytes(r.u8()));
    if (r.remaining) throw new ProtocolError('TRAILING', 'Sobra de dados.');
    offer = { v, epk, expiresAt, device: { pk, platform: plat, name } };
  } catch (e) {
    if (e instanceof MigrationError) throw e;
    throw new MigrationError('FORMAT', 'QR ilegível. Tente de novo.');
  }
  if (offer.expiresAt < now) throw new MigrationError('EXPIRED', 'Este QR expirou. No aparelho novo, gere outro.');
  return { offer, raw };
}

/** Aparelho NOVO: cria a oferta (QR) e guarda o segredo em memória. */
export function createOffer(device: DeviceInfo, now: number): OfferSecret {
  const esk = random(32);
  const offer: Offer = { v: MIG_VERSION, epk: agree.publicKey(esk), expiresAt: now + OFFER_TTL_SEC, device };
  const raw = encodeOffer(offer);
  return { esk, offer, text: OFFER_PREFIX + b64url(raw) };
}

/** Transcrição: tudo o que os dois lados viram, com rótulo de domínio. */
const transcript = (offerRaw: Uint8Array, epk2: Uint8Array) => hash(concat(utf8('piu/mig/v1/transcript'), offerRaw, epk2));

function keysFor(shared: Uint8Array, th: Uint8Array) {
  if (shared.every(b => b === 0)) throw new MigrationError('AUTH', 'Chave efêmera inválida.');
  return { key: kdf(shared, th, 'piu/mig/v1/key'), sas: kdf(shared, th, 'piu/mig/v1/code', 8) };
}

/** 4 palavras (11 bits cada, 44 bits) da lista da frase. */
export function codeWords(sas: Uint8Array): string[] {
  let bits = 0n;
  for (const b of sas) bits = (bits << 8n) | BigInt(b);
  return Array.from({ length: CODE_WORDS }, (_, i) => WORDLIST[Number((bits >> BigInt(64 - 11 * (i + 1))) & 0x7ffn)]);
}

function encodePayload(p: MigrationPayload) { return utf8(JSON.stringify({ v: MIG_VERSION, ...p })); }
function decodePayload(b: Uint8Array): MigrationPayload {
  let o: MigrationPayload & { v: number };
  try { o = JSON.parse(fromUtf8(b)); } catch { throw new MigrationError('CONTENT', 'Conteúdo ilegível.'); }
  if (!o || !Array.isArray(o.phrase) || !isValidPhrase(o.phrase) || !o.from || typeof o.from.pk !== 'string') throw new MigrationError('CONTENT', 'A transferência não trouxe uma frase válida.');
  return { phrase: o.phrase, from: { pk: o.from.pk, name: clamp(String(o.from.name ?? '')), platform: PLATFORMS.includes(o.from.platform) ? o.from.platform : 'other' }, profileName: typeof o.profileName === 'string' ? o.profileName : undefined };
}

/** Aparelho ANTIGO: lê a oferta e devolve a resposta (QR) e o código de 4 palavras para conferir. */
export function respondToOffer(offerText: string, payload: MigrationPayload, now: number): { reply: string; code: string[]; device: Offer['device'] } {
  if (!isValidPhrase(payload.phrase)) throw new MigrationError('CONTENT', 'Frase inválida.');
  const { offer, raw } = parseOffer(offerText, now);
  const esk2 = random(32), epk2 = agree.publicKey(esk2);
  const th = transcript(raw, epk2);
  const { key, sas } = keysFor(agree.shared(esk2, offer.epk), th);
  const nonce = random(24);
  const ct = aead.seal(key, nonce, encodePayload(payload), th);
  esk2.fill(0); key.fill(0);
  return { reply: REPLY_PREFIX + b64url(concat(Uint8Array.of(MIG_VERSION), epk2, nonce, ct)), code: codeWords(sas), device: offer.device };
}

/**
 * Aparelho NOVO: lê a resposta e devolve o código para a pessoa conferir. Só depois de conferido
 * se chama `open()` para pegar a frase. Lança MigrationError se a resposta foi adulterada.
 */
export function readReply(secret: OfferSecret, replyText: string, now: number): { code: string[]; payload: MigrationPayload } {
  const t = replyText.trim();
  if (!t.startsWith(REPLY_PREFIX)) throw new MigrationError('FORMAT', 'Este QR não é a resposta do aparelho antigo.');
  if (secret.offer.expiresAt < now) throw new MigrationError('EXPIRED', 'O QR deste aparelho expirou. Gere outro.');
  let b: Uint8Array;
  try { b = unb64url(t.slice(REPLY_PREFIX.length)); } catch { throw new MigrationError('FORMAT', 'QR ilegível. Tente de novo.'); }
  if (b.length < 1 + 32 + 24 + 16 || b[0] !== MIG_VERSION) throw new MigrationError('FORMAT', 'Resposta em formato desconhecido.');
  const epk2 = b.slice(1, 33), nonce = b.slice(33, 57), ct = b.slice(57);
  const th = transcript(utf8ToRaw(secret.text), epk2);
  let k: ReturnType<typeof keysFor>;
  try { k = keysFor(agree.shared(secret.esk, epk2), th); } catch { throw new MigrationError('AUTH', 'Resposta inválida.'); }
  const pt = aead.open(k.key, nonce, ct, th);
  k.key.fill(0);
  if (!pt) throw new MigrationError('AUTH', 'A resposta não confere: pode ter sido adulterada. Comece de novo, com os dois aparelhos lado a lado.');
  return { code: codeWords(k.sas), payload: decodePayload(pt) };
}

const utf8ToRaw = (offerText: string) => unb64url(offerText.slice(OFFER_PREFIX.length));

/** Esquece o segredo efêmero (ao sair da tela ou concluir). */
export const wipeOffer = (s: OfferSecret) => s.esk.fill(0);

// ── canal plugável ───────────────────────────────────────────────

/**
 * Canal entre os dois aparelhos. A interface é de texto para servir a QR, colar código ou ao
 * transporte local (Wi-Fi Direct/BLE) — que, quando estiver disponível antes do onboarding, pode
 * implementar `send`/`receive` com a mesma criptografia acima.
 */
export interface MigrationChannel {
  send(text: string): Promise<void>;
  /** Próxima mensagem recebida. */
  receive(): Promise<string>;
  close(): void;
}

/** Par de canais em memória (testes e demonstração). */
export function memoryChannelPair(): [MigrationChannel, MigrationChannel] {
  const mk = () => ({ q: [] as string[], waiting: [] as ((s: string) => void)[] });
  const a = mk(), b = mk();
  const end = (inbox: typeof a, outbox: typeof a): MigrationChannel => ({
    send: async t => { const w = outbox.waiting.shift(); if (w) w(t); else outbox.q.push(t); },
    receive: () => new Promise(res => { const t = inbox.q.shift(); if (t !== undefined) res(t); else inbox.waiting.push(res); }),
    close: () => {},
  });
  return [end(a, b), end(b, a)];
}

/** Aparelho novo pelo canal: envia a oferta, espera a resposta e devolve código e conteúdo (aplicar só depois de conferir). */
export async function receiveOverChannel(ch: MigrationChannel, device: DeviceInfo, now: () => number) {
  const s = createOffer(device, now());
  await ch.send(s.text);
  try { return readReply(s, await ch.receive(), now()); } finally { wipeOffer(s); }
}

/** Aparelho antigo pelo canal: espera a oferta e responde. */
export async function sendOverChannel(ch: MigrationChannel, payload: MigrationPayload, now: () => number) {
  const r = respondToOffer(await ch.receive(), payload, now());
  await ch.send(r.reply);
  return { code: r.code, device: r.device };
}

/**
 * Rotação das chaves de sessão: tira as sessões (Double Ratchet) do estado salvo do mensageiro
 * (JSON de `Messenger.export()`), mantendo contatos, fila e ids vistos. As próximas mensagens abrem
 * sessões novas (o outro lado aceita a sessão nova como quando alguém reinstala o app).
 */
export function dropSessions(state: string): string {
  const o = JSON.parse(state);
  if (o && typeof o === 'object') delete o.s;
  return JSON.stringify(o);
}
