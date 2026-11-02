// Empacota o processo principal (com o piu-node e suas dependências) num único arquivo.
// O app instalado não precisa de node_modules: só dist/main.cjs e o painel em resources/panel.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  // Dependências opcionais do pino (logger do Fastify) que o nó embutido não usa.
  logOverride: { 'require-resolve-not-external': 'silent' },
  legalComments: 'linked',
  sourcemap: false,
  minify: false,
});
console.log('dist/main.cjs pronto');
