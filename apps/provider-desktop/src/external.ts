/**
 * Links que a janela pode abrir no navegador padrão (`shell.openExternal`). Só https e só os hosts
 * desta lista: com script hostil na página, `window.open` não leva a pessoa a uma página falsa "do
 * Piu" (auditoria 2026-11-06, provider.md B-02). O painel hoje só abre o explorer da Lunes
 * (`LUNES_EXPLORER` em piu-node/src/lunes/lunesRpc.ts).
 */
export const EXTERNAL_HOSTS: ReadonlySet<string> = new Set(['blockexplorer.lunes.io']);

/** A URL normalizada, se puder abrir fora; senão `null`. */
export function externalUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '' || !EXTERNAL_HOSTS.has(u.hostname)) return null;
  return u.toString();
}
