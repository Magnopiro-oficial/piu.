import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// No `npm run dev`, o Vite injeta o CSS por <style> (e o React Refresh por script inline), que a CSP
// estrita do index.html bloqueia: o painel aparecia sem estilo. A CSP sai só no servidor de
// desenvolvimento; o build (e o que o piu-node serve) continua com ela.
const devWithoutCsp = (): Plugin => ({
  name: 'piu-dev-sem-csp',
  apply: 'serve',
  transformIndexHtml: html => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
});

// O painel é servido pelo daemon piu-node na rede local (piu-node.local:8420),
// sem internet: tudo (fontes e ícones inclusive) vai empacotado no build.
export default defineConfig({
  plugins: [react(), devWithoutCsp()],
  base: './',
  // Nada embutido como data: (fontes viram arquivos): permite CSP estrita (font-src 'self').
  build: { assetsInlineLimit: 0 },
  // Dev e preview só neste computador: sem CSP (ver acima) e com /src e /@fs, não devem ficar abertos
  // na rede (auditoria 2026-11-06, provider.md B-05). Para testar em outro aparelho: `npm run dev -- --host`.
  server: { port: 8420, host: 'localhost', strictPort: true },
  preview: { port: 8420, host: 'localhost' },
});
