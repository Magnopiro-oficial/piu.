import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export type AuthResult = 'ok' | 'denied' | 'unavailable';

/** O aparelho tem algum bloqueio (biometria, PIN, senha ou padrão)? Na web, não há. */
export async function deviceAuthAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try { return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE; } catch { return false; }
}

/**
 * Pede a biometria ou o bloqueio do aparelho (PIN/senha como alternativa).
 * `unavailable`: o aparelho não tem bloqueio nenhum (ou é a web) — quem chama decide o que fazer.
 */
export async function confirmDevice(promptMessage: string): Promise<AuthResult> {
  if (!(await deviceAuthAvailable())) return 'unavailable';
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancelar', disableDeviceFallback: false });
    return r.success ? 'ok' : 'denied';
  } catch {
    return 'denied';
  }
}
