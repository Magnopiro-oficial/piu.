import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O painel é servido pelo daemon piu-node na rede local (piu-node.local:8420),
// sem internet: tudo (fontes e ícones inclusive) vai empacotado no build.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 8420, host: true },
  preview: { port: 8420, host: true },
});
