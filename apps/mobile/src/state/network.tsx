import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TxKey } from '../data/network';
import { usePersisted } from '../lib/persist';

interface Network {
  /** Modo nó (FUN-016): retransmitir mensagens cifradas de outras pessoas. */
  relay: boolean; setRelay: (v: boolean) => void;
  /** Modo nó pausado pela bateria (abaixo do limite, ou fora da tomada com "Só retransmitir carregando"). */
  relayPaused: boolean; setRelayPaused: (v: boolean) => void;
  tx: Record<TxKey, boolean>; toggleTx: (k: TxKey) => void;
  battery: 20 | 30 | 50; setBattery: (v: 20 | 30 | 50) => void;
  storage: 256 | 512 | 1024; setStorage: (v: 256 | 512 | 1024) => void;
  chargingOnly: boolean; setChargingOnly: (v: boolean) => void;
}

const Ctx = createContext<Network | null>(null);

/**
 * Modo nó, transportes e limites (escolhas da pessoa, salvas cifradas no aparelho).
 * Os equipamentos do provider não ficam aqui: são os piu-node pareados de verdade (lib/approvalNodes.ts).
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [relay, setRelay] = usePersisted('net.relay', true);
  const [tx, setTx] = usePersisted<Record<TxKey, boolean>>('net.tx', { ble: true, direct: true, mesh: false, lora: false, eth: false });
  const [battery, setBattery] = usePersisted<20 | 30 | 50>('net.battery', 30);
  const [storage, setStorage] = usePersisted<256 | 512 | 1024>('net.storage', 512);
  const [chargingOnly, setChargingOnly] = usePersisted('net.chargingOnly', false);
  const [relayPaused, setRelayPaused] = useState(false);

  const value = useMemo<Network>(() => ({
    relay, setRelay, relayPaused, setRelayPaused, tx, toggleTx: k => setTx(t => ({ ...t, [k]: !t[k] })),
    battery, setBattery, storage, setStorage, chargingOnly, setChargingOnly,
  }), [relay, setRelay, relayPaused, tx, setTx, battery, setBattery, storage, setStorage, chargingOnly, setChargingOnly]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNetwork(): Network {
  const n = useContext(Ctx);
  if (!n) throw new Error('useNetwork fora de NetworkProvider');
  return n;
}

export const fmtL = (n: number) => n.toFixed(2).replace('.', ',');
