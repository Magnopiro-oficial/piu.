/**
 * Regras de segurança do processo principal como funções puras (sem Electron), testadas em
 * test/security.test.ts. O main.ts só liga estas decisões às APIs do Electron.
 */
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
