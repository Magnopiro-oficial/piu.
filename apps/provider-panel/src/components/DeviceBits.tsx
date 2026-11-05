import { useT } from '../i18n/react';
import { statusShort } from '../lib/devices';
import type { RelayNode } from '../types';

/** Bolinha de status + rótulo curto (Ativo / Pausado / Aquecendo). */
export function DeviceStatusCell({ d }: { d: RelayNode }) {
  useT(); // o rótulo segue o idioma do painel
  return (
    <div className="row" style={{ gap: 7, fontSize: 13, color: 'var(--ink2)' }}>
      <div className="dot" style={{ background: d.status === 'active' && (d.telemetry !== 'none' || d.link?.online) ? 'var(--ink)' : 'transparent', animation: d.status === 'warming' ? 'piuBreath 1.2s ease-in-out infinite' : 'none' }} />
      {statusShort(d)}
    </div>
  );
}
