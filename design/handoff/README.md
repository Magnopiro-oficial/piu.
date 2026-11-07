# Handoff: Piu — mensageiro descentralizado (Lunes Network)

## Visão geral
Piu é um mensageiro **offline-first** da Lunes Network: as mensagens viajam de aparelho em aparelho (Bluetooth LE, Wi-Fi Direct, Wi-Fi Mesh, LoRa, USB/Ethernet) sem internet nem servidor central, com criptografia ponta a ponta e store-and-forward. O pacote cobre:

1. **App mobile** (Android/iOS): onboarding, conversas, grupos, canais, comunidades, rota da mensagem, rede/modo nó, carteira LUNES, convite P2P (distribuição do APK de celular para celular), Por perto (convite pago), alertas/notificações, provider pelo celular, segurança e ajustes.
2. **Painel do provider para computador**: servido localmente pelo nó (`piu-node.local:8420`), para operar roteadores, antenas e gateways e acompanhar ganhos.
3. **Site do projeto** em PT e EN.

Requisitos de produto: `docs/Lunes_Network_Documento_de_Requisitos_v1.1.docx` (IDs FUN-xxx, INF-xxx, NFR-xxx citados abaixo vêm desse documento).

## Vídeos de referência (já incluídos)
Gravados quadro a quadro com relógio virtual (timing exato do protótipo), em `reference/video/`:
- `app_launch.webm` — abertura do app (ícone, nome, "procurando por perto", entrada).
- `app_payment.webm` — segurar para assinar → cena de pagamento completa → Concluir → saldo descendo e nova linha destacada (9,5 s).
- `app_receive_qr.webm` — folha Receber com QR nascendo em onda e linha de leitura.
- `desktop_mac_launch.webm` / `desktop_linux_launch_dark.webm` — abertura do Piu Desktop até a tela de entrada.
- `desktop_qr_pairing.webm` — QR de pareamento com o celular.
- `desktop_wallet.webm` — carteira do Desktop com contagem do saldo.

Quadros-chave em PNG (nomeados pelo tempo, ex.: `2500ms.png`) em `reference/app/<fluxo>/` e `reference/desktop/<fluxo>/`. Mobile em 390×844 (1×); Desktop em 832×533 (janela 1280×820 a 65%). Para gerar PNG de **todas** as telas, rode `tools/capture.mjs`.

## ⚠ Leia primeiro — como garantir fidelidade
1. **Assista aos vídeos em `reference/video/`** e, para as demais telas, **gere as referências renderizadas** antes de escrever código (precisa de Node 18+):
   ```
   cd tools && npm i && npx playwright install chromium && node capture.mjs
   ```
   Sai em `reference/`: PNG @2x de **todas as telas** (app mobile ~65 em claro e escuro, provider claro/escuro, Desktop mac/linux × claro/escuro com entrada, conversa, rota, carteira e 11 ajustes), notificações, canvases, e **vídeos `.webm` das animações** (abertura do app, pagamento completo, envio de mensagem, banner, emergência, troca de abas, abertura do Desktop mac/linux, contagem da carteira, malha do provider). Compare sua implementação com esses arquivos tela a tela.
2. **Leia `docs/COMO-LER-DC.md`** — os `.dc.html` são componentes com template `{{ }}`; muitos estilos e todas as `animation:` dinâmicas são calculados na classe `Component`, não aparecem no markup.
3. **Animações exatas**: `docs/animations/app.css`, `desktop.css`, `provider-desktop.css` trazem os `@keyframes` copiados dos arquivos + os usos (duração/curva/atraso) encontrados. Use estes valores, não aproximações.
4. **Fontes**: Geist, Geist Mono e Material Symbols Rounded (Google Fonts). Sem elas o layout quebra (larguras e ícones). Ícones são ligaduras de texto (`<span>chat</span>`) — no app nativo use o pacote de ícones correspondente.
5. Para abrir os protótipos, sirva a pasta `design/` por HTTP (ex.: `npx serve design`); por `file://` o navegador bloqueia o carregamento dos arquivos importados.

## Sobre os arquivos de design
Os arquivos em `design/` são **referências de design feitas em HTML** — protótipos que mostram aparência e comportamento, **não código de produção**. A tarefa é **recriar estes designs no ambiente-alvo**:
- App mobile: sugerido **React Native (Expo)** ou **Kotlin/Jetpack Compose + SwiftUI**. Transporte P2P exige módulos nativos (BLE, Wi-Fi Direct/Nearby, USB serial para LoRa), então prefira um stack com acesso nativo fácil.
- Painel do provider: web app leve (ex.: **Vite + React** ou **SvelteKit**) servido pelo daemon `piu-node` na rede local.
- Site: estático (ex.: **Astro** ou **Next.js export**), com i18n PT/EN.

Os `.dc.html` abrem direto no navegador (precisam do `support.js` na mesma pasta). Toda a lógica de cada tela está na classe `Component` no `<script data-dc-script>` de cada arquivo — leia-a para estados, dados de exemplo e transições.

## Fidelidade
**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos, raios, estados e animações são finais. Recriar pixel a pixel. Dados (nomes, valores LUNES, taxas de crédito) são **ilustrativos**.

---

## Design tokens

### Tema (o app tem versão clara e escura; o tema escuro é obrigatório)
| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#0A0A0A` | fundo |
| `bg2` | `#F3F3F1` | `#171717` (desktop `#161616`) | cartões, inputs |
| `bg3` | `#E6E6E3` | `#262626` | trilhas, segmentados, avatares |
| `bub` | `#F3F3F1` | `#1A1A1A` | balão recebido |
| `side` (desktop) | `#F8F8F6` | `#0E0E0E` | sidebar/título |
| `ink` | `#0C0C0C` | `#F4F4F2` | texto principal, botão primário |
| `ink2` | `#5F5F5C` | `#A2A29E` | texto secundário |
| `ink3` | `#9B9B97` | `#6C6C69` | só ícones/decoração (contraste baixo para texto) |
| `invink` | `#FFFFFF` | `#0A0A0A` | texto sobre `ink` |
| `line` | `rgba(0,0,0,.07)` | `rgba(255,255,255,.08)` | divisores |
| `line2` | `rgba(0,0,0,.16)` | `rgba(255,255,255,.18)` | bordas, contornos |
| `dot` | `rgba(0,0,0,.055)` | `rgba(255,255,255,.06)` | padrão de pontos no fundo do chat (18px) |
| `knob` | `#FFFFFF` | `#8C8C88` | bolinha do toggle desligado |
| `scrim` | `rgba(0,0,0,.32)` | `rgba(0,0,0,.60)` | fundo de folhas/diálogos |

Monocromático por princípio: **nenhuma cor de acento**. Ênfase = inverter (`ink` de fundo, `invink` de texto). Estados “ruins” usam borda tracejada, opacidade ou ícone, nunca vermelho.

### Tipografia
- **Geist** (300–800) para UI; **Geist Mono** (400/500) para rótulos técnicos, IDs, chaves, hashes, endereços e cabeçalhos de seção.
- Ícones: **Material Symbols Rounded** (variável; `wght` 300 padrão, `FILL 1` para estado ativo).
- Escala mobile: título de aba 36/700/-0.045em · H1 de fluxo 28–32/650/-0.035em · título de cartão 15–16/600 · corpo 15.5/1.35 (balão) · secundário 12.5–14 · rótulo de seção mono 11.5/500/+0.05em em CAIXA ALTA · micro mono 11–12.
- Desktop: título de página 34/700 · KPI 30/650 · número herói 60/650/-0.055em.
- Site: H1 `clamp(48px,7vw,88px)`/700/-0.055em/0.95 · H2 `clamp(36px,5vw,56px)`/700/-0.045em.
- Números: `font-variant-numeric: tabular-nums`. Moeda em pt-BR (`1.284,60`).
- Logotipo: texto “piu.” em Geist 750, `letter-spacing:-0.07em`, ponto em `ink3`.

### Forma e espaço
- Raios: 9–12 (segmentados, chips internos) · 14–16 (inputs, cartões pequenos) · 18–22 (cartões) · 24–28 (cartões herói, folhas, modais) · 30 (topo das bottom sheets) · pílulas = altura/2.
- Botões: primário 54px (raio 27) · secundário 44–48px · pequeno 30–34px.
- Margem lateral mobile 20px (texto 24px). Gap padrão 8–14px. Desktop: padding de página 32px, grid de 12 colunas com gap 16px.
- Toque mínimo 44px.
- Sombras: folhas `0 -10px 40px rgba(0,0,0,.18)`; modais `0 24px 60px rgba(0,0,0,.25–.3)`; banners `0 16px 40px rgba(0,0,0,.22)` + borda `line2` interna.

### Movimento (respeitar *reduzir movimento*)
| Elemento | Duração / curva |
|---|---|
| Mensagem enviada (entra) | 340ms, `cubic-bezier(.2,.9,.3,1.2)`, translateY 12px + scale .9→1, origem no canto do balão |
| Ícone de status (a cada troca de estado) | 420ms pop, `cubic-bezier(.2,.9,.3,1.4)` |
| Digitando… | 3 pontos, 1.1s loop, defasagem .15s |
| Banner in-app | entra 500ms, fica 4.5s com barra de tempo, sai 300ms |
| Bottom sheet | 380ms `cubic-bezier(.2,.9,.3,1)` translateY 100%→0; scrim fade 220ms |
| Diálogo | 320ms scale .9→1 |
| Aba ativa | bump 400ms |
| Toggle | knob 250ms `cubic-bezier(.2,.9,.3,1.3)` |
| Radar/rede | anéis 3.2s pulso contínuo; pacote viajando por enlace 1.6–3s linear |
| Segurar para apagar | 1.2s preenchendo o botão |
| Gráficos | barras crescem 600ms com defasagem 20–35ms |

---

## App mobile — telas (`PiuApp.dc.html`, viewport 390×844)
Estrutura: status bar 54px; barra de abas inferior 84px com 5 abas **Conversas · Por perto · Rede · Carteira · Perfil** (badge de não lidas; ícone preenchido quando ativo). Para abrir qualquer tela direto, use a prop `start` ou os botões dos arquivos `Piu N ….dc.html`.

### Abertura, transições e notificações do sistema
- **Abertura**: ícone (104px, raio 26) entra com `piuPop` 600ms; “piu.” 40/750 sobe com `piuUp` 450ms (atraso 220ms); “procurando por perto” com pontos. Após ~2,6s a splash sai (`piuSplashOut` 420ms) e o app entra (`piuReveal` 500ms `cubic-bezier(.2,.85,.3,1)`).
- **Transições**: abas trocam com `piuTab` (sobe); telas empilhadas entram da direita com `piuPush` 360ms `cubic-bezier(.2,.85,.3,1)`.
- **App fechado**: tela inicial simulada com ícone do Piu e badge de não lidas; o app fecha com `piuAppOut` 330ms em direção ao ícone e abre a partir dele (`piuAppIn`). Notificação push no topo; tocar abre direto na conversa/tela de origem.
- **Idioma** (Perfil → Idioma): 11 idiomas + formato de números e datas; mesma preferência no Desktop e no painel do provider. Traduções completas ainda pendentes (PT-BR é a fonte).

### Carteira e pagamento (mobile)
**Especificação obrigatória: `docs/APP-CARTEIRA-ENVIAR-RECEBER.md`** (botões Enviar/Receber/Convidar, folhas, QR, cena de pagamento segundo a segundo) + `docs/reference-code/app-wallet.js` + `reference/app/wallet_send_receive/`.
- **Entrada da carteira**: cartão de saldo entra com `piuCardIn` .65s (perspectiva, sobe 26px, rotateX 16°→0); anéis decorativos no canto (um gira `piuSpin` 22s com ponto orbitando); brilho atravessa uma vez (`piuShine` 1.5s, atraso .55s). Saldo **conta de 0 até o valor** em 950ms (rAF, easing `1-(1-p)^4`). Botões Enviar/Receber/Convidar com `piuPop` .5s (atraso .32s + 70ms cada); linhas de atividade `piuUp` .45s com 45ms de defasagem.
- **Receber (QR)**: mesma animação do QR do Desktop. Cartão branco (raio 26, padding 16) entra com `piuPop` .6s; grade 29×29 em 200px; cada módulo nasce com `piuQr` .35s `cubic-bezier(.2,.9,.3,1.5)`, atraso = 120ms + distância ao centro × 28ms (onda do centro para fora); 3 marcadores de canto; centro livre 7×7 com o ícone do app (48px, `piuPop` 1s); linha de leitura `piuScan` 2.6s infinita a partir de 1,1s. Tocar no código gera outro (nova semente, a onda recomeça).
- **Segurar para assinar**: o botão "Segure para assinar e enviar" enche da esquerda para a direita em 900ms enquanto pressionado (camada `invink` 24%), encolhe 3% e engrossa o ícone de digital. Soltar antes zera e mostra "Continue segurando até completar". Enter/Espaço assina direto (acessibilidade).
- **Cena de pagamento** (tela cheia em `--ink`, ~5s), cronologia a partir do fim do gesto:
  - 0–0,75s: íris abre a partir do botão (`clip-path: circle()` de 50% 93%). Fundo de pontos 22px. Topo: "PAGAMENTO P2P", barra de progresso (3,6s) e status ao vivo.
  - 0,3–1,15s: anel 168px desenha (`stroke-dashoffset`), digital com linha de leitura subindo e descendo, assinatura digitada em mono (`steps(27)`).
  - 1,2s: digital vira selo `verified` (`piuPop`), "Assinando"→"Assinado", onda de anel.
  - 1,6s: bloco sai para cima com blur. 1,75s: valor grande aparece e em 2,2s **encolhe e vira moeda** sobre "Você".
  - 2,4–3,8s: moeda (30px, gira em Y, brilho) percorre a rota Você → 7F·A2 (Wi-Fi Direct) → C2·19 (Wi-Fi Mesh) → 88·E0 (Bluetooth) → destinatário, com 3 fantasmas de rastro; a linha sólida se desenha junto (velocidade constante; paradas proporcionais ao comprimento: 20,9% / 51,8% / 80,3%). Cada nó acende e solta onda ao ser tocado.
  - 3,8s: avatar do destinatário pulsa (`piuBump`), 3 ondas e 16 faíscas radiais.
  - 4,15s: rota se dissolve. 4,3–5s: círculo e check se desenham, valor, "Marina recebeu a transação assinada", resumo (rota, tempo, taxa, liquidação, tx) e botão "Concluir" (5s).
  - Status do topo: Assinando → Assinado · Ed25519 → Saindo pelo Bluetooth → Salto 1/2/3 → Entregue.
- **Concluir**: íris fecha em direção ao cartão de saldo (.52s); o saldo **desce do valor antigo ao novo** em 1,3s e a nova linha "Enviado para…" entra destacada (`piuRowFresh` 1.8s).
- Barra de status fica branca enquanto a cena cobre o topo. Vídeos: `reference/video/app_payment.webm` e `app_payment_dark.webm`.

### Site (Piu Site / Piu Site EN)
- **Hero**: título entra palavra por palavra (`siteWord` .95s, atraso .12s + 80ms, máscara por palavra); texto, botões e números em `siteUp` escalonado (.55–.9s); celular sobe girando levemente (`sitePhone` 1.2s); 3 ondas saindo do celular (`siteRing` 3.6s); órbita contrária (`siteSpinR` 46s); 3 selos flutuantes (`siteChip` + `siteFloat`).
- **Faixa de transportes** em rolagem infinita (`siteMarquee` 34s, pausa no hover, máscara nas bordas).
- **Revelação na rolagem** via `animation-timeline: view()` (`siteReveal`: sobe 56px, blur 6→0); cartões escalonados em 8% do intervalo. Navegadores sem suporte mostram o conteúdo direto, sem animação.
- **Diagrama de saltos**: linha se desenha com a rolagem; cada nó pulsa (`sitePing`) no instante em que o pacote passa.
- **Prévias de Desktop** (provider e Piu Desktop) entram inclinadas em perspectiva (`siteDeskIn`) conforme a rolagem.
- **Piu Desktop para download** (`#desktop`, dentro de Baixar): abas macOS/Linux (detecta o sistema do visitante), botão principal, prévia ao vivo do app, lista de pacotes (dmg arm64/x64, Homebrew; AppImage, .deb, .rpm, Flatpak, ARM64) e assinatura. Link no menu, no hero, no rodapé e uma pergunta no FAQ.
- Avisos de download viram toast fixo inferior (`siteToast`), somem em 6,5 s.

### Onboarding (FUN-001..004)
- **welcome**: logotipo grande com órbitas girando (90s), proposta, 3 benefícios, “Criar identidade” e “Restaurar de outro aparelho”.
- **identity**: escolher pública (nome → `@handle · piu:7f3a…c19e`) ou anônima (nome derivado da chave, aviso de que o anonimato não é absoluto).
- **keys**: geração local com barra de progresso e impressão digital 8×4 hex; texto “Guardada somente neste aparelho”.

### Conversas
- **chats**: troca de identidade (pública/anônima, listas separadas), pílula de rede (“6 nós · offline”), busca, filtros (Todas/Pessoas/Grupos/Canais/Comunidades), banner de fila offline, lista com avatar (círculo = pessoa; quadrado raio 17 = grupo/canal), status da última mensagem.
- **chat**: cabeçalho com transporte atual e selo de verificado; balões (enviado = `ink`, recebido = `bub` + borda); rodapé com o transporte atual e composer. **Estados** (FUN, seção 3.1): `criada → aguardando (na fila) → encaminhada → entregue`, mais `expirada`/`falha` com “Reenviar”. Mensagens de sistema centralizadas (troca de chave etc.).
- **Folha de rota da mensagem** (tocar num balão): barra de 4 etapas, linha do tempo de saltos com transporte por salto, tamanho do envelope, fragmentos, TTL, prioridade e a nota “nós intermediários não conseguem ler”.
- **Anexar → arquivo em blocos** (FUN-009): progresso por bloco, **pausa automática quando a rota vira LoRa**, retomada, botão Pausar/Retomar e “integridade conferida (SHA-256)”.
- **contact** (⋯ numa conversa direta): código de segurança de 12×5 dígitos + QR, “Marcar como verificado”.
- **groupInfo** (⋯ no grupo, FUN-006): convite com QR e aprovação, permissões, membros; remover → diálogo → **chave do grupo v4→v5** + mensagem de sistema.
- **new / newChannel** (FUN-007): canal público, privado ou secreto; quem publica; publicar com identidade pública ou anônima.
- **community**: grupos e canais agrupados.

### Por perto (convite pago)
- **nearby**: visibilidade recíproca (desliga sozinha em 1h), grade de perfis públicos com proximidade aproximada (nunca localização exata), só identidade pública.
- **nearProfile**: fotos (placeholder), bio, interesses, em comum, taxa → folha “Convite para X” (1 mensagem até 140 caracteres; o valor fica reservado e volta em 24h se recusado ou expirado; novo convite só depois de 30 dias).
- **requests**: aceitar/recusar (recusa silenciosa), bloquear e denunciar, preferência de taxa (1/3/5/10 LUNES). **match**: tela invertida com avatares deslizando.

### Rede e provider no celular
- **network**: radar de nós (com imitação “piu.praca” marcada como não verificada), **Modo nó** (FUN-016), transportes, limites, nós alcançáveis com nome público `piu.*`, cartão Provider e **Diagnóstico local**.
- **diagnostics** (NFR-008): taxa de entrega, latência p50/p95, tempo em fila e expiradas, por transporte e por saltos. Nada sai do aparelho.
- **provIntro → provAdd → provConnect → provTest → provConfig → provider → provDevice → provEarnings**: classes Home Node / Super Node / Gateway Local / **Ponto de Acesso** (roteador comum sem software, vinculado a um nó pai, não gera créditos próprios); pacote assinado enviado do celular ou pelo terminal; pareamento com código de 6 dígitos; **teste real** com vizinhos (INF-010); nome público `piu.` + até 28 caracteres `[a-z0-9-]` com checagem de disponibilidade; carteira de provider separada.

### Carteira (`wallet`, `rewards`, `referrals`)
Saldo, Enviar (assinar com biometria, liquida quando houver Mainnet), Receber (QR + receber de alguém por perto), bônus de boas-vindas de 10 LUNES em 4 etapas, distribuição de 25 LUNES por convidado ativo (**só indicação direta, sem níveis**), créditos de rede (pendentes/validados/pagos/rejeitados).

### Convite P2P (`invite`, `share`, `recvPage`, `verify`, `accept`)
QR de convite assinado (uso único, 24h), envio do APK por Wi-Fi Direct ou Bluetooth com **código de segurança de 4 palavras**, página local servida pelo celular de quem convida, verificação da cópia em 5 checagens na primeira abertura. Aviso: no iPhone só pela App Store.

### Alertas e notificações
Banner in-app (7 tipos), **alerta de emergência em tela cheia** com assinatura oficial verificada, diálogos (segurar 1.2s para apagar dados; bateria baixa; lembrete de backup), **tela bloqueada** com prévia configurável (Sempre/Desbloqueado/Nunca), **notifSettings** (“sem servidor de notificações”).

### Segurança e ajustes
- **backup**: frase de 12 palavras borrada até tocar → quiz de 3 palavras → onde guardar.
- **restore → migrate**: de outro aparelho (com código de 4 palavras), pela frase ou por arquivo; progresso item a item; no fim, rotação das chaves de sessão.
- **myDevices**: desconectar aparelho, revogar aparelho perdido.
- **privacy / storage / battery** (FUN-017): busca, leitura, digitando, mensagens temporárias, atraso aleatório, padding, biometria; uso do armazenamento cifrado; bateria, horário, tráfego, banda, intervalo de descoberta (com estimativa de consumo).

## Painel do provider para computador (`PiuProviderDesktop.dc.html`, 1280×820, prop `theme`)
Janela com barra de endereço `piu-node.local:8420`; sidebar de 232px; páginas:
- **Visão geral**: ganhos de outubro + 31 barras, próxima liquidação (lote #0047), 4 KPIs, equipamentos, atividade, tráfego por transporte, ganhos por tipo.
- **Equipamentos**: tabela com filtros e busca; painel lateral de 360px (interfaces, recibos, pausar/atualizar/reiniciar/revogar; Ponto de Acesso esconde os controles de software).
- **Malha**: topologia ao vivo (628×520; enlaces sólido = Ethernet/USB, linha = Mesh, pontilhado = celulares, tracejado = LoRa; pacotes viajando) e vizinhos com qualidade do enlace.
- **Ganhos**: estados, créditos por tipo (texto 1 crédito, alerta via rádio 3, arquivo 2 por MB, rota nova 10; 100 créditos = 1 LUNES), ganhos por equipamento, lotes com hash da transação.
- **Carteira**: saldo e transferência **assinada no celular pareado** (modal com código).
- **Configurações**: limites globais, política de tráfego, sessões do painel (só rede local), identidade de operador, nomes públicos e regras anti-imitação.
- **Assistente “Adicionar equipamento”** (modal 780×620, 4 etapas: Equipamento, Conectar, Teste real, Regras).

## Site (`Piu Site.dc.html` PT · `Piu Site EN.dc.html` EN)
Fluido, `max-width:1200px`. Seções: nav fixa (PT|EN, claro/escuro, Baixar) · herói com o app ao vivo · faixa de transportes · Como funciona (cadeia de saltos animada + 3 passos) · grade de 6 recursos · Privacidade (fundo invertido, com “O que não prometemos”) · Seja provider (4 classes + painel embutido com escala fluida por ResizeObserver) · LUNES · Baixar (APK, de um amigo, Piu Node + assinatura) · Dúvidas em acordeão · rodapé. Links que ainda são placeholder: especificação LNNP, documento de requisitos, downloads.

---

## Estado e dados (modelo conceitual, seção 12 do documento)
`Identity` (pública | anônima, chaves separadas) · `Device` · `Conversation` / `Group` (membros, papéis, `keyVersion`) / `Channel` (tipo, política de publicação) / `Community` · `MessageEnvelope` (id, TTL, prioridade, fragmentos, estado, `route[]` com transporte por salto) · `RelayNode` (classe, interfaces, limites, nome público assinado, nó pai para Ponto de Acesso) · `RelayReceipt` · `RewardAccount` (pendente/validado/rejeitado/pago) · `RewardSettlement` (lote, carteira, tx).

Regras que o front precisa respeitar:
- Nunca prometer retransmissão 24h no celular (no iPhone, só com o app aberto).
- Mídia nunca por LoRa: pausar e esperar um transporte de maior capacidade.
- Duplicatas e rotas circulares não geram crédito.
- Nome público `piu.*` só é confiável com assinatura; SSIDs sem assinatura aparecem como imitação.
- Identidade do nó, identidade social e carteira não compartilham chaves.
- Nada de mensagens na blockchain.

## Assets
**Ícones de instalação dos apps de computador são DIFERENTES (obrigatório):**
- **Piu Desktop** (mensageiro): `design/brand/desktop/` — fundo preto, marca branca. `piu-desktop-icon.svg` + PNG 16–1024.
- **Piu Provider** (painel do provider): `design/brand/provider/` — fundo claro, marca preta com duas ondas de sinal saindo do olho. `piu-provider-icon.svg` + PNG 16–1024.
- Comparação: `design/brand/desktop-vs-provider-preview.png`.
- Ambos seguem a grade de ícone do macOS (corpo 824×824 centrado em 1024, raio 185, margem transparente) — use direto para `.icns` (iconutil) e para Linux (`.png` 512/256/128 em `hicolor`, `.desktop` com `Icon=piu-desktop` / `Icon=piu-provider`). Nome do app: "Piu" e "Piu Provider"; bundle ids distintos (ex.: `network.lunes.piu.desktop` e `network.lunes.piu.provider`).
- O app de celular continua com `icon-1024.png` (sangrado, a máscara é do sistema).

`design/brand/`: ícone do app (`piu-icon.svg`, `icon-1024.png`, `icon-light-1024.png`, `icon-maskable-512.png`, `icon-512/192.png`, `apple-touch-icon.png`), marca (`piu-mark.svg`), favicons (svg, ico, 16/32/48) e `site.webmanifest`. O ícone aparece na abertura do app e do Desktop e na tela inicial simulada. Fotos de perfil e QR codes são **placeholders** (listras). Ícones de UI: Material Symbols Rounded. Fontes: Geist / Geist Mono (Google Fonts). Logotipo em texto “piu.” (Geist 750, ponto em `ink3`).

## Arquivos
- `design/PiuApp.dc.html` — app mobile completo (todas as telas, estados e dados de exemplo).
- `design/PiuProviderDesktop.dc.html` — painel do provider.
- `design/Piu Site.dc.html`, `design/Piu Site EN.dc.html` — site.
- `design/Piu.dc.html` + `design/Piu 1…8 ….dc.html` — canvases por tema (claro e escuro lado a lado, botões que pulam direto para cada tela).
- `design/support.js` — runtime para abrir os protótipos no navegador.
- `design/Piu Desktop.dc.html` — app de conversa para Mac e Linux.
- `design/capture.dc.html` — página auxiliar usada por `tools/capture.mjs` (não é tela do produto).
- `design/brand/` — ícones e marca.
- `tools/capture.mjs` — gera `reference/` (PNG + vídeos).
- `docs/COMO-LER-DC.md` — guia do formato.
- `docs/animations/*.css` — keyframes exatos por plataforma (app, desktop, provider-desktop, site).
- `docs/Lunes_Network_Documento_de_Requisitos_v1.1.docx` — requisitos.

## Pontos em aberto (do documento, seção 18.2)
Modelo econômico (valores 10/25 LUNES, taxas de crédito e limites são ilustrativos) · tecnologias de rádio homologadas · algoritmos criptográficos · protocolo de roteamento · antifraude sem expor metadados · equipamentos de referência · recuperação de identidade.


## Piu Desktop (Mac e Linux) — app de conversa (`Piu Desktop.dc.html`, 1280×820)
Props: `os` = mac | linux · `theme` = light | dark · `start` = splash | auth | app. Mesmos tokens do mobile, com `--side` (#F8F8F6 / #0E0E0E) para barra de título e trilho, `--bub` #FFFFFF / #161616 e `--note` (fundo da notificação nativa, 97% opaco + `backdrop-filter: blur(20px)`). Janela com raio 12. RTL automático para árabe.

### Moldura da janela
- **macOS**: barra de título 40px, semáforos 12px (#FF5F57, #FEBC2E, #28C840, gap 8) à esquerda, título 13/600 `ink2` centralizado.
- **Linux (GNOME/Adwaita)**: barra 46px, ícone 20px (raio 5) + “Piu” à esquerda, título 13.5/650 centralizado, 3 botões circulares 24px (`bg3`) à direita.
- Atalhos mostram ⌘ no Mac e Ctrl no Linux.

### Abertura (2,65 s)
3 anéis 180px (borda 1.5px `ink`) com `piuRingL` 2.4s defasados 0/.8/1.6s · 2 órbitas de pontos (440px `piuSpin` 7s; 300px `piuSpinR` 5s), pontos entram com `piuPop` .5s a partir de .5s · ícone 120px raio 30 com sombra `0 24px 60px -18px rgba(0,0,0,.45)`, `piuPop` .8s .1s `cubic-bezier(.2,.9,.3,1.4)` · “piu.” 64/750 letra a letra com `piuLetter` .55s, atrasos .45/.53/.61/.69s `cubic-bezier(.2,.9,.3,1.2)` · rodapé “iniciando o nó local” (mono 12) com 3 pontos `piuDot` 1s, entra `piuFade` .5s .9s. Aos 2,2 s sai com `piuOut` .45s; aos 2,65 s mostra a entrada.

### Entrada (`authStep`)
Duas colunas: texto à esquerda (kicker mono 12, título 46/700/-0.045em, subtítulo 16 `ink2` máx. 440px) e conteúdo à direita sobre anéis girando (`piuSpinR` 40s). Cada troca de etapa alterna `piuPgA`/`piuPgB` .5s (sobe 14px + blur 3px→0).
- **start**: 3 opções (430px): Conectar ao meu celular · Criar identidade neste computador · Restaurar com 12 palavras.
- **qr**: QR 29×29 (252px), módulos entram com `piuQr`; linha de leitura `piuScan`; renova a cada 30 s com contador.
- **confirm**: 3 palavras para comparar com o celular (400px, centralizado).
- **create**: pública (nome + @handle) ou anônima; “manter conectado” guarda chave no Keychain/Secret Service.
- **work**: progresso (sincronizar / gerar chaves / restaurar) com pacote viajando (`piuTravelY`) e impressão digital.
- **phrase**: grade de 12 campos (450px).

### App — layout em colunas
1. **Trilho** 68px (`--side`): ícone 36px raio 10 no topo (`piuPop`), botões 44px raio 13 (Conversas, Carteira, Ajustes; ícone `FILL 1` quando ativo, badge 18px), indicador “nós por perto” pulsando, avatar da identidade 40px (círculo = pública; quadrado = anônima; troca anima `border-radius` .4s). Entra com `piuRail` .5s .05s.
2. **Lista** 320px: título 24/700, selo de identidade, busca 36px com atalho (⌘K / Ctrl K), filtros pílula 28px, linhas raio 14 com avatar 46px (38px em densidade compacta; padding 11/8px), hover desloca 3px. Entra com `piuUp` .55s .12s.
3. **Conversa** (flexível): cabeçalho com transporte e verificado; fundo com pontos 18px (`--dot`); balões; mensagem enviada entra `piuMsgIn` .38s `cubic-bezier(.2,.9,.3,1.3)`; status criada → encaminhada (650ms) → entregue (1,5s) → digitando (2s) → resposta. Fila offline: cartão tracejado. Canal: rodapé “Somente administradores publicam”. Botão de moeda no composer abre Enviar LUNES já com o contato. Entra com `piuUp` .6s .2s.
4. **Detalhes** 320px (opcional, `piuSide` .4s): avatar 76px, silenciar, verificar (código de segurança), mensagens temporárias, mídia, bloquear/sair. **Rota da mensagem** ao clicar num balão.

### Carteira
**Enviar e Receber têm especificação própria e obrigatória: `docs/DESKTOP-CARTEIRA-ENVIAR-RECEBER.md`** (destinatários, valor inicial 5, chips 1/5/10/25, resumo, sucesso, QR 29×29 com onda e ícone), código em `docs/reference-code/desktop-wallet.js` e PNG em `reference/desktop/wallet_send_receive/`.

Grid 1.35fr / 1fr (máx. 980px). Cartão de saldo invertido (raio 26, `piuDialog` .6s) com anéis decorativos e ponto orbitando (`piuSpin` 24s); saldo 58/700 com **contagem animada** (requestAnimationFrame, 1100ms, easing \`1-(1-p)^4\`, de 0 ou do saldo anterior); olho alterna •••••• e grava `localStorage['piu.hideBal']` (mesma preferência do celular). Ações Enviar / Receber / Converter (`piuPop` .5s, atraso .35s + 70ms cada). Painel lateral troca entre Enviar e Receber (QR + endereço). Movimentações; **Créditos de rede** com 7 barras 110px (`piuGrowY`, defasadas).

### Ajustes
Coluna de navegação 248px + página (título 30/700, descrição 14 `ink2` máx. 560px); troca de página alterna `piuPgA`/`piuPgB` .45s. Páginas: Perfil · Aparelhos · Notificações · Privacidade · Aparência (tema, densidade, animações) · Idioma (11 + formatos, tradução local, corretor) · Conversas e mídia · Rede (retransmitir, banda) · Sistema (abrir ao iniciar, ícone na barra de menus/bandeja) · Backup (12 palavras) · Atalhos de teclado. Diálogos: QR do perfil, parear aparelho, desconectar aparelho, sair.

### Notificação nativa
Chega 5 s depois de abrir o app (mensagem no grupo) e some em 5,2 s (`piuNoteOut` .35s).
- **macOS**: canto superior direito, `top 52px`, largura 356, raio 18, entra da direita `piuNoteMac` .55s `cubic-bezier(.2,.9,.3,1.1)`.
- **Linux**: centro do topo, `top 58px`, largura 380, raio 14, desce `piuNoteLin` .5s `cubic-bezier(.2,.9,.3,1.15)`.
- Ícone 40px raio 10 + mini-avatar 22px (`piuPop` .4s .25s), título 13.5/650, “agora”, corpo em 2 linhas, botão fechar 22px. Clique abre a conversa. “Não perturbe” suprime.
- Toast inferior: pílula 42px `ink`, `piuToast` .45s.

### Movimento
Todas as animações passam por `mo()`: com “Animações” desligado em Aparência ou `prefers-reduced-motion`, viram `none`. Keyframes exatos em `docs/animations/desktop.css`. Vídeos de referência: `reference/video/desktop_mac_launch.webm`, `desktop_linux_launch.webm`, `desktop_wallet.webm`. Telas: `reference/desktop/{mac,linux}-{light,dark}/`.
