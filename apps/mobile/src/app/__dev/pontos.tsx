import { Redirect, type Href } from 'expo-router';
import type { ComponentType } from 'react';

/**
 * Galeria de desenvolvimento do Piu 13 "Pontos Piu" (P1…P9): `/__dev/pontos?id=P4a`. Só existe em __DEV__:
 * no build de produção o Metro troca `__DEV__` por `false` e a dobra de constantes apaga o `require` antes de
 * montar o pacote, então src/dev/PontosGallery.tsx nem entra no bundle (conferido no `expo export`).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Gallery: ComponentType | null = __DEV__ ? require('../../dev/PontosGallery').default : null;

export default function DevPontosGallery() {
  return Gallery ? <Gallery /> : <Redirect href={'/' as Href} />;
}
