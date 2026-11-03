import { router } from 'expo-router';
import { ScrollView, Pressable, View } from 'react-native';
import { FEE_OPTIONS, fmtLunes, REQUESTS } from '../../data/wallet';
import { useLayout } from '../../lib/responsive';
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
  const { reqStatus, accept, decline, block, myFee, setMyFee } = useWallet();
  const { block: blockContact } = useStore();

  return (
    <Screen>
      <BackHeader title="Pedidos de conversa" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}>
        {REQUESTS.map(r => {
          const st = reqStatus[r.id];
          const done: [IconName, string] | null = st === 'accepted' ? ['check_circle', 'Aceito · conversa aberta']
            : st === 'blocked' ? ['block', 'Bloqueado e denunciado']
              : st === 'declined' ? ['close', `Recusado · ${r.name} não será avisado(a)`] : null;
          return (
            <View key={r.id} accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 12, opacity: st && st !== 'accepted' ? 0.55 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar initials={r.initials} size={compact ? 40 : 46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15.5} w={650} numberOfLines={1}>{r.name}, {r.age}</T>
                  <T size={12.5} mono color={c.ink2} numberOfLines={2}>{r.prox} · {r.time}</T>
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
                    <Button label="Recusar" variant="soft" height={46} fontSize={14} style={!compact && { flex: 1 }} onPress={() => decline(r.id)} />
                    <Button label="Aceitar e conversar" height={46} fontSize={14} style={!compact && { flex: 1.6 }}
                      onPress={() => { accept(r.id); router.push({ pathname: '/nearby/match', params: { id: r.id } }); }} />
                  </View>
                  <Pressable onPress={() => { block(r.id); blockContact({ id: r.id, name: r.name, initials: r.initials, how: 'pedido de conversa', reported: true }); }} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 4 }}>
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
      </ScrollView>
    </Screen>
  );
}
