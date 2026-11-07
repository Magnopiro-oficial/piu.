import { router } from 'expo-router';
import { useEffect } from 'react';
import { useT } from '../../i18n';
import { usePoint } from '../../state/point';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { TestView } from '../../ui/point/views';

/** P4: teste automático (runLanCheck) → P4a verde / P4b amarelo / P4c vermelho (bloqueia). */
export default function PointTest() {
  const t = useT();
  const p = usePoint();
  useEffect(() => { void p.runCheck(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const net = p.draft.network;
  const hotspot = net?.kind === 'hotspot';
  return (
    <Screen>
      <BackHeader title={t('point.test.header')} />
      <TestView
        net={net?.ssid ?? t('point.test.thisNet')}
        running={p.check.running}
        view={p.check.view}
        error={p.check.error}
        hotspot={hotspot}
        onContinue={() => {
          // Painel → "Testar de novo": volta ao painel; assistente: segue para o nível.
          if (p.config) router.back(); else router.push('/point/level');
        }}
        onRetry={() => { void p.runCheck(); }}
        onAltRouter={() => router.back()}
        onAltHotspot={async () => {
          try { await p.startHotspot(); void p.runCheck(); } catch { router.back(); }
        }}
      />
    </Screen>
  );
}
