import { ScrollView, View } from 'react-native';
import { REFERRALS, REF_RULES } from '../../data/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Seus convidados: 25 LUNES por pessoa ativa, só indicação direta (sem níveis). */
export default function Referrals() {
  const { c } = useTheme();
  return (
    <Screen>
      <BackHeader title="Seus convidados" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }}>75,00</T>
              <T size={14} w={600} color={c.ink2}>LUNES recebidos</T>
            </View>
            <T size={13.5} color={c.ink2}>+ 50,00 em validação · 3 de 20 no limite do mês</T>
          </View>
          <View style={{ padding: 16, borderRadius: 20, backgroundColor: c.bg2, gap: 12 }}>
            <T size={14} w={600}>Quando a recompensa é paga</T>
            {REF_RULES.map(([icon, t, d]) => (
              <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon name={icon} size={18} />
                <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}><T size={13} w={600}>{t}</T> {d}</T>
              </View>
            ))}
          </View>
        </View>
        <SectionLabel>{`${REFERRALS.length} CONVITES`}</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {REFERRALS.map(([ini, name, w, s, v, op]) => (
            <View key={name} accessibilityLabel={`${name}: ${s}, ${v}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line, opacity: op }}>
              <View style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: c.ink, backgroundColor: w === 100 ? c.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <T size={13.5} w={600} color={w === 100 ? c.invink : c.ink}>{ini}</T>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T size={14.5} w={600} numberOfLines={1} style={{ flex: 1 }}>{name}</T>
                  <T size={13.5} w={600} tabular>{v}</T>
                </View>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}><View style={{ height: '100%', width: `${w}%`, backgroundColor: c.ink }} /></View>
                <T size={12} color={c.ink2}>{s}</T>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
