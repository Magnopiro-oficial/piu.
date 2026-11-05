/**
 * Certificado TLS próprio do vínculo com o celular (wss://). O Android de release não aceita ws://
 * em claro, então o desktop serve o WebSocket por HTTPS com um certificado autoassinado P-256 (como o
 * piu-node gera o dele), guardado em `<userData>/link-tls/` e fixado pelo QR: `c=<SHA-256 do DER,
 * base64url>`. O celular só aceita esse certificado, então ninguém na Wi-Fi se faz passar pelo desktop.
 */
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { b64url } from '../../../mobile/src/messaging/card';

export interface LinkTls { key: string; cert: string; /** SHA-256 do certificado DER (32 bytes; o `c` do QR). */ hash: Uint8Array; /** O mesmo em base64url. */ pin: string; der: Uint8Array }

export function certHash(certPem: string): { hash: Uint8Array; pin: string; der: Uint8Array } {
  const der = new Uint8Array(new X509Certificate(certPem).raw);
  const hash = new Uint8Array(createHash('sha256').update(der).digest());
  return { hash, pin: b64url(hash), der };
}

/** Carrega (ou gera na primeira vez) o certificado do vínculo. `hosts`: IPs/nomes locais para o SAN. */
export async function loadLinkTls(dir: string, hosts: string[] = []): Promise<LinkTls> {
  const keyPath = join(dir, 'key.pem'), certPath = join(dir, 'cert.pem');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const names = [...new Set([hostname().toLowerCase(), ...hosts])].filter(Boolean);
    const pems = await generate([{ name: 'commonName', value: 'piu-desktop.local' }], {
      keyType: 'ec',
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 397 * 86400_000),
      extensions: [{ name: 'subjectAltName', altNames: ['piu-desktop.local', ...names].map(n => (/^\d+\.\d+\.\d+\.\d+$/.test(n) ? { type: 7, ip: n } : { type: 2, value: n })) }],
    });
    writeFileSync(keyPath, pems.private, { mode: 0o600 });
    writeFileSync(certPath, pems.cert, { mode: 0o644 });
  }
  const cert = readFileSync(certPath, 'utf8');
  return { key: readFileSync(keyPath, 'utf8'), cert, ...certHash(cert) };
}
