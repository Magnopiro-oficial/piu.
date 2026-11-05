// Empacota o processo principal e o preload num arquivo cada (esbuild), como o apps/provider-desktop.
// O app instalado não precisa de node_modules: dist/main.cjs + dist/preload.cjs + dist/renderer (Vite).
// O núcleo do celular (apps/mobile/src/protocol, messaging, lib) entra por caminho relativo e é
// empacotado aqui; nada dele é copiado ou editado.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  legalComments: 'linked',
  sourcemap: false,
  minify: false,
  logOverride: { 'require-resolve-not-external': 'silent' },
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs' });
// O preload roda em sandbox: só pode usar `electron` (contextBridge/ipcRenderer) e nada do Node.
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.cjs', platform: 'browser', format: 'cjs' });
console.log('dist/main.cjs e dist/preload.cjs prontos');
