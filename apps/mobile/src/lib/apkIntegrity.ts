/**
 * Conferir o instalador do "Enviar o Piu" (auditoria 2026-11-06, B-03): SHA-256 do APK e do certificado
 * de assinatura, calculados no módulo nativo `piu-app-share` (Kotlin, em blocos, fora da thread principal,
 * com cache por caminho + data + tamanho). Aqui só o formato, puro e testado no Node.
 */

/**
 * Certificado de assinatura do Piu publicado no site (`ANDROID_CERT_SHA256` em
 * apps/site/src/lib/androidRelease.ts; um teste confere que os dois são iguais).
 */
export const OFFICIAL_CERT_SHA256 = '595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31';

export interface ApkIntegrity {
  /** SHA-256 do arquivo que vai para o outro celular (64 hexa minúsculos). */
  apkSha256: string;
  /** SHA-256 de cada certificado que assina o app instalado (normalmente um). */
  certSha256: string[];
}

const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

/** Valores do módulo nativo, conferidos (null se faltar algo ou vier torto). */
export function normalizeIntegrity(raw: unknown): ApkIntegrity | null {
  const r = raw as { apkSha256?: unknown; certSha256?: unknown } | null;
  if (!r || !isSha256(r.apkSha256) || !Array.isArray(r.certSha256) || !r.certSha256.length || !r.certSha256.every(isSha256)) return null;
  return { apkSha256: r.apkSha256.toLowerCase(), certSha256: r.certSha256.map(c => c.toLowerCase()) };
}

/** "595B DC6A 2D57 …": o hash inteiro em grupos de 4 (igual ao site). */
export const groupHex = (hex: string) => hex.toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

/** "595B DC6A … 78B7 FF31": começo e fim, para a tela (o inteiro fica a um toque). */
export function shortHex(hex: string): string {
  const g = groupHex(hex).split(' ');
  return g.length <= 4 ? g.join(' ') : `${g.slice(0, 2).join(' ')} … ${g.slice(-2).join(' ')}`;
}

/** Assinado com a chave oficial do Piu? (Build de teste, chave de debug ou app alterado: 'other'.) */
export const certStatus = (certs: string[]): 'official' | 'other' =>
  certs.length === 1 && certs[0]!.toLowerCase() === OFFICIAL_CERT_SHA256 ? 'official' : 'other';
