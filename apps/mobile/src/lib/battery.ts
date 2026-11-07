import { BatteryState, useBatteryLevel, useBatteryState, useLowPowerMode } from 'expo-battery';

/** Nível (0–1, ou -1 sem informação) e se está na tomada. Android e iPhone: expo-battery. */
export function useBattery(): { level: number; charging: boolean | null } {
  const level = useBatteryLevel();
  const state = useBatteryState();
  if (state === BatteryState.UNKNOWN) return { level, charging: null };
  return { level, charging: state === BatteryState.CHARGING || state === BatteryState.FULL };
}

/** Economia de bateria do sistema ligada (o sistema corta o segundo plano). */
export function useLowPower(): boolean | null { return useLowPowerMode(); }
