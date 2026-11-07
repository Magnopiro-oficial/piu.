/**
 * Wi-Fi do ponto Piu no aparelho (módulos nativos piu-lan e piu-app-share), com as permissões que o app já
 * pede para o Wi-Fi Direct (src/transport/permissions.ts: dispositivos Wi-Fi por perto no Android 13+, com
 * `neverForLocation`; localização precisa até o 12). Sem módulo (web, iPhone, build antigo): `null`/erro
 * claro — a tela mostra o motivo (sem módulo, sem permissão, ocupado, sem suporte).
 */
import { Platform } from 'react-native';
import { PiuAppShare } from '../../modules/piu-app-share';
import { PiuLan, type PiuLanHotspot } from '../../modules/piu-lan';
import { requestWifiDirectPermission } from '../transport/permissions';
import type { ScannedNet } from './pointCore';
import { pointPageBindOk } from './pointPage';

export type PointWifiError = 'unavailable' | 'permission' | 'busy' | 'unsupported' | 'failed';

export const errCode = (e: unknown): PointWifiError => {
  const c = String((e as { code?: string })?.code ?? '');
  if (c === 'ERR_NO_PERMISSION') return 'permission';
  if (c === 'ERR_HOTSPOT_BUSY') return 'busy';
  if (c === 'ERR_UNSUPPORTED') return 'unsupported';
  if (c === 'unavailable') return 'unavailable';
  return 'failed';
};

const fail = (code: string) => Object.assign(new Error(code), { code });

/** Recursos que existem neste aparelho/build. */
export const pointWifiSupport = () => ({
  scan: !!PiuLan?.wifiScan,
  hotspot: !!PiuLan?.startHotspot && Platform.OS === 'android',
  join: !!PiuLan?.joinNetwork && Platform.OS === 'android' && Number(Platform.Version) >= 29,
  page: !!PiuAppShare?.startLanShare,
});

async function permitted(): Promise<void> {
  if ((await requestWifiDirectPermission()) !== 'granted') throw fail('ERR_NO_PERMISSION');
}

export async function scanNetworks(): Promise<ScannedNet[]> {
  if (!PiuLan?.wifiScan) throw fail('unavailable');
  await permitted();
  return PiuLan.wifiScan();
}

/** Nome do Wi-Fi atual se o sistema mostrar (sem pedir permissão nova; `null` quando oculto). */
export async function currentSsid(): Promise<string | null> {
  try { return (await PiuLan?.currentSsid?.()) ?? null; } catch { return null; }
}

export async function startHotspot(): Promise<PiuLanHotspot> {
  if (!PiuLan?.startHotspot) throw fail('unavailable');
  await permitted();
  return PiuLan.startHotspot();
}

export const stopHotspot = async () => { await PiuLan?.stopHotspot?.().catch(() => {}); };
export const hotspotInfo = async () => (await PiuLan?.hotspotInfo?.().catch(() => null)) ?? null;

export async function joinPointNetwork(ssid: string, password: string | null): Promise<void> {
  if (!PiuLan?.joinNetwork) throw fail('unavailable');
  await permitted();
  await PiuLan.joinNetwork(ssid, password);
}

export const leavePointNetwork = async () => { await PiuLan?.leaveNetwork?.().catch(() => {}); };

/** Ouve o hotspot (ligou/caiu) e a rede do ponto como visitante (entrou/caiu). */
export function watchPointWifi(fn: (e: { type: 'hotspot'; info: PiuLanHotspot | null } | { type: 'join'; state: 'joined' | 'lost'; ssid: string }) => void): () => void {
  if (!PiuLan) return () => {};
  const a = PiuLan.addListener('onHotspot', e => fn({ type: 'hotspot', info: 'stopped' in e ? null : e }));
  const b = PiuLan.addListener('onJoin', e => fn({ type: 'join', state: e.state, ssid: e.ssid }));
  return () => { a.remove(); b.remove(); };
}

export async function startPointPage(fileName: string, html: string, ip: string, port: number) {
  if (!PiuAppShare?.startLanShare) throw fail('unavailable');
  if (!pointPageBindOk(ip)) throw fail('ERR_BIND'); // nunca 0.0.0.0, loopback ou IP público
  return PiuAppShare.startLanShare(fileName, html, ip, port);
}
export const stopPointPage = async () => { await PiuAppShare?.stopLanShare?.().catch(() => {}); };
