/**
 * Procurar versão nova do Piu Provider para computador no GitHub (núcleo puro, sem Electron).
 * Espelha apps/desktop/src/main/system.ts, com as tags `provider-vX.Y.Z`. Só avisa e abre a página
 * do release: nada é baixado nem instalado automaticamente.
 * Sem imports relativos: os testes rodam este arquivo direto no Node (test/update.test.ts).
 */
export const RELEASES_REPO = 'Magnopiro-oficial/piu.';
export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=50`;
export const RELEASE_PAGE_PREFIX = `https://github.com/${RELEASES_REPO}/releases/`;
const TAG = /^provider-v(\d+\.\d+\.\d+)$/;
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0), pb = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Falha ao procurar versão: `offline` = nem chegou ao GitHub (sem internet, DNS, tempo esgotado);
 * `github` = o GitHub respondeu com erro ou com algo inesperado. A interface mostra textos diferentes.
 */
export class UpdateCheckError extends Error {
  readonly kind: 'offline' | 'github';
  constructor(kind: 'offline' | 'github', message: string) { super(message); this.name = 'UpdateCheckError'; this.kind = kind; }
}

/**
 * A URL normalizada se for uma página de release deste repositório no GitHub (a única coisa que o
 * app abre no navegador a partir da checagem); senão `null`.
 */
export function releasePageUrl(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.startsWith(RELEASE_PAGE_PREFIX)) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port !== '' || u.username !== '' || u.password !== '') return null;
  const s = u.toString();
  return s.startsWith(RELEASE_PAGE_PREFIX) ? s : null;
}

export interface ProviderRelease { version: string; url: string }

/** Releases publicadas do Provider Desktop, da mais nova para a mais velha. A página precisa ser do próprio repositório. */
export function providerReleases(json: unknown): ProviderRelease[] {
  if (!Array.isArray(json)) throw new UpdateCheckError('github', 'unexpected GitHub response');
  const out: ProviderRelease[] = [];
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const { tag_name: tag, html_url: raw, draft, prerelease } = r as Record<string, unknown>;
    if (typeof tag !== 'string' || typeof raw !== 'string' || draft === true || prerelease === true) continue;
    const m = TAG.exec(tag);
    const url = m ? releasePageUrl(raw) : null;
    if (m && url) out.push({ version: m[1]!, url });
  }
  return out.sort((x, y) => compareVersions(y.version, x.version));
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** Release mais nova do Provider Desktop publicada no GitHub (ou `null`). */
export async function latestRelease(fetchFn: FetchLike = defaultFetch): Promise<ProviderRelease | null> {
  let res;
  try { res = await fetchFn(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (err) { throw new UpdateCheckError('offline', (err as Error)?.message || 'offline'); }
  if (!res.ok) throw new UpdateCheckError('github', `GitHub HTTP ${res.status}`);
  let json: unknown;
  try { json = await res.json(); } catch { throw new UpdateCheckError('github', 'unexpected GitHub response'); }
  return providerReleases(json)[0] ?? null;
}

export interface UpdateCheck { state: 'available' | 'latest'; current: string; latest: string | null; url: string | null }

export async function checkForUpdates(current: string, fetchFn: FetchLike = defaultFetch): Promise<UpdateCheck> {
  const top = await latestRelease(fetchFn);
  if (!top) return { state: 'latest', current, latest: null, url: null };
  return { state: compareVersions(top.version, current) > 0 ? 'available' : 'latest', current, latest: top.version, url: top.url };
}

/** Checagem automática ao abrir: só com o aviso ligado e no máximo uma vez a cada 24 h. */
export function shouldAutoCheck(p: { updateNotify: boolean; lastUpdateCheck: number }, now: number): boolean {
  if (!p.updateNotify) return false;
  const elapsed = now - p.lastUpdateCheck;
  return elapsed >= DAY_MS || elapsed < 0;
}
