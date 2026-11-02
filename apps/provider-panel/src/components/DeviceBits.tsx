import { statusShort } from '../lib/devices';
import type { RelayNode } from '../types';

/** Bolinha de status + rótulo curto (Ativo / Pausado / Aquecendo). */
export function DeviceStatusCell({ d }: { d: RelayNode }) {
  return (
    <div className="row" style={{ gap: 7, fontSize: 13, color: 'var(--ink2)' }}>
      <div className="dot" style={{ background: d.status === 'active' ? 'var(--ink)' : 'transparent', animation: d.status === 'warming' ? 'piuBreath 1.2s ease-in-out infinite' : 'none' }} />
      {statusShort(d)}
    </div>
  );
}
