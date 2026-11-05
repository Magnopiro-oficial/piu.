import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useT } from '../../i18n';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { fingerprintOf, useKeys } from '../../state/keys';
import { useMyCard } from '../../state/messaging';
import { inviteLink } from '../../lib/inviteLink';
import { APP_SCHEME } from '../../lib/inviter';
import { useSendApp } from '../../lib/sendApp';
import { QrCode } from '../../ui/QrCode';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Convidar: o QR leva o link `piu://invite/accept?c=…` com o seu cartão de contato assinado (o mesmo
 * de "Meu código": uso único, 24 h). Quem já tem o Piu escaneia aqui ou pela câmera do celular;
 * quem está longe recebe o mesmo link pelo compartilhamento.
 */
export default function Invite() {
  const { c } = useTheme();
  const t = useT();
  const { profile, identity, showToast } = useStore();
  const [card, bump] = useMyCard(identity);
  const me = useKeys().identities?.[identity];
  const fp = me ? fingerprintOf(me) : null;
  const inviter = identity === 'public' && profile.name.trim() ? profile.name.trim() : '';
  const { canSend } = useSendApp();
  return (
    <Screen>
      <BackHeader title={t('wallet.invite')} />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        <View style={{ paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, borderRadius: 28, backgroundColor: c.ink, gap: 18 }}>
          <T size={28} w={650} ls={-0.035} lh={1.05} color={c.invink} accessibilityRole="header">{t('invite.title')}</T>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            {card ? <QrCode value={inviteLink(card, APP_SCHEME)} size={128} radius={18} label={t('invite.qr')} /> : <View style={{ width: 128, height: 128, borderRadius: 18, backgroundColor: c.invink, opacity: 0.2 }} />}
            <View style={{ gap: 6, minWidth: 0, flex: 1 }}>
              <T size={15} w={600} color={c.invink}>{inviter ? t('invite.from', { name: inviter }) : t('invite.anon')}</T>
              <T size={11.5} mono lh={1.5} color={c.invink} style={{ opacity: 0.72 }}>{`${t('invite.singleUse')}\n${t('invite.expires')}\n${t('invite.signed', { fp: fp ? fp[0] + '…' + fp[7] : '…' })}`}</T>
            </View>
          </View>
          <Pressable onPress={() => { bump(); showToast({ icon: 'qr_code_scanner', title: t('invite.newCode'), body: t('invite.newCode.body') }); }} accessibilityRole="button"
            style={{ height: 42, borderRadius: 21, borderWidth: 1, borderColor: c.invink, alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}>
            <T size={14} w={550} color={c.invink}>{t('invite.generate')}</T>
          </Pressable>
        </View>
        <Pressable onPress={() => router.push('/wallet/referrals')} accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
          <Icon name="toll" size={22} w={300} />
          <T size={13} lh={1.4} color={c.ink2} style={{ flex: 1 }}><T size={13} w={600}>+25 LUNES</T> {t('invite.reward')}</T>
          <Icon name="chevron_right" size={20} color={c.ink2} />
        </Pressable>
        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 10, paddingHorizontal: 4 }}>{t('invite.hasPiu')}</T>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 16, borderRadius: 20, backgroundColor: c.bg2 }}>
          <Icon name="qr_code_scanner" size={24} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={15.5} w={600}>{t('invite.yes')}</T>
            <T size={13} lh={1.4} color={c.ink2}>{t('invite.yes.desc')}</T>
          </View>
        </View>
        <Pressable onPress={() => router.push('/invite/share')} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 16, borderRadius: 20, borderWidth: 1.5, borderColor: c.ink, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
          <Icon name="upload" size={24} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={15.5} w={600}>{t('invite.far')}</T>
            <T size={13} lh={1.4} color={c.ink2}>{canSend ? t('invite.far.send') : t('invite.far.link')}</T>
          </View>
          <Icon name="chevron_right" size={20} color={c.ink2} style={{ marginTop: 2 }} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 6, paddingHorizontal: 4 }}>
          <Icon name="verified_user" size={17} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>{t('invite.signedNote')}</T>
        </View>
      </ScrollView>
    </Screen>
  );
}
