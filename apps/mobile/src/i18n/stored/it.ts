// Italiano. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': 'richiesta di chat · verifica il codice',
  'stored.sub.e2e': 'cifrata end-to-end',
  'stored.sub.nearby': 'Vicino · cifrata end-to-end',
  'stored.sys.request': 'Questa persona ha scritto per prima. Verifica il codice di sicurezza di persona prima di fidarti.',
  'stored.sys.keys': 'Chiavi scambiate. I messaggi sono cifrati su questo dispositivo e solo il contatto può leggerli.',
  'stored.sys.nearYou': 'Hai accettato la richiesta da Vicino. La chat è cifrata end-to-end.',
  'stored.sys.nearThem': '{name} ha accettato il tuo invito da Vicino. La chat è cifrata end-to-end.',
  'stored.sys.nearSomeone': 'La persona ha accettato il tuo invito da Vicino. La chat è cifrata end-to-end.',
  'stored.sys.revoked': 'Questo contatto ha revocato un dispositivo perso o compromesso. Verifica il codice di sicurezza di persona prima di fidarti dei nuovi messaggi.',
  'stored.sys.leftChannel': 'Non sei più in questo canale.',
  'stored.sys.removed': 'Sei stato rimosso. La chiave è cambiata: non leggerai nulla di nuovo.',
  'stored.sys.groupRevoked': 'Hai revocato un dispositivo. La chiave del gruppo è cambiata.',
  'stored.sys.group': 'Gruppo cifrato end-to-end. Solo chi è nella lista dei membri ha la chiave.',
  'stored.sys.channel': 'Canale cifrato end-to-end. Solo chi è nella lista dei membri ha la chiave.',
  'stored.sys.community': 'Community cifrata end-to-end. Solo chi è nella lista dei membri ha la chiave.',
};
