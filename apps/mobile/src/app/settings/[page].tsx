import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, View } from 'react-native';
import { customLabel, DAY_LETTER, DAY_MIN, DAY_NAME, hm, HOURS_STEP, type HoursWindow, NIGHT_WINDOW } from '../../messaging/hours';
import { useT, type Key } from '../../i18n';
import { confirmDevice } from '../../lib/deviceAuth';
import { fmtBytes } from '../../lib/networkCore';
import { hasScreenSecurity } from '../../lib/screenSecurity';
import { appVersion, canCheckUpdates, openRelease, runUpdateCheck, useUpdateCheck } from '../../lib/update';
import { outcomeText } from '../../lib/updateCore';
import { clearReceivedCache, receivedCacheBytes, useStorageUsage } from '../../lib/storageUsage';
import { previewBytes } from '../../lib/storageCore';
import { useStats } from '../../state/messaging';
import { useResetApp } from '../../state/reset';
import { useBattery } from '../../lib/battery';
import { useNetwork } from '../../state/network';
import { useSettings } from '../../state/settings';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Screen } from '../../ui/Screen';
import { ActionRow, FootNote, LockedRow, SegRow, SetGroup, ToggleRow } from '../../ui/Settings';
import { T } from '../../ui/T';

type Page = 'privacy' | 'storage' | 'battery' | 'about';
const TITLES: Record<Page, Key> = { privacy: 'profile.row.privacy', storage: 'profile.row.storage', battery: 'profile.row.battery', about: 'update.title' };

/** Ajustes: Privacidade, Armazenamento, Bateria e limites (tudo local) e Versão e atualizações. */
export default function SettingsPage() {
  const { page: raw } = useLocalSearchParams<{ page: string }>();
  const page: Page = raw === 'storage' || raw === 'battery' || raw === 'about' ? raw : 'privacy';
  const t = useT();
  return (
    <Screen>
      <BackHeader title={t(TITLES[page])} />
      <ScrollView>
        {page === 'privacy' ? <Privacy /> : page === 'storage' ? <Storage /> : page === 'about' ? <About /> : <Battery />}
      </ScrollView>
    </Screen>
  );
}

/** O que "Quem pode me encontrar" controla de fato (identidade pública; não há busca por nome). */
const FIND_DESC: Record<'all' | 'contacts' | 'none', Key> = { all: 'privacy.find.all.desc', contacts: 'privacy.find.contacts.desc', none: 'privacy.find.none.desc' };

function Privacy() {
  const t = useT();
  const { priv, setPriv, screenSecurity, setScreenSecurity } = useSettings();
  const { showToast, blocked } = useStore();
  const flip =(k: 'read' | 'typing' | 'delay' | 'pad' | 'noRoutes' | 'lock') => () => setPriv({ [k]: !priv[k] });
  return (
    <>
      <SetGroup title={t('privacy.visibility')}>
        <SegRow name={t('privacy.find')} desc={t(FIND_DESC[priv.find])} value={priv.find} onChange={find => setPriv({ find })} options={[['all', t('privacy.find.all')], ['contacts', t('privacy.find.contacts')], ['none', t('privacy.find.none')]]} />
        <SegRow name={t('privacy.nearStart')} value={priv.near} onChange={near => setPriv({ near })} options={[['off', t('privacy.nearStart.off')], ['1h', t('privacy.nearStart.1h')]]} />
      </SetGroup>
      <SetGroup title={t('privacy.chats')}>
        <ToggleRow name={t('privacy.readReceipts')} on={priv.read} onChange={flip('read')} />
        <ToggleRow name={t('privacy.typing')} on={priv.typing} onChange={flip('typing')} />
        <SegRow name={t('privacy.temp')} desc={t('privacy.temp.desc')} value={priv.temp} onChange={temp => setPriv({ temp })} options={[['off', t('common.off')], ['7d', t('privacy.temp.7d')], ['24h', t('privacy.temp.24h')]]} />
      </SetGroup>
      <SetGroup title={t('privacy.metadata')}>
        <ToggleRow name={t('privacy.delay')} desc={t('privacy.delay.desc')} on={priv.delay} onChange={flip('delay')} />
        <ToggleRow name={t('privacy.pad')} desc={t('privacy.pad.desc')} on={priv.pad} onChange={flip('pad')} />
        <ToggleRow name={t('privacy.noRoutes')} desc={t('privacy.noRoutes.desc')} on={priv.noRoutes} onChange={flip('noRoutes')} />
        <ToggleRow name={t('privacy.shareWallet')} desc={t('privacy.shareWallet.desc')} on={priv.shareWallet !== false} onChange={() => setPriv({ shareWallet: priv.shareWallet === false })} />
      </SetGroup>
      <SetGroup title={t('privacy.lock')}>
        <ToggleRow name={t('privacy.biometric')} disabled={Platform.OS === 'web'}
          desc={Platform.OS === 'web' ? t('privacy.biometric.web') : t('privacy.biometric.desc')}
          on={priv.lock} onChange={async () => {
            // Ligar ou desligar exige provar que é o dono do aparelho.
            const r = await confirmDevice(priv.lock ? t('privacy.biometric.off') : t('privacy.biometric.on'));
            if (r === 'ok') setPriv({ lock: !priv.lock });
            else if (r === 'unavailable') showToast({ icon: 'lock', title: t('privacy.noDeviceLock'), body: t('privacy.noDeviceLock.body') });
          }} />
        {hasScreenSecurity(Platform.OS) && <ToggleRow name={t('privacy.screen')} desc={t('privacy.screen.desc')} on={screenSecurity} onChange={() => setScreenSecurity(!screenSecurity)} />}
        <ActionRow name={t('privacy.blocked')} value={blocked.length ? String(blocked.length) : t('common.none')} onPress={() => router.push('/blocked')} />
      </SetGroup>
      <FootNote icon="info">{t('privacy.note')}</FootNote>
    </>
  );
}

function Storage() {
  const { c, reduceMotion } = useTheme();
  const t = useT();
  const { sto, setSto } = useSettings();
  const { storage, setStorage } = useNetwork();
  const { showToast, chats, purgeMediaPreviews } = useStore();
  const reset = useResetApp();
  const [del, setDel] = useState(false);
  const st = useStats(10_000);
  // Tamanhos que o mensageiro informa (terceiros e recibos ficam dentro do estado dele).
  const thirdPartyBytes = st?.metrics.thirdPartyBytes ?? 0;
  const creditsBytes = st ? JSON.stringify(st.credits.list).length + JSON.stringify(st.credits.lots).length : 0;
  const [use, refresh] = useStorageUsage({ thirdPartyBytes, creditsBytes });
  // Cache de mídia: arquivos recebidos na memória + prévias de fotos embutidas nas conversas.
  const [, setCleared] = useState(0);
  const cache = receivedCacheBytes() + previewBytes(chats);
  const parts = (use?.parts ?? []).filter(([l, n]) => n > 0 || l !== 'Ajustes e registros');
  const total = use?.total ?? 0;
  const OP = [1, 0.55, 0.3, 0.15, 0.08];
  const grow = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => { if (!reduceMotion) Animated.timing(grow, { toValue: 1, duration: 700, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }).start(); }, [reduceMotion, grow]);

  return (
    <>
      <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: c.bg2, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <T size={32} w={650} ls={-0.04}>{use ? fmtBytes(total) : '…'}</T>
          <T size={13.5} color={c.ink2}>{t('storage.onDevice')}</T>
        </View>
        <Animated.View accessibilityLabel={t('storage.byType')} style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, backgroundColor: total ? 'transparent' : c.bg3, width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}>
          {parts.map(([l, n], i) => (n > 0 ? <View key={l} style={{ flex: n, backgroundColor: c.ink, opacity: OP[i] }} /> : null))}
        </Animated.View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
          {parts.map(([l, n], i) => (
            <View key={l} style={{ width: '50%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingRight: 10 }}>
              <View style={{ width: 8, height: 8, marginTop: 4, borderRadius: 2, backgroundColor: c.ink, opacity: OP[i] }} />
              <T size={12.5} lh={1.3} color={c.ink2} style={{ flex: 1 }}>{l}</T>
              <T size={12.5} w={600}>{fmtBytes(n)}</T>
            </View>
          ))}
        </View>
        <T size={11} mono color={c.ink2}>{t('storage.measured')}</T>
      </View>
      <SetGroup title={t('storage.media')}>
        <SegRow name={t('storage.autoDownload')} value={sto.auto} onChange={auto => setSto({ auto })} options={[['wifi', t('storage.autoDownload.wifi')], ['always', t('common.always')], ['never', t('common.never')]]} />
        <SegRow name={t('storage.quality')} desc={t('storage.quality.desc')} value={sto.quality} onChange={quality => setSto({ quality })} options={[['eco', t('storage.quality.eco')], ['normal', t('storage.quality.normal')], ['orig', t('storage.quality.orig')]]} />
      </SetGroup>
      <SetGroup title={t('storage.thirdParty')}>
        <SegRow name={t('storage.maxSpace')} desc={t('storage.maxSpace.desc')} value={String(storage)} onChange={v => setStorage(Number(v) as 256 | 512 | 1024)} options={[['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB']]} />
        <SegRow name={t('storage.maxAge')} value={sto.retention} onChange={retention => setSto({ retention })} options={[['24', '24 h'], ['48', '48 h'], ['168', t('privacy.temp.7d')]]} />
      </SetGroup>
      <SetGroup title={t('storage.cleanup')}>
        <LockedRow name={t('storage.encrypted')} desc={t('storage.encrypted.desc')} />
        {/* Arquivos recebidos (memória) e prévias embutidas nas conversas (disco): o balão passa a dizer que a mídia foi apagada. */}
        <ActionRow name={t('storage.clearCache')} value={fmtBytes(cache)} onPress={() => {
          const freed = clearReceivedCache() + purgeMediaPreviews();
          setCleared(n => n + 1);
          // Mede de novo depois que as conversas forem regravadas (persist.ts grava em ~250 ms).
          setTimeout(refresh, 700);
          showToast(freed
            ? { icon: 'cleaning_services', title: t('storage.cacheCleared'), body: t('storage.cacheCleared.body', { size: fmtBytes(freed) }) }
            : { icon: 'cleaning_services', title: t('storage.nothingToClear'), body: t('storage.nothingToClear.body') });
        }} />
        <ActionRow name={t('profile.row.wipe')} strong onPress={() => setDel(true)} />
      </SetGroup>
      <FootNote icon="lock">{t('storage.note')}</FootNote>
      {del && (
        <Dialog icon="delete_forever" title={t('profile.wipe.title')} hold primary={t('profile.wipe.hold')} primaryIcon="touch_app"
          body={t('profile.wipe.body')}
          onClose={() => setDel(false)} onPrimary={() => { setDel(false); reset(); router.replace('/welcome'); }} />
      )}
    </>
  );
}

function Battery() {
  const { c } = useTheme();
  const t = useT();
  const { bat, setBat } = useSettings();
  const { battery, setBattery, chargingOnly, setChargingOnly } = useNetwork();
  // Bateria real do aparelho. O gasto como nó não é medido: o sistema não separa esse consumo.
  const { level, charging } = useBattery();
  const pct = level < 0 ? null : Math.round(level * 100);
  const DISC = { eco: t('battery.disc.every', { s: 60 }), normal: t('battery.disc.every', { s: 20 }), fast: t('battery.disc.every', { s: 5 }) };
  return (
    <>
      <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Icon name="battery_charging_80" size={34} w={300} color={c.invink} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={26} w={650} ls={-0.03} color={c.invink}>{pct == null ? '—' : `${pct}%`}</T>
          <T size={12.5} lh={1.35} color={c.invink} style={{ opacity: 0.75 }}>{`${pct == null ? t('battery.noReading') : charging ? t('battery.nowCharging') : t('battery.now')}. ${t('battery.notMeasured')}`}</T>
        </View>
      </View>
      <SetGroup title={t('battery.relay')}>
        <ToggleRow name={t('battery.bg')} desc={t('battery.bg.desc')} on={bat.bg} onChange={() => setBat({ bg: !bat.bg })} />
        <SegRow name={t('network.stopBelow')} value={String(battery)} onChange={v => setBattery(Number(v) as 20 | 30 | 50)} options={[['20', '20%'], ['30', '30%'], ['50', '50%']]} />
        <ToggleRow name={t('battery.chargingOnly')} on={chargingOnly} onChange={() => setChargingOnly(!chargingOnly)} />
      </SetGroup>
      <SetGroup title={t('battery.hoursTraffic')}>
        <SegRow name={t('battery.hours')} desc={bat.hours === 'custom' ? t('battery.hours.customDesc') : undefined} value={bat.hours}
          onChange={hours => setBat(hours === 'custom' ? { hours, custom: bat.custom ?? NIGHT_WINDOW } : { hours })}
          options={[['always', t('common.always')], ['night', '22h–7h'], ['custom', bat.custom ? customLabel(bat.custom) : t('battery.hours.custom')]]} />
        {bat.hours === 'custom' && bat.custom && <CustomHours w={bat.custom} onChange={custom => setBat({ hours: 'custom', custom })} />}
        <SegRow name={t('battery.traffic')} value={String(bat.traffic)} onChange={v => setBat({ traffic: Number(v) as 50 | 200 | 500 })} options={[['50', '50 MB'], ['200', '200 MB'], ['500', '500 MB']]} />
        <SegRow name={t('battery.bw')} value={bat.bw} onChange={bw => setBat({ bw })} options={[['1', '1 Mbps'], ['5', '5 Mbps'], ['max', t('battery.bw.max')]]} />
      </SetGroup>
      <SetGroup title={t('battery.discovery')}>
        <SegRow name={t('battery.disc')} desc={DISC[bat.disc]} value={bat.disc} onChange={disc => setBat({ disc })} options={[['eco', t('storage.quality.eco')], ['normal', t('storage.quality.normal')], ['fast', t('battery.disc.fast')]]} />
      </SetGroup>
      <FootNote icon="smartphone">{t('battery.note')}</FootNote>
    </>
  );
}

/**
 * Versão do Piu instalada e "Procurar atualização" (lib/update.ts). Sem internet ou com o GitHub fora, diz
 * isso; com versão nova, só abre a página da versão (não baixa nem instala nada sozinho).
 */
function About() {
  const { c } = useTheme();
  const t = useT();
  const { updateNotify, setUpdateNotify } = useSettings();
  const { outcome, checking } = useUpdateCheck();
  const version = appVersion();
  const status = outcome ? outcomeText(outcome, t) : null;
  const available = outcome?.state === 'available' ? outcome : null;
  return (
    <>
      <View accessible accessibilityLabel={`${t('profile.row.version')}: ${version || t('update.unknown')}. ${t('update.current')}`} style={{ marginHorizontal: 20, padding: 18, borderRadius: 22, backgroundColor: c.bg2, gap: 4 }}>
        <T size={13.5} color={c.ink2}>{t('profile.row.version')}</T>
        <T size={32} w={650} ls={-0.04} mono={!!version}>{version || t('update.unknown')}</T>
        <T size={12.5} color={c.ink2}>{t('update.current')}</T>
      </View>
      {canCheckUpdates && (
        <SetGroup title={t('update.title')}>
          <ActionRow icon="system_update_alt" name={checking ? t('update.checking') : t('update.check')} onPress={() => { if (!checking) void runUpdateCheck(); }} />
          {status && (
            <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16 }}>
              <Icon name={outcome?.state === 'latest' ? 'check_circle' : outcome?.state === 'available' ? 'system_update_alt' : outcome?.state === 'offline' ? 'cloud_off' : 'error'} size={21} w={300} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={15} w={550}>{status.title}</T>
                <T size={12.5} lh={1.35} color={c.ink2}>{status.body}</T>
              </View>
            </View>
          )}
          {available && <ActionRow icon="north_east" name={t('update.openPage')} strong onPress={() => { void openRelease(available.url); }} />}
          {Platform.OS === 'android' && <ToggleRow name={t('update.notify')} desc={t('update.notify.desc')} on={updateNotify} onChange={() => setUpdateNotify(!updateNotify)} />}
        </SetGroup>
      )}
      {canCheckUpdates && <FootNote icon="info">{t('update.note')}</FootNote>}
    </>
  );
}

/**
 * Faixa do horário "Personalizado": início e fim de 30 em 30 min (pode atravessar a meia-noite) e,
 * se quiser, os dias da semana em que a faixa começa. Início e fim nunca ficam iguais (faixa vazia).
 */
function CustomHours({ w, onChange }: { w: HoursWindow; onChange: (w: HoursWindow) => void }) {
  const { c } = useTheme();
  const t = useT();
  const step = (min: number, dir: 1 | -1, other: number) => {
    let next = (min + dir * HOURS_STEP + DAY_MIN) % DAY_MIN;
    if (next === other) next = (next + dir * HOURS_STEP + DAY_MIN) % DAY_MIN;
    return next;
  };
  const days = w.days ?? [0, 1, 2, 3, 4, 5, 6];
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
    if (!next.length) return; // ao menos um dia
    onChange({ start: w.start, end: w.end, ...(next.length < 7 ? { days: [...next].sort((a, b) => a - b) } : {}) });
  };
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
      <TimeStepper label={t('battery.hours.start')} value={w.start} set={dir => onChange({ ...w, start: step(w.start, dir, w.end) })} />
      <TimeStepper label={t('battery.hours.end')} value={w.end} set={dir => onChange({ ...w, end: step(w.end, dir, w.start) })} />
      <View style={{ gap: 8 }}>
        <T size={12.5} lh={1.4} color={c.ink2}>{w.start > w.end ? `${t('battery.hours.midnight')} ${t('battery.hours.days')}` : t('battery.hours.days')}</T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {DAY_LETTER.map((l, d) => {
            const on = days.includes(d);
            return (
              <Pressable key={d} onPress={() => toggleDay(d)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={DAY_NAME[d]}
                style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.ink : c.bg3 }}>
                <T size={13} w={600} color={on ? c.invink : c.ink}>{l}</T>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function TimeStepper({ label, value, set }: { label: string; value: number; set: (dir: 1 | -1) => void }) {
  const { c } = useTheme();
  const t = useT();
  const btn = { width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg3, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <T size={14} w={550} style={{ flex: 1 }}>{label}</T>
      <Pressable onPress={() => set(-1)} accessibilityRole="button" accessibilityLabel={`${label}: ${t('battery.hours.earlier')}`} style={btn}>
        <Icon name="remove" size={20} />
      </Pressable>
      <T size={17} w={650} mono style={{ width: 64, textAlign: 'center' }} accessibilityLiveRegion="polite">{hm(value)}</T>
      <Pressable onPress={() => set(1)} accessibilityRole="button" accessibilityLabel={`${label}: ${t('battery.hours.later')}`} style={btn}>
        <Icon name="add" size={20} />
      </Pressable>
    </View>
  );
}
