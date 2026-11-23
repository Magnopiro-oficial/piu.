import { useT } from '../i18n/react';
import { statusShort } from '../lib/devices';
import { deviceStorageRuleNote } from '../lib/limits';
import { Icon } from './ui';
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

/** Aviso sob a regra de espaço de um equipamento, quando ela passa do que um nó guarda hoje. */
export function StorageRuleNote({ gb }: { gb: number }) {
  useT(); // o texto segue o idioma do painel
  const note = deviceStorageRuleNote(gb);
  return note ? <div role="note" className="row" style={{ gap: 6, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.45 }}><Icon name="info" size={15} style={{ marginTop: 1 }} />{note}</div> : null;
}
