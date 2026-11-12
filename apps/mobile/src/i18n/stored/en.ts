// English. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': 'chat request · check the code',
  'stored.sub.e2e': 'end-to-end encrypted',
  'stored.sub.nearby': 'Nearby · end-to-end encrypted',
  'stored.sys.request': 'This person wrote first. Check the safety code in person before trusting them.',
  'stored.sys.keys': 'Keys exchanged. Messages are encrypted on this device and only the contact can read them.',
  'stored.sys.nearYou': 'You accepted the Nearby request. The chat is end-to-end encrypted.',
  'stored.sys.nearThem': '{name} accepted your Nearby invite. The chat is end-to-end encrypted.',
  'stored.sys.nearSomeone': 'The person accepted your Nearby invite. The chat is end-to-end encrypted.',
  'stored.sys.revoked': 'This contact revoked a lost or compromised device. Check the safety code in person before trusting new messages.',
  'stored.sys.leftChannel': 'You are no longer in this channel.',
  'stored.sys.removed': 'You were removed. The key was changed: you will not read anything new.',
  'stored.sys.groupRevoked': 'You revoked a device. The group key was changed.',
  'stored.sys.group': 'End-to-end encrypted group. Only people on the member list have the key.',
  'stored.sys.channel': 'End-to-end encrypted channel. Only people on the member list have the key.',
  'stored.sys.community': 'End-to-end encrypted community. Only people on the member list have the key.',
};
