import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useBattery } from '../lib/battery';
import { usePersisted } from '../lib/persist';
import { useNetwork } from '../state/network';
import { useSettings } from '../state/settings';
import { useStore } from '../state/store';
import { Dialog } from './Dialog';

const DAY = 86_400_000;
/** Primeiro lembrete de backup: um dia depois de criar a identidade. */
export const BACKUP_FIRST_REMINDER_MS = DAY;

/** Avisos do sistema que o design mostra fora das telas: bateria, backup e o filtro dos banners. */
export function SystemPrompts() {
  return (
    <>
      <NotifyBridge />
      <BatteryGuard />
      <BackupReminder />
    </>
  );
}

/** Banners respeitam Ajustes → Notificações (por tipo). */
function NotifyBridge() {
  const { setNotifyFilter } = useStore();
  const { notifs } = useSettings();
  useEffect(() => {
    setNotifyFilter(t => !t.kind || notifs[t.kind]);
    return () => setNotifyFilter(null);
  }, [notifs, setNotifyFilter]);
  return null;
}

/**
 * Modo nó pausado pela bateria (FUN-018): abaixo do limite escolhido, ou fora da tomada com
 * "Só retransmitir carregando", o Piu para de retransmitir para terceiros. As próprias mensagens continuam.
 * Avisa uma vez por pausa, com o diálogo do design.
 */
function BatteryGuard() {
  const { onboarded } = useStore();
  const { notifs } = useSettings();
  const { relay, battery, chargingOnly, relayPaused, setRelayPaused } = useNetwork();
  const { level, charging } = useBattery(); // nível 0–1, ou -1 sem informação
  const [open, setOpen] = useState(false);
  const known = level >= 0 && charging !== null;
  const low = known && !charging && level * 100 <= battery;
  const unplugged = known && chargingOnly && !charging;
  const shouldPause = relay && onboarded && (low || unplugged);

  const was = useRef(relayPaused);
  useEffect(() => {
    if (shouldPause === relayPaused) return;
    setRelayPaused(shouldPause);
    if (shouldPause && !was.current && low && notifs.network) setOpen(true);
    was.current = shouldPause;
  }, [shouldPause, relayPaused, setRelayPaused, low, notifs.network]);

  if (!open) return null;
  return (
    <Dialog icon="battery_alert" title="Modo nó pausado"
      body={`A bateria chegou a ${battery}%. O Piu parou de retransmitir para outras pessoas. Suas mensagens continuam funcionando.`}
      primary="Entendi" primaryIcon="check" onPrimary={() => setOpen(false)}
      secondary="Ajustar limite" onClose={() => { setOpen(false); router.push('/(tabs)/network'); }} />
  );
}

/**
 * Lembrete de backup das chaves: um dia depois do onboarding, enquanto o backup não for feito.
 * "Lembrar em 7 dias" adia; fazer o backup encerra os lembretes.
 */
function BackupReminder() {
  const { onboarded } = useStore();
  const { backupDone } = useSettings();
  const [since, setSince] = usePersisted<number | null>('backup.since', null);
  const [snooze, setSnooze] = usePersisted<number>('backup.snoozeUntil', 0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (onboarded && since == null) setSince(Date.now());
  }, [onboarded, since, setSince]);

  useEffect(() => {
    if (!onboarded || backupDone || since == null) { setOpen(false); return; }
    const due = Math.max(since + BACKUP_FIRST_REMINDER_MS, snooze);
    const wait = due - Date.now();
    if (wait <= 0) { setOpen(true); return; }
    // Aplicativo aberto por muito tempo: confere de novo quando vencer (até 1 dia de espera por vez).
    const t = setTimeout(() => setOpen(true), Math.min(wait, DAY));
    return () => clearTimeout(t);
  }, [onboarded, backupDone, since, snooze]);

  if (!open) return null;
  const later = () => { setSnooze(Date.now() + 7 * DAY); setOpen(false); };
  return (
    <Dialog icon="key" title="Faça backup das suas chaves"
      body="Se perder este aparelho, você perde sua identidade e seus LUNES. O backup é cifrado com uma frase que só você conhece."
      primary="Fazer backup agora" primaryIcon="lock" onPrimary={() => { later(); router.push('/backup'); }}
      secondary="Lembrar em 7 dias" onClose={later} />
  );
}
