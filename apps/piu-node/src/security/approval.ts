/**
 * Aprovação de transferências no celular pareado (design: "Assinar no celular", com o mesmo código
 * nas duas telas). Sem rede entre o celular e o nó, tudo passa por QR e por códigos digitados:
 *
 * 1. Parear (uma vez): o painel mostra `piup:` (QR) com um segredo de 32 bytes; o celular guarda o
 *    segredo e mostra um código de 6 dígitos (HMAC do segredo), que o operador digita no painel.
 * 2. Transferir: o nó cria um PEDIDO (`piut:`, QR) com valor, destino e validade de 5 min, e um
 *    código de conferência de 6 dígitos (hash do pedido) que aparece nas duas telas. O celular, depois
 *    da biometria, mostra o código de APROVAÇÃO: HMAC(segredo, pedido) em 16 caracteres. O operador
 *    digita; o nó confere em tempo constante e só então executa (uso único).
 *
 * Quem só vê o painel (ou o QR) não aprova nada: falta o segredo, que vive no celular.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const APPROVAL_TTL_MS = 5 * 60 * 1000;
export const PAIR_TTL_MS = 10 * 60 * 1000;
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I

const b64url = (b: Buffer) => b.toString('base64url');

export const newSecret = () => randomBytes(32);

/** Código de 6 dígitos que o celular mostra ao parear (o operador digita no painel). */
export const pairCode = (secret: Buffer) => {
  const h = createHmac('sha256', secret).update('piu/v0/phone-pair').digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
};

/** QR do pareamento (o segredo vai só no QR, mostrado na tela do painel). */
export function pairPayload(o: { phoneId: string; secret: Buffer; node: string; operator: string; fingerprint?: string; url?: string }) {
  return 'piup:' + b64url(Buffer.from(JSON.stringify({
    v: 1, i: o.phoneId, s: b64url(o.secret), n: o.node.slice(0, 40), o: o.operator.slice(0, 40),
    // Para o app falar com este nó pela API: impressão digital SHA-256 do certificado (pinning) e endereço.
    ...(o.fingerprint ? { f: o.fingerprint } : {}), ...(o.url ? { u: o.url } : {}),
  })));
}

/** QR do pedido de transferência. */
export function requestPayload(o: { txId: string; amount: number; to: string; phoneId: string; expiresAt: number; node: string }) {
  return 'piut:' + b64url(Buffer.from(JSON.stringify({ v: 1, i: o.txId, a: o.amount, t: o.to, p: o.phoneId, x: Math.floor(o.expiresAt / 1000), n: o.node.slice(0, 40) })));
}

/** Código de conferência (igual no painel e no celular): 6 dígitos do hash do pedido. */
export const checkCode = (request: string) => {
  const h = createHash('sha256').update(request).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
};

/** Código de aprovação que o celular calcula (16 caracteres de um alfabeto sem ambiguidades). */
export function approvalCode(secret: Buffer, request: string): string {
  const h = createHmac('sha256', secret).update('piu/v0/approve\n').update(request).digest();
  let bits = 0, acc = 0, out = '';
  for (const byte of h) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5 && out.length < 16) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= 16) break;
  }
  return out;
}

/** Confere o código digitado (ignora espaços, hífens e maiúsculas/minúsculas). */
export function approvalMatches(secret: Buffer, request: string, typed: string): boolean {
  const a = Buffer.from(typed.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const b = Buffer.from(approvalCode(secret, request));
  return a.length === b.length && timingSafeEqual(a, b);
}
