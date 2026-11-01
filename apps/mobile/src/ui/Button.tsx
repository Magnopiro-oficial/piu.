import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './T';

type Variant = 'primary' | 'ghost' | 'soft' | 'outline';

/** Botões do design: primário 54px (raio 27), secundários 44–48px. */
export function Button({ label, onPress, variant = 'primary', height = 54, fontSize, disabled, style, left, accessibilityLabel }: {
  label: string; onPress?: () => void; variant?: Variant; height?: number; fontSize?: number; disabled?: boolean;
  style?: StyleProp<ViewStyle>; left?: ReactNode; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const bg = variant === 'primary' ? c.ink : variant === 'soft' ? c.bg2 : 'transparent';
  const fg = variant === 'primary' ? c.invink : c.ink;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        { height, borderRadius: height / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
        variant === 'outline' && { borderWidth: 1, borderColor: c.line2 },
        { opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] },
        style,
      ]}>
      {left}
      <T size={fontSize ?? (height >= 54 ? 16 : 15)} w={variant === 'ghost' ? 500 : 600} color={fg} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}
