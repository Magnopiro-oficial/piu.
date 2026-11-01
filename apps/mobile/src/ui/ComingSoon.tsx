import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/** Telas desenhadas que entram nas próximas etapas do app. */
export function ComingSoon({ title, icon, desc }: { title: string; icon: IconName; desc: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 6 }}>
      <View style={{ height: 44 }} />
      <T size={36} w={700} ls={-0.045}>{title}</T>
      <View style={{ marginTop: 24, padding: 20, borderRadius: 22, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 10 }}>
        <Icon name={icon} size={26} w={300} />
        <T size={16} w={600}>Chega numa próxima versão</T>
        <T size={14} lh={1.45} color={c.ink2}>{desc}</T>
      </View>
    </View>
  );
}
