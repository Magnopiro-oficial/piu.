import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
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
  const { width } = useLayout();
  const { identity, setIdentity, profile, showToast } = useStore();
  const [card, bump] = useMyCard(identity);
  const me = useKeys().identities?.[identity];
  const fp = me ? fingerprintOf(me) : null;
  const size = Math.min(280, width - 80);
  const copy = async () => {
    await Clipboard.setStringAsync(card);
    showToast({ icon: 'content_copy', title: 'Código copiado', body: 'Envie só para quem você conhece. Vale por 24 h.' });
  };
  return (
    <Screen>
      <BackHeader title="Meu código" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 16, alignItems: 'stretch' }}>
        <Segmented label="Identidade" value={identity} onChange={setIdentity} options={[['public', 'Pública'], ['anon', 'Anônima']]} />
        <View style={{ alignItems: 'center', gap: 12, padding: 20, borderRadius: 28, backgroundColor: c.bg2 }}>
          {card ? <QrCode value={card} size={size} radius={18} label={`QR da identidade ${identity === 'public' ? 'pública' : 'anônima'}`} />
            : <View style={{ width: size, height: size, borderRadius: 18, backgroundColor: c.bg }} />}
          <T size={18} w={650} align="center">{identity === 'public' ? profile.name || 'Identidade pública' : 'Identidade anônima'}</T>
          {fp && <T size={12.5} mono color={c.ink2} align="center">{fp.slice(0, 4).join(' ')}{'\n'}{fp.slice(4).join(' ')}</T>}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }}>
          <Icon name="verified_user" size={18} />
          <T size={13} lh={1.45} color={c.ink2} style={{ flex: 1 }}>
            {identity === 'anon'
              ? 'O código anônimo não leva seu nome nem se liga à identidade pública.'
              : 'O código leva seu nome e as chaves públicas, assinados. Vale por 24 h.'}
            {' '}Depois, confiram o código de segurança na tela do contato.
          </T>
        </View>
        <Button label="Copiar código" variant="outline" height={46} disabled={!card} onPress={copy} left={<Icon name="content_copy" size={18} />} />
        <Button label="Gerar um novo" variant="ghost" height={42} fontSize={13.5} onPress={bump} />
        <Button label="Escanear o código de alguém" height={50} onPress={() => router.push('/scan')} />
      </ScrollView>
    </Screen>
  );
}
