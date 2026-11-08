/**
 * Bancada de teste do rádio do Piu: uma placa RNode emulada (rnode/emulator.ts) ligada ao app como o
 * Bluetooth liga de verdade. Escritas do celular vão em pedaços do MTU (Nus.chunks no Android) e as
 * notificações da placa chegam picadas em tamanhos variados e depois, como no aparelho.
 */
import type { ByteStream } from '../../rnode/link';
import { RNODE_BOARDS, RNodeEmulator, type BoardProfile, type EmulatorOptions } from '../../rnode/emulator';

/** Gerador determinístico (mulberry32): o mesmo teste pica os bytes sempre do mesmo jeito. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Espera as entregas pendentes (microtarefas e callbacks) do Bluetooth emulado. */
export async function settle(rounds = 20) { for (let i = 0; i < rounds; i++) await new Promise(r => setImmediate(r)); }

export class BleNus implements ByteStream {
  /** Bytes úteis por escrita/notificação (MTU negociado menos 3 do cabeçalho ATT). */
  readonly payload: number;
  private rnd: () => number;
  constructor(readonly emu: RNodeEmulator, o: { mtu?: number; seed?: number } = {}) {
    this.payload = (o.mtu ?? 185) - 3;
    this.rnd = seeded(o.seed ?? 7);
  }
  async write(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i += this.payload) {
      await Promise.resolve();
      this.emu.input(bytes.subarray(i, i + this.payload));
    }
  }
  onData(fn: (b: Uint8Array) => void) {
    return this.emu.onOutput(b => {
      let i = 0;
      while (i < b.length) {
        const n = 1 + Math.floor(this.rnd() * this.payload);
        const part = b.slice(i, i + n);
        i += n;
        queueMicrotask(() => fn(part));
      }
    });
  }
}

export const board = (name: string): BoardProfile => {
  const b = RNODE_BOARDS.find(x => x.name === name);
  if (!b) throw new Error(`placa ${name} não está em RNODE_BOARDS`);
  return b;
};

/** Placa emulada + Bluetooth + o que ela pôs no ar. */
export function bench(name = 'Heltec V3 (915)', o: EmulatorOptions & { now?: () => number; mtu?: number; seed?: number } = {}) {
  const emu = new RNodeEmulator(board(name), o);
  const aired: Uint8Array[] = [];
  emu.onTransmit(p => aired.push(p));
  const ble = new BleNus(emu, o);
  return { emu, ble, aired, hear: (p: Uint8Array) => emu.receive(p) };
}
