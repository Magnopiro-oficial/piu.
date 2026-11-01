import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadPersisted } from '../lib/persist';
import { NetworkProvider } from '../state/network';
import { StoreProvider } from '../state/store';
import { ResetProvider } from '../state/reset';
import { SettingsProvider } from '../state/settings';
import { WalletProvider } from '../state/wallet';
import { FONT_FILES } from '../theme/fonts';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { Toast } from '../ui/Toast';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts(FONT_FILES);
  // Dados salvos no aparelho: lidos antes de esconder o splash, para abrir direto onde a pessoa parou.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { loadPersisted().finally(() => setHydrated(true)); }, []);
  const ready = (loaded || !!error) && hydrated;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ResetProvider>
          <StoreProvider>
            <NetworkProvider>
              <WalletProvider>
                <SettingsProvider>
                  <Navigator />
                </SettingsProvider>
              </WalletProvider>
            </NetworkProvider>
          </StoreProvider>
        </ResetProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const { c, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }} />
      <Toast />
    </>
  );
}
