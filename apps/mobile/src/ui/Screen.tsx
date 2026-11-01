import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

/** Fundo do tema + áreas seguras do aparelho. */
export function Screen({ children, style, edges = ['top', 'bottom'] }: { children: ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom')[] }) {
  const { c } = useTheme();
  const i = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: c.bg, paddingTop: edges.includes('top') ? i.top : 0, paddingBottom: edges.includes('bottom') ? i.bottom : 0 }, style]}>
      {children}
    </View>
  );
}
