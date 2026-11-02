import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useLayout } from '../lib/responsive';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

/** `inverse`/`ghostInverse`: para telas de fundo tinta (inversão). */
type Variant = 'primary' | 'ghost' | 'soft' | 'outline' | 'inverse' | 'ghostInverse';

/** Botões do design: primário 54px (raio 27), secundários 44–48px. */
export function Button({ label, onPress, variant = 'primary', height = 54, fontSize, disabled, style, left, accessibilityLabel }: {
  label: string; onPress?: () => void; variant?: Variant; height?: number; fontSize?: number; disabled?: boolean;
  style?: StyleProp<ViewStyle>; left?: ReactNode; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  // Telas estreitas: menos respiro lateral e fonte 1 px menor para o rótulo caber.
  const { compact } = useLayout();
  const bg = variant === 'primary' ? c.ink : variant === 'inverse' ? c.invink : variant === 'soft' ? c.bg2 : 'transparent';
  const fg = variant === 'primary' || variant === 'ghostInverse' ? c.invink : c.ink;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        { height, borderRadius: height / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: compact ? 14 : 20 },
        variant === 'outline' && { borderWidth: 1, borderColor: c.line2 },
        { opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] },
        style,
      ]}>
      {left}
      <T size={(fontSize ?? (height >= 54 ? 16 : 15)) - (compact ? 1 : 0)} w={variant === 'ghost' || variant === 'ghostInverse' ? 500 : 600} color={fg} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}
