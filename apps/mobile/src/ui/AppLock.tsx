import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { useT } from '../i18n';
import { APP_LOCK_KEY, lockCapture, setAppLocked, unlockOutcome } from '../lib/appLockGate';
import { confirmDevice } from '../lib/deviceAuth';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { T } from './T';

/**
 * Bloqueio do app ("Abrir o Piu com biometria", em Privacidade): cobre tudo ao abrir e ao voltar do
 * segundo plano até a pessoa se autenticar. Com o bloqueio ligado, a prévia na troca de apps fica
 * desfocada (iPhone) ou em branco (Android, FLAG_SECURE no app inteiro). Na web não existe bloqueio
 * do aparelho, e a opção fica indisponível. É uma barreira de interface, não de cifragem: os dados
 * continuam decifrados na memória (regras em lib/appLockGate.ts).
 */
export function AppLock() {
  const { c } = useTheme();
  const t = useT();
  const { priv } = useSettings();
  const { showToast } = useStore();
  const enabled = priv.lock && Platform.OS !== 'web';
  const [locked, setLocked] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  // O aviso de "sem bloqueio no aparelho" sai uma vez por abertura do app, não a cada volta.
  const warned = useRef(false);

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const r = await confirmDevice(t('lock.unlockPrompt'));
    busy.current = false;
    // Sem bloqueio no aparelho não há como autenticar: o app abre, mas avisa que a opção está sem efeito.
    const o = unlockOutcome(r);
    if (o.open) { setLocked(false); setFailed(false); } else setFailed(true);
    if (o.warnNoLock && !warned.current) {
      warned.current = true;
      showToast({ icon: 'lock', title: t('privacy.noDeviceLock'), body: t('privacy.noDeviceLock.body') });
    }
  }, [t, showToast]);

  useEffect(() => {
    if (!enabled) { setLocked(false); return; }
    const sub = AppState.addEventListener('change', s => { if (s === 'background') setLocked(true); });
    const cap = lockCapture(Platform.OS, enabled);
    if (cap.iosSwitcher) ScreenCapture.enableAppSwitcherProtectionAsync(0.8).catch(() => {});
    // Android: a miniatura dos recentes é tirada antes de a cobertura aparecer; só a flag a deixa em branco.
    if (cap.androidSecure) ScreenCapture.preventScreenCaptureAsync(APP_LOCK_KEY).catch(() => {});
    return () => {
      sub.remove();
      if (cap.iosSwitcher) ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
      if (cap.androidSecure) ScreenCapture.allowScreenCaptureAsync(APP_LOCK_KEY).catch(() => {});
    };
  }, [enabled]);

  // O store não marca como lida a conversa aberta enquanto o app está coberto (lib/appLockGate.ts).
  useEffect(() => { setAppLocked(locked && enabled); }, [locked, enabled]);

  useEffect(() => { if (locked && enabled) void unlock(); }, [locked, enabled, unlock]);

  if (!locked || !enabled) return null;
  return (
    <View accessibilityViewIsModal style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16, zIndex: 100 }}>
      <Icon name="lock" size={40} w={300} />
      <T size={22} w={700} ls={-0.03} align="center" accessibilityRole="header">{t('lock.title')}</T>
      <T size={14} lh={1.45} color={c.ink2} align="center">{failed ? t('lock.failed') : t('lock.hint')}</T>
      <Button label={t('lock.unlock')} onPress={unlock} style={{ alignSelf: 'stretch', marginTop: 8 }} />
    </View>
  );
}
