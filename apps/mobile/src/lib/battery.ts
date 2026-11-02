import { BatteryState, useBatteryLevel, useBatteryState } from 'expo-battery';

/** Nível (0–1, ou -1 sem informação) e se está na tomada. Android e iPhone: expo-battery. */
export function useBattery(): { level: number; charging: boolean | null } {
  const level = useBatteryLevel();
  const state = useBatteryState();
  if (state === BatteryState.UNKNOWN) return { level, charging: null };
  return { level, charging: state === BatteryState.CHARGING || state === BatteryState.FULL };
}
