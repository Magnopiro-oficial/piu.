import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { BASE_ACTIVITY, BONUS_STEPS, CREDITS, CREDIT_HISTORY, WALLET_ADDR, fmtLunes } from '../../data/wallet';
import { useStore } from '../../state/store';
import { useWallet } from '../../state/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { SectionLabel, Segmented } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';
import { ReceiveSheet, SendSheet } from '../../ui/WalletSheets';

/** Carteira: Saldo (enviar, receber, convidar, bônus, distribuição, atividade) e Créditos de rede. */
export default function WalletTab() {
  const { c } = useTheme();
  const [tab, setTab] = useState<'wallet' | 'rewards'>('wallet');
  const [sheet, setSheet] = useState<'send' | 'receive' | null>(null);

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <T size={36} w={700} ls={-0.045} style={{ lineHeight: 38 }} accessibilityRole="header">Carteira</T>
          <View accessibilityLabel="Última conexão com a Mainnet: ontem" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 99, borderWidth: 1, borderColor: c.line2 }}>
            <Icon name="cloud_off" size={14} color={c.ink2} />
            <T size={12} w={500} color={c.ink2}>Mainnet: ontem</T>
          </View>
        </View>
        <View style={{ paddingTop: 12, paddingHorizontal: 20 }}>
          <Segmented label="Carteira" value={tab} onChange={setTab} options={[['wallet', 'Saldo'], ['rewards', 'Créditos de rede']]} />
        </View>
        {tab === 'wallet' ? <Balance onSheet={setSheet} /> : <Rewards />}
      </ScrollView>
      {sheet === 'send' && <SendSheet onClose={() => setSheet(null)} />}
      {sheet === 'receive' && <ReceiveSheet onClose={() => setSheet(null)} />}
    </Screen>
  );
}

function Balance({ onSheet }: { onSheet: (s: 'send' | 'receive') => void }) {
  const { c } = useTheme();
  const { balance, sent, reserved, earned } = useWallet();
  const { showToast } = useStore();
  const actions: [IconName, string, () => void][] = [
    ['arrow_upward', 'Enviar', () => onSheet('send')],
    ['arrow_downward', 'Receber', () => onSheet('receive')],
    ['person_add', 'Convidar', () => router.push('/invite')],
  ];
  const activity: [IconName, string, string, string, string][] = [
    ...earned.map(x => ['waving_hand', `Convite aceito · ${x.from}`, 'Agora', 'recebido', `+${fmtLunes(x.amt)}`] as [IconName, string, string, string, string]),
    ...reserved.map(x => ['waving_hand', `Convite para ${x.to}`, 'Agora', 'reservado por 24 h', `−${fmtLunes(x.amt)}`] as [IconName, string, string, string, string]),
    ...sent.map(x => ['north_east', `Enviado para ${x.to}`, 'Agora', 'na fila da malha', `−${fmtLunes(x.amt)}`] as [IconName, string, string, string, string]),
    ...BASE_ACTIVITY,
  ];

  return (
    <>
      <View style={{ marginTop: 14, marginHorizontal: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18, borderRadius: 28, backgroundColor: c.ink, gap: 18 }}>
        <View style={{ gap: 6 }}>
          <T size={13} color={c.invink} style={{ opacity: 0.7 }}>Saldo disponível</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={54} w={650} ls={-0.055} tabular color={c.invink} style={{ lineHeight: 56 }} accessibilityLiveRegion="polite">{fmtLunes(balance)}</T>
            <T size={15} w={600} color={c.invink} style={{ opacity: 0.75 }}>LUNES</T>
          </View>
          <T size={13} color={c.invink} style={{ opacity: 0.75 }}>+ 60,00 a liberar · bônus em validação</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {actions.map(([icon, label, go]) => (
            <Pressable key={label} onPress={go} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.invink, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={24} color={c.ink} /></View>
              <T size={12.5} w={550} color={c.invink}>{label}</T>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => showToast({ icon: 'content_copy', title: 'Endereço copiado', body: WALLET_ADDR.long })} accessibilityRole="button" accessibilityLabel={`Copiar endereço ${WALLET_ADDR.short}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.35)', opacity: 0.8 }}>
          <T size={12} mono color={c.invink} style={{ flex: 1 }}>{WALLET_ADDR.short}</T>
          <Icon name="content_copy" size={16} color={c.invink} />
        </Pressable>
      </View>

      <View style={{ marginTop: 12, marginHorizontal: 20, padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="redeem" size={22} w={300} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={15.5} w={600}>Bônus de boas-vindas</T>
            <T size={12.5} color={c.ink2}>Reservado · libera em 3 dias</T>
          </View>
          <T size={16} w={650} tabular>10,00</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {BONUS_STEPS.map(([label, w]) => (
            <View key={label} accessibilityLabel={`${label}: ${w === 100 ? 'concluído' : `${w}%`}`} style={{ flex: 1, gap: 7 }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: c.bg3, overflow: 'hidden' }}><View style={{ height: '100%', width: `${w}%`, backgroundColor: c.ink }} /></View>
              <T size={11} lh={1.25} w={w === 100 ? 450 : 650} color={w === 100 ? c.ink2 : c.ink}>{label}</T>
            </View>
          ))}
        </View>
      </View>

      <View style={{ marginTop: 12, marginHorizontal: 20, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 16, borderRadius: 22, borderWidth: 1.5, borderColor: c.ink, gap: 14 }}>
        <View style={{ gap: 4 }}>
          <T size={19} w={650} ls={-0.025}>Distribua o Piu, ganhe LUNES</T>
          <T size={13.5} lh={1.4} color={c.ink2}>25 LUNES para cada pessoa que instalar a partir do seu celular e ficar ativa por 7 dias.</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[['7', 'convidados'], ['3', 'ativos e pagos'], ['75', 'LUNES ganhos']].map(([v, l]) => (
            <View key={l} style={{ flex: 1, gap: 2 }}>
              <T size={22} w={650} ls={-0.03} tabular>{v}</T>
              <T size={11.5} color={c.ink2}>{l}</T>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Convidar agora" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => router.push('/invite')} />
          <Button label="Ver convidados" variant="outline" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => router.push('/wallet/referrals')} />
        </View>
      </View>

      <SectionLabel>ATIVIDADE</SectionLabel>
      <View style={{ marginHorizontal: 20 }}>
        {activity.map(([icon, t, d, s, v], i) => <Row key={i} icon={icon} t={t} d={`${d} · ${s}`} v={v} />)}
      </View>
      <View style={{ marginTop: 18, marginHorizontal: 24, flexDirection: 'row', gap: 10 }}>
        <Icon name="key" size={17} />
        <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>As chaves da carteira ficam neste aparelho e são separadas das suas identidades de conversa.</T>
      </View>
    </>
  );
}

function Rewards() {
  const { c } = useTheme();
  const total = CREDITS.reduce((a, x) => a + x[1], 0);
  return (
    <>
      <View style={{ marginTop: 10, marginHorizontal: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, borderRadius: 26, backgroundColor: c.ink, gap: 18 }}>
        <View style={{ gap: 6 }}>
          <T size={13} color={c.invink} style={{ opacity: 0.7 }}>Validados, prontos para liquidar</T>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T size={52} w={650} ls={-0.05} tabular color={c.invink} style={{ lineHeight: 54 }}>1.042,0</T>
            <T size={15} color={c.invink} style={{ opacity: 0.7 }}>créditos</T>
          </View>
          <T size={12.5} mono color={c.invink} style={{ opacity: 0.7 }}>≈ 10,42 LUNES · estimativa</T>
        </View>
        <View accessibilityLabel="Créditos por estado" style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
          {CREDITS.map(([l, n, , op]) => <View key={l} style={{ width: `${(n / total) * 100}%`, backgroundColor: c.invink, opacity: op }} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 16 }}>
          {CREDITS.map(([l, , v, op]) => (
            <View key={l} style={{ width: '46%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.invink, opacity: op }} />
              <T size={12.5} color={c.invink} style={{ flex: 1, opacity: 0.75 }}>{l}</T>
              <T size={13} w={600} tabular color={c.invink}>{v}</T>
            </View>
          ))}
        </View>
      </View>
      <View style={{ marginTop: 12, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="cloud_off" size={22} w={300} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={14} w={600}>Liquidação aguardando Mainnet</T>
          <T size={12.5} lh={1.35} color={c.ink2}>Seus créditos ficam guardados aqui. A liquidação em LUNES acontece quando houver conexão.</T>
        </View>
      </View>
      <SectionLabel>HISTÓRICO</SectionLabel>
      <View style={{ marginHorizontal: 20 }}>
        {CREDIT_HISTORY.map(([icon, t, d, s, v]) => <Row key={t} icon={icon} t={t} d={`${d} · ${s}`} v={v} />)}
      </View>
      <T size={12.5} lh={1.45} color={c.ink2} style={{ marginTop: 18, marginHorizontal: 24 }}>Créditos dependem de entregas comprovadas. Tempo ligado, antenas maiores ou capacidade anunciada não geram recompensa. Duplicatas são descartadas.</T>
    </>
  );
}

function Row({ icon, t, d, v }: { icon: IconName; t: string; d: string; v: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} w={300} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={14.5} w={550} numberOfLines={2}>{t}</T>
        <T size={12.5} color={c.ink2}>{d}</T>
      </View>
      <T size={14} w={600} tabular>{v}</T>
    </View>
  );
}
