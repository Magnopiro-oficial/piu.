# Handoff: Piu — mensageiro descentralizado (Lunes Network)

## Visão geral
Piu é um mensageiro **offline-first** da Lunes Network: as mensagens viajam de aparelho em aparelho (Bluetooth LE, Wi-Fi Direct, Wi-Fi Mesh, LoRa, USB/Ethernet) sem internet nem servidor central, com criptografia ponta a ponta e store-and-forward. O pacote cobre:

1. **App mobile** (Android/iOS): onboarding, conversas, grupos, canais, comunidades, rota da mensagem, rede/modo nó, carteira LUNES, convite P2P (distribuição do APK de celular para celular), Por perto (convite pago), alertas/notificações, provider pelo celular, segurança e ajustes.
2. **Painel do provider para computador**: servido localmente pelo nó (`piu-node.local:8420`), para operar roteadores, antenas e gateways e acompanhar ganhos.
3. **Site do projeto** em PT e EN.

Requisitos de produto: `docs/requisitos/Lunes_Network_Documento_de_Requisitos_v1.1.docx` (IDs FUN-xxx, INF-xxx, NFR-xxx citados abaixo vêm desse documento).

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
Sem imagens finais: fotos de perfil e QR codes são **placeholders** (listras). Ícones: Material Symbols Rounded (Google Fonts). Fontes: Geist / Geist Mono (Google Fonts). Não há marca gráfica além do logotipo em texto “piu.”.

## Arquivos
- `design/PiuApp.dc.html` — app mobile completo (todas as telas, estados e dados de exemplo).
- `design/PiuProviderDesktop.dc.html` — painel do provider.
- `design/Piu Site.dc.html`, `design/Piu Site EN.dc.html` — site.
- `design/Piu.dc.html` + `design/Piu 1…8 ….dc.html` — canvases por tema (claro e escuro lado a lado, botões que pulam direto para cada tela).
- `design/support.js` — runtime para abrir os protótipos no navegador.
- `docs/requisitos/Lunes_Network_Documento_de_Requisitos_v1.1.docx` — requisitos.

## Pontos em aberto (do documento, seção 18.2)
Modelo econômico (valores 10/25 LUNES, taxas de crédito e limites são ilustrativos) · tecnologias de rádio homologadas · algoritmos criptográficos · protocolo de roteamento · antifraude sem expor metadados · equipamentos de referência · recuperação de identidade.
