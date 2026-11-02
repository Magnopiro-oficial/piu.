import * as Battery from 'expo-battery';

/** Abaixo disto (sem estar na tomada) a seleção de transporte prefere Bluetooth LE. */
export const LOW_BATTERY_LEVEL = 0.3;

/**
 * Leitura contínua de "bateria baixa" para a seleção de transporte (Android e iPhone: expo-battery).
 * Modo de economia de energia do sistema também conta como bateria baixa.
 */
export function watchLowBattery(): () => boolean {
  let level = -1;
  let charging = false;
  let saver = false;
  const setState = (s: Battery.BatteryState) => { charging = s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL; };
  Battery.getBatteryLevelAsync().then(v => { level = v; }).catch(() => {});
  Battery.getBatteryStateAsync().then(setState).catch(() => {});
  Battery.isLowPowerModeEnabledAsync().then(v => { saver = v; }).catch(() => {});
  try {
    Battery.addBatteryLevelListener(e => { level = e.batteryLevel; });
    Battery.addBatteryStateListener(e => setState(e.batteryState));
    Battery.addLowPowerModeListener(e => { saver = e.lowPowerMode; });
  } catch { /* sem sensor: fica a última leitura */ }
  return () => saver || (!charging && level >= 0 && level < LOW_BATTERY_LEVEL);
}
