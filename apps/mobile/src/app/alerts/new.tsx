import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { ALERT_CATEGORIES, ALERT_DURATIONS, type AlertCategory, type AlertSeverity, AREA_MAX, DEFAULT_DURATION_SEC, draftIssue, SEVERITIES, TEXT_MAX, TITLE_MAX } from '../../messaging/communityAlerts';
import { useT } from '../../i18n';
import { alertCategoryName, alertSeverityName, draftIssueText, limitText, officialNote } from '../../i18n/alerts';
import { useMessaging } from '../../state/messaging';
import { useStore } from '../../state/store';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../../ui/Button';
import { BackHeader, SectionLabel, Segmented } from '../../ui/Controls';
import { Icon, type IconName } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/T';

/**
 * Publicar alerta na comunidade (`community`: id do grupo): categoria, gravidade, título, texto,
 * área (opcional) e validade. Vai cifrado no grupo da comunidade, com prioridade Alta.
 */
export default function NewAlert() {
  const { c } = useTheme();
  const t = useT();
  const { showToast } = useStore();
  const { community } = useLocalSearchParams<{ community: string }>();
  const { alerts, groupOps } = useMessaging();
  const [cat, setCat] = useState<AlertCategory | null>(null);
  const [sev, setSev] = useState<AlertSeverity | ''>('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [area, setArea] = useState('');
  const [dur, setDur] = useState(String(DEFAULT_DURATION_SEC));
  const input = { borderRadius: 14, backgroundColor: c.bg2, color: c.ink, paddingHorizontal: 14 };
  const problem = draftIssueText(draftIssue({ cat: cat ?? '', sev, title, text, area, dur: Number(dur) }), t);
  const limit = community && alerts ? limitText(alerts.limit(community), t) : null;
  const publish = () => {
    if (!alerts || !community || !cat || !sev) return;
    try {
      const v = alerts.publish(community, { cat, sev, title, text, area, durSec: Number(dur) });
      showToast({ icon: 'schedule_send', title: t('alerts.published'), body: t('alerts.published.body') });
      router.replace({ pathname: '/alert', params: { id: v.id } });
    } catch (e) { showToast({ icon: 'error', title: t('alerts.publishFail'), body: limitText((e as Error).message, t) ?? '' }); }
  };
  if (!community || !groupOps?.isMember(community)) return <Screen><BackHeader title={t('alerts.publish')} /><T size={15} color={c.ink2} align="center">{t('alerts.notMember')}</T></Screen>;
  return (
    <Screen>
      <BackHeader title={t('alerts.publish')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginHorizontal: 20, padding: 14, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line2, flexDirection: 'row', gap: 10 }}>
          <Icon name="info" size={18} />
          <T size={12.5} lh={1.4} color={c.ink2} style={{ flex: 1 }}>{`${officialNote(t)} ${t('alerts.new.note')}`}</T>
        </View>

        <SectionLabel>{t('alerts.new.category')}</SectionLabel>
        <View style={{ paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={t('alert.row.category')}>
          {ALERT_CATEGORIES.map(k => {
            const on = cat === k.id;
            return (
              <Pressable key={k.id} onPress={() => setCat(k.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={alertCategoryName(k.id, t)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 99, backgroundColor: on ? c.ink : c.bg2 }}>
                <Icon name={k.icon as IconName} size={18} color={on ? c.invink : c.ink} />
                <T size={13.5} w={600} color={on ? c.invink : c.ink}>{alertCategoryName(k.id, t)}</T>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>{t('alerts.new.severity')}</SectionLabel>
        <View style={{ paddingHorizontal: 20, gap: 6 }}>
          <Segmented<AlertSeverity | ''> label={t('alert.row.severity')} value={sev} onChange={setSev} options={SEVERITIES.map(s => [s.id, alertSeverityName(s.id, t)])} />
          <T size={12} lh={1.4} color={c.ink2}>{sev === 'grave' ? t('alerts.new.sev.grave') : sev === 'warn' ? t('alerts.new.sev.warn') : sev === 'info' ? t('alerts.new.sev.info') : t('alerts.new.sev.hint')}</T>
        </View>

        <SectionLabel>{t('alerts.new.what')}</SectionLabel>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <TextInput value={title} onChangeText={setTitle} placeholder={t('alerts.new.title')} placeholderTextColor={c.ink3} accessibilityLabel={t('alerts.new.title')} maxLength={TITLE_MAX}
            style={{ ...input, height: 52, fontSize: 16, fontFamily: fontFamily(600) }} />
          <TextInput value={text} onChangeText={setText} placeholder={t('alerts.new.details')} placeholderTextColor={c.ink3} accessibilityLabel={t('alerts.new.details.a11y')} maxLength={TEXT_MAX} multiline
            style={{ ...input, minHeight: 96, paddingTop: 12, paddingBottom: 12, fontSize: 15, fontFamily: fontFamily(400), textAlignVertical: 'top' }} />
          <TextInput value={area} onChangeText={setArea} placeholder={t('alerts.new.area')} placeholderTextColor={c.ink3} accessibilityLabel={t('alerts.new.area.a11y')} maxLength={AREA_MAX}
            style={{ ...input, height: 48, fontSize: 15, fontFamily: fontFamily(400) }} />
        </View>

        <SectionLabel>{t('alerts.new.validity')}</SectionLabel>
        <View style={{ paddingHorizontal: 20, gap: 6 }}>
          <Segmented label={t('alerts.new.validity.label')} value={dur} onChange={setDur} options={ALERT_DURATIONS.map(d => [String(d.sec), d.label])} />
          <T size={12} lh={1.4} color={c.ink2}>{t('alerts.new.validity.hint')}</T>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
          {!!(limit || (problem && (cat || sev || title))) && <T size={12.5} lh={1.4} color={c.ink2} accessibilityLiveRegion="polite">{limit ?? problem}</T>}
          <Button label={t('alerts.publish')} height={52} disabled={!!problem || !!limit} onPress={publish} />
        </View>
      </ScrollView>
    </Screen>
  );
}
