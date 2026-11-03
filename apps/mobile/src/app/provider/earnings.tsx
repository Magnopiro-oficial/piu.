import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { CREDIT_PARAMS } from '../../messaging/credits';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Ganhos do provider no celular. Os créditos dos equipamentos ficam no piu-node de cada um, e a
 * liquidação ainda não está conectada à Lunes Mainnet: aqui não há número para mostrar. Os créditos
 * deste celular como nó ficam em Carteira → Créditos de rede.
 */
export default function ProvEarnings() {
  const { c } = useTheme();
  const how: [IconName, string, string][] = [
    ['verified_user', 'Recibo do seu nó', 'assinado a cada envelope de terceiro repassado'],
    ['verified', 'Prova de entrega', 'o destino confirma sem revelar quem é'],
    ['account_balance_wallet', 'Lote semanal', `mínimo de ${CREDIT_PARAMS.minLotLunes} LUNES · ${CREDIT_PARAMS.creditsPerLunes} créditos = 1 LUNES (provisório)`],
  ];

  return (
    <Screen>
      <BackHeader title="Ganhos do provider" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }}>0,00</T>
            <T size={14} w={600} color={c.ink2}>LUNES recebidos</T>
          </View>
          <T size={13.5} color={c.ink2}>Nenhum lote liquidado · liquidação ainda não conectada à Mainnet</T>
        </View>

        <View style={{ marginTop: 16, marginHorizontal: 20, padding: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
          <Icon name="dns" size={22} w={300} />
          <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Créditos pendentes, validados e rejeitados de cada equipamento aparecem no painel dele. Este celular não guarda esses números.</T>
        </View>

        <SectionLabel>COMO O CRÉDITO É FORMADO</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {how.map(([icon, t, d], i) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <Icon name={icon} size={21} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={550}>{t}</T>
                <T size={11.5} mono color={c.ink2}>{d}</T>
              </View>
            </View>
          ))}
        </View>

        <SectionLabel>LOTES DE LIQUIDAÇÃO</SectionLabel>
        <T size={13} lh={1.45} color={c.ink2} style={{ marginHorizontal: 24 }}>Nenhum lote ainda.</T>

        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Ver créditos deste celular" variant="outline" height={50} left={<Icon name="toll" size={20} />} onPress={() => router.push('/(tabs)/wallet')} />
        </View>
        <View style={{ marginTop: 16, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="policy" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Cada crédito combina recibo do seu nó, confirmação do destino e auditoria por amostragem. Duplicatas, rotas circulares e tráfego artificial são rejeitados.</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
