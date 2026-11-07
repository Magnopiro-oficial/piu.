/**
 * "Procurar atualização" no celular (TypeScript puro, testado no Node: __tests__/updateCore.test.ts).
 * Espelha apps/desktop/src/main/system.ts: lê a lista de releases do GitHub, fica só com as tags
 * `android-vX.Y.Z` publicadas (sem rascunho nem pré-lançamento) que tenham a página e o `Piu-X.Y.Z.apk`
 * no próprio repositório, e compara com a versão instalada. Não baixa nem instala nada: a interface só
 * abre a página da versão no navegador (o Android pede confirmação para instalar por cima).
 */
import { t as tGlobal, type Key, type Vars } from '../i18n/core';

type Tr = (key: Key, vars?: Vars) => string;

export const RELEASES_REPO = 'Magnopiro-oficial/piu.';
export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=50`;
const RELEASE_PAGE_PREFIX = `https://github.com/${RELEASES_REPO}/releases/`;
const DOWNLOAD_PREFIX = `${RELEASE_PAGE_PREFIX}download/`;
const TAG = /^android-v(\d+\.\d+\.\d+)$/;
const TIMEOUT_MS = 15_000;
/** "Avisar sobre novas versões" vem ligado, a mesma decisão do Desktop (`updateNotify: true`). */
export const UPDATE_NOTIFY_DEFAULT = true;
/** Aviso automático: no máximo uma checagem por dia. */
export const AUTO_CHECK_MS = 24 * 60 * 60 * 1000;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0), pb = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Página de release do próprio repositório no github.com (a única URL que o app abre daqui). */
export function isReleasePage(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(RELEASE_PAGE_PREFIX) && !/[\s\\]/.test(url);
}

export interface AndroidRelease { version: string; url: string; apk: string }

/**
 * Falha ao procurar versão: `offline` = nem chegou ao GitHub (sem internet, DNS, tempo esgotado);
 * `github` = o GitHub respondeu com erro ou com algo inesperado.
 */
export class UpdateCheckError extends Error {
  constructor(public kind: 'offline' | 'github', message: string) { super(message); this.name = 'UpdateCheckError'; }
}

/** URL exata do `Piu-<versão>.apk` daquela tag, se o release tiver esse arquivo. */
function apkOf(list: unknown, tag: string, version: string): string | null {
  if (!Array.isArray(list)) return null;
  const name = `Piu-${version}.apk`;
  const want = `${DOWNLOAD_PREFIX}${tag}/${name}`;
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    if (r.name === name && r.browser_download_url === want) return want;
  }
  return null;
}

/** Releases Android publicadas, da mais nova para a mais velha. */
export function androidReleases(json: unknown): AndroidRelease[] {
  if (!Array.isArray(json)) throw new UpdateCheckError('github', 'unexpected');
  const out: AndroidRelease[] = [];
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const { tag_name: tag, html_url: url, draft, prerelease, assets } = r as Record<string, unknown>;
    if (typeof tag !== 'string' || draft === true || prerelease === true || !isReleasePage(url)) continue;
    const m = TAG.exec(tag);
    if (!m) continue;
    const apk = apkOf(assets, tag, m[1]!);
    if (apk) out.push({ version: m[1]!, url, apk });
  }
  return out.sort((x, y) => compareVersions(y.version, x.version));
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: FetchLike = (u, i) => fetch(u, i) as unknown as ReturnType<FetchLike>;

/** Release Android mais nova publicada no GitHub (ou `null`). */
export async function latestRelease(fetchFn: FetchLike = defaultFetch, timeoutMs = TIMEOUT_MS): Promise<AndroidRelease | null> {
  // AbortController + setTimeout (AbortSignal.timeout não existe em todo motor JS do React Native).
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_r, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new Error('timeout')); }, timeoutMs); });
  let res;
  try { res = await Promise.race([fetchFn(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal }), timeout]); }
  catch { throw new UpdateCheckError('offline', 'offline'); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new UpdateCheckError('github', `status ${res.status}`);
  try { return androidReleases(await res.json())[0] ?? null; }
  catch { throw new UpdateCheckError('github', 'unexpected'); }
}

export interface UpdateCheck { state: 'latest' | 'available'; current: string; latest: string | null; url: string | null }

export async function checkForUpdates(current: string, fetchFn: FetchLike = defaultFetch): Promise<UpdateCheck> {
  const top = await latestRelease(fetchFn);
  if (!top) return { state: 'latest', current, latest: null, url: null };
  return { state: compareVersions(top.version, current) > 0 ? 'available' : 'latest', current, latest: top.version, url: top.url };
}

export type UpdateOutcome = UpdateCheck | { state: 'offline' } | { state: 'github' };

/** Igual a `checkForUpdates`, mas nunca lança: falhas viram os estados `offline` e `github`. */
export async function checkOutcome(current: string, fetchFn: FetchLike = defaultFetch): Promise<UpdateOutcome> {
  try { return await checkForUpdates(current, fetchFn); }
  catch (e) { return { state: e instanceof UpdateCheckError && e.kind === 'github' ? 'github' : 'offline' }; }
}

/** Título e explicação de cada estado, para a tela e para o aviso. */
export function outcomeText(o: UpdateOutcome, t: Tr = tGlobal): { title: string; body: string } {
  switch (o.state) {
    case 'available': return { title: t('update.available', { version: o.latest ?? '' }), body: t('update.available.body') };
    case 'latest': return { title: t('update.latest'), body: t('update.latest.body') };
    case 'offline': return { title: t('update.offline'), body: t('update.offline.body') };
    default: return { title: t('update.github'), body: t('update.github.body') };
  }
}

/** Hora de checar de novo (aviso automático)? Nunca checou, passou um dia ou o relógio voltou. */
export function autoCheckDue(lastAt: number | null, now: number): boolean {
  return lastAt == null || lastAt > now || now - lastAt >= AUTO_CHECK_MS;
}
