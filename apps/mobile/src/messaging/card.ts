/**
 * Cartão de contato (o conteúdo do QR de convite): a parte pública de uma identidade, o nome que a
 * pessoa escolheu mostrar e a validade, tudo assinado pela própria chave de assinatura.
 *
 * Formato: `piu1:` + base64url de
 *   u8 versão (1) · u8 tipo (0 pública, 1 anônima) · signPk (32) · agreePk (32) · vínculo (64)
 *   · u32 expira em (s) · u8 tamanho do nome · nome (UTF-8, até 48 bytes) · assinatura (64)
 *
 * O cartão não é segredo: quem o tem consegue escrever para a identidade, mas não ler nada.
 * Quem garante que a chave é mesmo da pessoa é a conferência do código de segurança, frente a frente.
 */
import { concat, fromUtf8, ProtocolError, Reader, utf8, Writer } from '../protocol/bytes';
import { identityId, type Identity, type IdentityKind, type PublicIdentity, verifyBinding } from '../protocol/keys';
import { sign } from '../protocol/suite';

export const CARD_PREFIX = 'piu1:';
export const CARD_TTL_SEC = 24 * 3600;
const MAX_NAME_BYTES = 48;
const DOMAIN = utf8('piu/v0/card');

export interface ContactCard {
  kind: IdentityKind;
  pub: PublicIdentity;
  /** Nome exibido; vazio na identidade anônima. */
  name: string;
  expiresAt: number;
  /** `piu:…` (hash das chaves públicas). */
  id: string;
}

export function b64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ProtocolError('BAD_CARD', 'Código com caracteres inválidos.');
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const r = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(r, c => c.charCodeAt(0));
}

/** Corta o nome em até 48 bytes sem quebrar um caractere no meio. */
function clampName(name: string): Uint8Array {
  let out = utf8(name.trim());
  let chars = [...name.trim()];
  while (out.length > MAX_NAME_BYTES) { chars = chars.slice(0, -1); out = utf8(chars.join('')); }
  return out;
}

export function encodeCard(me: Identity, name: string, now: number, ttlSec = CARD_TTL_SEC): string {
  const nm = me.kind === 'anon' ? new Uint8Array(0) : clampName(name);
  const body = new Writer().u8(1).u8(me.kind === 'anon' ? 1 : 0).bytes(me.signPk).bytes(me.agreePk).bytes(me.binding)
    .u32(now + ttlSec).u8(nm.length).bytes(nm).done();
  return CARD_PREFIX + b64url(concat(body, sign.sign(concat(DOMAIN, body), me.sign.sk)));
}

/** Lê e confere um cartão. Lança `ProtocolError` (BAD_CARD, BAD_SIG, EXPIRED). */
export function decodeCard(text: string, now: number): ContactCard {
  const t = text.trim();
  if (!t.startsWith(CARD_PREFIX)) throw new ProtocolError('BAD_CARD', 'Isto não é um código de contato do Piu.');
  if (t.length > 1024) throw new ProtocolError('BAD_CARD', 'Código grande demais.');
  try {
    const raw = unb64url(t.slice(CARD_PREFIX.length));
    const r = new Reader(raw);
    if (r.u8() !== 1) throw new ProtocolError('BAD_CARD', 'Versão de código desconhecida.');
    const k = r.u8();
    if (k > 1) throw new ProtocolError('BAD_CARD', 'Tipo de identidade inválido.');
    const signPk = r.bytes(32), agreePk = r.bytes(32), binding = r.bytes(64);
    const expiresAt = r.u32();
    const nameLen = r.u8();
    if (nameLen > MAX_NAME_BYTES) throw new ProtocolError('BAD_CARD', 'Nome grande demais.');
    const name = fromUtf8(r.bytes(nameLen));
    const bodyLen = r.offset;
    const sig = r.bytes(64);
    if (r.remaining !== 0) throw new ProtocolError('BAD_CARD', 'Código com dados a mais.');
    const pub = { signPk, agreePk, binding };
    if (!verifyBinding(pub) || !sign.verify(sig, concat(DOMAIN, raw.slice(0, bodyLen)), signPk)) throw new ProtocolError('BAD_SIG', 'Assinatura do código não confere.');
    if (expiresAt <= now) throw new ProtocolError('EXPIRED', 'Este código venceu. Peça um novo.');
    return { kind: k === 1 ? 'anon' : 'public', pub, name: k === 1 ? '' : name, expiresAt, id: identityId(signPk, agreePk) };
  } catch (e) {
    if (e instanceof ProtocolError && e.code !== 'TRUNCATED') throw e;
    throw new ProtocolError('BAD_CARD', 'Código incompleto ou corrompido.');
  }
}
