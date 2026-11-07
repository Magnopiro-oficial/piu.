// Renderer (React) do Piu Desktop. Sai em dist/renderer e é carregado por file:// pelo processo principal,
// por isso `base: './'`. Nada do Node entra aqui: o renderer só fala com o app pela ponte do preload.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    // Fontes viram arquivos de verdade: a CSP (`font-src 'self'`) bloqueia fonte embutida em data:.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  server: { port: 5188, strictPort: true },
});
