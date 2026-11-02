import { useId, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/** Placeholder listrado do design (fotos de perfil): listras a 135° de `period/2` px. */
export function Stripes({ period = 16, a, b, style, children, label = 'foto de perfil (placeholder)' }: {
  period?: number; a?: string; b?: string; style?: StyleProp<ViewStyle>; children?: ReactNode; label?: string;
}) {
  const { c } = useTheme();
  const id = 'st' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View accessibilityLabel={label} style={[{ overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <Pattern id={id} width={period} height={period} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <Rect width={period} height={period} fill={a ?? c.bg2} />
            <Line x1={period * 0.75} y1={0} x2={period * 0.75} y2={period} stroke={b ?? c.bg3} strokeWidth={period / 2} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}
