// @ts-check
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// Site estático em PT (/) e EN (/en/). O painel do provider é copiado para /painel/
// por scripts/embed-panel.mjs e aparece embutido na seção "Seja provider".
export default defineConfig({
  // Defina o domínio final aqui para gerar URLs canônicas e hreflang absolutos.
  site: process.env.SITE_URL || undefined,
  // Caminho base (GitHub Pages sem domínio: /piu./). Com domínio próprio, fica '/'.
  base: process.env.BASE_PATH || '/',
  integrations: [react()],
  i18n: { defaultLocale: 'pt', locales: ['pt', 'en'], routing: { prefixDefaultLocale: false } },
  // CSS sempre em arquivo (nada de <style> inline) e nenhum recurso embutido como data:,
  // para a CSP estrita de public/_headers (style-src 'self', font-src 'self').
  build: { format: 'directory', inlineStylesheets: 'never' },
  vite: { build: { assetsInlineLimit: 0 } },
  // CSP gerada pelo Astro em <meta> em cada página, com hashes dos scripts/estilos que ele mesmo
  // injeta (hidratação da ilha React). Sem 'unsafe-inline' para scripts e folhas de estilo.
  // frame-ancestors não funciona em <meta>: vai por header (public/_headers).
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'none'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "frame-src 'self'",
        "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", 'upgrade-insecure-requests',
      ],
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
    },
  },
});
