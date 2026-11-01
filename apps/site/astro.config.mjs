// @ts-check
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// Site estático em PT (/) e EN (/en/). O painel do provider é copiado para /painel/
// por scripts/embed-panel.mjs e aparece embutido na seção "Seja provider".
export default defineConfig({
  // Defina o domínio final aqui para gerar URLs canônicas e hreflang absolutos.
  site: process.env.SITE_URL || undefined,
  integrations: [react()],
  i18n: { defaultLocale: 'pt', locales: ['pt', 'en'], routing: { prefixDefaultLocale: false } },
  build: { format: 'directory' },
});
