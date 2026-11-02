import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { PROV_FAMILIES, seedProvDevices, type ProvDevice, type TxKey } from '../data/network';
import { usePersisted } from '../lib/persist';

/** Rascunho do assistente “Adicionar equipamento” (compartilhado entre as 4 etapas). */
export interface ProvDraft {
  fam: string; install: 'phone' | 'term'; name: string; pub: string; parent: string;
  /** Interfaces alteradas pela pessoa (índice → ligada). */
  ifaces: Record<number, boolean>;
  bw: 5 | 20 | 50; sto: 1 | 4 | 8; hours: 'always' | 'night' | 'day'; wallet: 'new' | 'personal';
}

interface Network {
  /** Modo nó (FUN-016): retransmitir mensagens cifradas de outras pessoas. */
  relay: boolean; setRelay: (v: boolean) => void;
  /** Modo nó pausado pela bateria (abaixo do limite, ou fora da tomada com "Só retransmitir carregando"). */
  relayPaused: boolean; setRelayPaused: (v: boolean) => void;
  tx: Record<TxKey, boolean>; toggleTx: (k: TxKey) => void;
  battery: 20 | 30 | 50; setBattery: (v: 20 | 30 | 50) => void;
  storage: 256 | 512 | 1024; setStorage: (v: 256 | 512 | 1024) => void;
  chargingOnly: boolean; setChargingOnly: (v: boolean) => void;
  devices: ProvDevice[];
  togglePause: (id: string) => void;
  revoke: (id: string) => void;
  draft: ProvDraft;
  setDraft: (p: Partial<ProvDraft>) => void;
  /** Cria o equipamento a partir do rascunho e devolve o id. */
  activate: () => ProvDevice;
}

const Ctx = createContext<Network | null>(null);

const freshDraft = (devices: ProvDevice[]): ProvDraft => ({
  fam: 'router', install: 'phone', name: PROV_FAMILIES[0].defName!, pub: 'vila-esperanca-4',
  parent: devices.find(d => !d.passive && d.cls !== 'Super Node')?.id ?? '', ifaces: {}, bw: 20, sto: 4, hours: 'always', wallet: 'new',
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [relay, setRelay] = usePersisted('net.relay', true);
  const [tx, setTx] = usePersisted<Record<TxKey, boolean>>('net.tx', { ble: true, direct: true, mesh: true, lora: false, eth: false });
  const [battery, setBattery] = usePersisted<20 | 30 | 50>('net.battery', 30);
  const [storage, setStorage] = usePersisted<256 | 512 | 1024>('net.storage', 512);
  const [chargingOnly, setChargingOnly] = usePersisted('net.chargingOnly', false);
  // Equipamentos do provider; `fresh` (animação de entrada) não sobrevive a reabrir o app.
  const [devices, setDevices] = usePersisted<ProvDevice[]>('net.devices', seedProvDevices, ds => ds.map(d => ({ ...d, fresh: false })));
  const [relayPaused, setRelayPaused] = useState(false);
  const [draft, setDraftState] = useState<ProvDraft>(() => freshDraft(seedProvDevices()));

  const value = useMemo<Network>(() => ({
    relay, setRelay, relayPaused, setRelayPaused, tx, toggleTx: k => setTx(t => ({ ...t, [k]: !t[k] })),
    battery, setBattery, storage, setStorage, chargingOnly, setChargingOnly,
    devices,
    togglePause: id => setDevices(ds => ds.map(d => (d.id !== id ? d : { ...d, status: d.status === 'paused' ? 'active' : 'paused' }))),
    revoke: id => setDevices(ds => ds.filter(d => d.id !== id)),
    draft,
    setDraft: p => setDraftState(d => ({ ...d, ...p })),
    activate: () => {
      const fam = PROV_FAMILIES.find(f => f.id === draft.fam)!;
      const parent = devices.find(d => d.id === draft.parent);
      const dev: ProvDevice = {
        id: 'dev' + Date.now(), name: (draft.name || fam.defName || '').trim(), model: fam.model ?? '', cls: (fam.result ?? '').split(' · ')[0], icon: fam.icon,
        status: fam.isAp ? 'active' : 'warming', pph: '—', today: 0, month: 0, nb: Number(fam.nb ?? 0),
        ifaces: (fam.ifaces ?? []).filter((x, i) => draft.ifaces[i] ?? x[2]).map(x => [x[0], 'aguardando tráfego', 3]),
        sto: fam.isAp ? null : [0, draft.sto], queue: '0', receipts: [], fresh: true,
        pub: 'piu.' + (draft.pub || 'novo-ponto'), passive: !!fam.isAp, parent: fam.isAp ? draft.parent : undefined,
      };
      if (fam.isAp) dev.model = `Repetidor comum · ligado ao ${parent?.name ?? 'nó pai'}`;
      setDevices(ds => [...ds, dev]);
      setDraftState(freshDraft([...devices, dev]));
      return dev;
    },
  }), [relay, relayPaused, tx, battery, storage, chargingOnly, devices, draft]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNetwork(): Network {
  const n = useContext(Ctx);
  if (!n) throw new Error('useNetwork fora de NetworkProvider');
  return n;
}

export const fmtL = (n: number) => n.toFixed(2).replace('.', ',');
