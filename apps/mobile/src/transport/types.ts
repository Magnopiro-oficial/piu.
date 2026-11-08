import type { LanController } from './lan/controller';
import type { LoraRadio } from './meshtastic/radio';
import type { PiuLoraRadio } from './rnode/radio';

/** Transporte P2P: descobre vizinhos e troca envelopes (bytes já cifrados). Sem servidor. */
export type TransportKind = 'nearby' | 'ble' | 'sim';
export type TransportState = 'off' | 'starting' | 'running' | 'unavailable';

/**
 * Meio físico de um enlace com um vizinho. `nearby` = Nearby Connections no Android
 * (Bluetooth clássico + Wi-Fi Direct, alta banda); `ble` = Bluetooth LE GATT (Android e iPhone);
 * `lora` = malha Meshtastic pelo rádio LoRa da pessoa (pouquíssima banda, último recurso);
 * `piulora` = a mesma malha LoRa pelo rádio próprio do Piu (RNode, docs/transporte/super-node-lora.md),
 * preferido ao Meshtastic quando os dois estão ligados;
 * `lan` = LNNP pela rede Wi-Fi em que o celular está (UDP + TCP, o mesmo do Desktop e do piu-node).
 */
export type Medium = 'nearby' | 'ble' | 'lan' | 'lora' | 'piulora' | 'sim';

/**
 * Características declaradas de cada meio (INF-005). Usadas pela seleção de transporte
 * (FUN-013/014) para escolher, por vizinho, por onde cada envelope sai.
 */
export interface MediumCaps {
  medium: Medium;
  /** Maior envelope aceito de uma vez (bytes). */
  maxEnvelopeBytes: number;
  /** Unidade de transmissão do enlace (bytes por bloco/payload, antes da fragmentação do meio). */
  mtuBytes: number;
  /** Banda útil aproximada (bytes/s), só para ordenar meios; não é garantia. */
  approxBytesPerSec: number;
  /** Custo de energia relativo: 1 = baixo (BLE), 3 = alto (Wi-Fi Direct). */
  energyCost: 1 | 2 | 3 | 4;
}

/** `via`: o meio pelo qual o vizinho foi visto/conectado (o melhor disponível, se houver mais de um). */
export interface Peer { id: string; name: string; via: Medium; connected: boolean }

export type TransportEvent =
  | { type: 'state'; state: TransportState; reason?: string }
  | { type: 'peerFound'; peer: Omit<Peer, 'connected'> }
  | { type: 'peerLost'; id: string }
  /** `via` (opcional): meio do primeiro enlace que conectou. */
  | { type: 'connected'; id: string; name?: string; via?: Medium }
  | { type: 'disconnected'; id: string }
  /** `via` (opcional): meio por onde o envelope chegou. */
  | { type: 'envelope'; from: string; data: Uint8Array; via?: Medium };

export interface Transport {
  kind: TransportKind;
  /** Meios que este aparelho tem, com suas características (INF-005). */
  media: readonly MediumCaps[];
  /** `name`: identificador curto deste nó; `serviceId`: separa redes/versões do protocolo. */
  start(name: string, serviceId: string): Promise<void>;
  stop(): Promise<void>;
  /** Envia ao vizinho pelo melhor meio; se falhar, tenta o próximo (FUN-014). */
  send(peerId: string, data: Uint8Array): Promise<void>;
  subscribe(fn: (e: TransportEvent) => void): () => void;
  /** Bateria baixa → prefere BLE. `null` volta à leitura automática da bateria. */
  setPowerHint?(lowBattery: boolean | null): void;
  /** Liga/desliga meios por escolha da pessoa (aba Rede: Bluetooth LE, Wi-Fi Direct). */
  setMediaEnabled?(enabled: Partial<Record<Medium, boolean>>): void;
  /**
   * Modo nó em segundo plano (NFR-009). Android: serviço em primeiro plano com aviso fixo
   * "Piu retransmitindo mensagens". iPhone: sem efeito (só com o app aberto, por decisão de design).
   */
  setBackgroundRelay?(on: boolean): Promise<void>;
  /** "Procurar vizinhos" (NFR-004): intervalo entre varreduras de descoberta, em segundos. */
  setDiscoveryInterval?(seconds: number): void;
  /**
   * Rede local (LNNP pelo Wi-Fi, lan/controller.ts). Só no Android com o módulo nativo; liga e desliga
   * por conta própria (state/transport.tsx, `useLanTransport`), sem mexer em Bluetooth/Nearby.
   */
  lan?: LanController;
  /** Rádio Meshtastic pelo Bluetooth (meshtastic/radio.ts). Só no Android com o módulo piu-meshtastic. */
  lora?: LoraRadio;
  /** Rádio próprio do Piu (RNode) pelo Bluetooth (rnode/radio.ts). Só no Android com o módulo PiuRNode. */
  piulora?: PiuLoraRadio;
}

/**
 * Ajustes → Bateria e limites → "Procurar vizinhos" (design: Bluetooth a cada 60 s / 20 s / 5 s).
 * O iPhone limita a varredura em segundo plano: lá o intervalo vale com o app aberto.
 */
export const DISCOVERY_INTERVAL_SEC = { eco: 60, normal: 20, fast: 5 } as const;
export type DiscoveryMode = keyof typeof DISCOVERY_INTERVAL_SEC;

/** Identificador do serviço LNNP v1 (anúncio e descoberta). */
export const SERVICE_ID = 'net.piu.lnnp.v1';
