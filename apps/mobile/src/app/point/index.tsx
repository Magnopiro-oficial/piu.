import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useT } from '../../i18n';
import { useSettings } from '../../state/settings';
import { usePoint } from '../../state/point';
import { useLanTransport } from '../../state/transport';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeProvider';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { EndCard, IntroView, PanelView } from '../../ui/point/views';

/** Ponto Piu: P2 (início) sem ponto; P7 (painel, P7a–c estados, P7d encerrar) com ponto. */
export default function PointHome() {
  const t = useT();
  const { c } = useTheme();
  const p = usePoint();
  const lan = useLanTransport();
  const { bat } = useSettings();
  const { showToast } = useStore();
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const cfg = p.config;

  if (!cfg) {
    return (
      <Screen>
        <BackHeader title={t('point.title')} />
        <IntroView available={lan.available} onStart={() => router.push('/point/network')} onLater={() => router.back()} />
      </Screen>
    );
  }

  const net = cfg.network.kind === 'hotspot' ? cfg.network.ssid ?? t('point.panel.hotspotNet') : cfg.network.ssid ?? t('point.net.unknownName');
  return (
    <Screen>
      <BackHeader title={cfg.name} />
      <PanelView
        d={{
          name: cfg.name, level: cfg.level, net, paused: cfg.paused, health: p.health ?? 'ok',
          peersToday: p.stats.peersToday, delivered: p.stats.delivered, stored: p.stats.stored, relayed: p.stats.relayed,
          storedBytes: p.stats.storedBytes, spaceBytes: cfg.spaceMb * 1024 * 1024, dataToday: p.stats.dataToday, dataCap: bat.traffic * 1024 * 1024,
          pageUrl: p.pageUrl, pageError: !!p.pageError,
        }}
        onQr={() => router.push('/point/qr')}
        onLevel={() => router.push({ pathname: '/point/level', params: { edit: '1' } })}
        onPause={() => { void p.pause(); }}
        onResume={() => { void p.resume().catch(() => {}); }}
        onEnd={() => setEnding(true)}
        onRetest={() => { p.useCurrentWifi({ ssid: cfg.network.ssid, separated: cfg.network.separated }); router.push('/point/test'); }}
      />
      {ending ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setEnding(false)} statusBarTranslucent>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }} onPress={() => setEnding(false)} accessibilityRole="button" accessibilityLabel={t('common.cancel')} />
          <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
            <EndCard name={cfg.name} stored={p.stats.stored} busy={busy} onCancel={() => setEnding(false)} onEnd={async () => {
              setBusy(true);
              try {
                const n = await p.end();
                setEnding(false);
                showToast({ kind: 'network', icon: 'delete_forever', title: t('point.panel.ended', { count: n }), body: '' });
                router.back();
              } finally { setBusy(false); }
            }} />
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}
