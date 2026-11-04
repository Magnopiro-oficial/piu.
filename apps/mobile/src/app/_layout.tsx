import '../lib/cryptoPolyfill';
import { useFonts } from 'expo-font';
import { router, Stack, useGlobalSearchParams, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NotificationBridge } from '../lib/notifications';
import { cardFromText } from '../lib/inviteLink';
import { forgetPersisted, loadPersisted, persistNow, readPersisted } from '../lib/persist';
import { KeysProvider, preloadKeys } from '../state/keys';
import { MessagingProvider } from '../state/messaging';
import { NetworkProvider } from '../state/network';
import { StoreProvider, useStore } from '../state/store';
import { ResetProvider } from '../state/reset';
import { SettingsProvider } from '../state/settings';
import { TransportProvider } from '../state/transport';
import { WalletProvider } from '../state/wallet';
import { FONT_FILES } from '../theme/fonts';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { AppLock } from '../ui/AppLock';
import { SystemPrompts } from '../ui/SystemPrompts';
import { Toast } from '../ui/Toast';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts(FONT_FILES);
  // Dados salvos no aparelho: lidos antes de esconder o splash, para abrir direto onde a pessoa parou.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { Promise.all([loadPersisted(), preloadKeys()]).finally(() => setHydrated(true)); }, []);
  const ready = (loaded || !!error) && hydrated;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ResetProvider>
          <KeysProvider>
            <StoreProvider>
              <NetworkProvider>
                <WalletProvider>
                  <SettingsProvider>
                    <TransportProvider>
                      <MessagingProvider>
                        <Navigator />
                      </MessagingProvider>
                    </TransportProvider>
                  </SettingsProvider>
                </WalletProvider>
              </NetworkProvider>
            </StoreProvider>
          </KeysProvider>
        </ResetProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Telas acessíveis antes do onboarding. Todo o resto exige identidade criada (inclusive por link piu://). */
const PRE_ONBOARDING = new Set(['welcome', 'identity', 'keys', 'restore', 'migrate']);

/** Convite (`piu://invite/accept?c=…`) aberto antes de criar a identidade: volta para ele depois. */
const PENDING_INVITE = 'invite.pending';

function OnboardingGuard() {
  const segments = useSegments();
  const { c: inviteParam } = useGlobalSearchParams<{ c?: string }>();
  const { onboarded } = useStore();
  const first = segments[0] as string | undefined;
  useEffect(() => {
    if (onboarded || !first || PRE_ONBOARDING.has(first)) return;
    if (first === 'invite' && typeof inviteParam === 'string' && cardFromText(inviteParam)) void persistNow(PENDING_INVITE, inviteParam).catch(() => {});
    router.replace('/welcome');
  }, [onboarded, first]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!onboarded) return;
    const c = readPersisted<string>(PENDING_INVITE);
    if (!c) return;
    void forgetPersisted(PENDING_INVITE);
    // Depois da navegação do fim do onboarding (keys.tsx troca para as abas).
    const t = setTimeout(() => router.push({ pathname: '/invite/accept', params: { c } }), 400);
    return () => clearTimeout(t);
  }, [onboarded]);
  return null;
}

function Navigator() {
  const { c, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade', animationDuration: 260 }} />
      <OnboardingGuard />
      <Toast />
      <NotificationBridge />
      <SystemPrompts />
      <AppLock />
    </>
  );
}
