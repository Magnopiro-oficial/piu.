/**
 * Certificado TLS próprio do vínculo com o celular (wss://). O Android de release não aceita ws://
 * em claro, então o desktop serve o WebSocket por HTTPS com um certificado autoassinado P-256 (como o
 * piu-node gera o dele), fixado pelo QR: `c=<SHA-256 do DER, base64url>`. O celular só aceita esse
 * certificado, então ninguém na Wi-Fi se faz passar pelo desktop.
 * Privacidade: o certificado é novo a cada abertura do servidor (fica só na memória) e leva só o nome
 * genérico `piu-desktop.local`, sem o nome do computador nem IPs. O celular confere o pino, não o nome;
 * assim quem conecta na porta não descobre o computador nem o reconhece em outra rede.
 */
import { createHash, X509Certificate } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { b64url } from '../../../mobile/src/messaging/card';

export interface LinkTls { key: string; cert: string; /** SHA-256 do certificado DER (32 bytes; o `c` do QR). */ hash: Uint8Array; /** O mesmo em base64url. */ pin: string; der: Uint8Array }

export function certHash(certPem: string): { hash: Uint8Array; pin: string; der: Uint8Array } {
  const der = new Uint8Array(new X509Certificate(certPem).raw);
  const hash = new Uint8Array(createHash('sha256').update(der).digest());
  return { hash, pin: b64url(hash), der };
}

/**
 * Gera um certificado novo para o vínculo (o pino viaja no QR a cada vez). `dir`: pasta onde
 * versões antigas gravavam o certificado (com nome do computador e IPs); é limpa aqui.
 */
export async function loadLinkTls(dir: string): Promise<LinkTls> {
  for (const f of ['key.pem', 'cert.pem']) { try { rmSync(join(dir, f), { force: true }); } catch { /* sem permissão: segue */ } }
  const pems = await generate([{ name: 'commonName', value: 'piu-desktop.local' }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 397 * 86400_000),
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'piu-desktop.local' }] }],
  });
  return { key: pems.private, cert: pems.cert, ...certHash(pems.cert) };
}
