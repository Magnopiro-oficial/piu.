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
  },
  server: { port: 5188, strictPort: true },
});
