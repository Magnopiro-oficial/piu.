import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { REF_RULES, REFERRAL_MONTHLY_CAP } from '../../data/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Seus convidados: 25 LUNES por pessoa ativa, só indicação direta (sem níveis).
 * Cada convidado é registrado quando alguém instala a partir deste celular, o que ainda não existe
 * nesta versão (o app não é enviado de celular para celular). Sem registro, a lista fica vazia.
 */
export default function Referrals() {
  const { c } = useTheme();
  return (
    <Screen>
      <BackHeader title="Seus convidados" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 14 }}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }}>0,00</T>
              <T size={14} w={600} color={c.ink2}>LUNES recebidos</T>
            </View>
            <T size={13.5} color={c.ink2}>{`0 de ${REFERRAL_MONTHLY_CAP} no limite do mês`}</T>
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
        <SectionLabel>0 CONVITES</SectionLabel>
        <View style={{ marginHorizontal: 20, padding: 18, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 12 }}>
          <T size={15} w={600}>Nenhum convidado ainda</T>
          <T size={13} lh={1.45} color={c.ink2}>Quem instalar o Piu a partir do seu celular aparece aqui, com o andamento dos 7 dias. O pagamento depende da liquidação na Lunes Mainnet, ainda não conectada.</T>
          <Button label="Convidar agora" height={44} fontSize={14} onPress={() => router.push('/invite')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
