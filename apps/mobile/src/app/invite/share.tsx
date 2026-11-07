import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useLang, useT } from '../../i18n';
import { hasStoreLinks, inviteLink, inviteShareText } from '../../lib/inviteLink';
import { APP_SCHEME, STORE_LINKS, useInviter } from '../../lib/inviter';
import { useSendApp } from '../../lib/sendApp';
import { useMyCard } from '../../state/messaging';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';
import { ApkIntegrityCard } from '../../ui/ApkIntegrityCard';
import { WifiSharePanel } from '../../ui/WifiSharePanel';

/**
 * Enviar o convite de longe: o link `piu://invite/accept?c=…` com o seu cartão de contato assinado
 * (uso único, 24 h), pelo compartilhamento do sistema. Os links das lojas vêm de
 * `expo.extra.storeLinks` (app.json); vazios, o texto leva só o convite.
 */
export default function ShareInvite() {
  const { c } = useTheme();
  const t = useT();
  const lang = useLang();
  const { identity, showToast } = useStore();
  const { name, words } = useInviter();
  const [card] = useMyCard(identity);
  const link = card ? inviteLink(card, APP_SCHEME) : '';
  // O texto viaja para a outra pessoa: sai no idioma de quem envia.
  const message = link ? inviteShareText({ name, link, store: STORE_LINKS }, lang) : '';
  const stores = hasStoreLinks(STORE_LINKS);

  const share = async () => {
    if (!message) return;
    try { await Share.share({ message }); }
    catch { showToast({ icon: 'error', title: t('inviteShare.fail'), body: t('inviteShare.fail.body') }); }
  };
  const { canSend, sending, send: sendApp } = useSendApp();
  const [wifiOpen, setWifiOpen] = useState(false);
  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    showToast({ icon: 'content_copy', title: t('inviteShare.copied'), body: t('inviteShare.copied.body') });
  };

  return (
    <Screen>
      <BackHeader title={t('inviteShare.title')} />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        {canSend && (
          // Regra 6.1: distribuição P2P, sem loja e sem internet (só Android).
          <View style={{ borderRadius: 22, backgroundColor: c.bg2, padding: 16, gap: 10 }}>
            <T size={14.5} w={600}>{t('inviteShare.noPiu')}</T>
            <T size={12.5} lh={1.45} color={c.ink2}>{t('inviteShare.noPiu.desc')}</T>
            {wifiOpen ? <WifiSharePanel onClose={() => setWifiOpen(false)} /> : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label={sending ? t('wallet.evidence.preparing') : 'Bluetooth'} height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} disabled={sending} onPress={sendApp} left={<Icon name="bluetooth" size={18} color={c.invink} />} />
                <Button label="Wi-Fi Direct" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} onPress={() => setWifiOpen(true)} left={<Icon name="wifi_tethering" size={18} color={c.invink} />} />
              </View>
            )}
            {/* B-03: valores para quem recebe conferir com o site (Bluetooth, Quick Share e Wi-Fi Direct). */}
            <ApkIntegrityCard />
          </View>
        )}
        <View style={{ borderRadius: 22, backgroundColor: c.bg2 }}>
          <Step n={1} title={t('inviteShare.step1')}>
            <T size={12} mono lh={1.5} color={c.ink2} numberOfLines={3} selectable>{link || t('inviteShare.preparing')}</T>
            <T size={12.5} lh={1.4} color={c.ink2}>{t('inviteShare.step1.desc')}</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label={t('common.share')} height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} disabled={!message} onPress={share} left={<Icon name="upload" size={18} color={c.invink} />} />
              <Button label={t('inviteShare.copyLink')} variant="outline" height={44} fontSize={14} style={{ flex: 1, paddingHorizontal: 4 }} disabled={!link} onPress={copy} left={<Icon name="content_copy" size={18} />} />
            </View>
          </Step>
          <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />
          <Step n={2} title={t('inviteShare.step2')}>
            <View accessibilityLabel={`${t('inviteShare.code')}: ${words.join(', ')}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {words.map((w, i) => (
                <View key={`${w}-${i}`} style={{ width: '48.5%', flexGrow: 1, height: 40, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={17} w={650} ls={-0.02}>{w}</T>
                </View>
              ))}
            </View>
            <T size={12.5} lh={1.4} color={c.ink2}>{t('inviteShare.step2.desc')}</T>
          </Step>
        </View>


        <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
          <Icon name="install_mobile" size={17} />
          <T size={12.5} lh={1.45} color={c.ink2} style={{ flex: 1 }}>
            {stores ? t('inviteShare.stores') : t('inviteShare.noStores', { how: canSend ? t('inviteShare.noStores.button') : t('inviteShare.noStores.also') })}
          </T>
        </View>

        <Button label={t('inviteShare.back')} variant="soft" height={52} onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, padding: 16 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}><T size={12} w={600} color={c.invink}>{n}</T></View>
      <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
        <T size={14.5} w={600}>{title}</T>
        {children}
      </View>
    </View>
  );
}
