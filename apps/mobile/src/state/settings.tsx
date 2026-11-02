import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePersisted } from '../lib/persist';
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
  const [priv, setPrivS] = usePersisted<Privacy>('set.priv', { find: 'contacts', near: 'off', read: true, typing: true, temp: 'off', delay: false, pad: true, noRoutes: true, lock: false });
  const [sto, setStoS] = usePersisted<StorageOpts>('set.sto', { auto: 'wifi', quality: 'normal', retention: '48' });
  const [bat, setBatS] = usePersisted<BatteryOpts>('set.bat', { bg: true, hours: 'always', traffic: 200, bw: '5', disc: 'normal' });
  const [preview, setPreview] = usePersisted<Preview>('set.preview', 'always');
  const [notifs, setNotifs] = usePersisted<Record<NotifKey, boolean>>('set.notifs', () => Object.fromEntries(NOTIF_TYPES.map(([k]) => [k, k !== 'network'])) as Record<NotifKey, boolean>);
  const [quiet, setQuiet] = usePersisted('set.quiet', false);
  const [discreet, setDiscreet] = usePersisted('set.discreet', true);
  const [backupDone, setBackupDone] = usePersisted('set.backupDone', false);
  const [dropped, setDropped] = usePersisted<Record<string, boolean>>('set.dropped', {});
  const [restoreMode, setRestoreMode] = usePersisted<RestoreMode>('set.restoreMode', 'device');
  const [mediaCleared, setMediaCleared] = usePersisted('set.mediaCleared', false);

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
