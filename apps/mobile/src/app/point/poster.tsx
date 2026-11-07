import { useState } from 'react';
import { useT } from '../../i18n';
import { sharePoster } from '../../lib/pointShare';
import { usePoint } from '../../state/point';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { PosterView } from '../../ui/point/views';

/** P6c: cartaz A4 para imprimir (PDF pela folha do sistema). */
export default function PointPoster() {
  const t = useT();
  const p = usePoint();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = p.config;
  if (!cfg) return null;
  return (
    <Screen>
      <BackHeader title={t('point.poster.header')} />
      <PosterView name={cfg.name} qr={p.qr} id={cfg.id} footerUrl={p.pageUrl} busy={busy} error={error}
        onPrint={async () => {
          setBusy(true); setError(null);
          try { await sharePoster(cfg, p.qr, p.pageUrl, t); } catch { setError(t('point.qr.shareFail')); } finally { setBusy(false); }
        }} />
    </Screen>
  );
}
