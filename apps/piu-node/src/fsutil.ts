import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Gravação atômica com permissão 0600: escreve num temporário ao lado, força o disco e troca pelo
 * nome final. Uma queda de energia no meio deixa o arquivo antigo inteiro, nunca um pela metade.
 * A pasta é criada (ou corrigida) com 0700.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${file}.tmp`;
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
}
