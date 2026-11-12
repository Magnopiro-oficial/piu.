/** Meio de um enlace: Nearby Connections (só Android) ou Bluetooth LE GATT (Android e iPhone). */
export type PiuMedium = 'nearby' | 'ble';

/**
 * Eventos que o módulo nativo emite. Os dados viajam em base64 pela ponte nativa.
 * `id` é o id do enlace dentro do meio `via` (endpoint do Nearby, endereço/UUID do BLE).
 * `via` é opcional nos eventos para aceitar binários antigos (sem `via` = `kind()`).
 */
export type PiuTransportEvents = {
  onState: (e: { state: 'off' | 'starting' | 'running' | 'unavailable'; reason?: string }) => void;
  /** Também reenviado quando o nome do enlace fica conhecido (bloco `hello` do BLE). */
  onPeerFound: (e: { id: string; name: string; via: PiuMedium }) => void;
  onPeerLost: (e: { id: string; via?: PiuMedium }) => void;
  onConnected: (e: { id: string; name?: string; auth?: string; via?: PiuMedium }) => void;
  onDisconnected: (e: { id: string; via?: PiuMedium }) => void;
  onEnvelope: (e: { from: string; data: string; via?: PiuMedium }) => void;
  /** Pulso do serviço em primeiro plano (a cada 5 s, com wake lock curto), só enquanto ele está ligado. */
  onHeartbeat: () => void;
};
