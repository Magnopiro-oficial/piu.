# Inventário do pacote (confira se tudo chegou)

Abra os protótipos com `npx serve design` (precisa de servidor; `support.js` carrega os componentes).

## design/ — protótipos (fonte da verdade)
| Arquivo | O que é |
|---|---|
| `Piu.dc.html` | Índice de todas as telas |
| `PiuApp.dc.html` | App mobile completo (todas as telas, animações, carteira, pagamento) |
| `Piu 1 Base do app.dc.html` … `Piu 8 Seguranca e ajustes.dc.html` | Pranchas por tema (8 arquivos) — usam `PiuApp` |
| `Piu Desktop.dc.html` | Piu Desktop Mac/Linux (entrada, 3 colunas, carteira, ajustes, notificações) |
| `PiuProviderDesktop.dc.html` | Painel do provider (computador) |
| `Piu Site.dc.html` / `Piu Site EN.dc.html` | Site PT / EN |
| `Piu Icones.dc.html` + `icons/a,b,c/` | Estudo de ícones |
| `Piu Investor Deck`, `Piu Pitch`, `Piu Provider Deck` (.dc.html) + `deck-stage.js` + `export/shots/` | Apresentações (não fazem parte do app) |
| `support.js` | Runtime dos protótipos — **obrigatório para abrir** |
| `capture.dc.html` | Página usada por `tools/capture.mjs` |

## design/brand/
- App mobile: `icon-1024.png`, `icon-512.png`, `icon-192.png`, `icon-maskable-512.png`, `icon-light-1024.png`, `piu-icon.svg`, `piu-mark.svg`, `apple-touch-icon.png`, favicons (`favicon.svg/.ico`, 16/32/48), `site.webmanifest`.
- **Piu Desktop**: `desktop/piu-desktop-icon.svg` + PNG 16, 32, 64, 128, 256, 512, 1024.
- **Piu Provider**: `provider/piu-provider-icon.svg` + PNG 16, 32, 64, 128, 256, 512, 1024.
- `desktop-vs-provider-preview.png` — os dois ícones lado a lado.

## docs/
- `COMO-LER-DC.md` — como ler os arquivos `.dc.html`.
- `APP-CARTEIRA-ENVIAR-RECEBER.md` — carteira mobile (obrigatório).
- `DESKTOP-CARTEIRA-ENVIAR-RECEBER.md` — carteira Desktop (obrigatório).
- `reference-code/app-wallet.js`, `reference-code/desktop-wallet.js` — lógica pronta (QR, tempos, estados).
- `animations/app.css`, `desktop.css`, `provider-desktop.css`, `site.css` — todos os keyframes.
- `Lunes_Network_Documento_de_Requisitos_v1.1.docx` — requisitos do produto.

## reference/
- `video/` — 7 vídeos: `app_launch`, `app_payment`, `app_receive_qr`, `desktop_mac_launch`, `desktop_linux_launch_dark`, `desktop_qr_pairing`, `desktop_wallet` (.webm).
- `app/launch` (10), `app/payment` (22), `app/receive_qr` (8), `app/wallet_send_receive` (4) — PNG.
- `desktop/mac_launch` (9), `desktop/linux_launch_dark` (9), `desktop/qr_pairing` (6), `desktop/wallet` (6), `desktop/wallet_send_receive` (9) — PNG.

## tools/
- `capture.mjs` + `package.json` — gera PNG de todas as telas (Node 18+, Playwright).

## Externos (internet)
Fontes do Google Fonts: **Geist**, **Geist Mono**, **Material Symbols Rounded**. Em produção, empacote-as localmente.
