import { useEffect, useState } from 'react';
import { getTransport } from '../../transport';
import type { RadioStatus } from '../../transport/meshtastic/radio';
import type { PiuLoraStatus } from '../../transport/rnode/link';
import type { PiuLoraRadio } from '../../transport/rnode/radio';

/** Rádio do Piu (RNode) do transporte (só Android com o módulo PiuRNode; senão `null`) e o estado ao vivo. */
export function usePiuLora(): { radio: PiuLoraRadio; status: RadioStatus; link: PiuLoraStatus; now: number } | null {
  const radio = getTransport().piulora ?? null;
  const [, setVer] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!radio) return;
    const bump = () => { setVer(v => v + 1); setNow(Date.now()); };
    const a = radio.onChange(bump), b = radio.link.onChange(bump);
    return () => { a(); b(); };
  }, [radio]);
  // "Próxima mensagem em 40 s": a contagem anda de segundo em segundo.
  const busy = radio?.link.status().busyUntil;
  useEffect(() => {
    if (!busy || busy <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);
  // Super Node "por perto" por 40 min depois do último anúncio: confere de minuto em minuto.
  const nodes = radio?.link.status().superNodes;
  useEffect(() => {
    if (!radio || !nodes) return;
    const id = setInterval(() => radio.link.refreshNodes(), 60_000);
    return () => clearInterval(id);
  }, [radio, nodes]);
  if (!radio) return null;
  return { radio, status: radio.status(), link: radio.link.status(), now };
}
