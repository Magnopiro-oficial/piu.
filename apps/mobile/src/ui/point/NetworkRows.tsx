/**
 * Aba Rede: linha "Wi-Fi local" (P1, P1a–c) com o estado real do transporte LAN (useLanTransport) e a
 * seção "PONTOS PIU" (criar / o ponto deste celular / no ponto como visitante).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useT } from '../../i18n';
import { usePoint } from '../../state/point';
import { useLanTransport } from '../../state/transport';
import { SectionLabel } from '../Controls';
import { Dialog } from '../Dialog';
import { ListBox, NavRow } from './parts';
import { LanRowView, PointsRow, type LanRowState } from './views';
import type { LanCtx } from '../../state/transport';

/** Estado da linha a partir do transporte LAN (puro: também usado pela galeria). */
export function lanRowState(lan: Pick<LanCtx, 'available' | 'offReason' | 'active' | 'state' | 'lowPower' | 'peers'>, o: { isolated: boolean; net: string | null }): LanRowState {
  if (!lan.available) return { kind: 'unavailable' };
  if (lan.offReason === 'userOff') return { kind: 'userOff' };
  if (lan.offReason === 'noWifi') return { kind: 'noWifi' };
  if (lan.offReason === 'onboarding' || lan.offReason === 'keys') return { kind: 'waiting' };
  if (o.isolated) return { kind: 'isolated' };
  if (lan.active && lan.state === 'running') return lan.lowPower ? { kind: 'low', net: o.net, peers: lan.peers.length } : { kind: 'on', net: o.net, peers: lan.peers.length };
  return { kind: 'starting' };
}

export function LanRow({ name, first }: { name: string; first?: boolean }) {
  const t = useT();
  const lan = useLanTransport();
  const p = usePoint();
  const [why, setWhy] = useState(false);
  const isolated = p.health === 'isolating' || p.check.view?.rows.some(r => r.key === 'isolation') === true;
  const net = p.hotspot ? p.hotspot.ssid : p.current.ssid;
  return (
    <>
      <LanRowView name={name} first={first} state={lanRowState(lan, { isolated, net })} on={lan.enabled} onToggle={() => lan.setEnabled(!lan.enabled)} onWhy={() => setWhy(true)} />
      {why ? <Dialog icon="router" title={t('point.lan.whyTitle')} body={t('point.lan.whyBody')} primary={t('common.ok')} onPrimary={() => setWhy(false)} onClose={() => setWhy(false)} secondary={t('common.close')} /> : null}
    </>
  );
}

export function PointsSection() {
  const t = useT();
  const p = usePoint();
  const j = p.visitor.joined;
  return (
    <>
      <SectionLabel>{t('point.section').toUpperCase()}</SectionLabel>
      <View style={{ marginHorizontal: 20, gap: 10 }}>
        <PointsRow point={p.config ? { name: p.config.name, level: p.config.level, paused: p.config.paused } : null} onPress={() => router.push('/point')} />
        {j ? (
          <ListBox>
            <NavRow first icon="location_on" title={t('point.here', { name: j.name })} sub={t('point.here.leave')} right={null} onPress={() => { void p.leave(); }} label={t('point.here.leave')} />
          </ListBox>
        ) : null}
      </View>
    </>
  );
}
