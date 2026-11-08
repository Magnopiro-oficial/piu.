/**
 * O rádio Meshtastic da pessoa: buscar, conectar pelo Bluetooth e entregar ao `LoraLink` (link.ts).
 * O cliente BLE é injetado (no app, modules/piu-meshtastic) para testar sem rádio. Reconexão não é
 * automática: a tela chama `connect` de novo.
 */
import { LoraLink } from './link';

export type RadioDevice = { id: string; name: string; rssi: number };
export type RadioPhase = 'idle' | 'scanning' | 'connecting' | 'pairing' | 'connected' | 'away' | 'error';
export type RadioStatus = { phase: RadioPhase; device: RadioDevice | null; devices: RadioDevice[]; error?: string };

/** O que o módulo nativo oferece (o mesmo formato de modules/piu-meshtastic). */
export interface RadioClient {
  scan(seconds: number): Promise<void>;
  connect(id: string): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  drain(): Promise<void>;
  disconnect(): void;
  addDeviceListener(fn: (d: RadioDevice) => void): { remove(): void };
  addFromRadioListener(fn: (data: Uint8Array) => void): { remove(): void };
  addStateListener(fn: (state: string, reason?: string) => void): { remove(): void };
}

export class LoraRadio {
  private st: RadioStatus = { phase: 'idle', device: null, devices: [] };
  private fns = new Set<() => void>();

  constructor(private readonly client: RadioClient, readonly link: LoraLink = new LoraLink()) {
    client.addDeviceListener(d => {
      const devices = [...this.st.devices.filter(x => x.id !== d.id), d].sort((a, b) => b.rssi - a.rssi);
      this.set({ devices });
    });
    client.addStateListener((state, reason) => {
      if (state === 'connecting' && reason === 'bond') this.set({ phase: 'pairing' });
      else if (state === 'disconnected' && this.st.phase === 'connected') { this.link.detach(); this.set({ phase: 'away' }); }
    });
  }

  status(): RadioStatus { return { ...this.st, devices: [...this.st.devices] }; }
  onChange(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private set(p: Partial<RadioStatus>) { this.st = { ...this.st, ...p }; this.fns.forEach(f => f()); }

  /** `keep`: continua uma busca (a lista não pisca a cada rodada). */
  async scan(seconds = 10, keep = false) {
    this.set({ phase: 'scanning', ...(keep ? {} : { devices: [] }), error: undefined });
    try { await this.client.scan(seconds); if (this.st.phase === 'scanning') this.set({ phase: 'idle' }); }
    catch (e) { this.set({ phase: 'error', error: code(e) }); }
  }

  async connect(id: string) {
    const device = this.st.devices.find(d => d.id === id) ?? { id, name: id, rssi: 0 };
    this.set({ phase: 'connecting', device, error: undefined });
    try {
      await this.client.connect(id);
      const c = this.client;
      await this.link.attach({ write: b => c.write(b), drain: () => c.drain(), onFromRadio: fn => { const s = c.addFromRadioListener(fn); return () => s.remove(); } });
      this.set({ phase: 'connected' });
    } catch (e) {
      this.link.detach();
      this.set({ phase: 'error', error: code(e) });
    }
  }

  disconnect() {
    this.client.disconnect();
    this.link.detach();
    this.set({ phase: 'idle', device: null });
  }
}

const code = (e: unknown) => (e as { code?: string })?.code ?? 'ERR';
