import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { Enter, type EnterKind } from './Enter';

/**
 * Fundo do tema + áreas seguras do aparelho + entrada da tela (design: `push` nas telas internas,
 * `tab` no conteúdo das abas). O fundo fica parado; só o conteúdo anima.
 */
export function Screen({ children, style, edges = ['top', 'bottom'], enter = 'push' }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom')[]; enter?: EnterKind;
}) {
  const { c } = useTheme();
  const i = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Enter kind={enter} style={[{ paddingTop: edges.includes('top') ? i.top : 0, paddingBottom: edges.includes('bottom') ? i.bottom : 0 }, style]}>
        {children}
      </Enter>
    </View>
  );
}
