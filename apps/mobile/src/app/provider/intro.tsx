import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { PROV_CLASSES } from '../../data/network';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Piu Provider: as 3 classes de nó e como se ganha (só por entrega comprovada). */
export default function ProvIntro() {
  const { c } = useTheme();
  return (
    <Screen>
      <BackHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 24, gap: 12 }}>
          <T size={12} w={500} mono ls={0.04} color={c.ink2}>PIU PROVIDER</T>
          <T size={34} w={700} ls={-0.045} lh={1.02} accessibilityRole="header">Transforme seu roteador em infraestrutura.</T>
          <T size={15} lh={1.45} color={c.ink2}>Seu equipamento entrega mensagens cifradas da vizinhança, sem conseguir ler nenhuma, e você recebe LUNES por cada entrega comprovada.</T>
        </View>
        <View style={{ marginTop: 22, marginHorizontal: 20, flexDirection: 'row', gap: 8 }}>
          {['Conecte o equipamento', 'Passe no teste real', 'Ganhe por entregas'].map((t, i) => (
            <View key={t} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.bg2, gap: 10 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={12} w={600} color={c.invink}>{i + 1}</T></View>
              <T size={13} w={600} lh={1.25}>{t}</T>
            </View>
          ))}
        </View>
        <SectionLabel>QUE EQUIPAMENTO VOCÊ TEM</SectionLabel>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {PROV_CLASSES.map(k => (
            <View key={k.name} style={{ padding: 16, borderRadius: 20, borderWidth: 1, borderColor: c.line2, flexDirection: 'row', gap: 14 }}>
              <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={k.icon} size={23} w={300} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <T size={16} w={650}>{k.name}</T>
                <T size={13.5} lh={1.35}>{k.what}</T>
                <T size={12.5} lh={1.35} color={c.ink2}>{k.desc}</T>
                <T size={11.5} mono color={c.ink2} style={{ marginTop: 2 }}>{k.ex}</T>
              </View>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
          <Icon name="verified" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Você ganha por entregas úteis validadas, não por tempo ligado nem por capacidade anunciada. Nenhum hardware oficial é exigido.</T>
        </View>
        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Adicionar equipamento" onPress={() => router.push('/provider/add')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
