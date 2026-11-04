# Piu Provider · painel local

Painel do provider para computador, recriado a partir de `project/PiuProviderDesktop.dc.html` (Claude Design).
Vite + React + TypeScript. Feito para ser servido pelo daemon `piu-node` na rede local (`piu-node.local:8420`), **sem internet**: as fontes (Geist, Geist Mono) e os ícones (Material Symbols Rounded) vão dentro do build.

```bash
npm install
npm run dev        # http://localhost:8420
npm run build      # gera dist/ (base relativa, dá para servir de qualquer caminho)
npm run typecheck
npm test           # Vitest: lógica do guia e da ajuda (src/lib/*.test.ts)
```

## Estrutura
- `src/styles.css`: tokens claro/escuro, keyframes e primitivas (segmentado, toggle, barras). Respeita *reduzir movimento*.
- `src/state/store.tsx`: estado do painel (equipamentos, carteira, limites, políticas, toasts), tema salvo no `localStorage`, rotas por hash (`#/devices/mini`).
- `src/pages/`: Visão geral, Equipamentos (+ painel de detalhe), Malha, Ganhos, Carteira, Configurações.
- `src/wizard/AddDeviceWizard.tsx`: assistente de 4 etapas (Equipamento, Conectar, Teste real, Regras), incluindo o Ponto de Acesso.
- `src/data/seed.ts` e `src/data/topology.ts`: dados de exemplo do protótipo (**ilustrativos**).
- `src/lib/guide.ts`, `src/lib/help.ts` e `src/components/Guide.tsx`: ajuda para quem não entende de redes.
  - **Primeiros passos** (Visão geral, só com o piu-node): entrar, backup da chave, carteira de recebimento, celular, primeiro vizinho e, opcional, mais um equipamento. Cada passo se marca pelo estado real do nó (`/api/operator`, `/api/wallet/lunes`, `/api/phones`, vizinhos LNNP) e leva ao cartão certo. “Esconder” vale só neste navegador; a Ajuda reabre.
  - **Ajuda** (botão no cabeçalho de toda página): o que a página mostra, o que fazer nela e as palavras dela em linguagem simples (glossário completo em “Ver todas”).
  - **No assistente**: “O que é isso?” ao lado dos termos técnicos e “Onde fica isso no meu roteador?” para o Ponto de Acesso.

## O que vem do piu-node e o que ainda é simulado
Servido pelo `piu-node` (com sessão), o painel **não usa dados de exemplo**: o que o nó mede aparece; o que depende de terceiros (validador, Mainnet, preço do LUNES) ou de hardware ainda não suportado aparece como indisponível, nunca como número inventado. As estatísticas são lidas a cada 10 s (`src/lib/live.ts`).

| Tela | De onde vem |
|---|---|
| Visão geral | recibos assinados no mês e por dia (`GET /api/relay/history`), recebidos/encaminhados/duplicatas de hoje, vizinhos por meio (`GET /api/relay`), recibos guardados para o validador (`GET /api/relay/receipts`), atividade real (vizinhos, recibos, transferências). Sem LUNES: o valor sai do validador |
| Malha | este nó no centro e os vizinhos LNNP de verdade (meio, MTU, versão, se retransmite, desde quando); "sem vizinhos ainda" quando não há. Conexões recusadas por credencial revogada (`counters.revokedRefused`) e o que voltou do armazenamento local ao ligar (`store.restored`) |
| Ganhos | recibos por dia e por semana, pagos = entradas reais da carteira; lotes só quando houver liquidação; rejeitados "—" (o validador ainda não respondeu). **Carteira do lote**: o nó assina a carteira LUNES desta semana ou da próxima (`POST /api/payout-claims`, com step-up; endereço SS58 conferido pelo nó), e os botões baixam as evidências (`EvidenceFile`) e a declaração (`ClaimFile`) para levar ao validador |
| Carteira | saldo e movimentações registrados no nó (`GET /api/wallet`); operador novo começa com 0. Carteira de provider na Lunes Mainnet (`GET /api/wallet/lunes`): o operador configura o endereço Lunes (SS58, conferido no nó, com código novo do equipamento), e o painel mostra o endereço (copiar), o saldo on-chain lido pelo nó com bloco, endereço WebSocket que respondeu e horário (a cada 30 s ou no botão), e "Receber" com QR, copiar e link para o explorador. Sem rede, mostra a última leitura e o motivo. O pagamento dos lotes continua pendente da liquidação |
| Equipamentos | o próprio nó (`self`) com estatísticas reais (encaminhados na última hora, recibos de hoje, vizinhos, memória usada, interfaces, recibos recentes); pausar ele pausa o motor. Os outros são registros do assistente: com identidade técnica e a chave de operador neles, mostram o **resumo assinado** que mandam pela malha (encaminhados e guardados desde que ligaram, vizinhos, pausado) e recebem a **pausa e as regras** daqui (assinadas pela chave de operador; "aplicado" quando o resumo confirma); sem isso, "sem dados neste nó". Ponto de Acesso mostra o nó pai. **Reiniciar** o próprio nó (dono, com código novo do equipamento). Identidade técnica e se está assinada pela chave de operador; **regras do equipamento** (banda, armazenamento, horário), que no próprio nó valem no motor; **revogar** um equipamento com identidade técnica põe a chave dele na lista de revogação do operador (os nós do operador recusam a conexão dele) |
| Assistente | no passo "Conectar", o operador escolhe qual vizinho LNNP conectado é o equipamento novo (a identidade técnica dele é assinada pela chave de operador); no passo "Regras", banda, armazenamento e horário vão para o nó; num Ponto de Acesso, o nó pai escolhido vai junto (`parent`) |
| Configurações | limites, políticas, sessões e celulares reais. **Chave de operador**: impressão digital real, backup cifrado com senha (`piu-operador.backup`), rotação e **restaurar backup** (arquivo + senha), os três com um código novo do equipamento. Quem não é o dono do nó vê os limites travados (o nó recusa). "Limitar remetentes desconhecidos" e "Só comunidades que sigo" aparecem desligadas: ainda sem efeito no motor |

Também reais: pareamento, sessões, ajustes, transferência com aprovação no celular e pacotes assinados.

Indisponível com o piu-node (dito na tela, sem simular sucesso): busca e pareamento automáticos e teste real no assistente (o equipamento entra "registrado"; o vínculo com a identidade técnica é a escolha de um vizinho conectado), atualizar equipamento, reiniciar outro equipamento que não o nó do painel, verificação/assinatura do nome público na malha, histórico por dia dos outros equipamentos (só o último resumo).

Sem `piu-node` (site, prévia, selo "demonstração"), tudo funciona com os dados de exemplo de `src/data/`.

## Diferenças em relação ao protótipo
- O painel ocupa a janela inteira, em vez de um quadro fixo de 1280×820 com cantos arredondados. As “bolinhas” falsas da janela foram removidas; a faixa superior continua mostrando qual nó serve o painel e o estado “sem internet”. Abaixo de 1180 px o layout se adapta (ver "Responsivo").
- O mapa da Malha fica centralizado no cartão em telas largas, e os nós de um equipamento revogado somem do mapa.
- Controles com papéis acessíveis (`switch`, `radio`, `checkbox`, `aria-current`), foco visível, Esc fecha diálogos e o assistente.

## Responsivo
- **≥ 1180 px**: como o design (barra lateral completa).
- **760–1179 px** (tablet, janela estreita do app desktop): barra lateral só com ícones (rótulo acessível e dica), cartões em 2 colunas, detalhe do equipamento abaixo da tabela, mapa da Malha acima da lista de vizinhos. O tema troca pelo botão da faixa superior.
- **< 760 px** (celular no navegador da rede local): marca e operador na faixa superior, navegação embaixo, cartões em 1 coluna, tabelas viram lista (cada valor com o próprio rótulo), colunas secundárias escondidas, diálogos e assistente com 16 px de margem, alvos de toque ≥ 44 px.
- As regras ficam no fim de `src/styles.css` (os componentes usam estilo inline; as classes trocam só o que muda por largura).
- Conferência: `npm run build && npm run check:responsive` mede `scrollWidth <= clientWidth` em 360, 390, 768, 1024 e 1280 px, em todas as rotas, nos temas claro e escuro, no painel embutido (iframe) e no assistente, e tira capturas (`responsive-shots/`). Com piu-node: `node scripts/check-responsive.mjs --url https://localhost:8420 --code <código do console> --name <operador>`.

## Segurança
- **CSP estrita** em `<meta>` no `index.html` (vale em qualquer servidor, inclusive o `piu-node`) e por header em `public/_headers` (Cloudflare Pages / Netlify): só recursos do próprio painel (`'self'`), sem scripts inline, sem `eval`, sem `data:` para fontes (`build.assetsInlineLimit: 0`). Estilos por atributo (`style=`) são liberados com `style-src-attr`.
- **Headers** (`public/_headers`): `X-Frame-Options: DENY` e `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva, `Cross-Origin-Opener-Policy`/`Resource-Policy`, HSTS (só tem efeito sob HTTPS).
- **piu-node** (`apps/piu-node`): envia os mesmos headers e exige pareamento antes de qualquer API.

## Com o piu-node (pareamento)
Quando servido pelo `apps/piu-node`, o painel só aparece depois do **pareamento**: o operador digita o código de 8 dígitos mostrado na tela do equipamento. A sessão fica num cookie `HttpOnly` (o painel nunca vê o token). Toda ação (pausar, revogar, transferir) vai para a API com o token CSRF da sessão. Transferências pedem um código novo do equipamento quando a última confirmação tem mais de 15 minutos. O botão "Sair" encerra a sessão no servidor.

Sem `piu-node` (hospedagem estática, prévia ou embutido no site), o painel roda como **demonstração**, com dados de exemplo e o selo "demonstração" no topo.

O link do instalador no assistente usa HTTPS e mostra o SHA-256 do manifesto assinado, mais o comando `verify-package.mjs`, que o instalador roda antes de executar.
