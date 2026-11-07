import { Redirect, type Href } from 'expo-router';
import type { ComponentType } from 'react';

/**
 * Galeria de desenvolvimento do Piu 11 (N1…N10c): `/__dev/node?id=N3a`. Só existe em __DEV__: no build
 * de produção o Metro troca `__DEV__` por `false` e a dobra de constantes apaga o `require` antes de
 * montar o pacote, então src/dev/NodeGallery.tsx nem entra no bundle (conferido no `expo export`).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Gallery: ComponentType | null = __DEV__ ? require('../../dev/NodeGallery').default : null;

export default function DevNodeGallery() {
  return Gallery ? <Gallery /> : <Redirect href={'/' as Href} />;
}
