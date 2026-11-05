/**
 * Transporte do Piu Desktop: descobre vizinhos e troca envelopes (bytes já cifrados) com eles.
 * Mesma ideia do `apps/mobile/src/transport/types.ts`, com os meios do computador:
 * - `lan`: rede local (Wi-Fi/Ethernet) pelo LNNP v1, como o piu-node (implementado: lnnpLan.ts).
 * - `ble`: Bluetooth LE (interface pronta, implementação depois: bleStub.ts).
 */
import type { PeerInfo, TransportState } from '../shared/types';

export type DesktopMedium = 'lan' | 'ble';

export type TransportEvent =
  | { type: 'state'; state: TransportState; reason?: string }
  /** Enlace autenticado com um vizinho. `id`: id curto do nó (16 hex); `pk`: chave completa (hex). */
  | { type: 'connected'; id: string; pk: string; address: string }
  | { type: 'disconnected'; id: string }
  /** Envelope (bytes) vindo do vizinho `from`. */
  | { type: 'envelope'; from: string; data: Uint8Array }
  /** A lista/estado dos vizinhos mudou (para a tela Rede). */
  | { type: 'peers' };

export interface Transport {
  readonly kind: DesktopMedium;
  readonly state: TransportState;
  /** Motivo do estado `unavailable` (texto para a pessoa). */
  readonly reason?: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Envia ao vizinho pelo enlace aberto; rejeita se não há enlace (a fila do roteador segura). */
  send(peerId: string, data: Uint8Array): Promise<void>;
  subscribe(fn: (e: TransportEvent) => void): () => void;
  /** Vizinhos fixos e descobertos, com estado. */
  peerStatus(): PeerInfo[];
  /** Enlaces abertos agora. */
  readonly linkCount: number;
}
