import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { NOTIF_TYPES, PREVIEW_HINT } from '../data/settings';
import { notificationPermission, requestNotificationPermission, sendTestNotification } from '../lib/notifications';
import { useSettings } from '../state/settings';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { BackHeader, Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { Screen } from '../ui/Screen';
import { LockedRow, SetGroup, ToggleRow } from '../ui/Settings';
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

/** Notificações sem servidor: pré-visualização, tipos de aviso e silêncio. */
export default function Notifications() {
  const { c } = useTheme();
  const { preview, setPreview, notifs, toggleNotif, quiet, setQuiet, discreet, setDiscreet } = useSettings();
  const link = (label: string, href: '/lock' | '/alert') => (
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
          <LockedRow icon="warning" name="Alertas de emergência" desc="Sempre ativos se assinados por fonte oficial" />
        </SetGroup>
        <View style={{ paddingTop: 8, paddingHorizontal: 22 }}>{link('Ver exemplo de alerta de emergência', '/alert')}</View>

        <SetGroup title="SILÊNCIO">
          <ToggleRow name="Modo noturno" desc="22h às 7h · alertas críticos ainda tocam" on={quiet} onChange={() => setQuiet(!quiet)} />
          <ToggleRow name="Vibração discreta" desc="Sem som; um toque curto por notificação" on={discreet} onChange={() => setDiscreet(!discreet)} />
        </SetGroup>
      </ScrollView>
    </Screen>
  );
}
