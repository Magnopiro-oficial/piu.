/**
 * "Segurança da tela" (Ajustes → Privacidade), como no Signal. Lógica pura (sem React Native nem
 * Expo; testada em __tests__/screenSecurity.test.ts); quem chama o `expo-screen-capture` é o hook
 * `useChatScreenSecurity` em `ui/ScreenSecurity.tsx`, usado só na tela da conversa.
 *
 * - Android: FLAG_SECURE (`preventScreenCaptureAsync`) enquanto a conversa está em foco: sem print,
 *   sem gravação; a prévia nos apps recentes fica em branco enquanto a conversa estiver aberta.
 * - iPhone e web: o ajuste não existe (o iPhone não permite bloquear print; a web não tem a API).
 */

/** Chave usada em `preventScreenCaptureAsync`/`allowScreenCaptureAsync`, separada da das telas (ex.: 'backup'). */
export const SCREEN_SECURITY_KEY = 'screenSecurity';

/** O ajuste existe neste sistema (`Platform.OS`)? Só no Android: o interruptor aparece só lá. */
export function hasScreenSecurity(os: string): boolean {
  return os === 'android';
}

/** Aplicar FLAG_SECURE na conversa em foco, com o ajuste atual? */
export function shouldPreventCapture(os: string, enabled: boolean): boolean {
  return hasScreenSecurity(os) && enabled;
}
