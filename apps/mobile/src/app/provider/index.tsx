import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { type ProvNode, useProvNodes } from '../../lib/approvalNodes';
import { dayLabel } from '../../lib/walletCore';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Painel do provider no celular: os equipamentos com piu-node pareados com este celular (pareamento
 * real pelo QR do painel). Ganhos, recibos e o teste real ficam no painel de cada equipamento: o
 * celular não lê a API local do nó, então não mostra números que não tem.
 */
export default function Provider() {
  const { c } = useTheme();
  const { nodes } = useProvNodes();
  const list = nodes ?? [];

  return (
    <Screen>
      <BackHeader title="Provider" right={
        <Pressable onPress={() => router.push('/provider/add')} accessibilityRole="button" accessibilityLabel="Adicionar equipamento"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="add" size={22} />
        </Pressable>
      } />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 4, marginHorizontal: 20, paddingTop: 20, paddingHorizontal: 18, paddingBottom: 18, borderRadius: 26, backgroundColor: c.ink, gap: 8 }}>
          <T size={13} color={c.invink} style={{ opacity: 0.7 }}>Equipamentos pareados</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={50} w={650} ls={-0.055} tabular color={c.invink} style={{ lineHeight: 52 }}>{nodes ? String(list.length) : '…'}</T>
            <T size={15} w={600} color={c.invink} style={{ opacity: 0.75 }}>{list.length === 1 ? 'equipamento' : 'equipamentos'}</T>
          </View>
          <T size={13} lh={1.4} color={c.invink} style={{ opacity: 0.75 }}>Este celular aprova as transferências pedidas no painel de cada um. Ganhos e recibos ficam no painel do equipamento.</T>
        </View>

        <Pressable onPress={() => router.push('/provider/earnings')} accessibilityRole="button"
          style={{ marginTop: 10, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="event_upcoming" size={22} w={300} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600}>Liquidação aguardando Mainnet</T>
            <T size={12.5} color={c.ink2}>Os lotes só são pagos quando a liquidação for conectada à Lunes Mainnet</T>
          </View>
          <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
        </Pressable>

        <SectionLabel>{`EQUIPAMENTOS · ${list.length}`}</SectionLabel>
        <View style={{ marginHorizontal: 20, gap: 8 }}>
          {nodes && list.length === 0 && (
            <View style={{ padding: 18, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 12 }}>
              <T size={15} w={600}>Nenhum equipamento pareado</T>
              <T size={13} lh={1.45} color={c.ink2}>Instale o Piu Node num roteador, computador ou Raspberry Pi e leia o QR de “Parear celular” no painel dele.</T>
              <Button label="Adicionar equipamento" height={44} fontSize={14} onPress={() => router.push('/provider/add')} />
            </View>
          )}
          {list.map(d => <NodeRow key={d.phoneId} d={d} />)}
        </View>
        <T size={12.5} lh={1.45} color={c.ink2} style={{ marginTop: 18, marginHorizontal: 24 }}>Seus equipamentos só veem envelopes cifrados. Ganhos vêm de recibos confirmados pelo destino e por nós independentes.</T>
      </ScrollView>
    </Screen>
  );
}

function NodeRow({ d }: { d: ProvNode }) {
  const { c } = useTheme();
  const when = dayLabel(d.at, Date.now());
  return (
    <Pressable onPress={() => router.push({ pathname: '/provider/device/[id]', params: { id: d.phoneId } })} accessibilityRole="button"
      accessibilityLabel={`${d.node}, pareado ${when === 'Hoje' || when === 'Ontem' ? when.toLowerCase() : `em ${when}`}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="router" size={23} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={15} w={600} numberOfLines={2}>{d.node}</T>
        <T size={11.5} mono color={c.ink2} numberOfLines={1}>{d.operator ? `operador ${d.operator} · ` : ''}pareado {when === 'Hoje' || when === 'Ontem' ? when.toLowerCase() : `em ${when}`}</T>
      </View>
      <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
    </Pressable>
  );
}
