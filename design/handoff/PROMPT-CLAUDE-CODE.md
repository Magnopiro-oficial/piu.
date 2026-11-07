# Prompt para colar no Claude Code

Você vai implementar o ecossistema Piu (app mobile, Piu Desktop para Mac/Linux, painel do provider e site) a partir desta pasta de handoff. A fidelidade visual e de movimento precisa ser **exata**.

## Antes de escrever código
0. Confira `ARQUIVOS.md`: se algum arquivo listado não existir, pare e avise.
1. Leia `README.md` inteiro (tokens, telas, fluxos e cronologia das animações).
2. Leia `docs/COMO-LER-DC.md`. Os arquivos `design/*.dc.html` são componentes com template `{{ }}`: estilos dinâmicos e todas as `animation:` calculadas ficam na classe `Component`, no fim de cada arquivo.
3. Assista aos vídeos em `reference/video/` e veja os quadros-chave em `reference/app/` e `reference/desktop/`. Para PNG de todas as telas, gere:
   ```
   cd tools && npm i && npx playwright install chromium && node capture.mjs
   ```
   Isso cria `reference/` com PNG de todas as telas (claro e escuro) e vídeos `.webm` das animações principais.
4. Para ver os protótipos funcionando: `npx serve design` e abra `Piu.dc.html` (índice), `PiuApp.dc.html`, `Piu Desktop.dc.html`, `PiuProviderDesktop.dc.html` e `Piu Site.dc.html`.

## Correção pendente (faça primeiro)
A Carteira do Piu Desktop foi implementada errada: **Receber sem QR code** e **Enviar sem os valores pré-definidos (1 · 5 · 10 · 25)**, sem destinatários e sem o resumo. Refaça seguindo `docs/DESKTOP-CARTEIRA-ENVIAR-RECEBER.md` à risca, use `docs/reference-code/desktop-wallet.js` (QR, estados, tempos) e compare com os 9 PNG de `reference/desktop/wallet_send_receive/` em claro e escuro. Só considere pronto quando todos os itens do checklist do documento estiverem marcados.

O mesmo vale para o **app mobile**: faltaram os botões **Enviar · Receber · Convidar** no cartão de saldo, o **QR animado** em Receber e a **cena de pagamento** inteira. Refaça pelo `docs/APP-CARTEIRA-ENVIAR-RECEBER.md` (linha do tempo segundo a segundo), use `docs/reference-code/app-wallet.js` e compare com `reference/app/wallet_send_receive/`, `reference/app/payment/`, `reference/app/receive_qr/` e os vídeos `app_payment.webm` / `app_receive_qr.webm`.

## Regras
- Use os valores de `docs/animations/*.css` (keyframes, durações, curvas e atrasos). Não aproxime.
- Fontes: Geist, Geist Mono e Material Symbols Rounded. Ícones de marca em `design/brand/`.
- **Ícones de instalação diferentes**: Piu Desktop usa `design/brand/desktop/`, Piu Provider usa `design/brand/provider/` (nomes, bundle ids e `.desktop` separados — ver README › Assets).
- Paleta só em tons de cinza; tema claro e escuro pelas variáveis listadas no README.
- Respeite `prefers-reduced-motion` e o ajuste "Animações" do Desktop.
- Ao terminar cada tela, compare com o PNG de `reference/` correspondente e com o vídeo, quando houver. Se houver diferença, corrija antes de seguir.

## Ordem sugerida
1. Tokens, fontes e componentes base (botões, folhas, diálogos, toasts, avatares).
2. App mobile: abertura, abas e transições, conversas, carteira (contagem do saldo, QR animado em Receber, segurar para assinar e cena de pagamento), Por perto, rede/provider, perfil e ajustes, notificações.
3. Piu Desktop: abertura, entrada (QR, criar, restaurar), três colunas, carteira, 11 páginas de ajustes, notificação nativa Mac/Linux.
4. Painel do provider (desktop).
5. Site PT/EN com animações de rolagem e área de download do Desktop.
