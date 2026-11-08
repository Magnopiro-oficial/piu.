import { useEffect, useState } from 'react';
import { getTransport } from '../../transport';
import type { LoraStatus } from '../../transport/meshtastic/link';
import type { LoraRadio, RadioStatus } from '../../transport/meshtastic/radio';

/** Rádio Meshtastic do transporte (só Android com o módulo piu-meshtastic; senão `null`) e o estado ao vivo. */
export function useLora(): { radio: LoraRadio; status: RadioStatus; link: LoraStatus; now: number } | null {
  const radio = getTransport().lora ?? null;
  const [, setVer] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!radio) return;
    const bump = () => { setVer(v => v + 1); setNow(Date.now()); };
    const a = radio.onChange(bump), b = radio.link.onChange(bump);
    return () => { a(); b(); };
  }, [radio]);
  // "LoRa ocupado": a contagem anda de segundo em segundo enquanto há algo esperando a vez.
  const busy = radio?.link.status().busyUntil;
  useEffect(() => {
    if (!busy || busy <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);
  // O Super Node conta como "por perto" por 40 min depois do último anúncio: confere de minuto em minuto.
  const nodes = radio?.link.status().superNodes;
  useEffect(() => {
    if (!radio || !nodes) return;
    const id = setInterval(() => radio.link.refreshNodes(), 60_000);
    return () => clearInterval(id);
  }, [radio, nodes]);
  if (!radio) return null;
  return { radio, status: radio.status(), link: radio.link.status(), now };
}
