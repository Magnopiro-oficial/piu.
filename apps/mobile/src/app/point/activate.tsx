import { router } from 'expo-router';
import { useState } from 'react';
import { useT } from '../../i18n';
import { validSsid, validWpaPassword } from '../../lib/pointCore';
import { usePoint } from '../../state/point';
import { BackHeader } from '../../ui/Controls';
import { Screen } from '../../ui/Screen';
import { ActivateView } from '../../ui/point/views';

/** P6o: resumo e um toque (não move LUNES). Nome do ponto e rede do QR (senha só se o dono digitar). */
export default function PointActivate() {
  const t = useT();
  const p = usePoint();
  const net = p.draft.network;
  const hotspot = net?.kind === 'hotspot';
  const [name, setName] = useState(p.draft.name);
  const [ssid, setSsid] = useState(net?.ssid ?? '');
  const [open, setOpen] = useState(net?.security === 'nopass');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passError = !hotspot && !open && password.length > 0 && !validWpaPassword(password);
  const netLabel = hotspot ? (net?.ssid ?? t('point.panel.hotspotNet')) : (ssid.trim() || net?.ssid || t('point.net.unknownName'));
  return (
    <Screen>
      <BackHeader title={t('point.act.header')} />
      <ActivateView
        net={netLabel} level={p.draft.level} spaceMb={p.draft.spaceMb} days={p.draft.days} gateway={p.draft.level === 'gateway' && !!p.check.view?.internet}
        name={name} onName={setName} namePlaceholder={t('point.act.namePh')}
        qr={{ hotspot, ssid, onSsid: setSsid, open, onOpen: setOpen, password, onPassword: setPassword, passError }}
        busy={busy} error={error}
        onActivate={async () => {
          if (!net) { router.back(); return; }
          if (p.check.view?.blocks) { setError(t('point.act.blocked')); return; }
          setBusy(true); setError(null);
          try {
            const s = ssid.trim();
            const network = hotspot ? net : { ...net, ssid: s && validSsid(s) ? s : null, security: open ? 'nopass' as const : 'WPA' as const, password: !open && validWpaPassword(password) ? password : null };
            await p.activate({ name, network });
            router.replace('/point/qr');
          } catch (e) { setError(String((e as Error)?.message ?? e)); }
          finally { setBusy(false); }
        }}
      />
    </Screen>
  );
}
