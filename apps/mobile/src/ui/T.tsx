import { Text, type TextProps, type TextStyle } from 'react-native';
import { fontFamily } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';

export interface TProps extends TextProps {
  /** Tamanho em px. */
  size?: number;
  /** Peso do design (300–800, aceita 550/650). */
  w?: number;
  mono?: boolean;
  color?: string;
  /** letter-spacing em em, como no design. */
  ls?: number;
  /** line-height como múltiplo do tamanho. */
  lh?: number;
  align?: TextStyle['textAlign'];
  tabular?: boolean;
}

/** Texto do Piu: Geist/Geist Mono, cor `ink` por padrão. */
export function T({ size = 15, w = 400, mono, color, ls, lh, align, tabular, style, ...rest }: TProps) {
  const { c } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fontFamily(w, mono), fontSize: size, color: color ?? c.ink,
          letterSpacing: ls !== undefined ? ls * size : -0.005 * size,
          lineHeight: lh ? lh * size : undefined, textAlign: align,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    />
  );
}
