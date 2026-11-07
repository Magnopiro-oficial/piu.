/**
 * Visitante (P8): folha "Ponto Piu por perto" ao abrir o app (ou ao ler o QR) e "Você saiu do ponto"
 * (P8b, some em 5 s). Montado uma vez no app (_layout.tsx). A faixa P8a fica no topo das Conversas
 * (`PointHereBanner`).
 */
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { useStats } from '../../state/messaging';
import { useNetwork } from '../../state/network';
import { usePoint } from '../../state/point';
import { useLanTransport } from '../../state/transport';
import { Sheet, type SheetHandle } from '../Sheet';
import { HereBanner, LeftBanner, VisitorSheetBody } from './views';

const ERR = { permission: 'point.visit.err.permission', unsupported: 'point.visit.err.unsupported', unavailable: 'point.visit.err.unavailable', failed: 'point.visit.err.failed', busy: 'point.visit.err.failed' } as const;

export function PointWatch() {
  const p = usePoint();
  const t = useT();
  const { tx } = useNetwork();
  const insets = useSafeAreaInsets();
  const sheet = useRef<SheetHandle>(null);
  const v = p.visitor;

  useEffect(() => {
    if (!v.left) return;
    const id = setTimeout(p.clearLeft, 5000);
    return () => clearTimeout(id);
  }, [v.left, p.clearLeft]);

  return (
    <>
      {v.offer ? (
        <Sheet ref={sheet} label={t('point.visit.title')} onClose={p.dismissOffer}>
          <VisitorSheetBody name={v.offer.name} ssid={v.offer.ssid} joining={v.joining} error={v.error ? t(ERR[v.error]) : null}
            onJoin={() => { void p.join(); }} onLater={() => sheet.current?.close()} />
        </Sheet>
      ) : null}
      {v.left ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 8 }}>
          <LeftBanner ble={tx.ble} onClose={p.clearLeft} />
        </View>
      ) : null}
    </>
  );
}

/** P8a: faixa no topo das Conversas enquanto estiver num ponto (contagens reais: vizinhos na rede local e entregas desde que entrou). */
export function PointHereBanner() {
  const p = usePoint();
  const lan = useLanTransport();
  const stats = useStats(5000);
  const j = p.visitor.joined;
  if (!j) return null;
  const delivered = Math.max(0, (stats?.metrics.delivered ?? j.deliveredAt) - j.deliveredAt);
  return (
    <View>
      <HereBanner name={j.name} peers={lan.peers.length} delivered={delivered} onPress={() => router.push('/(tabs)/network')} />
    </View>
  );
}
