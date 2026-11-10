// Español. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': 'solicitud de conversación · comprueba el código',
  'stored.sub.e2e': 'cifrada de extremo a extremo',
  'stored.sub.nearby': 'Cerca · cifrada de extremo a extremo',
  'stored.sys.request': 'Esta persona escribió primero. Comprueba el código de seguridad en persona antes de confiar.',
  'stored.sys.keys': 'Claves intercambiadas. Los mensajes se cifran en este dispositivo y solo el contacto puede leerlos.',
  'stored.sys.nearYou': 'Aceptaste la solicitud de Cerca. La conversación está cifrada de extremo a extremo.',
  'stored.sys.nearThem': '{name} aceptó tu invitación de Cerca. La conversación está cifrada de extremo a extremo.',
  'stored.sys.nearSomeone': 'La persona aceptó tu invitación de Cerca. La conversación está cifrada de extremo a extremo.',
  'stored.sys.revoked': 'Este contacto revocó un dispositivo perdido o comprometido. Comprueba el código de seguridad en persona antes de confiar en mensajes nuevos.',
  'stored.sys.leftChannel': 'Ya no estás en este canal.',
  'stored.sys.removed': 'Te quitaron. La clave cambió: no leerás nada nuevo.',
  'stored.sys.groupRevoked': 'Revocaste un dispositivo. La clave del grupo cambió.',
  'stored.sys.group': 'Grupo cifrado de extremo a extremo. Solo quien está en la lista de miembros tiene la clave.',
  'stored.sys.channel': 'Canal cifrado de extremo a extremo. Solo quien está en la lista de miembros tiene la clave.',
  'stored.sys.community': 'Comunidad cifrada de extremo a extremo. Solo quien está en la lista de miembros tiene la clave.',
};
