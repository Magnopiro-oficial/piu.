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

## Ainda provisório
- Os botões de download só mostram orientações; ainda não há APK nem pacotes publicados.
- "Especificação LNNP" ainda aponta para as Dúvidas.
- A assinatura e o SHA-256 exibidos são de exemplo.
