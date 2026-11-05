import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useT } from '../i18n';
import { useLayout } from '../lib/responsive';
import { fingerprintOf, useKeys } from '../state/keys';
import { useMyCard } from '../state/messaging';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { QrCode } from '../ui/QrCode';
import { Screen } from '../ui/Screen';
import { T } from '../ui/T';

/** Meu código: QR do cartão assinado da identidade em uso, para alguém escanear pessoalmente. */
export default function MyCode() {
  const { c } = useTheme();
  const t = useT();
  const { width } = useLayout();
  const { identity, setIdentity, profile, showToast } = useStore();
  const [card, bump] = useMyCard(identity);
  const me = useKeys().identities?.[identity];
  const fp = me ? fingerprintOf(me) : null;
  const size = Math.min(280, width - 80);
  const copy = async () => {
    await Clipboard.setStringAsync(card);
    showToast({ icon: 'content_copy', title: t('myCode.copied'), body: t('myCode.copied.body') });
  };
  return (
    <Screen>
      <BackHeader title={t('chats.myCode')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 16, alignItems: 'stretch' }}>
        <Segmented label={t('profile.identity')} value={identity} onChange={setIdentity} options={[['public', t('profile.identity.public')], ['anon', t('profile.identity.anon')]]} />
        <View style={{ alignItems: 'center', gap: 12, padding: 20, borderRadius: 28, backgroundColor: c.bg2 }}>
          {card ? <QrCode value={card} size={size} radius={18} label={t('myCode.qr', { kind: (identity === 'public' ? t('profile.identity.public') : t('profile.identity.anon')).toLowerCase() })} />
            : <View style={{ width: size, height: size, borderRadius: 18, backgroundColor: c.bg }} />}
          <T size={18} w={650} align="center">{identity === 'public' ? profile.name || t('identity.public') : t('identity.anon')}</T>
          {fp && <T size={12.5} mono color={c.ink2} align="center">{fp.slice(0, 4).join(' ')}{'\n'}{fp.slice(4).join(' ')}</T>}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }}>
          <Icon name="verified_user" size={18} />
          <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>
            {identity === 'anon' ? t('myCode.note.anon') : t('myCode.note.public')}
            {' '}{t('myCode.note.after')}
          </T>
        </View>
        <Button label={t('myCode.copy')} variant="outline" height={46} disabled={!card} onPress={copy} left={<Icon name="content_copy" size={18} />} />
        <Button label={t('myCode.regenerate')} variant="ghost" height={42} fontSize={13.5} onPress={bump} />
        <Button label={t('myCode.scanSomeone')} height={50} onPress={() => router.push('/scan')} />
      </ScrollView>
    </Screen>
  );
}
