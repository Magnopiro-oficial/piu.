# piu.

Mensageiro **descentralizado e offline-first** da Lunes Network. As mensagens viajam de aparelho em aparelho (Bluetooth LE, Wi-Fi Direct, Wi-Fi Mesh, LoRa, USB/Ethernet), sem internet nem servidor central, com criptografia ponta a ponta e store-and-forward.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| [`apps/provider-panel`](apps/provider-panel) | Painel local do provider (Vite + React + TypeScript), servido pelo `piu-node` em `piu-node.local:8420` |
| [`apps/site`](apps/site) | Site do projeto em PT e EN (Astro), com o painel embutido |
| [`apps/mobile`](apps/mobile) | App Piu para Android e iOS (Expo + React Native), em construção por etapas |
| [`design/`](design) | Protótipos de referência em HTML (Claude Design): app mobile, painel do provider e site em PT/EN |
| [`docs/design-spec.md`](docs/design-spec.md) | Especificação de design: tokens, tipografia, movimento, telas e regras de produto |
| [`docs/requisitos/`](docs/requisitos) | Documento de requisitos da Lunes Network (IDs FUN, INF e NFR) |
| [`docs/historico-do-design.md`](docs/historico-do-design.md) | Conversa de design com as decisões tomadas |

## Painel do provider

```bash
cd apps/provider-panel
npm install
npm run dev      # http://localhost:8420
npm run build    # gera dist/
```

Detalhes em [`apps/provider-panel/README.md`](apps/provider-panel/README.md).

## Site

```bash
cd apps/site
npm install
npm run dev      # http://localhost:4321
```

Detalhes em [`apps/site/README.md`](apps/site/README.md).

## App mobile

```bash
cd apps/mobile
npm install
npm start        # Android, iOS ou web
```

Detalhes em [`apps/mobile/README.md`](apps/mobile/README.md).

## Protótipos

Abra qualquer `design/*.dc.html` no navegador (o `support.js` precisa estar na mesma pasta). O índice é `design/Piu.dc.html`. Eles são **referência visual**, não código de produção.

## Roadmap

- [x] Painel do provider para computador
- [x] Site do projeto (PT e EN)
- [ ] App mobile (Android e iOS): etapa 1 de 5 feita (onboarding e Conversas)
