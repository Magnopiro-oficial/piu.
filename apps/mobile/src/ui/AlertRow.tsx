import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { type AlertView, categoryOf } from '../messaging/communityAlerts';
import { fmtDate, useT } from '../i18n';
import { alertCategoryName, alertSeverityName, alertStatusName } from '../i18n/alerts';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { T } from './T';

const until = (sec: number) => fmtDate(sec * 1000, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Um alerta da comunidade numa lista (Notificações, Alertas da comunidade). Toque abre o alerta. */
export function AlertRow({ a, showCommunity }: { a: AlertView; showCommunity?: boolean }) {
  const { c } = useTheme();
  const t = useT();
  const cat = categoryOf(a.cat);
  const dim = !a.active || a.status === 'contested';
  const meta = [alertSeverityName(a.sev, t), alertStatusName(a.status, t), `${a.confirms}✓ ${a.denies}✗`, showCommunity ? a.communityName : '', a.active ? t('alertRow.until', { when: until(a.until) }) : ''].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => router.push({ pathname: '/alert', params: { id: a.id } })} accessibilityRole="button"
      accessibilityLabel={`${a.title}. ${alertSeverityName(a.sev, t)}, ${alertStatusName(a.status, t)}, ${t('alert.confirms', { count: a.confirms })} · ${t('alert.denies', { count: a.denies })}.${a.area ? ` ${a.area}.` : ''}`}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, backgroundColor: pressed ? c.bg3 : c.bg, opacity: dim ? 0.6 : 1 })}>
      <Icon name={cat.icon as IconName} size={22} fill={a.sev === 'grave' && !dim} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={14.5} w={600} numberOfLines={2}>{a.title}</T>
        <T size={12.5} lh={1.35} color={c.ink2} numberOfLines={1}>{a.area || alertCategoryName(cat.id, t)}</T>
        <T size={11.5} mono color={c.ink2} numberOfLines={2}>{meta}</T>
      </View>
      <Icon name="chevron_right" size={20} color={c.ink3} />
    </Pressable>
  );
}
