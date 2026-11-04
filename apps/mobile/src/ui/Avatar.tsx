import { Image, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

/**
 * Círculo = pessoa; quadrado de raio 17 (proporcional) = grupo/canal/comunidade.
 * `photo`: foto do perfil público que o contato mandou (no lugar das iniciais).
 */
export function Avatar({ initials, size = 54, square, inverted, photo }: { initials: string; size?: number; square?: boolean; inverted?: boolean; photo?: string }) {
  const { c } = useTheme();
  const radius = square ? Math.round(size * 17 / 54) : size / 2;
  if (photo) {
    return <Image accessible={false} source={{ uri: photo }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: c.bg3, flexShrink: 0 }} />;
  }
  return (
    <View accessible={false} style={{
      width: size, height: size, borderRadius: radius,
      backgroundColor: inverted ? c.ink : c.bg3, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <T size={Math.round(size * 17 / 54)} w={600} ls={-0.02} color={inverted ? c.invink : c.ink}>{initials}</T>
    </View>
  );
}
