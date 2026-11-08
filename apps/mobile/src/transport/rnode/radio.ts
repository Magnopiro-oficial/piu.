/**
 * O rádio próprio do Piu (RNode) da pessoa: buscar, conectar pelo Bluetooth (serviço Nordic UART) e
 * entregar os bytes ao `PiuLoraLink` (link.ts), que configura o rádio. O cliente BLE é injetado (no app,
 * modules/piu-meshtastic/rnode.ts) para testar sem rádio. Reconexão não é automática: a tela chama
 * `connect` de novo. Mesmos estados do rádio Meshtastic (meshtastic/radio.ts).
 */
import type { RadioDevice, RadioStatus } from '../meshtastic/radio';
import { PiuLoraLink } from './link';

/** O que o módulo nativo oferece (o mesmo formato de modules/piu-meshtastic/rnode.ts). */
export interface RNodeClient {
  scan(seconds: number): Promise<void>;
  connect(id: string): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  disconnect(): void;
  addDeviceListener(fn: (d: RadioDevice) => void): { remove(): void };
  addDataListener(fn: (data: Uint8Array) => void): { remove(): void };
  addStateListener(fn: (state: string, reason?: string) => void): { remove(): void };
}

export class PiuLoraRadio {
  private st: RadioStatus = { phase: 'idle', device: null, devices: [] };
  private fns = new Set<() => void>();

  constructor(private readonly client: RNodeClient, readonly link: PiuLoraLink = new PiuLoraLink()) {
    client.addDeviceListener(d => {
      // Teto de 32 (os de sinal mais forte): anúncios falsos em massa não incham a lista nem a tela.
      const devices = [...this.st.devices.filter(x => x.id !== d.id), d].sort((a, b) => b.rssi - a.rssi).slice(0, 32);
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

  /** Conecta e configura o rádio; se a configuração for recusada, o motivo fica em `link.status().problem`. */
  async connect(id: string) {
    const device = this.st.devices.find(d => d.id === id) ?? { id, name: id, rssi: 0 };
    this.set({ phase: 'connecting', device, error: undefined });
    try {
      await this.client.connect(id);
      const c = this.client;
      this.set({ phase: 'connected' });
      await this.link.attach({ write: b => c.write(b), onData: fn => { const s = c.addDataListener(fn); return () => s.remove(); } });
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
