import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { NOTIF_TYPES, type NotifKey, type Preview, type RestoreMode } from '../data/settings';

export interface Privacy { find: 'all' | 'contacts' | 'none'; near: 'off' | '1h'; read: boolean; typing: boolean; temp: 'off' | '7d' | '24h'; delay: boolean; pad: boolean; noRoutes: boolean; lock: boolean }
export interface StorageOpts { auto: 'wifi' | 'always' | 'never'; quality: 'eco' | 'normal' | 'orig'; retention: '24' | '48' | '168' }
export interface BatteryOpts { bg: boolean; hours: 'always' | 'night' | 'custom'; traffic: 50 | 200 | 500; bw: '1' | '5' | 'max'; disc: 'eco' | 'normal' | 'fast' }

interface Settings {
  priv: Privacy; setPriv: (p: Partial<Privacy>) => void;
  sto: StorageOpts; setSto: (p: Partial<StorageOpts>) => void;
  bat: BatteryOpts; setBat: (p: Partial<BatteryOpts>) => void;
  preview: Preview; setPreview: (p: Preview) => void;
  notifs: Record<NotifKey, boolean>; toggleNotif: (k: NotifKey) => void;
  quiet: boolean; setQuiet: (v: boolean) => void;
  discreet: boolean; setDiscreet: (v: boolean) => void;
  backupDone: boolean; setBackupDone: (v: boolean) => void;
  dropped: Record<string, boolean>; dropDevice: (id: string) => void;
  restoreMode: RestoreMode; setRestoreMode: (m: RestoreMode) => void;
  mediaCleared: boolean; clearMedia: () => void;
}

const Ctx = createContext<Settings | null>(null);

/** Ajustes de segurança, privacidade, armazenamento, bateria e notificações (locais, sem servidor). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [priv, setPrivS] = useState<Privacy>({ find: 'contacts', near: 'off', read: true, typing: true, temp: 'off', delay: false, pad: true, noRoutes: true, lock: false });
  const [sto, setStoS] = useState<StorageOpts>({ auto: 'wifi', quality: 'normal', retention: '48' });
  const [bat, setBatS] = useState<BatteryOpts>({ bg: true, hours: 'always', traffic: 200, bw: '5', disc: 'normal' });
  const [preview, setPreview] = useState<Preview>('always');
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>(() => Object.fromEntries(NOTIF_TYPES.map(([k]) => [k, k !== 'network'])) as Record<NotifKey, boolean>);
  const [quiet, setQuiet] = useState(false);
  const [discreet, setDiscreet] = useState(true);
  const [backupDone, setBackupDone] = useState(false);
  const [dropped, setDropped] = useState<Record<string, boolean>>({});
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('device');
  const [mediaCleared, setMediaCleared] = useState(false);

  const value = useMemo<Settings>(() => ({
    priv, setPriv: p => setPrivS(s => ({ ...s, ...p })),
    sto, setSto: p => setStoS(s => ({ ...s, ...p })),
    bat, setBat: p => setBatS(s => ({ ...s, ...p })),
    preview, setPreview,
    notifs, toggleNotif: k => setNotifs(n => ({ ...n, [k]: !n[k] })),
    quiet, setQuiet, discreet, setDiscreet,
    backupDone, setBackupDone,
    dropped, dropDevice: id => setDropped(d => ({ ...d, [id]: true })),
    restoreMode, setRestoreMode,
    mediaCleared, clearMedia: () => setMediaCleared(true),
  }), [priv, sto, bat, preview, notifs, quiet, discreet, backupDone, dropped, restoreMode, mediaCleared]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSettings fora de SettingsProvider');
  return s;
}
