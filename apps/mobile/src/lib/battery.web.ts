import { useEffect, useState } from 'react';

interface BatteryManager extends EventTarget { level: number; charging: boolean }

/**
 * Navegador: a Battery Status API (só Chromium; o expo-battery não funciona na web).
 * Sem a API, o nível é -1 e a pausa por bateria não acontece.
 */
export function useBattery(): { level: number; charging: boolean | null } {
  const [v, setV] = useState<{ level: number; charging: boolean | null }>({ level: -1, charging: null });
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) return;
    let bm: BatteryManager | null = null;
    const read = () => { if (bm) setV({ level: bm.level, charging: bm.charging }); };
    nav.getBattery().then(b => { bm = b; read(); b.addEventListener('levelchange', read); b.addEventListener('chargingchange', read); }).catch(() => {});
    return () => { bm?.removeEventListener('levelchange', read); bm?.removeEventListener('chargingchange', read); };
  }, []);
  return v;
}
