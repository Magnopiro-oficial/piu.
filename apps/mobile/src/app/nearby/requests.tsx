import { router } from 'expo-router';
import { ScrollView, Pressable, View } from 'react-native';
import { FEE_OPTIONS, fmtLunes } from '../../data/wallet';
import { useT } from '../../i18n';

/** "agora", "há 12 min", "há 3 h" (o pedido vale 24 h), no idioma em uso. */
const ago = (sec: number, t: ReturnType<typeof useT>) => {
  const m = Math.max(0, Math.floor((Date.now() / 1000 - sec) / 60));
  return m < 1 ? t('common.now') : m < 60 ? t('requests.agoMin', { n: m }) : t('requests.agoH', { n: Math.floor(m / 60) });
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
  const t = useT();
  const { compact } = useLayout();
  const { myFee, setMyFee } = useWallet();
  const { nearby } = useMessaging();
  const requests = nearby?.requests ?? [];
  const { block: blockContact, showToast } = useStore();
  const answer = (id: string, a: 'accept' | 'decline' | 'block') => {
    try { return nearby?.answer(id, a) ?? null; } catch (e) { showToast({ icon: 'timer_off', title: t('requests.expired'), body: String((e as Error).message) }); return null; }
  };

  return (
    <Screen>
      <BackHeader title={t('notif.type.nearby')} />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}>
        {requests.length === 0 && (
          <View style={{ paddingVertical: 32, paddingHorizontal: 24, alignItems: 'center', gap: 10 }}>
            <Icon name="waving_hand" size={36} w={300} color={c.ink2} />
            <T size={16} w={650} align="center">{t('requests.empty')}</T>
            <T size={13} lh={1.45} color={c.ink2} align="center">{t('requests.empty.body')}</T>
          </View>
        )}
        {requests.map(r => {
          const st = r.status === 'pending' ? undefined : r.status;
          const done: [IconName, string] | null = st === 'accepted' ? ['check_circle', t('requests.accepted')]
            : st === 'blocked' ? ['block', t('requests.blocked')]
              : st === 'declined' ? ['close', t('requests.declined', { name: r.name })] : null;
          return (
            <View key={r.id} accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 22, backgroundColor: c.bg2, gap: 12, opacity: st && st !== 'accepted' ? 0.55 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar initials={initialsOf(r.name)} size={compact ? 40 : 46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={15.5} w={650} numberOfLines={1}>{r.name}</T>
                  <T size={12.5} mono color={c.ink2} numberOfLines={2}>{r.prox} · {ago(r.at, t)}</T>
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
                    <Button label={t('scan.transfer.refuse')} variant="soft" height={46} fontSize={14} style={!compact && { flex: 1 }} onPress={() => answer(r.id, 'decline')} />
                    <Button label={t('accept.accept')} height={46} fontSize={14} style={!compact && { flex: 1.6 }}
                      onPress={() => { if (answer(r.id, 'accept')) router.push({ pathname: '/nearby/match', params: { id: r.id } }); }} />
                  </View>
                  {/* Bloqueia o `piu:` real do remetente: o mensageiro descarta novos pedidos e mensagens dele. */}
                  <Pressable onPress={() => { answer(r.id, 'block'); blockContact({ id: r.from, name: r.name, initials: initialsOf(r.name), how: 'pedido de conversa', reported: true }); }} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 4 }}>
                    <T size={12.5} w={550} color={c.ink2} style={{ textDecorationLine: 'underline' }}>{t('requests.blockReport')}</T>
                  </Pressable>
                </>
              )}
            </View>
          );
        })}

        <View style={{ marginTop: 8 }}><SectionLabel>{t('requests.prefs')}</SectionLabel></View>
        <View style={{ padding: 16, borderRadius: 22, borderWidth: 1, borderColor: c.line2, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 8 }}>
            <T size={15} w={600}>{t('requests.fee')}</T>
            <T size={12} color={c.ink2}>{compact ? `${t('requests.inLunes')} · ` : ''}{t('requests.fee.desc')}</T>
          </View>
          <Segmented label={t('requests.fee')} value={String(myFee)} onChange={v => setMyFee(Number(v))}
            options={FEE_OPTIONS.map(n => [String(n), compact ? String(n) : `${n} LUNES`] as [string, string])} />
          <T size={12.5} lh={1.4} color={c.ink2}>{t('requests.fee.hint')}</T>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4, paddingTop: 4 }}>
          <Icon name="notifications_off" size={18} color={c.ink2} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('requests.declineNote')}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4 }}>
          <Icon name="cloud_off" size={18} color={c.ink2} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('requests.localNote', { pending: t('wallet.mainnetPending') })}</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
