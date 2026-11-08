/**
 * Regras de segurança do processo principal como funções puras (sem Electron), testadas em
 * test/security.test.ts. O main.ts só liga estas decisões às APIs do Electron.
 */
import { extname, resolve, sep } from 'node:path';
import { tm } from './i18n';

/**
 * Switches que abrem o processo para depuração/instrumentação (M-05). No app empacotado, qualquer um
 * deles faz o Piu sair: com `--remote-debugging-port` um programa do mesmo usuário falaria com o renderer
 * por CDP e chamaria `window.piu.*` (inclusive a frase) sem passar pelo Keychain.
 */
export const FORBIDDEN_SWITCHES = [
  'remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-allow-origins',
  'inspect', 'inspect-brk', 'inspect-port', 'inspect-publish-uid', 'js-flags',
] as const;

/**
 * Switches proibidos presentes em `argv` (ou que `hasSwitch` diz existir). O Chromium aceita `--x`, `-x`
 * e, no Windows, `/x`, sem diferenciar maiúsculas no nome; depois de `--` nada mais é switch.
 */
export function forbiddenDebugSwitches(argv: readonly string[], platform: string = process.platform, hasSwitch?: (name: string) => boolean): string[] {
  const found = new Set<string>();
  for (const arg of argv.slice(1)) {
    if (arg === '--') break;
    const m = (platform === 'win32' ? /^(?:--?|\/)([^=\s]+)/ : /^--?([^=\s]+)/).exec(arg);
    const name = m?.[1]?.toLowerCase();
    if (name && (FORBIDDEN_SWITCHES as readonly string[]).includes(name)) found.add(name);
  }
  if (hasSwitch) for (const s of FORBIDDEN_SWITCHES) { try { if (hasSwitch(s)) found.add(s); } catch { /* sem a API */ } }
  return [...found];
}

/**
 * Esquema próprio da interface (B-04): a janela abre `piu-app://app/index.html` em vez de file://, e o fuse
 * GrantFileProtocolExtraPrivileges fica desligado. O main.ts registra o esquema como padrão e seguro e
 * responde só com arquivos de dentro de `dist/renderer` (`rendererFileFor`).
 */
export const RENDERER_SCHEME = 'piu-app';
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://app/`;

/** Arquivo de `dir` pedido por uma URL `piu-app://app/…`, ou null (outro host, credenciais, NUL ou fora da pasta). */
export function rendererFileFor(url: string, dir: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${RENDERER_SCHEME}:` || u.host !== 'app' || u.username || u.password) return null;
  let rel: string;
  try { rel = decodeURIComponent(u.pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  rel = rel.replace(/^\/+/, '') || 'index.html';
  const root = resolve(dir);
  const full = resolve(root, rel);
  return full.startsWith(root + sep) ? full : null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};
/** Tipo do arquivo da interface pela extensão (módulos ES exigem text/javascript). */
export const rendererMime = (file: string) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';

/** Origem do renderer: a pasta `dist/renderer` como URL file:// TERMINADA em "/" (B-06). */
export const rendererOriginOf = (dirHref: string) => (dirHref.endsWith('/') ? dirHref : `${dirHref}/`);

/** A URL é um arquivo dentro da pasta do renderer (prefixo com a barra: `renderer-x/` não passa). */
export const isRendererUrl = (url: string, origin: string) => origin.endsWith('/') && url.startsWith(origin);

/** Páginas que o Piu pode abrir no navegador padrão (B-02). Nada mais sai do app. */
export const EXTERNAL_ORIGINS = new Set(['https://lunes.io', 'https://explorer.lunes.io', 'https://github.com']);

export function externalUrlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && EXTERNAL_ORIGINS.has(u.origin);
  } catch { return false; }
}

/**
 * Quem chamou o IPC (B-01): só o quadro principal da janela do Piu, com uma URL do próprio renderer.
 * `isMain`: o quadro é o `mainFrame` da janela do app.
 */
export function isTrustedSender(frame: { url: string; isMain: boolean } | null | undefined, origin: string): boolean {
  return !!frame && frame.isMain && isRendererUrl(frame.url, origin);
}

export interface ReauthDeps {
  platform: string;
  canPromptTouchID: () => boolean;
  promptTouchID: (reason: string) => Promise<void>;
  /** Confirmação nativa do sistema (diálogo do processo principal; o renderer não consegue clicar nela). */
  confirm: () => Promise<boolean>;
}

/**
 * Reautenticação antes de mostrar a frase (M-01): Touch ID no macOS quando existe; sem Touch ID
 * (Macs Intel, Windows, Linux) um diálogo nativo de confirmação. O Electron não expõe a senha da
 * sessão nem o Windows Hello. Qualquer recusa ou erro: não mostra (falha fechada).
 */
export async function reauthForPhrase(d: ReauthDeps): Promise<boolean> {
  try {
    if (d.platform === 'darwin' && d.canPromptTouchID()) {
      await d.promptTouchID(tm('main.phrase.touchId'));
      return true;
    }
    return (await d.confirm()) === true;
  } catch { return false; }
}

/**
 * `PIU_PROFILE=<nome>`: outro perfil (pasta de dados `Piu-<nome>` e nome do app, logo outro item do cofre do
 * sistema). Para testes do app instalado sem tocar nos dados nem no Keychain de quem usa (com
 * `--use-mock-keychain` no macOS). Não abre nada: não dá acesso aos dados do perfil normal. Só [a-z0-9-], até 24.
 */
export function profileFromEnv(env: Record<string, string | undefined>): string | null {
  const p = env.PIU_PROFILE ?? '';
  return /^[a-z0-9-]{1,24}$/.test(p) ? p : null;
}

/**
 * Microfone (achado B-02 revisto para a chamada de voz): só áudio, só a janela do Piu e só com uma chamada
 * aberta (caixa "pre", chamando, tocando ou em curso). Câmera e captura de tela continuam negadas.
 * `check`: consulta do Chromium (nomes dos aparelhos), que pode vir sem tipo (`unknown`).
 */
export function mediaAllowed(p: { types: readonly string[]; url: string; origin: string; inCall: boolean; check?: boolean }): boolean {
  if (!p.inCall || !p.types.length) return false;
  if (p.types.some(t => t !== 'audio' && !(p.check && t === 'unknown'))) return false;
  return isRendererUrl(p.url.endsWith('/') ? p.url : `${p.url}/`, p.origin);
}
