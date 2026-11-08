// GERADO por scripts/sync-protocol.mjs a partir de apps/mobile/src/transport/meshtastic/nodeBeacon.ts. Não edite aqui.
/**
 * Anúncio de Super Node na porta 256 do Meshtastic ("PN", docs/transporte/super-node-lora.md): o piu-node
 * com rádio Meshtastic diz que está na malha, assinado pela chave técnica dele (a do handshake LNNP).
 * Um pacote só, de 104 bytes. Testado em __tests__/nodeBeacon.test.ts; o piu-node usa uma cópia.
 */
import type { KeyPair } from '../protocol/keys.js';
import { sign } from '../protocol/suite.js';

export const BEACON_BYTES = 104;
const MAGIC0 = 0x50, MAGIC1 = 0x4e, VERSION = 1, SIGNED = 40;
/** Diferença máxima de relógio aceita (s). */
const SKEW_SEC = 3600;
/** Quanto tempo o Super Node conta como "por perto" depois do último anúncio (s). */
export const NEAR_SEC = 40 * 60;
const LABEL = new TextEncoder().encode('piu/v0/lora-node');

const sigMsg = (head: Uint8Array) => { const m = new Uint8Array(LABEL.length + head.length); m.set(LABEL); m.set(head, LABEL.length); return m; };

export type NodeBeacon = { pk: Uint8Array; at: number; relay: boolean; gateway: boolean };
/** Super Node ouvido, para o mapa da rede: `id` = chave em hex, `last` = último anúncio (s). Sem posição: o "PN" não leva. */
export type HeardNode = { id: string; gateway: boolean; relay: boolean; last: number };

export function encodeNodeBeacon(node: KeyPair, o: { at: number; relay: boolean; gateway: boolean }): Uint8Array {
  const b = new Uint8Array(BEACON_BYTES);
  b[0] = MAGIC0; b[1] = MAGIC1; b[2] = VERSION;
  b.set(node.pk, 3);
  new DataView(b.buffer).setUint32(35, o.at >>> 0);
  b[39] = (o.relay ? 1 : 0) | (o.gateway ? 2 : 0);
  b.set(sign.sign(sigMsg(b.subarray(0, SIGNED)), node.sk), SIGNED);
  return b;
}

/** Anúncio válido (assinatura e horário perto de `now`, em s), ou `null` (inclusive se não for um "PN"). */
export function decodeNodeBeacon(b: Uint8Array, now: number): NodeBeacon | null {
  if (b.length !== BEACON_BYTES || b[0] !== MAGIC0 || b[1] !== MAGIC1 || b[2] !== VERSION) return null;
  const pk = b.slice(3, 35), at = new DataView(b.buffer, b.byteOffset).getUint32(35), flags = b[39]!;
  if (Math.abs(now - at) > SKEW_SEC) return null;
  if (!sign.verify(b.subarray(SIGNED), sigMsg(b.subarray(0, SIGNED)), pk)) return null;
  return { pk, at, relay: (flags & 1) !== 0, gateway: (flags & 2) !== 0 };
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/**
 * Super Nodes ouvidos, um por chave (o último anúncio vale), do calado há mais tempo ao mais recente.
 * Só um anúncio mais novo (`at` maior) renova: quem grava um anúncio do ar e repete não estica a
 * presença do nó. Cheia (64), sai o calado há mais tempo, não o nó que segue anunciando.
 */
export class NodeSightings {
  private seen = new Map<string, { b: NodeBeacon; last: number }>();
  saw(b: NodeBeacon, now: number) {
    const k = hex(b.pk), prev = this.seen.get(k);
    if (prev && b.at <= prev.b.at) return;
    this.seen.delete(k);
    this.seen.set(k, { b, last: now });
    if (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value!);
  }
  near(now: number): NodeBeacon[] {
    for (const [k, v] of this.seen) if (now - v.last > NEAR_SEC) this.seen.delete(k);
    return [...this.seen.values()].map(v => v.b);
  }
  /** Os de `near`, com a chave em hex e a hora do último anúncio (mapa da rede). */
  heard(now: number): HeardNode[] {
    this.near(now);
    return [...this.seen].map(([id, v]) => ({ id, gateway: v.b.gateway, relay: v.b.relay, last: v.last }));
  }
  clear() { this.seen.clear(); }
}
