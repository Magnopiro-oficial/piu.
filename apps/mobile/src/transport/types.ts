/** Transporte P2P: descobre vizinhos e troca envelopes (bytes já cifrados). Sem servidor. */
export type TransportKind = 'nearby' | 'ble' | 'sim';
export type TransportState = 'off' | 'starting' | 'running' | 'unavailable';

export interface Peer { id: string; name: string; via: 'nearby' | 'ble' | 'sim'; connected: boolean }

export type TransportEvent =
  | { type: 'state'; state: TransportState; reason?: string }
  | { type: 'peerFound'; peer: Omit<Peer, 'connected'> }
  | { type: 'peerLost'; id: string }
  | { type: 'connected'; id: string; name?: string }
  | { type: 'disconnected'; id: string }
  | { type: 'envelope'; from: string; data: Uint8Array };

export interface Transport {
  kind: TransportKind;
  /** `name`: identificador curto deste nó; `serviceId`: separa redes/versões do protocolo. */
  start(name: string, serviceId: string): Promise<void>;
  stop(): Promise<void>;
  send(peerId: string, data: Uint8Array): Promise<void>;
  subscribe(fn: (e: TransportEvent) => void): () => void;
}

/** Identificador do serviço LNNP v1 (anúncio e descoberta). */
export const SERVICE_ID = 'net.piu.lnnp.v1';
