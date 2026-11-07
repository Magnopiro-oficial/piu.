# Site do Piu

Site do projeto em português (`/`) e inglês (`/en/`), recriado a partir de `design/Piu Site.dc.html` e `design/Piu Site EN.dc.html`. Feito com **Astro** e gerado como HTML estático; fontes e ícones vão dentro do build.

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # gera dist/ (inclui o painel do provider em /painel/)
npm run preview
```

`npm run dev` e `npm run build` rodam antes `scripts/embed-panel.mjs`, que compila `apps/provider-panel` e copia o resultado para `public/painel/`. É esse painel que aparece embutido em "Seja provider" e abre em tela cheia pelo botão "Ver o painel". Ele acompanha o tema escolhido no site.

## Estrutura
- `src/i18n/pt.ts` e `src/i18n/en.ts`: todos os textos. O inglês é tipado pelo português, então nenhuma chave fica faltando.
- `src/components/SitePage.astro`: a página, igual para os dois idiomas.
- `src/components/PhoneDemo.tsx`: o celular do topo (React). Recria a tela de Conversas do app, com troca de identidade, filtros, busca, abrir conversa e enviar mensagem passando pelos estados de entrega. Fica em português, como o app.
- `src/layouts/Base.astro`: `<head>`, metadados e o tema aplicado antes da primeira pintura.

## Domínio
Defina `SITE_URL` (ex.: `SITE_URL=https://exemplo.org npm run build`) para gerar a URL canônica e os `hreflang` absolutos.

## Downloads (fonte única)
Todos os links, tamanhos e SHA-256 vêm de `src/lib/releases.json`, gerado por `node scripts/sync-release.mjs` a partir dos releases publicados no GitHub (`--dry-run` só mostra). Release inexistente ou rascunho = "em breve", sem link. Hoje: APK `android-v0.1.0` publicado; `desktop-v0.1.0` não existe; `provider-v0.1.0` é rascunho. O certificado do APK fica em `src/lib/androidRelease.ts`.

## Publicação
`.github/workflows/pages-site.yml` publica no **GitHub Pages** a cada mudança na `main`.

## Segurança
- **CSP com hashes** gerada pelo Astro (`security.csp` em `astro.config.mjs`) numa `<meta>` em cada página: scripts e folhas de estilo só do próprio site, mais os hashes do que o Astro injeta para hidratar a ilha React. Sem `'unsafe-inline'` para scripts. O tema é aplicado por `public/theme-init.js`, e não por script inline.
- **Nada embutido como `data:`** (`inlineStylesheets: 'never'`, `assetsInlineLimit: 0`), para valer `font-src 'self'`.
- **Headers** em `public/_headers` (formato Cloudflare Pages/Netlify): `frame-ancestors 'none'`/`X-Frame-Options: DENY` no site; o painel em `/painel/` só pode ser exibido pelo próprio site (`frame-ancestors 'self'`, `SAMEORIGIN`); `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS.
- **Atenção: o GitHub Pages ignora `_headers`** e não deixa configurar headers. Lá valem só a CSP em `<meta>`, o `referrer` em `<meta>`, o HSTS do próprio github.io e o anti-iframe de `public/theme-init.js` (esconde a página se ela estiver dentro de um iframe). Ficam faltando `nosniff`, `Permissions-Policy`, COOP/CORP e `frame-ancestors` de verdade. Para tê-los, publique atrás da Cloudflare (domínio próprio com Transform Rules, ou Cloudflare Pages com este `_headers`).
