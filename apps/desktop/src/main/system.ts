/**
 * Integração com o sistema, sem Electron (testada em test/system.test.ts):
 * - "Iniciar com o sistema" no Linux: arquivo `piu.desktop` em `~/.config/autostart` (XDG). No macOS e no
 *   Windows o main.ts usa `app.setLoginItemSettings`.
 * - "Verificar atualizações": lê a lista de releases do GitHub (fora da carteira, a única chamada de internet;
 *   só quando a pessoa pede ou, com "Avisar quando sair versão nova", uma vez ao abrir o Piu), filtra as tags `desktop-vX.Y.Z` e compara com a
 *   versão instalada. Baixar, conferir a assinatura e instalar fica em updater.ts.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateCheck } from '../shared/types';
import { tm } from './i18n';

const AUTOSTART_FILE = 'piu.desktop';

/** Exec entre aspas, com `"`, `` ` ``, `$` e `\` escapados (Desktop Entry Specification). */
export function linuxAutostartEntry(exec: string): string {
  const quoted = `"${exec.replace(/(["`$\\])/g, '\\$1')}"`;
  return ['[Desktop Entry]', 'Type=Application', 'Name=Piu', 'Comment=Mensagens que chegam sem internet', `Exec=${quoted}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}

export function linuxAutostartDir(env: Record<string, string | undefined>, home: string): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'autostart');
}

export function setLinuxAutostart(enabled: boolean, o: { dir: string; exec: string }) {
  const file = join(o.dir, AUTOSTART_FILE);
  if (!enabled) { rmSync(file, { force: true }); return; }
  mkdirSync(o.dir, { recursive: true });
  writeFileSync(file, linuxAutostartEntry(o.exec), { mode: 0o644 });
}

// ── atualizações ─────────────────────────────────────────
export const RELEASES_REPO = 'Magnopiro-oficial/piu.';
export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=50`;
const RELEASE_PAGE_PREFIX = `https://github.com/${RELEASES_REPO}/releases/`;
const TAG = /^desktop-v(\d+\.\d+\.\d+)$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0), pb = b.split('.').map(n => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export const DOWNLOAD_PREFIX = `https://github.com/${RELEASES_REPO}/releases/download/`;

export interface ReleaseAsset { name: string; url: string; size: number }
/** `notes`: itens de lista das notas do release (texto puro), para "O que muda". */
export interface DesktopRelease { version: string; url: string; assets: ReleaseAsset[]; notes: string[] }

/** Só arquivos baixados do próprio repositório, com nome simples (sem caminho) e tamanho conhecido. */
function assetsOf(list: unknown, tag: string): ReleaseAsset[] {
  if (!Array.isArray(list)) return [];
  const out: ReleaseAsset[] = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const { name, browser_download_url: url, size } = a as Record<string, unknown>;
    if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) continue;
    if (!/^[\w.+-]+$/.test(name) || name.startsWith('.') || url !== `${DOWNLOAD_PREFIX}${tag}/${encodeURIComponent(name)}`) continue;
    out.push({ name, url, size });
  }
  return out;
}

/** Linhas "- item" / "* item" das notas, sem marcação, no máximo 6 de até 140 caracteres. */
export function releaseNotes(body: unknown): string[] {
  if (typeof body !== 'string') return [];
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*[-*•]\s+(.+)$/.exec(line);
    if (!m) continue;
    const t = m[1]!.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (t) out.push(t.length > 140 ? `${t.slice(0, 139)}…` : t);
    if (out.length === 6) break;
  }
  return out;
}

/** Releases publicadas do desktop, da mais nova para a mais velha. A página precisa ser do próprio repositório. */
export function desktopReleases(json: unknown): DesktopRelease[] {
  if (!Array.isArray(json)) throw new Error(tm('main.update.githubUnexpected'));
  const out: DesktopRelease[] = [];
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const { tag_name: tag, html_url: url, draft, prerelease, assets, body } = r as Record<string, unknown>;
    if (typeof tag !== 'string' || typeof url !== 'string' || draft === true || prerelease === true) continue;
    const m = TAG.exec(tag);
    if (!m || !url.startsWith(RELEASE_PAGE_PREFIX)) continue;
    out.push({ version: m[1]!, url, assets: assetsOf(assets, tag), notes: releaseNotes(body) });
  }
  return out.sort((x, y) => compareVersions(y.version, x.version));
}

/**
 * Falha ao procurar versão: `offline` = nem chegou ao GitHub (sem internet, DNS, tempo esgotado);
 * `github` = o GitHub respondeu com erro ou com algo inesperado. A interface mostra textos diferentes (E2d/E2e).
 */
export class UpdateCheckError extends Error {
  constructor(public kind: 'offline' | 'github', message: string) { super(message); this.name = 'UpdateCheckError'; }
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Release mais nova do desktop publicada no GitHub (ou `null`). Erros viram mensagem para a pessoa. */
export async function latestRelease(fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<DesktopRelease | null> {
  let res;
  try { res = await fetchFn(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new UpdateCheckError('offline', tm('main.update.offline')); }
  if (!res.ok) throw new UpdateCheckError('github', tm('main.update.githubStatus', { status: res.status }));
  try { return desktopReleases(await res.json())[0] ?? null; }
  catch { throw new UpdateCheckError('github', tm('main.update.githubUnexpected')); }
}

export async function checkForUpdates(current: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<UpdateCheck> {
  const top = await latestRelease(fetchFn);
  if (!top) return { state: 'latest', current, latest: null, url: null };
  return { state: compareVersions(top.version, current) > 0 ? 'available' : 'latest', current, latest: top.version, url: top.url };
}
