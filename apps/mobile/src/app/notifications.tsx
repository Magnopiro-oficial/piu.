import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { NOTIF_TYPES } from '../data/settings';
import { useT, type Key } from '../i18n';
import { OFFICIAL_NOTE } from '../messaging/communityAlerts';
import { useMessaging } from '../state/messaging';
import { previewPiu } from '../lib/piuSound';
import { notificationPermission, requestNotificationPermission, sendTestNotification } from '../lib/notifications';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { AlertRow } from '../ui/AlertRow';
import { SetGroup, ToggleRow } from '../ui/Settings';
import { T } from '../ui/T';

type Perm = 'granted' | 'denied' | 'undetermined' | null;

/** Permissão do sistema para as notificações locais: pedir, abrir os ajustes do aparelho ou testar. */
function SystemPermission() {
  const { c } = useTheme();
  const t = useT();
  const [perm, setPerm] = useState<Perm>(null);
  const [sent, setSent] = useState(false);
  const refresh = useCallback(() => { notificationPermission().then(setPerm).catch(() => setPerm('denied')); }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);
  if (!perm) return null;
  // Permitido: só o botão do design ("Testar com o app fechado", 50 px, `ink`, ícone de celular).
  if (perm === 'granted') {
    return (
      <View style={{ marginTop: 12, marginHorizontal: 20, gap: 8 }}>
        <Button label={sent ? t('notif.test.sent') : t('notif.test')} height={50} fontSize={15} disabled={sent}
          left={<Icon name="phone_iphone" size={19} color={c.invink} />}
          onPress={() => { void sendTestNotification().then(ok => { setSent(ok); if (ok) setTimeout(() => setSent(false), 6000); }); }} />
        <T size={12} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 4 }}>{t('notif.test.hint')}</T>
      </View>
    );
  }
  const text = perm === 'denied' ? (Platform.OS === 'web' ? t('notif.perm.deniedWeb') : t('notif.perm.denied')) : t('notif.perm.undetermined');
  return (
    <View style={{ marginTop: 10, marginHorizontal: 20, padding: 14, borderRadius: 18, backgroundColor: c.bg2, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Icon name="notifications_off" size={22} w={300} />
        <View style={{ flex: 1, gap: 3 }}>
          <T size={14} w={600}>{t('notif.system')}</T>
          <T size={12.5} lh={1.4} color={c.ink2} accessibilityLiveRegion="polite">{text}</T>
        </View>
      </View>
      {perm === 'undetermined' && <Button label={t('notif.allow')} height={42} fontSize={14} onPress={() => { void requestNotificationPermission().finally(refresh); }} />}
      {perm === 'denied' && Platform.OS !== 'web' && <Button label={t('notif.openSettings')} variant="outline" height={42} fontSize={14} onPress={() => { void Linking.openSettings(); }} />}
    </View>
  );
}

/**
 * Alertas da comunidade de todas as comunidades em que a pessoa está: publicados e classificados
 * pelos membros (messaging/communityAlerts.ts), no grupo de cada comunidade.
 */
function CommunityAlerts() {
  const { c } = useTheme();
  const t = useT();
  const { alerts, alertEpoch, ready } = useMessaging();
  void alertEpoch;
  const list = alerts?.list() ?? [];
  return (
    <View>
      <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 22, paddingHorizontal: 24, paddingBottom: 8 }}>{t('notif.alerts')}</T>
      <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, gap: 10 }}>
        <T size={12.5} lh={1.4} color={c.ink2}>{`${OFFICIAL_NOTE} ${t('notif.alerts.hint')}`}</T>
        {list.length ? list.map(a => <AlertRow key={a.id} a={a} showCommunity />) : (
          <View accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
            <T size={12.5} lh={1.4} color={c.ink2}>{!ready ? t('common.loading') : t('notif.alerts.empty')}</T>
          </View>
        )}
      </View>
    </View>
  );
}

/** Notificações sem servidor: pré-visualização, tipos de aviso, alertas da comunidade e silêncio. */
export default function Notifications() {
  const { c } = useTheme();
  const t = useT();
  const { preview, setPreview, notifs, toggleNotif, quiet, setQuiet, discreet, setDiscreet, piuSound, setPiuSound } = useSettings();
  const link = (label: string, href: '/lock') => (
    <Pressable onPress={() => router.push(href)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 2 }}>
      <T size={12.5} w={550} style={{ textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
  return (
    <Screen>
      <BackHeader title={t('profile.row.notifications')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 4, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
          <Icon name="hub" size={22} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={14} w={600}>{t('notif.noServer')}</T>
            <T size={12.5} lh={1.4} color={c.ink2}>{t('notif.noServer.desc')}</T>
          </View>
        </View>
        <SystemPermission />

        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 22, paddingHorizontal: 24, paddingBottom: 8 }}>{t('notif.preview')}</T>
        <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, gap: 10 }}>
          <Segmented label={t('notif.preview.label')} value={preview} onChange={setPreview} options={[['always', t('common.always')], ['unlocked', t('notif.preview.unlocked')], ['never', t('common.never')]]} />
          <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 2 }} accessibilityLiveRegion="polite">{t(`notif.preview.hint.${preview}` as Key)}</T>
          {link(t('notif.preview.lock'), '/lock')}
        </View>

        <SetGroup title={t('notif.what')}>
          {NOTIF_TYPES.map(([k, icon]) => <ToggleRow key={k} icon={icon} name={t(`notif.type.${k}` as Key)} desc={t(`notif.type.${k}.desc` as Key)} on={notifs[k]} onChange={() => toggleNotif(k)} />)}
        </SetGroup>

        <CommunityAlerts />

        <SetGroup title={t('notif.sound')}>
          <ToggleRow icon="music_note" name={t('notif.piuSound')} desc={discreet ? t('notif.piuSound.discreet') : t('notif.piuSound.desc')} on={piuSound}
            onChange={() => { const next = !piuSound; setPiuSound(next); if (next) void previewPiu(); }} />
          <Pressable onPress={() => void previewPiu()} accessibilityRole="button" accessibilityLabel={t('notif.hearPiu')}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, opacity: pressed ? 0.6 : 1 })}>
            <Icon name="play_arrow" size={21} w={300} />
            <T size={15} w={500}>{t('notif.hearPiu')}</T>
          </Pressable>
        </SetGroup>

        <SetGroup title={t('notif.silence')}>
          <ToggleRow name={t('notif.night')} desc={t('notif.night.desc')} on={quiet} onChange={() => setQuiet(!quiet)} />
          <ToggleRow name={t('notif.discreet')} desc={t('notif.discreet.desc')} on={discreet} onChange={() => setDiscreet(!discreet)} />
        </SetGroup>
      </ScrollView>
    </Screen>
  );
}
