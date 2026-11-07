import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Gravação atômica com permissão 0600 (mesmo padrão de apps/piu-node/src/fsutil.ts, copiado: o
 * liquidante roda sozinho): escreve num temporário ao lado, força o disco (fsync) e troca pelo nome
 * final. Uma queda de energia no meio deixa o arquivo antigo inteiro, nunca um pela metade. É o que
 * protege o diário (a barreira contra pagamento duplo) e o estado do validador. Pasta com 0700.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Nome único: dois gravadores ao mesmo tempo não se atropelam no mesmo temporário.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    for (let off = 0; off < buf.length;) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  // A troca de nome também vai para o disco (onde o sistema permite abrir a pasta).
  try { const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); } } catch { /* sem suporte: segue */ }
}
