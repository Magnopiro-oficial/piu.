import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { NOTIF_TYPES, PREVIEW_HINT } from '../data/settings';
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
  const [perm, setPerm] = useState<Perm>(null);
  const [sent, setSent] = useState(false);
  const refresh = useCallback(() => { notificationPermission().then(setPerm).catch(() => setPerm('denied')); }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);
  if (!perm) return null;
  const text = perm === 'granted'
    ? 'Permitidas. Os avisos chegam com o Piu em segundo plano; com ele aberto, aparecem como banner.'
    : perm === 'denied'
      ? (Platform.OS === 'web' ? 'Bloqueadas neste navegador. Libere nas permissões do site.' : 'Bloqueadas nos ajustes do aparelho. Sem elas, você só vê os avisos com o Piu aberto.')
      : 'O Piu ainda não pode avisar fora do app. O aviso é criado aqui, no aparelho: nada passa por servidor.';
  return (
    <View style={{ marginTop: 10, marginHorizontal: 20, padding: 14, borderRadius: 18, backgroundColor: c.bg2, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Icon name={perm === 'granted' ? 'notifications' : 'notifications_off'} size={22} w={300} />
        <View style={{ flex: 1, gap: 3 }}>
          <T size={14} w={600}>Notificações do sistema</T>
          <T size={12.5} lh={1.4} color={c.ink2} accessibilityLiveRegion="polite">{text}</T>
        </View>
      </View>
      {perm === 'undetermined' && <Button label="Permitir notificações" height={42} fontSize={14} onPress={() => { void requestNotificationPermission().finally(refresh); }} />}
      {perm === 'denied' && Platform.OS !== 'web' && <Button label="Abrir ajustes do aparelho" variant="outline" height={42} fontSize={14} onPress={() => { void Linking.openSettings(); }} />}
      {perm === 'granted' && (
        <Button label={sent ? 'Chega em 5 s · bloqueie a tela' : 'Enviar aviso de teste'} variant="outline" height={42} fontSize={14} disabled={sent}
          onPress={() => { void sendTestNotification().then(ok => { setSent(ok); if (ok) setTimeout(() => setSent(false), 6000); }); }} />
      )}
    </View>
  );
}

/**
 * Alertas da comunidade de todas as comunidades em que a pessoa está: publicados e classificados
 * pelos membros (messaging/communityAlerts.ts), no grupo de cada comunidade.
 */
function CommunityAlerts() {
  const { c } = useTheme();
  const { alerts, alertEpoch, ready } = useMessaging();
  void alertEpoch;
  const list = alerts?.list() ?? [];
  return (
    <View>
      <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 22, paddingHorizontal: 24, paddingBottom: 8 }}>ALERTAS DA COMUNIDADE</T>
      <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, gap: 10 }}>
        <T size={12.5} lh={1.4} color={c.ink2}>{`${OFFICIAL_NOTE} Cada membro classifica: “Confirmo” ou “Não procede”. Para publicar, abra a comunidade → Alertas.`}</T>
        {list.length ? list.map(a => <AlertRow key={a.id} a={a} showCommunity />) : (
          <View accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
            <T size={12.5} lh={1.4} color={c.ink2}>{!ready ? 'Carregando…' : 'Nenhum alerta vigente nas suas comunidades.'}</T>
          </View>
        )}
      </View>
    </View>
  );
}

/** Notificações sem servidor: pré-visualização, tipos de aviso, alertas da comunidade e silêncio. */
export default function Notifications() {
  const { c } = useTheme();
  const { preview, setPreview, notifs, toggleNotif, quiet, setQuiet, discreet, setDiscreet, piuSound, setPiuSound } = useSettings();
  const link = (label: string, href: '/lock') => (
    <Pressable onPress={() => router.push(href)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 2 }}>
      <T size={12.5} w={550} style={{ textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
  return (
    <Screen>
      <BackHeader title="Notificações" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 4, marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 12 }}>
          <Icon name="hub" size={22} w={300} />
          <View style={{ flex: 1, gap: 3 }}>
            <T size={14} w={600}>Sem servidor de notificações</T>
            <T size={12.5} lh={1.4} color={c.ink2}>O Piu escuta a malha em segundo plano, sem Google ou Apple no meio. Avisos podem chegar alguns minutos depois.</T>
          </View>
        </View>
        <SystemPermission />

        <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 22, paddingHorizontal: 24, paddingBottom: 8 }}>PRÉ-VISUALIZAÇÃO</T>
        <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, gap: 10 }}>
          <Segmented label="Pré-visualização" value={preview} onChange={setPreview} options={[['always', 'Sempre'], ['unlocked', 'Desbloqueado'], ['never', 'Nunca']]} />
          <T size={12.5} lh={1.4} color={c.ink2} style={{ paddingHorizontal: 2 }} accessibilityLiveRegion="polite">{PREVIEW_HINT[preview]}</T>
          {link('Ver na tela bloqueada', '/lock')}
        </View>

        <SetGroup title="O QUE AVISAR">
          {NOTIF_TYPES.map(([k, icon, name, desc]) => <ToggleRow key={k} icon={icon} name={name} desc={desc} on={notifs[k]} onChange={() => toggleNotif(k)} />)}
        </SetGroup>

        <CommunityAlerts />

        <SetGroup title="SOM">
          <ToggleRow icon="music_note" name="Som de piu" desc={discreet ? 'Com o app aberto. Com ele fechado, a vibração discreta (abaixo) deixa sem som' : 'Com o app aberto e nas notificações'} on={piuSound}
            onChange={() => { const next = !piuSound; setPiuSound(next); if (next) void previewPiu(); }} />
          <Pressable onPress={() => void previewPiu()} accessibilityRole="button" accessibilityLabel="Ouvir o piu"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, opacity: pressed ? 0.6 : 1 })}>
            <Icon name="play_arrow" size={21} w={300} />
            <T size={15} w={500}>Ouvir o piu</T>
          </Pressable>
        </SetGroup>

        <SetGroup title="SILÊNCIO">
          <ToggleRow name="Modo noturno" desc="22h às 7h · alertas Graves da comunidade ainda tocam" on={quiet} onChange={() => setQuiet(!quiet)} />
          <ToggleRow name="Vibração discreta" desc="Sem som; um toque curto por notificação" on={discreet} onChange={() => setDiscreet(!discreet)} />
        </SetGroup>
      </ScrollView>
    </Screen>
  );
}
