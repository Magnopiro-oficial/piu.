import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useT } from '../../i18n';
import { looksSeparated, type ScannedNet } from '../../lib/pointCore';
import { errCode } from '../../lib/pointWifi';
import { usePoint } from '../../state/point';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { NetworkView } from '../../ui/point/views';

/** P3: rede atual primeiro; redes por perto; "criar a rede neste celular" (hotspot local). */
export default function PointNetwork() {
  const t = useT();
  const p = usePoint();
  const cur = p.current;
  const [selected, setSelected] = useState<'current' | 'hotspot' | null>(p.draft.network?.kind === 'hotspot' ? 'hotspot' : cur.connected ? 'current' : null);
  const [separated, setSeparated] = useState(p.draft.network?.kind === 'wifi' ? p.draft.network.separated : looksSeparated(cur.ssid));
  const [busy, setBusy] = useState(false);
  const [hsError, setHsError] = useState<string | null>(null);

  useEffect(() => { void p.refreshNearby(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!p.draft.network && cur.ssid) setSeparated(looksSeparated(cur.ssid)); }, [cur.ssid]); // eslint-disable-line react-hooks/exhaustive-deps

  const note = !p.support.scan ? t('point.net.scanUnavailable')
    : p.nearbyError === 'permission' ? t('point.net.scanDenied')
    : p.nearby.length ? t('point.net.nearbyHint') : t('point.net.scanNone');

  const openWifiSettings = (_n: ScannedNet) => {
    if (Platform.OS === 'android') void Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => Linking.openSettings().catch(() => {}));
  };

  return (
    <Screen>
      <BackHeader title={t('point.net.header')} />
      <NetworkView
        current={{ connected: cur.connected, ssid: cur.ssid }}
        selected={selected}
        separated={separated}
        onSeparated={setSeparated}
        onPickCurrent={() => setSelected('current')}
        nearby={p.nearby}
        nearbyNote={note}
        onNearby={openWifiSettings}
        hotspot={{ on: !!p.hotspot, ssid: p.hotspot?.ssid ?? null, busy, error: hsError, available: p.support.hotspot }}
        onHotspot={async () => {
          if (p.hotspot) { setSelected('hotspot'); return; }
          setBusy(true); setHsError(null);
          try { await p.startHotspot(); setSelected('hotspot'); }
          catch (e) {
            const code = errCode(e);
            setHsError(t(code === 'permission' ? 'point.hotspot.permission' : code === 'busy' ? 'point.hotspot.busy' : code === 'unsupported' ? 'point.hotspot.unsupported' : code === 'unavailable' ? 'point.hotspot.unavailable' : 'point.hotspot.failed'));
          } finally { setBusy(false); }
        }}
        onTest={() => {
          if (selected === 'current') p.useCurrentWifi({ ssid: cur.ssid, separated });
          else if (selected === 'hotspot' && p.hotspot) p.setDraft({ network: { kind: 'hotspot', ssid: p.hotspot.ssid, security: p.hotspot.passphrase ? 'WPA' : 'nopass', password: p.hotspot.passphrase, separated: true } });
          router.push('/point/test');
        }}
      />
    </Screen>
  );
}
