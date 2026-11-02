import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json',
};

/**
 * Arquivos do painel (somente leitura). Sem listagem de pastas; o caminho é normalizado e
 * precisa ficar dentro da pasta do painel (anti path traversal); só extensões conhecidas.
 */
export async function readPanelFile(root: string, urlPath: string): Promise<{ body: Buffer; type: string } | null> {
  const base = resolve(root);
  let rel: string;
  try { rel = decodeURIComponent(urlPath.split('?')[0] ?? '/'); } catch { return null; }
  if (rel.includes('\0')) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = resolve(join(base, normalize(rel)));
  if (full !== base && !full.startsWith(base + sep)) return null;
  const type = TYPES[extname(full).toLowerCase()];
  if (!type) return null;
  try {
    if (!(await stat(full)).isFile()) return null;
    return { body: await readFile(full), type };
  } catch {
    return null;
  }
}
