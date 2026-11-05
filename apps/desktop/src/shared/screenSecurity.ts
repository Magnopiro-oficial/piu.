/**
 * "Segurança da tela" (como no Signal): impede capturas e gravações da janela do Piu enquanto uma
 * CONVERSA estiver aberta. Nas outras telas (lista sem conversa, Ajustes, Carteira) a captura é
 * liberada. macOS e Windows: `BrowserWindow.setContentProtection(...)`. Linux: sem suporte no sistema.
 * Lógica pura (o que aplicar por sistema, ajuste e tela), testada em test/screenSecurity.test.ts.
 */
export const LINUX_NOTE = 'O Linux não permite bloquear capturas de tela';
export const SCREEN_SECURITY_DESC = 'Impede capturas de tela das conversas (macOS e Windows).';

export interface ScreenSecurityDecision {
  /** O sistema consegue bloquear capturas desta janela? */
  supported: boolean;
  /** Valor a passar para `setContentProtection` agora (sempre `false` onde não há suporte). */
  protect: boolean;
  /** Texto para a interface quando não há suporte. */
  note: string | null;
}

export const screenSecuritySupported = (platform: string) => platform === 'darwin' || platform === 'win32';

/**
 * @param enabled ajuste "Segurança da tela" (padrão ligado)
 * @param conversationOpen há uma conversa aberta na janela agora
 */
export function screenSecurityFor(platform: string, enabled: boolean, conversationOpen: boolean): ScreenSecurityDecision {
  const supported = screenSecuritySupported(platform);
  return { supported, protect: supported && enabled && conversationOpen, note: supported ? null : LINUX_NOTE };
}
