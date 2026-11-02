import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useStore } from '../../state/store';
import { RealCommunity } from '../../ui/RealCommunity';
import { COMMUNITY } from '../../data/seed';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Comunidade: grupos e canais agrupados. */
export default function Community() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const real = useStore().chats.find(x => x.id === id && x.group);
  if (real) return <RealCommunity chat={real} />;
  const k = COMMUNITY;
  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 24, paddingBottom: 20, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={24} w={650} color={c.invink}>{k.initials}</T></View>
          <View style={{ gap: 6 }}>
            <T size={28} w={700} ls={-0.04} accessibilityRole="header">{k.name}</T>
            <T size={14} color={c.ink2}>{k.sub}</T>
          </View>
        </View>
        {k.sections.map(sec => (
          <View key={sec.title} style={{ paddingHorizontal: 20, paddingBottom: 18, gap: 6 }}>
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingHorizontal: 4, paddingBottom: 4 }}>{sec.title}</T>
            <View style={{ borderRadius: 18, backgroundColor: c.bg2, overflow: 'hidden' }}>
              {sec.items.map(([icon, name, meta], i) => (
                <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <Icon name={icon as IconName} size={20} w={300} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T size={15} w={550}>{name}</T>
                    <T size={12.5} color={c.ink2}>{meta}</T>
                  </View>
                  <Icon name="chevron_right" size={20} color={c.ink3} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
