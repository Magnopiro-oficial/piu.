// Deutsch. Same keys and {vars} as stored/pt-BR.ts (src/lib/__tests__/i18n.test.ts).
import type { Dict } from '../core';

export const stored: Dict = {
  'stored.sub.request': 'Chat-Anfrage · Code prüfen',
  'stored.sub.e2e': 'Ende-zu-Ende-verschlüsselt',
  'stored.sub.nearby': 'In der Nähe · Ende-zu-Ende-verschlüsselt',
  'stored.sys.request': 'Diese Person hat zuerst geschrieben. Prüfe den Sicherheitscode persönlich, bevor du ihr vertraust.',
  'stored.sys.keys': 'Schlüssel ausgetauscht. Nachrichten werden auf diesem Gerät verschlüsselt und nur der Kontakt kann sie lesen.',
  'stored.sys.nearYou': 'Du hast die Anfrage aus „In der Nähe“ angenommen. Der Chat ist Ende-zu-Ende-verschlüsselt.',
  'stored.sys.nearThem': '{name} hat deine Einladung aus „In der Nähe“ angenommen. Der Chat ist Ende-zu-Ende-verschlüsselt.',
  'stored.sys.nearSomeone': 'Die Person hat deine Einladung aus „In der Nähe“ angenommen. Der Chat ist Ende-zu-Ende-verschlüsselt.',
  'stored.sys.revoked': 'Dieser Kontakt hat ein verlorenes oder kompromittiertes Gerät widerrufen. Prüfe den Sicherheitscode persönlich, bevor du neuen Nachrichten vertraust.',
  'stored.sys.leftChannel': 'Du bist nicht mehr in diesem Kanal.',
  'stored.sys.removed': 'Du wurdest entfernt. Der Schlüssel wurde gewechselt: Du liest nichts Neues mehr.',
  'stored.sys.groupRevoked': 'Du hast ein Gerät widerrufen. Der Gruppenschlüssel wurde gewechselt.',
  'stored.sys.group': 'Ende-zu-Ende-verschlüsselte Gruppe. Nur wer auf der Mitgliederliste steht, hat den Schlüssel.',
  'stored.sys.channel': 'Ende-zu-Ende-verschlüsselter Kanal. Nur wer auf der Mitgliederliste steht, hat den Schlüssel.',
  'stored.sys.community': 'Ende-zu-Ende-verschlüsselte Community. Nur wer auf der Mitgliederliste steht, hat den Schlüssel.',
};
