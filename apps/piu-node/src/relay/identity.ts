import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveNodeKey, type KeyPair, newSeed } from '../protocol/keys.js';

/**
 * Identidade técnica do nó (LNNP): semente própria do equipamento, gerada na primeira execução e
 * guardada em `<data>/lnnp/node.seed` com 0600. Não tem relação com a carteira nem com o operador:
 * trocar de operador não muda a identidade do nó, e a identidade do nó não revela quem opera.
 */
export function loadNodeKey(dataDir: string): KeyPair {
  const dir = join(dataDir, 'lnnp');
  const file = join(dir, 'node.seed');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (!existsSync(file)) {
    const tmp = file + '.tmp';
    writeFileSync(tmp, newSeed(), { mode: 0o600 });
    renameSync(tmp, file);
  }
  chmodSync(file, 0o600);
  const seed = new Uint8Array(readFileSync(file));
  if (seed.length !== 32) throw new Error(`Semente do nó inválida em ${file}.`);
  return deriveNodeKey(seed);
}
