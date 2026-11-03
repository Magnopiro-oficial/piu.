import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { NOTIF_TYPES, PREVIEW_HINT } from '../data/settings';
import { refreshAlerts, setAlertRegion, useOfficialAlerts } from '../lib/alerts';
import { alertTitle, areaLine, publisherOf, SEVERITY_PT, UFS, visibleAlerts } from '../lib/alertsCore';
import { fontFamily } from '../theme/fonts';
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

/**
 * Alertas oficiais (CAP) que o Piu Node pareado retransmite: região escolhida pela pessoa (UF e,
 * se quiser, um trecho da área), lista dos vigentes e, sem nó ou sem nada vigente, o motivo.
 */
function OfficialAlerts() {
  const { c } = useTheme();
  const { alerts, region, nodes, lastAt, loading, error } = useOfficialAlerts();
  const [area, setArea] = useState(region.area);
  useEffect(() => { void refreshAlerts().catch(() => {}); }, []);
  const list = visibleAlerts(alerts, region, Date.now());
  const where = region.uf ? UFS.find(u => u[0] === region.uf)![2] : 'todo o Brasil';
  const empty = !lastAt && loading ? 'Buscando no seu Piu Node…'
    : !nodes.paired ? 'Nenhum Piu Node pareado com este celular. Os alertas oficiais chegam pelo seu nó, que lê o feed público em CAP (INMET, por padrão). Pareie em Provider → Adicionar equipamento.'
      : !nodes.connected ? 'O celular ainda não está conectado ao seu Piu Node. Abra o equipamento em Provider e digite o código de 8 dígitos dele.'
        : !nodes.enabled ? 'O seu Piu Node está com os alertas oficiais desligados (PIU_ALERT_FEEDS vazio).'
          : `Nenhum alerta oficial vigente para ${region.area.trim() ? `“${region.area.trim()}” em ` : ''}${where}.`;
  return (
    <View>
      <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 22, paddingHorizontal: 24, paddingBottom: 8 }}>ALERTAS OFICIAIS</T>
      <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
        <T size={12.5} lh={1.4} color={c.ink2}>Alertas públicos em CAP (INMET e outros feeds configurados no nó), retransmitidos pelo seu Piu Node. Não são assinados pelo órgão. Severos e extremos da sua região viram aviso no aparelho.</T>
        <T size={13} w={600}>Região</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {([[null, 'Brasil'], ...UFS.map(([uf]) => [uf, uf])] as [typeof region.uf, string][]).map(([uf, label]) => {
            const on = region.uf === uf;
            return (
              <Pressable key={label} onPress={() => setAlertRegion({ ...region, uf })} accessibilityRole="radio" accessibilityState={{ checked: on }}
                accessibilityLabel={uf ? UFS.find(u => u[0] === uf)![2] : 'Todo o Brasil'}
                style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 99, backgroundColor: on ? c.ink : c.bg, borderWidth: 1, borderColor: on ? c.ink : c.line2 }}>
                <T size={13} w={600} color={on ? c.invink : c.ink}>{label}</T>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextInput value={area} onChangeText={setArea} onEndEditing={() => setAlertRegion({ ...region, area })} onBlur={() => setAlertRegion({ ...region, area })}
          placeholder="Cidade ou região (opcional)" placeholderTextColor={c.ink3} autoCorrect={false} accessibilityLabel="Cidade ou região, opcional"
          style={{ height: 42, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.bg, color: c.ink, fontSize: 14, fontFamily: fontFamily(400) }} />
        {list.length ? list.map(a => (
          <Pressable key={a.id} onPress={() => router.push({ pathname: '/alert', params: { id: a.id } })} accessibilityRole="button"
            accessibilityLabel={`${alertTitle(a)}, severidade ${SEVERITY_PT[a.info.severity]}. ${areaLine(a)}`}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, backgroundColor: pressed ? c.bg3 : c.bg })}>
            <Icon name="warning" size={22} fill={a.info.severity === 'Extreme' || a.info.severity === 'Severe'} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <T size={14.5} w={600} numberOfLines={2}>{alertTitle(a)}</T>
              <T size={12.5} lh={1.35} color={c.ink2} numberOfLines={2}>{areaLine(a) || a.info.event}</T>
              <T size={11.5} mono color={c.ink2}>{`${SEVERITY_PT[a.info.severity]} · ${publisherOf(a)} (CAP) · via ${a.via}`}</T>
            </View>
            <Icon name="chevron_right" size={20} color={c.ink3} />
          </Pressable>
        )) : (
          <View accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2 }}>
            <T size={12.5} lh={1.4} color={c.ink2}>{empty}</T>
          </View>
        )}
        {!!error && <T size={12} lh={1.4} color={c.ink2}>{`Última busca com erro: ${error}`}</T>}
        {nodes.connected > 0 && (
          <Button label={loading ? 'Buscando…' : 'Atualizar'} variant="outline" height={40} fontSize={13.5} disabled={loading} onPress={() => { void refreshAlerts().catch(() => {}); }} />
        )}
      </View>
    </View>
  );
}

/** Notificações sem servidor: pré-visualização, tipos de aviso, alertas oficiais e silêncio. */
export default function Notifications() {
  const { c } = useTheme();
  const { preview, setPreview, notifs, toggleNotif, quiet, setQuiet, discreet, setDiscreet } = useSettings();
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
          <LockedRow icon="warning" name="Alertas oficiais" desc="Severos e extremos da sua região, retransmitidos pelo seu Piu Node" />
        </SetGroup>

        <OfficialAlerts />

        <SetGroup title="SILÊNCIO">
          <ToggleRow name="Modo noturno" desc="22h às 7h · alertas críticos ainda tocam" on={quiet} onChange={() => setQuiet(!quiet)} />
          <ToggleRow name="Vibração discreta" desc="Sem som; um toque curto por notificação" on={discreet} onChange={() => setDiscreet(!discreet)} />
        </SetGroup>
      </ScrollView>
    </Screen>
  );
}
