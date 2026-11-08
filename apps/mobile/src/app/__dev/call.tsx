import { Redirect, type Href } from 'expo-router';
import type { ComponentType } from 'react';

/**
 * Galeria de desenvolvimento do Piu 14 "Chamada de voz": `/__dev/call?id=out&anim=suave`. Só existe em
 * __DEV__: no build de produção o Metro troca `__DEV__` por `false` e a dobra de constantes apaga o
 * `require` antes de montar o pacote, então src/dev/CallGallery.tsx nem entra no bundle.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Gallery: ComponentType | null = __DEV__ ? require('../../dev/CallGallery').default : null;

export default function DevCallGallery() {
  return Gallery ? <Gallery /> : <Redirect href={'/' as Href} />;
}
