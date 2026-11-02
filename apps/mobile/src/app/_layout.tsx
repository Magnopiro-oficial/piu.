import '../lib/cryptoPolyfill';
import { useFonts } from 'expo-font';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadPersisted } from '../lib/persist';
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

function OnboardingGuard() {
  const segments = useSegments();
  const { onboarded } = useStore();
  const first = segments[0] as string | undefined;
  useEffect(() => {
    if (!onboarded && first && !PRE_ONBOARDING.has(first)) router.replace('/welcome');
  }, [onboarded, first]);
  return null;
}

function Navigator() {
  const { c, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }} />
      <OnboardingGuard />
      <Toast />
      <AppLock />
    </>
  );
}
