import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { ICONS, type IconName } from './icons.generated';

export type { IconName };

/** Material Symbols Rounded. `w` 300 (traço leve, padrão do design) ou 400; `fill` para estado ativo. */
/** Fora da árvore de acessibilidade no celular; no navegador o atributo `accessible` vira aviso do React no DOM. */
const NOT_A11Y = Platform.OS === 'web' ? { 'aria-hidden': true } : { accessible: false };

export function Icon({ name, size = 20, w = 400, fill = false, color, style }: {
  name: IconName; size?: number; w?: 300 | 400; fill?: boolean; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const paths = ICONS[name];
  const d = paths[(w === 300 ? 0 : 2) + (fill ? 1 : 0)];
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" style={style} {...NOT_A11Y} pointerEvents="none">
      <Path d={d} fill={color ?? c.ink} />
    </Svg>
  );
}
