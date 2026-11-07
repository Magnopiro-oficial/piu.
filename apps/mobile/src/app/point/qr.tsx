import { router } from 'expo-router';
import { useState } from 'react';
import { useT } from '../../i18n';
import { sharePoster } from '../../lib/pointShare';
import { usePoint } from '../../state/point';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { QrView } from '../../ui/point/views';

/** P6: ponto ativo, QR de Wi-Fi padrão com o nome do ponto; compartilhar (PDF), cartaz, painel. */
export default function PointQrScreen() {
  const t = useT();
  const p = usePoint();
  const [sharing, setSharing] = useState(false);
  const cfg = p.config;
  if (!cfg) return null;
  return (
    <Screen>
      <BackHeader title={t('point.qr.header')} />
      <QrView
        name={cfg.name} ssid={cfg.network.ssid} qr={p.qr} sharing={sharing}
        onShare={async () => {
          setSharing(true);
          try { await sharePoster(cfg, p.qr, p.pageUrl, t); } catch { /* a folha do sistema mostra o próprio erro */ } finally { setSharing(false); }
        }}
        onPoster={() => router.push('/point/poster')}
        onPanel={() => { if (router.canGoBack()) router.dismissTo('/point'); else router.replace('/point'); }}
      />
    </Screen>
  );
}
