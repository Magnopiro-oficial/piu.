import { router } from 'expo-router';
import { ScrollView, Pressable, View } from 'react-native';
import { FEE_OPTIONS, fmtLunes, MAINNET_PENDING } from '../../data/wallet';

/** "agora", "há 12 min", "há 3 h" (o pedido vale 24 h). */
const ago = (sec: number) => {
  const m = Math.max(0, Math.floor((Date.now() / 1000 - sec) / 60));
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h`;
};
import { useLayout } from '../../lib/responsive';
import { initialsOf } from '../../lib/text';
import { useMessaging } from '../../state/messaging';
import { useStore } from '../../state/store';
import { useWallet } from '../../state/wallet';
import { useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { BackHeader, Segmented, SectionLabel } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/** Pedidos de conversa recebidos por Por perto: aceitar (recebe a taxa), recusar em silêncio, bloquear. */
export default function Requests() {
  const { c } = useTheme();
  const { compact } = useLayout();
  const { myFee, setMyFee } = useWallet();
  const { nearby } = useMessaging();
  const requests = nearby?.requests ?? [];
  const { block: blockContact, showToast } = useStore();
  const answer = (id: string, a: 'accept' | 'decline' | 'block') => {
    try { return nearby?.answer(id, a) ?? null; } catch (e) { showToast({ icon: 'timer_off', title: 'Pedido expirou', body: String((e as Error).message) }); return null; }
  };

  return (
    <Screen>
      <BackHeader title="Pedidos de conversa" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}>
        {requests.length === 0 && (
          <View style={{ paddingVertical: 32, paddingHorizontal: 24, alignItems: 'center', gap: 10 }}>
            <Icon name="waving_hand" size={36} w={300} color={c.ink2} />
            <T size={16} w={650} align="center">Nenhum pedido de conversa</T>
            <T size={13} lh={1.45} color={c.ink2} align="center">Quando alguém por perto convidar você, o pedido aparece aqui com a taxa que você escolheu.</T>
          </View>
        )}
        {requests.map(r => {
          const st = r.status === 'pending' ? undefined : r.status;
          const done: [IconName, string] | null = st === 'accepted' ? ['check_circle', 'Aceito · conversa aberta']
            : st === 'blocked' ? ['block', 'Bloqueado e denunciado']
              : st === 'declined' ? ['close', `Recusado · ${r.name} não será avisado(a)`] : null;
          return (
            <View key={r.id} accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 12, opacity: st && st !== 'accepted' ? 0.55 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar initials={initialsOf(r.name)} size={compact ? 40 : 46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15.5} w={650} numberOfLines={1}>{r.name}</T>
                  <T size={12.5} mono color={c.ink2} numberOfLines={2}>{r.prox} · {ago(r.at)}</T>
                </View>
                <View style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 99, backgroundColor: c.ink }}>
                  <T size={12} w={600} mono color={c.invink}>+{fmtLunes(r.fee)}{compact ? '' : ' LUNES'}</T>
                </View>
              </View>
              <View style={{ alignSelf: 'flex-start', maxWidth: '92%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, borderTopLeftRadius: 6, backgroundColor: c.bg }}>
                <T size={14.5} lh={1.4}>{r.msg}</T>
              </View>
              {done ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name={done[0]} size={18} fill={st === 'accepted'} />
                  <T size={13} w={550}>{done[1]}</T>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: compact ? 'column-reverse' : 'row', gap: 8 }}>
                    <Button label="Recusar" variant="soft" height={46} fontSize={14} style={!compact && { flex: 1 }} onPress={() => answer(r.id, 'decline')} />
                    <Button label="Aceitar e conversar" height={46} fontSize={14} style={!compact && { flex: 1.6 }}
                      onPress={() => { if (answer(r.id, 'accept')) router.push({ pathname: '/nearby/match', params: { id: r.id } }); }} />
                  </View>
                  {/* Bloqueia o `piu:` real do remetente: o mensageiro descarta novos pedidos e mensagens dele. */}
                  <Pressable onPress={() => { answer(r.id, 'block'); blockContact({ id: r.from, name: r.name, initials: initialsOf(r.name), how: 'pedido de conversa', reported: true }); }} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 4 }}>
                    <T size={12.5} w={550} color={c.ink2} style={{ textDecorationLine: 'underline' }}>Bloquear e denunciar</T>
                  </Pressable>
                </>
              )}
            </View>
          );
        })}

        <View style={{ marginTop: 8 }}><SectionLabel>SUAS PREFERÊNCIAS</SectionLabel></View>
        <View style={{ padding: 16, borderRadius: 22, borderWidth: 1, borderColor: c.line2, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 8 }}>
            <T size={15} w={600}>Taxa para abrir conversa</T>
            <T size={12} color={c.ink2}>{compact ? 'em LUNES · ' : ''}você recebe ao aceitar</T>
          </View>
          <Segmented label="Taxa para abrir conversa" value={String(myFee)} onChange={v => setMyFee(Number(v))}
            options={FEE_OPTIONS.map(n => [String(n), compact ? String(n) : `${n} LUNES`] as [string, string])} />
          <T size={12.5} lh={1.4} color={c.ink2}>Quanto maior a taxa, menos convites você recebe.</T>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4, paddingTop: 4 }}>
          <Icon name="notifications_off" size={18} color={c.ink2} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>Quem você recusa não é avisado: o convite apenas expira e o valor volta para a pessoa.</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4 }}>
          <Icon name="cloud_off" size={18} color={c.ink2} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{`Taxas aceitas ficam a receber, registradas só neste aparelho: ${MAINNET_PENDING}.`}</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
