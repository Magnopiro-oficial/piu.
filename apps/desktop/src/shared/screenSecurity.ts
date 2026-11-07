/**
 * "Segurança da tela" (como no Signal): impede capturas e gravações da janela do Piu enquanto uma
 * CONVERSA estiver aberta (ajuste em Ajustes → Privacidade, padrão ligado). Telas com SEGREDO — a frase
 * em Backup, o QR/palavras do vínculo e a Carteira (M-02) — ficam protegidas sempre, mesmo com o ajuste
 * desligado. Nas outras (lista sem conversa, demais Ajustes) a captura é liberada.
 * macOS e Windows: `BrowserWindow.setContentProtection(...)`. Linux: sem suporte no sistema.
 * Lógica pura (o que aplicar por sistema, ajuste e tela), testada em test/screenSecurity.test.ts.
 * Textos no dicionário (namespace `settings`): a decisão traduz no idioma atual a cada chamada.
 */
import { t, tIn } from './i18n';

/** Texto de referência (pt-BR) do aviso do Linux; a interface recebe `note`, já no idioma atual. */
export const LINUX_NOTE = tIn('pt-BR', 'settings.security.linuxNote');
/** Descrição do ajuste "Segurança da tela" no idioma atual. */
export const screenSecurityDesc = () => t('settings.security.desc');

/** Telas com segredo que o renderer pode marcar como visíveis (`setSecretVisible`). */
export const SECRET_SCREENS = ['phrase', 'link', 'wallet'] as const;
export type SecretScreen = (typeof SECRET_SCREENS)[number];
export const isSecretScreen = (x: unknown): x is SecretScreen => typeof x === 'string' && (SECRET_SCREENS as readonly string[]).includes(x);

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
 * @param enabled ajuste "Segurança da tela" (padrão ligado; só vale para conversas)
 * @param sensitive `conversation`: há uma conversa aberta; `secret`: frase, QR do vínculo ou carteira na tela
 */
export function screenSecurityFor(platform: string, enabled: boolean, sensitive: { conversation: boolean; secret: boolean }): ScreenSecurityDecision {
  const supported = screenSecuritySupported(platform);
  return { supported, protect: supported && (sensitive.secret || (enabled && sensitive.conversation)), note: supported ? null : t('settings.security.linuxNote') };
}
