// Français. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': 'demande de conversation · vérifiez le code',
  'stored.sub.e2e': 'chiffrée de bout en bout',
  'stored.sub.nearby': 'À proximité · chiffrée de bout en bout',
  'stored.sys.request': 'Cette personne a écrit en premier. Vérifiez le code de sécurité en personne avant de lui faire confiance.',
  'stored.sys.keys': 'Clés échangées. Les messages sont chiffrés sur cet appareil et seul le contact peut les lire.',
  'stored.sys.nearYou': 'Vous avez accepté la demande À proximité. La conversation est chiffrée de bout en bout.',
  'stored.sys.nearThem': '{name} a accepté votre invitation À proximité. La conversation est chiffrée de bout en bout.',
  'stored.sys.nearSomeone': 'La personne a accepté votre invitation À proximité. La conversation est chiffrée de bout en bout.',
  'stored.sys.revoked': 'Ce contact a révoqué un appareil perdu ou compromis. Vérifiez le code de sécurité en personne avant de faire confiance aux nouveaux messages.',
  'stored.sys.leftChannel': 'Vous n’êtes plus dans ce canal.',
  'stored.sys.removed': 'Vous avez été retiré. La clé a changé : vous ne lirez plus rien de nouveau.',
  'stored.sys.groupRevoked': 'Vous avez révoqué un appareil. La clé du groupe a changé.',
  'stored.sys.group': 'Groupe chiffré de bout en bout. Seuls les membres de la liste ont la clé.',
  'stored.sys.channel': 'Canal chiffré de bout en bout. Seuls les membres de la liste ont la clé.',
  'stored.sys.community': 'Communauté chiffrée de bout en bout. Seuls les membres de la liste ont la clé.',
};
