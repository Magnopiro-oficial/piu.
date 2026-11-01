/** Eventos que o módulo nativo emite. Os dados viajam em base64 pela ponte nativa. */
export type PiuTransportEvents = {
  onState: (e: { state: 'off' | 'starting' | 'running' | 'unavailable'; reason?: string }) => void;
  onPeerFound: (e: { id: string; name: string; via: 'nearby' | 'ble' }) => void;
  onPeerLost: (e: { id: string }) => void;
  onConnected: (e: { id: string; name?: string; auth?: string }) => void;
  onDisconnected: (e: { id: string }) => void;
  onEnvelope: (e: { from: string; data: string }) => void;
};
