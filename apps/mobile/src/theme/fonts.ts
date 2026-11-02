import {
  Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_800ExtraBold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium, GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono';

export const FONT_FILES = {
  Geist_300Light, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_800ExtraBold,
  GeistMono_400Regular, GeistMono_500Medium, GeistMono_600SemiBold,
};

const SANS: Record<number, keyof typeof FONT_FILES> = {
  300: 'Geist_300Light', 400: 'Geist_400Regular', 500: 'Geist_500Medium', 600: 'Geist_600SemiBold', 700: 'Geist_700Bold', 800: 'Geist_800ExtraBold',
};
const MONO: Record<number, keyof typeof FONT_FILES> = { 400: 'GeistMono_400Regular', 500: 'GeistMono_500Medium', 600: 'GeistMono_600SemiBold' };

/**
 * O design usa a Geist variável (pesos como 550 e 650). No app usamos os arquivos estáticos:
 * o peso é arredondado para a centena mais próxima (meio para cima).
 */
export function fontFamily(weight: number, mono = false): string {
  const w = Math.round(weight / 100 + 1e-9) * 100;
  if (mono) return MONO[Math.min(600, Math.max(400, w))];
  return SANS[Math.min(800, Math.max(300, w))];
}
