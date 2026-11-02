import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { palettes, type Colors, type Scheme } from './tokens';

interface Theme { scheme: Scheme; c: Colors; reduceMotion: boolean }
const Ctx = createContext<Theme>({ scheme: 'light', c: palettes.light, reduceMotion: false });

/** Segue o tema do aparelho (o tema escuro é obrigatório) e a opção “reduzir movimento”. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);
  const value = useMemo(() => ({ scheme, c: palettes[scheme], reduceMotion }), [scheme, reduceMotion]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
