import { createHash, createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pacotes do instalador assinados pela chave de release da Lunes (Ed25519).
 * O manifesto traz nome, versão, arquivo, tamanho e SHA-256; a assinatura cobre esses campos em
 * JSON canônico. O nó só oferece pacotes cuja assinatura confere com a chave pública FIXADA
 * (PIU_RELEASE_PUBKEY); o instalador confere de novo antes de executar (scripts/verify-package.mjs).
 */
export interface Manifest { name: string; version: string; file: string; size: number; sha256: string; signature: string }

export const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export const signedPayload = (m: Omit<Manifest, 'signature'>) =>
  Buffer.from(JSON.stringify({ name: m.name, version: m.version, file: m.file, size: m.size, sha256: m.sha256 }));

export const releaseKey = (spkiBase64: string): KeyObject => createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });

export function verifyManifest(m: Manifest, key: KeyObject): boolean {
  try { return edVerify(null, signedPayload(m), key, Buffer.from(m.signature, 'base64')); } catch { return false; }
}

/** Confere o arquivo contra o manifesto (tamanho e SHA-256). */
export function fileMatches(m: Manifest, bytes: Buffer): boolean {
  return bytes.length === m.size && createHash('sha256').update(bytes).digest('hex') === m.sha256;
}

/** Manifestos válidos em <data>/packages/*.manifest.json (assinatura e arquivo conferidos). */
export function loadPackages(dir: string, key: KeyObject | null): Manifest[] {
  if (!key) return []; // sem chave de release fixada, nenhum pacote é oferecido
  let names: string[] = [];
  try { names = readdirSync(dir).filter(n => n.endsWith('.manifest.json')); } catch { return []; }
  const out: Manifest[] = [];
  for (const n of names) {
    try {
      const m = JSON.parse(readFileSync(join(dir, n), 'utf8')) as Manifest;
      if (!SAFE_FILE.test(m.file) || !verifyManifest(m, key)) continue;
      const p = join(dir, m.file);
      if (statSync(p).size !== m.size || !fileMatches(m, readFileSync(p))) continue;
      out.push(m);
    } catch { /* manifesto inválido: ignorado */ }
  }
  return out;
}
