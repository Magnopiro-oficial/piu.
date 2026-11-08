/**
 * SÓ DESENVOLVIMENTO (importado por src/app/__dev/radio.tsx atrás de `__DEV__`; fora do build de produção).
 * Cada id do Piu 17 renderiza a MESMA peça que o app usa (LoraBlockView, RadioTypeSheet, ConnectPiuSheet,
 * RegionPicker) com DADOS DE EXEMPLO. As folhas de conexão rodam o caminho real (PiuLoraRadio →
 * PiuLoraLink → RNodeSetup) com um rádio de exemplo que responde pelo "Bluetooth".
 * `/__dev/radio` lista; `/__dev/radio?id=1d` mostra um só.
 */
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { LoraRowView } from '../lib/loraRow';
import type { LoraMode, PiuProblem, PiuRowView } from '../lib/piuLora';
import { useTheme } from '../theme/ThemeProvider';
import type { RadioDevice } from '../transport/meshtastic/radio';
import { PiuLoraLink } from '../transport/rnode/link';
import { PiuLoraRadio, type RNodeClient } from '../transport/rnode/radio';
import { RNODE_BOARDS, RNodeEmulator, type EmulatorOptions } from '../transport/rnode/emulator';
import { ListBox, NavRow } from '../ui/point/parts';
import { ConnectPiuSheet } from '../ui/lora/ConnectPiuSheet';
import { LoraBlockView } from '../ui/lora/LoraBlock';
import { RadioTypeSheet } from '../ui/lora/RadioTypeSheet';
import { RegionPicker } from '../ui/lora/RegionPicker';
import { T } from '../ui/T';

const noop = () => {};
const DEVS: RadioDevice[] = [{ id: 'AA:00:00:00:3F:2A', name: 'RNode 3F2A', rssi: -55 }, { id: 'AA:00:00:00:77:C1', name: 'RNode 77C1', rssi: -70 }, { id: 'AA:00:00:00:0B:9E', name: 'RNode 0B9E', rssi: -90 }];

/**
 * Rádio de exemplo: a placa emulada byte a byte (rnode/emulator.ts). `answer` liga o Bluetooth à placa;
 * sem ele a placa fica calada (configurando). `board`/`fw`/`tnc`/`provisioned` reproduzem os casos reais.
 */
function exampleRadio(o: { devices?: RadioDevice[]; connect?: 'ok' | 'bond' | 'TIMEOUT'; answer?: boolean; region?: string | null } & EmulatorOptions & { board?: string } = {}) {
  const data = new Set<(b: Uint8Array) => void>(), dev = new Set<(d: RadioDevice) => void>(), st = new Set<(s: string, r?: string) => void>();
  const sub = <F,>(s: Set<F>, f: F) => { s.add(f); return { remove: () => { s.delete(f); } }; };
  const emu = new RNodeEmulator(RNODE_BOARDS.find(b => b.name === (o.board ?? 'Heltec V3 (915)'))!, o);
  emu.onOutput(b => { const c = b.slice(); setTimeout(() => data.forEach(fn => fn(c)), 0); });
  const client: RNodeClient = {
    async scan(sec) { (o.devices ?? []).forEach(d => dev.forEach(f => f(d))); await new Promise(r => setTimeout(r, sec * 1000)); },
    async connect() {
      if (o.connect === 'TIMEOUT') throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
      if (o.connect === 'bond') { st.forEach(f => f('connecting', 'bond')); await new Promise(() => {}); }
    },
    async write(b) { if (o.answer) emu.input(b); },
    disconnect: noop,
    addDeviceListener: f => sub(dev, f), addDataListener: f => sub(data, f), addStateListener: f => sub(st, f),
  };
  const radio = new PiuLoraRadio(client, new PiuLoraLink({ region: o.region === undefined ? 'BR_902' : o.region }));
  void radio.scan(0); // a lista já tem o nome de cada rádio
  return radio;
}

const piuUp = (p: Partial<Extract<PiuRowView, { kind: 'connected' }>> = {}): PiuRowView => ({ kind: 'connected', radio: 'RNode 3F2A', region: 'BR_902', freqHz: 904_750_000, superNodes: { count: 2, gateway: true }, ...p });
const meshUp: LoraRowView = { kind: 'connected', radio: 'T-Echo', battery: 82, nodes: 7 };

function Rede({ on = true, pv = null, mv = null, mode: m0 = 'auto' }: { on?: boolean; pv?: PiuRowView | null; mv?: LoraRowView | null; mode?: LoraMode }) {
  const { c } = useTheme();
  const [mode, setMode] = useState<LoraMode>(m0);
  const [sw, setSw] = useState(on);
  return (
    <View style={{ width: 390, padding: 14 }}>
      <View style={{ borderRadius: 22, backgroundColor: c.bg2, overflow: 'hidden' }}>
        <LoraBlockView first on={sw} onToggle={setSw} noPerm={false} askPermission={noop} mode={mode} onMode={setMode} pv={pv} mv={mv}
          onAdd={noop} onRegion={noop} onProblem={noop} onReconnect={noop} />
      </View>
    </View>
  );
}

const PROBLEM: Record<string, PiuProblem> = { '3g': { kind: 'notRNode' }, '3h': { kind: 'band' }, '3i': { kind: 'code', code: '0x03' } };

const FRAMES: Record<string, () => ReactNode> = {
  '1a': () => <Rede on={false} />,
  '1b': () => <Rede />,
  '1c': () => <Rede pv={piuUp()} />,
  '1c-m': () => <Rede mv={meshUp} />,
  '1d': () => <Rede pv={piuUp()} mv={meshUp} />,
  '1e': () => <Rede pv={{ kind: 'away', radio: 'RNode 3F2A' }} mv={meshUp} mode="piu" />,
  '1f': () => <Rede pv={piuUp({ busySec: 40, superNodes: undefined })} />,
  '1g': () => <Rede pv={{ kind: 'failed', radio: 'RNode 3F2A', region: 'BR_902', problem: { kind: 'band' } }} />,
  '1h': () => <Rede pv={{ kind: 'away', radio: 'RNode 3F2A' }} />,
  '2': () => <RadioTypeSheet onClose={noop} onPick={noop} />,
  '3a': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS })} onRegion={noop} onClose={noop} />,
  '3b': () => <ConnectPiuSheet radio={exampleRadio({})} onRegion={noop} onClose={noop} />,
  '3c': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, connect: 'bond' })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3d': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3e': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, answer: true })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3f': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, connect: 'TIMEOUT' })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3g': () => <ConnectPiuSheet radio={exampleRadio({})} problem={PROBLEM['3g']} onRegion={noop} onClose={noop} />,
  '3h': () => <ConnectPiuSheet radio={exampleRadio({})} problem={PROBLEM['3h']} onRegion={noop} onClose={noop} />,
  '3i': () => <ConnectPiuSheet radio={exampleRadio({})} problem={PROBLEM['3i']} onRegion={noop} onClose={noop} />,
  '3j': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, answer: true, fw: [1, 50] })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3k': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, answer: true, tnc: { freqHz: 869_525_000, bwHz: 125_000, sf: 8, cr: 5, txDbm: 14 } })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3l': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, answer: true, provisioned: false })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3m': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '3n': () => <ConnectPiuSheet radio={exampleRadio({ devices: DEVS, answer: true, board: 'Heltec V3 (433)' })} deviceId={DEVS[0]!.id} onRegion={noop} onClose={noop} />,
  '4a': () => <RegionPicker link={new PiuLoraLink({})} first country="BR" onDone={noop} onClose={noop} />,
  '4b': () => <RegionPicker link={new PiuLoraLink({})} first country="AR" onDone={noop} onClose={noop} />,
  '4c': () => <RegionPicker link={new PiuLoraLink({ region: 'BR_902' })} first={false} country="BR" onDone={noop} onClose={noop} />,
};
const IDS = Object.keys(FRAMES);

export default function RadioGallery() {
  const { c } = useTheme();
  const raw = useLocalSearchParams<{ id?: string | string[] }>().id;
  const id = Array.isArray(raw) ? raw.join(',') : raw;
  if (id && id.includes(',')) return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
      {id.split(',').map(x => <View key={x} style={{ gap: 4 }}><T size={11} mono color={c.ink2} style={{ paddingHorizontal: 8 }}>{x}</T>{FRAMES[x]?.()}</View>)}
    </ScrollView>
  );
  if (id) return <View testID={`gallery-${id}`} style={{ flex: 1, backgroundColor: c.bg }}>{FRAMES[id]?.() ?? <T>?</T>}</View>;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
      <T size={12} mono color={c.ink2}>DEV · Piu 17 Rádio do Piu · dados de exemplo</T>
      <ListBox>
        {IDS.map((x, i) => <NavRow key={x} first={!i} icon="settings_input_antenna" title={x} onPress={() => router.push(`/__dev/radio?id=${x}` as Href)} />)}
      </ListBox>
      <Pressable onPress={() => router.back()}><T>←</T></Pressable>
    </ScrollView>
  );
}
