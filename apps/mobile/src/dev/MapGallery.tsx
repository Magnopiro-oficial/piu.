/**
 * SÓ DESENVOLVIMENTO (importado por src/app/__dev/map.tsx atrás de `__DEV__`; fora do build de produção).
 * Quadros 2-1 a 2-10 do Piu 18 "Mapa da rede" (direção Radar) com a MESMA peça do app (NetworkMapView)
 * e os 16 pontos de EXEMPLO do protótipo (com posição e rumo, que o protocolo ainda não tem).
 * `/__dev/map` lista; `/__dev/map?id=2-4` mostra um só; `?id=2-1,2-2` mostra vários.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { fmtDate } from '../i18n';
import type { MapPoint, PointKind } from '../lib/networkMap';
import { useTheme } from '../theme/ThemeProvider';
import type { Medium } from '../transport/types';
import { NetworkMapView, type MapViewProps } from '../ui/map/MapView';
import { ListBox, NavRow } from '../ui/point/parts';
import { T } from '../ui/T';

const noop = () => {};
const NOW = Date.now();
const AT_1406 = new Date(NOW).setHours(14, 6, 0, 0);
const CH: Record<string, Medium> = { bt: 'ble', wd: 'nearby', wl: 'lan', lp: 'piulora', lm: 'lora' };

// [id, nome, tipo, rumo°, distância m, canal, no alcance, quem alcança, visto há (min, offline)]
const RAW: [string, string, PointKind, number, number, keyof typeof CH, boolean, string | null, number][] = [
  ['marina', 'Marina', 'pessoa', 12, 40, 'bt', true, null, 12],
  ['ana', 'Ana Costa', 'pessoa', 18, 250, 'bt', true, null, 14],
  ['e07a', 'Galaxy · E07A', 'pessoa', 26, 195, 'wd', true, null, 12],
  ['padaria', 'piu.padaria', 'ponto', 60, 120, 'wl', true, null, 12],
  ['biblio', 'piu.biblio', 'wifi', 85, 305, 'wl', true, null, 15],
  ['galpao', 'piu.galpao', 'ponto', 190, 75, 'wl', false, 'padaria', 60],
  ['praca', 'piu.praca', 'gateway', 330, 228, 'wl', false, 'e07a', 60],
  ['torre', 'piu.torre-serra', 'super', 12, 4200, 'lp', true, null, 12],
  ['mercado', 'piu.mercado', 'super', 282, 1500, 'lp', true, null, 13],
  ['r77', 'piu.77c1', 'rnode', 332, 1100, 'lp', true, null, 12],
  ['r0b', 'piu.0b9e', 'rnode', 98, 2600, 'lp', true, null, 20],
  ['a4c1', 'Meshtastic !a4c1', 'mesh', 132, 1700, 'lm', true, null, 12],
  ['9d02', 'Meshtastic !9d02', 'mesh', 208, 3500, 'lm', true, null, 25],
  ['escola', 'piu.escola', 'gateway', 52, 7200, 'lp', false, 'torre', 120],
  ['pousada', 'piu.pousada', 'wifi', 355, 650, 'wl', false, 'r77', 60],
  ['77b0', 'Meshtastic !77b0', 'mesh', 186, 8600, 'lm', false, '9d02', 180],
];

const sample = (o: { noDir?: boolean; offline?: boolean; connected?: string; reach?: string[] } = {}): MapPoint[] => RAW.map(([id, name, kind, b, d, ch, inR, via, min]) => {
  const inRange = !o.offline && (inR || !!o.reach?.includes(id));
  return {
    id, name, kind, channels: [CH[ch]!], distM: d, distBy: o.noDir ? 'signal' : 'pos', bearing: o.noDir ? null : b,
    inRange, connected: !o.offline && o.connected === id, signal: id === 'torre' ? 'medium' : d < 100 ? 'strong' : d < 1000 ? 'medium' : 'weak',
    hops: inR ? 1 : 2, reachedVia: via, lastSeen: o.offline ? NOW - min * 60_000 : NOW - 20_000, why: 'optedIn', connectable: true,
  };
});

const base: MapViewProps = {
  points: sample(), mode: 'full', located: true, lora: true, loraMode: 'auto', now: NOW, banner: null, connect: null,
  onConnect: noop, onCancel: noop, onDisconnect: noop, canDisconnect: () => true, radioName: 'RNode 3F2A', toast: null,
};

const Frame = (p: Partial<MapViewProps>) => <NetworkMapView {...base} {...p} />;

const FRAMES: Record<string, () => ReactNode> = {
  '2-1': () => <Frame />,
  '2-2': () => <Frame initial={{ selected: 'torre' }} />,
  '2-3': () => <Frame initial={{ selected: 'pousada' }} />,
  '2-4': () => <Frame initial={{ selected: 'torre' }} connect={{ id: 'torre', phase: 'keys' }} />,
  '2-5': () => <Frame points={sample({ connected: 'torre', reach: ['escola'] })} initial={{ selected: 'torre' }} gained={{ torre: 6 }} toast="Conectado a piu.torre-serra · +6 pontos"
    extraRows={p => (p.id === 'torre' ? [['Agora você alcança', 'piu.escola e mais 5'], ['Desde', fmtDate(AT_1406, { hour: '2-digit', minute: '2-digit' })]] : [])} />,
  '2-6': () => <Frame initial={{ filters: ['super', 'lora'] }} />,
  '2-7': () => <Frame initial={{ view: 'list' }} />,
  '2-8': () => <Frame points={[]} mode="empty" lora={false} onAddLora={noop} />,
  '2-9': () => <Frame points={sample({ offline: true })} mode="offline" banner="offline" onBanner={noop} lastSeenAt={AT_1406} />,
  '2-10': () => <Frame points={sample({ noDir: true })} located={false} banner="noLoc" onBanner={noop} />,
};
const IDS = Object.keys(FRAMES);
const TITLES: Record<string, string> = {
  '2-1': 'Mapa cheio', '2-2': 'Ponto no alcance', '2-3': 'Ponto longe', '2-4': 'Conectando', '2-5': 'Conectado',
  '2-6': 'Filtros por tipo', '2-7': 'Lista em vez de mapa', '2-8': 'Nada por perto', '2-9': 'Offline', '2-10': 'Sem localização',
};

/** Um quadro no tamanho de um celular (a folha e o aviso se posicionam dentro dele). */
const Phone = ({ children }: { children: ReactNode }) => <View style={{ width: '100%', maxWidth: 420, height: 800, alignSelf: 'center', overflow: 'hidden' }}>{children}</View>;

export default function MapGallery() {
  const { c } = useTheme();
  const raw = useLocalSearchParams<{ id?: string | string[] }>().id;
  const id = Array.isArray(raw) ? raw.join(',') : raw;
  if (id && id.includes(',')) return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
      {id.split(',').map(x => <View key={x} style={{ gap: 4 }}><T size={11} mono color={c.ink2} style={{ paddingHorizontal: 8 }}>{x}</T><Phone>{FRAMES[x]?.()}</Phone></View>)}
    </ScrollView>
  );
  if (id) return <View testID={`gallery-${id}`} style={{ flex: 1, backgroundColor: c.bg }}>{FRAMES[id]?.() ?? <T>?</T>}</View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
      <T size={12} mono color={c.ink2}>DEV · Piu 18 Mapa da rede · dados de exemplo</T>
      <ListBox>
        {IDS.map((x, i) => <NavRow key={x} first={!i} icon="radar" title={`${x} · ${TITLES[x]}`} onPress={() => router.push(`/__dev/map?id=${x}` as Href)} />)}
      </ListBox>
      <Pressable onPress={() => router.back()}><T>←</T></Pressable>
    </ScrollView>
  );
}
