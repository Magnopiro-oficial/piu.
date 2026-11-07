/**
 * SÓ DESENVOLVIMENTO (importado por src/app/__dev/pontos.tsx atrás de `__DEV__`; fora do build de produção).
 * Cada id do Piu 13 (P1…P9) renderiza a MESMA peça que a rota usa (src/ui/point/views.tsx) com DADOS DE
 * EXEMPLO pelas mesmas props. Os resultados do teste (P4a–c) passam pelo caminho real:
 * `classifyLanCheck` → `pointCheckView`. `/__dev/pontos` lista; `/__dev/pontos?id=P4a` mostra um só (390×844).
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { createElement, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { pointCheckView, pointWifiQr, type PointCheckView } from '../lib/pointCore';
import { pointPageHtml } from '../lib/pointPage';
import { classifyLanCheck, type LanCheckInputs } from '../transport/lan/lanCheck';
import { useTheme } from '../theme/ThemeProvider';
import { BackHeader, SectionLabel, Toggle } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { T } from '../ui/T';
import { ListBox, NavRow } from '../ui/point/parts';
import {
  ActivateView, CardFrame, EndCard, HereBanner, IntroView, LanRowView, LeftBanner, LevelView, NetworkView, NotifPreview, PanelView, PointsRow, PosterView, QrView, ResultCard,
  TestView, VisitorSheetBody, type LanRowState, type PanelData,
} from '../ui/point/views';

const noop = () => {};
const QR = pointWifiQr({ ssid: 'Casa-Visitantes', security: 'WPA', password: 'exemplo123' });
const base: LanCheckInputs = {
  wifi: { connected: true, internet: true, ip: '192.168.10.20', prefix: 24, gateway: '192.168.10.1' }, lanRunning: true,
  seen: { broadcast: 2, mdns: 1, scan: 0, links: 0 }, gatewayAdmin: ['timeout', 'timeout'], otherLans: {}, knownPeer: null,
};
const views: Record<'green' | 'yellow' | 'red', PointCheckView> = {
  green: pointCheckView(classifyLanCheck(base), { separated: true, hotspot: false }),
  yellow: pointCheckView(classifyLanCheck({ ...base, seen: { broadcast: 0, mdns: 0, scan: 0, links: 0 }, gatewayAdmin: ['open'], knownPeer: { probe: 'timeout', discovered: false } }), { separated: true, hotspot: false }),
  red: pointCheckView(classifyLanCheck({ ...base, otherLans: { '192.168.1.1': 'open' } }), { separated: true, hotspot: false }),
};
const panel: PanelData = {
  name: 'Piu · Padaria do Zé', level: 'guardian', net: 'Casa-Visitantes', paused: false, health: 'ok',
  peersToday: 23, delivered: 96, stored: 412, relayed: 1208, storedBytes: 0.7 * 1024 ** 3, spaceBytes: 2 * 1024 ** 3, dataToday: 48 * 1024 ** 2, dataCap: 200 * 1024 ** 2,
  pageUrl: null, pageError: false,
};

function Phone({ title, children }: { title?: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 390, height: 844, backgroundColor: c.bg, overflow: 'hidden' }}>
      {title !== undefined ? <BackHeader title={title} /> : null}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <View style={{ width: 390, padding: 5 }}><CardFrame pad={18}>{children}</CardFrame></View>;
}

const lanStates: Record<string, LanRowState> = {
  P1a: { kind: 'noWifi' }, P1b: { kind: 'low', net: 'Casa-5G', peers: 4 }, P1c: { kind: 'isolated' },
};

function Rede() {
  const { c } = useTheme();
  const row = (icon: 'bluetooth' | 'wifi_tethering', name: string, sub: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderTopWidth: icon === 'bluetooth' ? 0 : 1, borderTopColor: c.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} w={300} /></View>
      <View style={{ flex: 1, gap: 2 }}><T size={15} w={550}>{name}</T><T size={12.5} color={c.ink2}>{sub}</T></View>
      <Toggle on onChange={noop} label={name} />
    </View>
  );
  return (
    <ScrollView>
      <SectionLabel>Transportes</SectionLabel>
      <View style={{ marginHorizontal: 20, borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
        {row('bluetooth', 'Bluetooth LE', 'Descoberta e texto curto · 6 vizinhos')}
        {row('wifi_tethering', 'Wi-Fi Direct', 'Aparelho a aparelho, sem roteador')}
        <LanRowView name="Wi-Fi local" state={{ kind: 'on', net: 'Casa-5G', peers: 4 }} on onToggle={noop} onWhy={noop} />
      </View>
      <SectionLabel>Pontos Piu</SectionLabel>
      <View style={{ marginHorizontal: 20 }}><PointsRow point={null} onPress={noop} /></View>
    </ScrollView>
  );
}

function render(id: string): ReactNode {
  const { c } = useTheme(); // eslint-disable-line react-hooks/rules-of-hooks
  switch (id) {
    case 'P1': return <Phone title="Rede"><Rede /></Phone>;
    case 'P1a': case 'P1b': case 'P1c':
      return <View style={{ width: 390, padding: 5 }}><View style={{ borderRadius: 24, backgroundColor: c.bg2, overflow: 'hidden' }}><LanRowView first name="Wi-Fi local" state={lanStates[id]!} on onToggle={noop} onWhy={noop} /></View></View>;
    case 'P2': return <Phone title="Ponto Piu"><IntroView available onStart={noop} onLater={noop} /></Phone>;
    case 'P3': return (
      <Phone title="Escolher a rede">
        <NetworkView current={{ connected: true, ssid: 'Casa-5G' }} selected="current" separated={false} onSeparated={noop} onPickCurrent={noop}
          nearby={[{ ssid: 'Casa-Visitantes', level: -50, secure: true }, { ssid: 'Padaria do Zé', level: -72, secure: false }]} nearbyNote="Para usar outra rede, conecte o celular a ela nas configurações do Wi-Fi e volte aqui."
          onNearby={noop} hotspot={{ on: false, ssid: null, busy: false, error: null, available: true }} onHotspot={noop} onTest={noop} />
      </Phone>
    );
    case 'P4': return <Phone title="Testando"><TestView net="Casa-5G" running view={null} error={null} hotspot={false} onContinue={noop} onRetry={noop} onAltRouter={noop} onAltHotspot={noop} freezeAt={2} /></Phone>;
    case 'P4done': return <Phone title="Testando"><TestView net="Casa-Visitantes" running={false} view={views.green} error={null} hotspot={false} onContinue={noop} onRetry={noop} onAltRouter={noop} onAltHotspot={noop} /></Phone>;
    case 'P4a': return <View style={{ width: 390, padding: 5 }}><ResultCard view={views.green} hotspot={false} onContinue={noop} onRetry={noop} onAltRouter={noop} onAltHotspot={noop} /></View>;
    case 'P4b': return <View style={{ width: 390, padding: 5 }}><ResultCard view={views.yellow} hotspot={false} onContinue={noop} onRetry={noop} onAltRouter={noop} onAltHotspot={noop} /></View>;
    case 'P4c': return <View style={{ width: 390, padding: 5 }}><ResultCard view={views.red} hotspot={false} onContinue={noop} onRetry={noop} onAltRouter={noop} onAltHotspot={noop} /></View>;
    case 'P5': return <Phone title="Nível"><LevelView level="guardian" spaceMb={2048} days={14} internet onLevel={noop} onSpace={noop} onDays={noop} onContinue={noop} /></Phone>;
    case 'P6o': return (
      <Phone title="Ativar">
        <ActivateView net="Casa-Visitantes" level="guardian" spaceMb={2048} days={14} gateway={false} name="Padaria do Zé" onName={noop} namePlaceholder="Padaria do Zé"
          qr={{ hotspot: false, ssid: 'Casa-Visitantes', onSsid: noop, open: false, onOpen: noop, password: '', onPassword: noop, passError: false }} onActivate={noop} busy={false} error={null} />
      </Phone>
    );
    case 'P6': return <Phone title="Ponto ativo"><QrView name="Piu · Padaria do Zé" ssid="Casa-Visitantes" qr={QR} sharing={false} onShare={noop} onPoster={noop} onPanel={noop} /></Phone>;
    case 'P6c': return <Phone title="Cartaz"><PosterView name="Piu · Padaria do Zé" qr={QR} id="0123456789abcdef" footerUrl="http://192.168.10.20:8766/" busy={false} error={null} onPrint={noop} /></Phone>;
    case 'P7': return <Phone title="Piu · Padaria do Zé"><PanelView d={panel} onQr={noop} onLevel={noop} onPause={noop} onResume={noop} onEnd={noop} onRetest={noop} /></Phone>;
    case 'P7a': return <Phone title="Piu · Padaria do Zé"><PanelView d={{ ...panel, paused: true, health: 'paused' }} onQr={noop} onLevel={noop} onPause={noop} onResume={noop} onEnd={noop} onRetest={noop} /></Phone>;
    case 'P7b': return <Phone title="Piu · Padaria do Zé"><PanelView d={{ ...panel, health: 'netDown' }} onQr={noop} onLevel={noop} onPause={noop} onResume={noop} onEnd={noop} onRetest={noop} /></Phone>;
    case 'P7c': return <Phone title="Piu · Padaria do Zé"><PanelView d={{ ...panel, health: 'isolating' }} onQr={noop} onLevel={noop} onPause={noop} onResume={noop} onEnd={noop} onRetest={noop} /></Phone>;
    case 'P7d': return (
      <Phone>
        <View style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'center', paddingHorizontal: 20 }}>
          <EndCard name="Piu · Padaria do Zé" stored={412} onCancel={noop} onEnd={noop} />
        </View>
      </Phone>
    );
    case 'P8': return (
      <Phone>
        <View style={{ flex: 1, backgroundColor: c.scrim }}>
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 300, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: c.bg, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}>
            <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.bg3 }} />
            <VisitorSheetBody name="Piu · Padaria do Zé" ssid="Casa-Visitantes" joining={false} error={null} onJoin={noop} onLater={noop} />
          </View>
        </View>
      </Phone>
    );
    case 'P8n': return <Card><NotifPreview name="Piu · Padaria do Zé" /></Card>;
    case 'P8a': return <Card><HereBanner name="Piu · Padaria do Zé" peers={7} delivered={3} onPress={noop} /></Card>;
    case 'P8b': return <Card><LeftBanner ble onClose={noop} /></Card>;
    case 'P9': {
      const html = pointPageHtml({ pointName: 'Piu · Padaria do Zé', fileName: 'Piu-0.5.0.apk', size: 38 * 1024 * 1024, integrity: { apkSha256: '9f2c41ab7e03d8c155f02b9e8a17c3d406e8b2f14c907d3ae6150b8f92c7aa31', certSha256: ['595bdc6a2d574fec59f0f781eb9d8d479a84f4907d70405f83b4b1e578b7ff31'] } });
      return <Phone>{Platform.OS === 'web' ? createElement('iframe', { srcDoc: html, title: 'P9', style: { width: 390, height: 844, border: 0 } }) : <T>P9: página servida pelo celular (abra no navegador de outro aparelho).</T>}</Phone>;
    }
  }
  return <T>?</T>;
}

export const IDS = ['P1', 'P1a', 'P1b', 'P1c', 'P2', 'P3', 'P4', 'P4done', 'P4a', 'P4b', 'P4c', 'P5', 'P6o', 'P6', 'P6c', 'P7', 'P7a', 'P7b', 'P7c', 'P7d', 'P8', 'P8n', 'P8a', 'P8b', 'P9'];

export default function PontosGallery() {
  const { c } = useTheme();
  const raw = useLocalSearchParams<{ id?: string | string[] }>().id;
  const id = Array.isArray(raw) ? raw.join(',') : raw;
  // `?id=P1a,P1b,P1c`: várias peças pequenas empilhadas, com o id em cima de cada uma.
  if (id && id.includes(',')) return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
      {id.split(',').map(x => <View key={x} style={{ gap: 4 }}><T size={11} mono color={c.ink2} style={{ paddingHorizontal: 8 }}>{x}</T>{render(x)}</View>)}
    </ScrollView>
  );
  if (id) return <View testID={`gallery-${id}`} style={{ flex: 1, backgroundColor: c.bg }}>{render(id)}</View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
      <T size={12} mono color={c.ink2}>DEV · Piu 13 Pontos Piu · dados de exemplo</T>
      <ListBox>
        {IDS.map((x, i) => <NavRow key={x} first={!i} icon="location_on" title={x} onPress={() => router.push(`/__dev/pontos?id=${x}` as Href)} />)}
      </ListBox>
      <Pressable onPress={() => router.back()}><T>←</T></Pressable>
    </ScrollView>
  );
}
