import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useT } from '../../i18n';
import { limitText, officialNote } from '../../i18n/alerts';
import { useMessaging } from '../../state/messaging';
import { useTheme } from '../../theme/ThemeProvider';
import { AlertRow } from '../../ui/AlertRow';
import { Button } from '../../ui/Button';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Alertas de uma comunidade (`id`: id do grupo da comunidade): os vigentes primeiro e o histórico
 * das últimas 24 h, e "Publicar alerta" para qualquer membro.
 */
export default function CommunityAlerts() {
  const { c } = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { alerts, alertEpoch, groupOps } = useMessaging();
  void alertEpoch;
  const isMember = !!id && !!groupOps?.isMember(id);
  const list = id && alerts ? alerts.list(id) : [];
  const active = list.filter(a => a.active), past = list.filter(a => !a.active);
  const limit = id && alerts && isMember ? limitText(alerts.limit(id), t) : null;
  return (
    <Screen>
      <BackHeader title={t('notif.type.alert')} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}>
        <View style={{ padding: 14, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, gap: 4 }}>
          <T size={13.5} w={600}>{officialNote(t)}</T>
          <T size={12.5} lh={1.4} color={c.ink2}>{t('alerts.rules')}</T>
        </View>
        {!isMember ? (
          <T size={14} color={c.ink2}>{t('alerts.notMember')}</T>
        ) : (
          <>
            <Button label={t('alerts.publish')} height={48} fontSize={15} disabled={!!limit} onPress={() => router.push({ pathname: '/alerts/new', params: { community: id } })} />
            {!!limit && <T size={12.5} lh={1.4} color={c.ink2} accessibilityLiveRegion="polite">{limit}</T>}
            <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 8, paddingHorizontal: 4 }}>{t('alerts.active')}</T>
            <View style={{ borderRadius: 18, backgroundColor: c.bg2, padding: 6, gap: 4 }}>
              {active.length ? active.map(a => <AlertRow key={a.id} a={a} />) : <T size={13} color={c.ink2} style={{ padding: 10 }}>{t('alerts.noneActive')}</T>}
            </View>
            {past.length > 0 && (
              <>
                <T size={11.5} w={500} mono ls={0.05} color={c.ink2} style={{ paddingTop: 8, paddingHorizontal: 4 }}>{t('alerts.past')}</T>
                <View style={{ borderRadius: 18, backgroundColor: c.bg2, padding: 6, gap: 4 }}>
                  {past.map(a => <AlertRow key={a.id} a={a} />)}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
