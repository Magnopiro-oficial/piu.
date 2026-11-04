import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePersisted } from '../lib/persist';
import type { BackupRecord } from '../lib/backupStatus';
import { NOTIF_TYPES, type NotifKey, type Preview, type RestoreMode } from '../data/settings';
import { type HoursWindow, normHoursChoice } from '../messaging/hours';

/**
 * `find` ("Quem pode me encontrar", identidade pública): `all` = Por perto anuncia e recebe pedidos;
 * `contacts` = fora de Por perto, pedido de conversa só de quem tem o meu código; `none` = também
 * descarta os pedidos pelo código. Aplicado no mensageiro (`Messenger.setDiscovery`).
 */
export interface Privacy { find: 'all' | 'contacts' | 'none'; near: 'off' | '1h'; read: boolean; typing: boolean; temp: 'off' | '7d' | '24h'; delay: boolean; pad: boolean; noRoutes: boolean; lock: boolean }
export interface StorageOpts { auto: 'wifi' | 'always' | 'never'; quality: 'eco' | 'normal' | 'orig'; retention: '24' | '48' | '168' }
/** `hours`: horário do Modo nó. 'custom' usa a faixa `custom` escolhida pela pessoa (messaging/hours.ts). */
export interface BatteryOpts { bg: boolean; hours: 'always' | 'night' | 'custom'; custom?: HoursWindow; traffic: 50 | 200 | 500; bw: '1' | '5' | 'max'; disc: 'eco' | 'normal' | 'fast' }

/** Lê os ajustes de bateria salvos: "Personalizado" sem faixa válida migra para "Sempre" (messaging/hours.ts). */
export function normBattery(b: BatteryOpts): BatteryOpts {
  const { custom: _old, hours: _h, ...rest } = b;
  void _old; void _h;
  return { ...rest, ...normHoursChoice(b.hours, b.custom) };
}

interface Settings {
  priv: Privacy; setPriv: (p: Partial<Privacy>) => void;
  sto: StorageOpts; setSto: (p: Partial<StorageOpts>) => void;
  bat: BatteryOpts; setBat: (p: Partial<BatteryOpts>) => void;
  preview: Preview; setPreview: (p: Preview) => void;
  notifs: Record<NotifKey, boolean>; toggleNotif: (k: NotifKey) => void;
  quiet: boolean; setQuiet: (v: boolean) => void;
  discreet: boolean; setDiscreet: (v: boolean) => void;
  /** "Som de piu": o piu toca com o app aberto e é o som das notificações. */
  piuSound: boolean; setPiuSound: (v: boolean) => void;
  backupDone: boolean; setBackupDone: (v: boolean) => void;
  /** Último backup de verdade (frase confirmada ou arquivo cifrado salvo), com a data. */
  backupAt: BackupRecord | null; setBackupAt: (r: BackupRecord) => void;
  /** @deprecated Sempre vazio: desconectar e revogar aparelhos ficam no registro real (lib/devices.ts). */
  dropped: Record<string, boolean>;
  restoreMode: RestoreMode; setRestoreMode: (m: RestoreMode) => void;
}

const DEFAULT_NOTIFS = Object.fromEntries(NOTIF_TYPES.map(([k]) => [k, k !== 'network'])) as Record<NotifKey, boolean>;

const NONE: Record<string, boolean> = Object.freeze({}) as Record<string, boolean>;

const Ctx = createContext<Settings | null>(null);

/** Ajustes de segurança, privacidade, armazenamento, bateria e notificações (locais, sem servidor). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [priv, setPrivS] = usePersisted<Privacy>('set.priv', { find: 'all', near: 'off', read: true, typing: true, temp: 'off', delay: false, pad: true, noRoutes: true, lock: false });
  const [sto, setStoS] = usePersisted<StorageOpts>('set.sto', { auto: 'wifi', quality: 'normal', retention: '48' });
  const [bat, setBatS] = usePersisted<BatteryOpts>('set.bat', { bg: true, hours: 'always', traffic: 200, bw: '5', disc: 'normal' });
  const [preview, setPreview] = usePersisted<Preview>('set.preview', 'always');
  const [notifsRaw, setNotifs] = usePersisted<Record<NotifKey, boolean>>('set.notifs', () => DEFAULT_NOTIFS);
  // Tipo novo (ex.: Alertas da comunidade) entra com o padrão em quem já tinha os ajustes salvos.
  const notifs = useMemo(() => ({ ...DEFAULT_NOTIFS, ...notifsRaw }), [notifsRaw]);
  const batN = useMemo(() => normBattery(bat), [bat]);
  const [quiet, setQuiet] = usePersisted('set.quiet', false);
  const [discreet, setDiscreet] = usePersisted('set.discreet', true);
  const [piuSound, setPiuSound] = usePersisted('set.piuSound', true);
  const [backupDone, setBackupDone] = usePersisted('set.backupDone', false);
  const [backupAt, setBackupAt] = usePersisted<BackupRecord | null>('set.backupAt', null);
  const [restoreMode, setRestoreMode] = usePersisted<RestoreMode>('set.restoreMode', 'device');

  const value = useMemo<Settings>(() => ({
    priv, setPriv: p => setPrivS(s => ({ ...s, ...p })),
    sto, setSto: p => setStoS(s => ({ ...s, ...p })),
    bat: batN, setBat: p => setBatS(s => normBattery({ ...normBattery(s), ...p })),
    preview, setPreview,
    notifs, toggleNotif: k => setNotifs(n => { const cur = { ...DEFAULT_NOTIFS, ...n }; return { ...cur, [k]: !cur[k] }; }),
    quiet, setQuiet, discreet, setDiscreet, piuSound, setPiuSound,
    backupDone, setBackupDone, backupAt, setBackupAt,
    dropped: NONE,
    restoreMode, setRestoreMode,
  }), [priv, setPrivS, sto, setStoS, batN, setBatS, preview, setPreview, notifs, setNotifs, quiet, setQuiet, discreet, setDiscreet, piuSound, setPiuSound, backupDone, setBackupDone, backupAt, setBackupAt, restoreMode, setRestoreMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSettings fora de SettingsProvider');
  return s;
}
