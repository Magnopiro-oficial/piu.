import { ScrollView, View } from 'react-native';
import { PROV_PAID, PROV_PENDING, PROV_RATES, PROV_REJECTED } from '../../data/network';
import { fmtL, useNetwork } from '../../state/network';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

const fmtPt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ganhos do provider: estados (pagos, validados, pendentes, rejeitados), créditos por tipo e lotes de liquidação. */
export default function ProvEarnings() {
  const { c } = useTheme();
  const { devices } = useNetwork();
  const { showToast } = useStore();
  const month = devices.reduce((a, d) => a + d.month, 0);
  const total = PROV_PAID + month + PROV_REJECTED;
  const states: [string, number, number][] = [['Pagos', PROV_PAID, 1], ['Validados', month - PROV_PENDING, 0.6], ['Pendentes', PROV_PENDING, 0.32], ['Rejeitados', PROV_REJECTED, 0.14]];
  const lots: [IconName, string, string, string][] = [
    ['hourglass_top', 'Lote #0047 · outubro', 'em formação · aguardando Mainnet', fmtL(month)],
    ['check_circle', 'Lote #0046 · setembro', 'liquidado · tx 7c1e…a90f', '512,08'],
    ['check_circle', 'Lote #0045 · agosto', 'liquidado · tx 21bd…04c3', '448,44'],
    ['check_circle', 'Lote #0044 · julho', 'liquidado · tx e09a…7b11', '324,08'],
  ];

  return (
    <Screen>
      <BackHeader title="Ganhos do provider" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ paddingTop: 4, paddingHorizontal: 20, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={44} w={650} ls={-0.05} tabular style={{ lineHeight: 46 }}>{fmtPt(PROV_PAID)}</T>
            <T size={14} w={600} color={c.ink2}>LUNES recebidos</T>
          </View>
          <T size={13.5} color={c.ink2}>desde julho · 3 lotes liquidados</T>
        </View>

        <View style={{ marginTop: 16, marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
          <View accessibilityLabel="Proporção de créditos por estado" style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
            {states.map(([l, n, op]) => <View key={l} style={{ width: `${(Math.max(0, n) / total) * 100}%`, backgroundColor: c.ink, opacity: op }} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 16 }}>
            {states.map(([l, n, op]) => (
              <View key={l} style={{ width: '46%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.ink, opacity: op }} />
                <T size={12.5} color={c.ink2} style={{ flex: 1 }}>{l}</T>
                <T size={13} w={600} tabular>{fmtPt(n)}</T>
              </View>
            ))}
          </View>
        </View>

        <SectionLabel>CRÉDITOS POR ENTREGA · OUTUBRO</SectionLabel>
        <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
          {PROV_RATES.map(([icon, t, rule, n, v], i) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <Icon name={icon} size={21} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={550}>{t}</T>
                <T size={11.5} mono color={c.ink2}>{rule} · {n}</T>
              </View>
              <T size={14} w={650} tabular>{v} L</T>
            </View>
          ))}
        </View>
        <T size={11.5} mono color={c.ink2} style={{ marginTop: 8, marginHorizontal: 24 }}>100 créditos = 1 LUNES · valores ilustrativos</T>

        <SectionLabel>LOTES DE LIQUIDAÇÃO</SectionLabel>
        <View style={{ marginHorizontal: 20 }}>
          {lots.map(([icon, t, s, v]) => (
            <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} w={300} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14.5} w={550}>{t}</T>
                <T size={12.5} color={c.ink2}>{s}</T>
              </View>
              <T size={14} w={600} tabular>{v}</T>
            </View>
          ))}
        </View>

        <View style={{ paddingTop: 20, paddingHorizontal: 20 }}>
          <Button label="Transferir para carteira pessoal" variant="outline" height={50} left={<Icon name="swap_horiz" size={20} />}
            onPress={() => showToast({ icon: 'swap_horiz', title: 'Transferência assinada', body: `${fmtPt(PROV_PAID)} LUNES para sua carteira pessoal · liquida na próxima conexão com a Mainnet` })} />
        </View>
        <View style={{ marginTop: 16, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
          <Icon name="policy" size={17} w={300} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Cada crédito combina recibo do seu nó, confirmação do destino e auditoria por amostragem. Duplicatas, rotas circulares e tráfego artificial são rejeitados.</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
