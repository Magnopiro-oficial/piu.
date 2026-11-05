import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { useT } from '../i18n';
import { confirmDevice } from '../lib/deviceAuth';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon } from './Icon';
import { T } from './T';

/**
 * Bloqueio do app ("Abrir o Piu com biometria", em Privacidade): cobre tudo ao abrir e ao voltar do
 * segundo plano até a pessoa se autenticar. Com o bloqueio ligado, o app também fica desfocado na
 * troca de apps (iPhone). Na web não existe bloqueio do aparelho, e a opção fica indisponível.
 */
export function AppLock() {
  const { c } = useTheme();
  const t = useT();
  const { priv } = useSettings();
  const enabled = priv.lock && Platform.OS !== 'web';
  const [locked, setLocked] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const r = await confirmDevice(t('lock.unlockPrompt'));
    busy.current = false;
    // Sem bloqueio no aparelho não há como autenticar: a opção não protege e o app abre.
    if (r === 'ok' || r === 'unavailable') { setLocked(false); setFailed(false); } else setFailed(true);
  }, [t]);

  useEffect(() => {
    if (!enabled) { setLocked(false); return; }
    const sub = AppState.addEventListener('change', s => { if (s === 'background') setLocked(true); });
    if (Platform.OS === 'ios') ScreenCapture.enableAppSwitcherProtectionAsync(0.8).catch(() => {});
    return () => {
      sub.remove();
      if (Platform.OS === 'ios') ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, [enabled]);

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
