import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useT } from '../../i18n';
import { type ProvNode, useProvNodes } from '../../lib/approvalNodes';
import { CERT_STREAK_DAYS } from '../../lib/phoneNodeCore';
import { certDayOf } from '../../lib/phoneNodeView';
import { dayLabel } from '../../lib/walletCore';
import { usePhoneNode } from '../../state/phoneNode';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Painel do provider no celular: os equipamentos com piu-node pareados com este celular (pareamento
 * real pelo QR do painel). O estado, os recibos e a pausa de cada um vêm da API local do nó, na tela
 * do equipamento (HTTPS com o certificado fixado). Ganhos em LUNES dependem do validador.
 */
export default function Provider() {
  const { c } = useTheme();
  const t = useT();
  const { nodes } = useProvNodes();
  const list = nodes ?? [];

  return (
    <Screen>
      <BackHeader title="Provider" right={
        <Pressable onPress={() => router.push('/provider/add')} accessibilityRole="button" accessibilityLabel={t('prov.addDevice')}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="add" size={22} />
        </Pressable>
      } />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 4, marginHorizontal: 20, paddingTop: 20, paddingHorizontal: 18, paddingBottom: 18, borderRadius: 26, backgroundColor: c.ink, gap: 8 }}>
          <T size={13} color={c.invink} style={{ opacity: 0.7 }}>{t('prov.paired')}</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={50} w={650} ls={-0.055} tabular color={c.invink} style={{ lineHeight: 52 }}>{nodes ? String(list.length) : '…'}</T>
            <T size={15} w={600} color={c.invink} style={{ opacity: 0.75 }}>{t('prov.deviceWord', { count: list.length })}</T>
          </View>
          <T size={13} lh={1.4} color={c.invink} style={{ opacity: 0.75 }}>{t('prov.intro')}</T>
        </View>

        <Pressable onPress={() => router.push('/provider/earnings')} accessibilityRole="button"
          style={{ marginTop: 10, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="event_upcoming" size={22} w={300} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={14} w={600}>{t('prov.settlementPending')}</T>
            <T size={12.5} color={c.ink2}>{t('prov.settlementPending.desc')}</T>
          </View>
          <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
        </Pressable>

        <PhoneNodeRow />

        <SectionLabel>{t('prov.devicesLabel', { count: list.length })}</SectionLabel>
        <View style={{ marginHorizontal: 20, gap: 8 }}>
          {nodes && list.length === 0 && (
            <View style={{ padding: 18, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 12 }}>
              <T size={15} w={600}>{t('prov.none')}</T>
              <T size={13} lh={1.45} color={c.ink2}>{t('prov.none.body')}</T>
              <Button label={t('prov.addDevice')} height={44} fontSize={14} onPress={() => router.push('/provider/add')} />
            </View>
          )}
          {list.map(d => <NodeRow key={d.phoneId} d={d} />)}
        </View>
        <T size={12.5} lh={1.45} color={c.ink2} style={{ marginTop: 18, marginHorizontal: 24 }}>{t('prov.note')}</T>
      </ScrollView>
    </Screen>
  );
}

function NodeRow({ d }: { d: ProvNode }) {
  const { c } = useTheme();
  const t = useT();
  const when = dayLabel(d.at, Date.now(), t);
  const pairedWhen = when === t('day.today') || when === t('day.yesterday') ? t('prov.pairedWhen', { when: when.toLowerCase() }) : t('prov.pairedOn', { when });
  return (
    <Pressable onPress={() => router.push({ pathname: '/provider/device/[id]', params: { id: d.phoneId } })} accessibilityRole="button"
      accessibilityLabel={`${d.node}, ${pairedWhen}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="router" size={23} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={15} w={600} numberOfLines={2}>{d.node}</T>
        <T size={11.5} mono color={c.ink2} numberOfLines={1}>{d.operator ? `${t('prov.operator', { name: d.operator })} · ` : ''}{pairedWhen}</T>
      </View>
      <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
    </Pressable>
  );
}

/**
 * "Do celular" (modo nó, TELAS-NOVAS.md M3): o painel deste aparelho na lista do Provider, no lugar do
 * "em breve". Desligado, leva a M1; ligado, mostra o dia dos 7 e os avais e abre o painel.
 */
function PhoneNodeRow() {
  const { c } = useTheme();
  const t = useT();
  const pn = usePhoneNode();
  const st = pn.status;
  const on = !!st && st.phase !== 'off';
  const line = !st || st.phase === 'off' ? t('pn.row.off')
    : st.phase === 'left' ? (pn.refund.phase === 'returned' ? t('pn.row.returned') : t('pn.row.left', { count: pn.refund.daysLeft }))
    : st.phase === 'needsBond' ? t('pn.row.needsBond')
    : st.phase === 'bondPending' ? t('pn.row.bondPending')
    : t('pn.row.on', { n: certDayOf(pn.certBar), total: CERT_STREAK_DAYS, e: st.endorsements, needed: st.needed });
  return (
    <Pressable onPress={() => router.push(on ? '/provider/phone' : '/provider/connect?mode=phone')} accessibilityRole="button" accessibilityLabel={`${t('pn.title')}, ${line}`}
      style={({ pressed }) => ({ marginTop: 10, marginHorizontal: 20, padding: 14, borderRadius: 20, borderWidth: on ? 1.5 : 1, borderColor: on ? c.ink : c.line2, flexDirection: 'row', alignItems: 'center', gap: 12, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: on ? c.ink : c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name="smartphone" size={23} w={300} color={on ? c.invink : c.ink} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={15} w={600}>{t('pn.title')}</T>
        <T size={12.5} color={c.ink2} numberOfLines={2}>{line}</T>
      </View>
      <Icon name="chevron_right" size={20} w={300} color={c.ink2} />
    </Pressable>
  );
}
