import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, Platform, View } from 'react-native';
import { PiuTransport } from '../../modules/piu-transport';
import { useT } from '../i18n';
import { BG_SETUP_AUTOSTART_KEY, type BgStep, missingSteps, oemOf, type PowerInfo, setupNote } from '../lib/bgSetupCore';
import { readPersisted, schedulePersisted } from '../lib/persist';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { T } from './T';

/**
 * Ajustes do aparelho para "Receber com o app fechado" (regras em lib/bgSetupCore.ts). Um estado só,
 * lido de novo ao voltar dos ajustes do sistema: o pedido do primeiro uso (ui/SystemPrompts.tsx) e a
 * aba Rede veem o mesmo.
 */
type Snap = { power: PowerInfo | null; autostart: boolean };
let snap: Snap = { power: null, autostart: false };
const subs = new Set<() => void>();

function readPower(): PowerInfo | null {
  if (Platform.OS !== 'android') return null;
  try { return PiuTransport?.powerInfo?.() ?? null; } catch { return null; }
}

function refresh() {
  const power = readPower();
  const autostart = readPersisted<boolean>(BG_SETUP_AUTOSTART_KEY) === true;
  const p = snap.power;
  const same = autostart === snap.autostart && (p === power || (!!p && !!power && p.ignoringBattery === power.ignoringBattery && p.manufacturer === power.manufacturer && p.brand === power.brand));
  if (same) return;
  snap = { power, autostart };
  subs.forEach(f => f());
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const getSnap = () => snap;

export function useBgSetup() {
  const s = useSyncExternalStore(subscribe, getSnap, getSnap);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') refresh(); });
    return () => sub.remove();
  }, []);
  return useMemo(() => ({
    missing: missingSteps(s.power, s.autostart),
    oem: s.power ? oemOf(s.power.manufacturer, s.power.brand) : 'other' as const,
  }), [s]);
}

const STEP_TITLE: Record<BgStep, 'network.receiveClosed.setup.battery' | 'network.receiveClosed.setup.autostart'> = {
  battery: 'network.receiveClosed.setup.battery',
  autostart: 'network.receiveClosed.setup.autostart',
};
export const bgStepTitle = (s: BgStep) => STEP_TITLE[s];

const openBattery = () => { try { PiuTransport?.openBatteryExemption?.(); } catch { /* sem a tela: a aba Rede segue mostrando */ } };
const openAutostart = () => { try { PiuTransport?.openAutostart?.(); } catch { /* idem */ } };
const confirmAutostart = () => { schedulePersisted(BG_SETUP_AUTOSTART_KEY, true); refresh(); };

/** A mesma tela no primeiro uso e na aba Rede: um toque em cada ajuste que falta; confere de novo ao voltar. */
export function BackgroundSetupDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { c } = useTheme();
  const { missing, oem } = useBgSetup();
  const note = setupNote(oem);
  const steps: BgStep[] = oem === 'xiaomi' ? ['battery', 'autostart'] : ['battery'];
  const done = missing.length === 0;
  return (
    <Dialog icon="battery_alert" title={t('network.receiveClosed')} body={t('network.receiveClosed.setup.body')}
      primary={t('network.receiveClosed.setup.done')} primaryIcon="check" onPrimary={onClose}
      secondary={done ? t('common.close') : t('network.receiveClosed.setup.later')} onClose={onClose}>
      <View style={{ alignSelf: 'stretch', gap: 10 }}>
        {steps.map(s => {
          const ok = !missing.includes(s);
          return (
            <View key={s} style={{ padding: 12, borderRadius: 18, backgroundColor: c.bg2, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T size={14} w={600} style={{ flex: 1 }}>{t(STEP_TITLE[s])}</T>
                {ok && <Icon name="check_circle" size={20} fill />}
                {ok && <T size={12.5} w={600}>{t('network.receiveClosed.setup.ok')}</T>}
              </View>
              {!ok && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {s === 'battery'
                    ? <Button label={t('network.receiveClosed.setup.allow')} height={40} fontSize={13} onPress={openBattery} />
                    : <>
                        <Button label={t('network.receiveClosed.setup.open')} height={40} fontSize={13} onPress={openAutostart} />
                        <Button label={t('network.receiveClosed.setup.confirm')} variant="outline" height={40} fontSize={13} onPress={confirmAutostart} />
                      </>}
                </View>
              )}
            </View>
          );
        })}
        {note && <T size={12.5} lh={1.4} color={c.ink2}>{t(note)}</T>}
      </View>
    </Dialog>
  );
}
