import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersisted } from '../lib/persist';
import { applyLangPref, isLang, isRegion, type LangPref, type Region } from '../i18n';
import type { BackupRecord } from '../lib/backupStatus';
import { NOTIF_TYPES, type NotifKey, type Preview, type RestoreMode } from '../data/settings';
import { type HoursWindow, normHoursChoice } from '../messaging/hours';
import { UPDATE_NOTIFY_DEFAULT } from '../lib/updateCore';
import { SOUND_DEFAULTS } from '../lib/piuChirp';

/**
 * `find` ("Quem pode me encontrar", identidade pública): `all` = Por perto anuncia e recebe pedidos;
 * `contacts` = fora de Por perto, pedido de conversa só de quem tem o meu código; `none` = também
 * descarta os pedidos pelo código. Aplicado no mensageiro (`Messenger.setDiscovery`).
 */
export interface Privacy { find: 'all' | 'contacts' | 'none'; near: 'off' | '1h'; read: boolean; typing: boolean; temp: 'off' | '7d' | '24h'; delay: boolean; pad: boolean; noRoutes: boolean; lock: boolean;
  /** Mandar meu endereço Lunes aos contatos públicos (`wa`). Ausente em ajustes antigos = ligado. */
  shareWallet?: boolean }
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
  /** Carteira: esconder o saldo na tela (só exibição; os dados não mudam). */
  hideBalance: boolean; setHideBalance: (v: boolean) => void;
  /** "Segurança da tela" (Privacidade, só Android): FLAG_SECURE na conversa em foco, sem print nem gravação (ui/ScreenSecurity.tsx). */
  screenSecurity: boolean; setScreenSecurity: (v: boolean) => void;
  /** Idioma do app (`auto` = o do sistema, se suportado) e Região (formato de número e data). Só neste aparelho. */
  lang: LangPref; setLang: (l: LangPref) => void;
  region: Region; setRegion: (r: Region) => void;
  /** "Avisar sobre novas versões": com internet, confere o GitHub no máximo 1 vez por dia (ui/UpdateWatch.tsx). Ligado de fábrica, como no Desktop. */
  updateNotify: boolean; setUpdateNotify: (v: boolean) => void;
}

const DEFAULT_NOTIFS = Object.fromEntries(NOTIF_TYPES.map(([k]) => [k, k !== 'network'])) as Record<NotifKey, boolean>;

const NONE: Record<string, boolean> = Object.freeze({}) as Record<string, boolean>;

const Ctx = createContext<Settings | null>(null);

/** Ajustes de segurança, privacidade, armazenamento, bateria e notificações (locais, sem servidor). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [priv, setPrivS] = usePersisted<Privacy>('set.priv', { find: 'all', near: 'off', read: true, typing: true, temp: 'off', delay: false, pad: true, noRoutes: true, lock: false, shareWallet: true });
  const [sto, setStoS] = usePersisted<StorageOpts>('set.sto', { auto: 'wifi', quality: 'normal', retention: '48' });
  const [bat, setBatS] = usePersisted<BatteryOpts>('set.bat', { bg: true, hours: 'always', traffic: 200, bw: '5', disc: 'normal' });
  const [preview, setPreview] = usePersisted<Preview>('set.preview', 'always');
  const [notifsRaw, setNotifs] = usePersisted<Record<NotifKey, boolean>>('set.notifs', () => DEFAULT_NOTIFS);
  // Tipo novo (ex.: Alertas da comunidade) entra com o padrão em quem já tinha os ajustes salvos.
  const notifs = useMemo(() => ({ ...DEFAULT_NOTIFS, ...notifsRaw }), [notifsRaw]);
  const batN = useMemo(() => normBattery(bat), [bat]);
  // Padrão de fábrica: o piu nas notificações (quem nunca mexeu segue o padrão; o padrão não é gravado).
  const [quiet, setQuiet] = usePersisted<boolean>('set.quiet', SOUND_DEFAULTS.quiet);
  const [discreet, setDiscreet] = usePersisted<boolean>('set.discreet', SOUND_DEFAULTS.discreet);
  const [piuSound, setPiuSound] = usePersisted<boolean>('set.piuSound', SOUND_DEFAULTS.piu);
  const [backupDone, setBackupDone] = usePersisted('set.backupDone', false);
  const [backupAt, setBackupAt] = usePersisted<BackupRecord | null>('set.backupAt', null);
  const [restoreMode, setRestoreMode] = usePersisted<RestoreMode>('set.restoreMode', 'device');
  const [hideBalance, setHideBalance] = usePersisted('set.hideBalance', false);
  const [screenSecurity, setScreenSecurity] = usePersisted('set.screenSecurity', true);
  const [lang, setLang] = usePersisted<LangPref>('set.lang', 'auto', v => (v === 'auto' || isLang(v) ? v : 'auto'));
  const [region, setRegion] = usePersisted<Region>('set.region', 'auto', v => (isRegion(v) ? v : 'auto'));
  const [updateNotify, setUpdateNotify] = usePersisted('set.updateNotify', UPDATE_NOTIFY_DEFAULT);
  // Idioma aplicado antes da primeira renderização dos filhos (sem piscar em pt-BR) e a cada troca.
  useState(() => { applyLangPref(lang, region); return null; });
  useEffect(() => { applyLangPref(lang, region); }, [lang, region]);

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
    hideBalance, setHideBalance, screenSecurity, setScreenSecurity,
    lang, setLang, region, setRegion, updateNotify, setUpdateNotify,
  }), [priv, setPrivS, sto, setStoS, batN, setBatS, preview, setPreview, notifs, setNotifs, quiet, setQuiet, discreet, setDiscreet, piuSound, setPiuSound, backupDone, setBackupDone, backupAt, setBackupAt, restoreMode, setRestoreMode, hideBalance, setHideBalance, screenSecurity, setScreenSecurity, lang, setLang, region, setRegion, updateNotify, setUpdateNotify]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSettings fora de SettingsProvider');
  return s;
}
