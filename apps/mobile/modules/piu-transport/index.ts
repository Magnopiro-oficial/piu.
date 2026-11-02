export { default as PiuTransport } from './src/PiuTransportModule';
export type { PiuMedium, PiuTransportEvents } from './src/PiuTransport.types';

/** Protocolo comum entre plataformas (Bluetooth LE GATT). Ver modules/piu-transport/README.md. */
export const BLE_SERVICE_UUID = '02999473-3C58-4C4C-A014-DDA62869CFCE';
export const BLE_INBOX_UUID = '7B41CD1F-85C3-400F-A6F9-5B89DD6B0915';
export const BLE_OUTBOX_UUID = 'E7D5F504-1483-497F-B64E-9DB52C4D3240';
/** Limite de um envelope (o Nearby Connections aceita até 32 KB por payload de bytes). */
export const MAX_ENVELOPE_BYTES = 32 * 1024;
/** Texto do aviso fixo do Android enquanto o Modo nó retransmite em segundo plano (NFR-009). */
export const RELAY_NOTIFICATION = {
  title: 'Piu retransmitindo mensagens',
  text: 'Modo nó ligado: mensagens cifradas de outras pessoas passam por este aparelho.',
};
