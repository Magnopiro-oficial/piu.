// Leitura e conferência de releases.json (gerado por scripts/sync-release.mjs a partir do GitHub).
// Valor torto quebra o build em vez de ir para o ar.
import data from './releases.json';

export const REPO = 'https://github.com/Magnopiro-oficial/piu.';

export interface ReleaseAsset { name: string; url: string; size: number; sha256: string }
export interface Release { tag: string; version: string; published: boolean; publishedAt: string | null; assets: Record<string, ReleaseAsset> }
export type Product = 'android' | 'desktop' | 'provider' | 'node';

const TAG = /^(android|desktop|provider|node)-v(\d+\.\d+\.\d+)$/;

function check(product: Product): Release {
  const r = (data as unknown as Record<Product, Release>)[product];
  const m = r && TAG.exec(r.tag);
  if (!m || m[1] !== product || m[2] !== r.version) throw new Error(`releases.json: tag/versão inválida em ${product}.`);
  if (!r.published) return { ...r, assets: {} };
  for (const [id, a] of Object.entries(r.assets)) {
    const base = `${REPO}/releases/download/${r.tag}/`;
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) throw new Error(`releases.json: ${product}.${id} sem SHA-256 de 64 hexa.`);
    if (!Number.isInteger(a.size) || a.size <= 0) throw new Error(`releases.json: ${product}.${id} com tamanho inválido.`);
    if (!a.url.startsWith(base)) throw new Error(`releases.json: ${product}.${id} aponta para fora do release ${r.tag}.`);
  }
  return r;
}

export const release = (p: Product) => check(p);

/** Tamanho como o GitHub mostra (base 1024, rótulo "MB"). */
export const fmtSize = (bytes: number) => {
  const mb = bytes / 1024 / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
};
