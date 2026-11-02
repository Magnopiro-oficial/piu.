/** Navegador: o transporte é simulado e não olha a bateria. */
export const LOW_BATTERY_LEVEL = 0.3;
export function watchLowBattery(): () => boolean { return () => false; }
