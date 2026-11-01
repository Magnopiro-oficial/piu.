import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

/** Círculo = pessoa; quadrado de raio 17 (proporcional) = grupo/canal/comunidade. */
export function Avatar({ initials, size = 54, square, inverted }: { initials: string; size?: number; square?: boolean; inverted?: boolean }) {
  const { c } = useTheme();
  return (
    <View accessible={false} style={{
      width: size, height: size, borderRadius: square ? Math.round(size * 17 / 54) : size / 2,
      backgroundColor: inverted ? c.ink : c.bg3, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <T size={Math.round(size * 17 / 54)} w={600} ls={-0.02} color={inverted ? c.invink : c.ink}>{initials}</T>
    </View>
  );
}
