# Piu Provider · painel local

Painel do provider para computador, recriado a partir de `project/PiuProviderDesktop.dc.html` (Claude Design).
Vite + React + TypeScript. Feito para ser servido pelo daemon `piu-node` na rede local (`piu-node.local:8420`), **sem internet**: as fontes (Geist, Geist Mono) e os ícones (Material Symbols Rounded) vão dentro do build.

```bash
npm install
npm run dev        # http://localhost:8420
npm run build      # gera dist/ (base relativa, dá para servir de qualquer caminho)
npm run typecheck
```

## Estrutura
- `src/styles.css`: tokens claro/escuro, keyframes e primitivas (segmentado, toggle, barras). Respeita *reduzir movimento*.
- `src/state/store.tsx`: estado do painel (equipamentos, carteira, limites, políticas, toasts), tema salvo no `localStorage`, rotas por hash (`#/devices/mini`).
- `src/pages/`: Visão geral, Equipamentos (+ painel de detalhe), Malha, Ganhos, Carteira, Configurações.
- `src/wizard/AddDeviceWizard.tsx`: assistente de 4 etapas (Equipamento, Conectar, Teste real, Regras), incluindo o Ponto de Acesso.
- `src/data/seed.ts` e `src/data/topology.ts`: dados de exemplo do protótipo (**ilustrativos**).

## O que vem do piu-node e o que ainda é simulado
Servido pelo `piu-node` (com sessão), o painel **não usa dados de exemplo**: o que o nó mede aparece; o que depende de terceiros (validador, Mainnet, preço do LUNES) ou de hardware ainda não suportado aparece como indisponível, nunca como número inventado. As estatísticas são lidas a cada 10 s (`src/lib/live.ts`).

| Tela | De onde vem |
|---|---|
| Visão geral | recibos assinados no mês e por dia (`GET /api/relay/history`), recebidos/encaminhados/duplicatas de hoje, vizinhos por meio (`GET /api/relay`), recibos guardados para o validador (`GET /api/relay/receipts`), atividade real (vizinhos, recibos, transferências). Sem LUNES: o valor sai do validador |
| Malha | este nó no centro e os vizinhos LNNP de verdade (meio, MTU, versão, se retransmite, desde quando); "sem vizinhos ainda" quando não há |
| Ganhos | recibos por dia e por semana, pagos = entradas reais da carteira; lotes só quando houver liquidação; rejeitados "—" (o validador ainda não respondeu) |
| Carteira | saldo e movimentações reais (`GET /api/wallet`); operador novo começa com 0. Endereço da carteira e "Receber" ficam indisponíveis (ainda não configurados no nó) |
| Equipamentos | o próprio nó (`self`) com estatísticas reais (encaminhados na última hora, recibos de hoje, vizinhos, memória usada, interfaces, recibos recentes); pausar ele pausa o motor. Os outros são registros do assistente, marcados "sem dados neste nó" |
| Configurações | limites, políticas, sessões e celulares reais. Chave de operador, backup e rotação: indisponíveis (esta versão não cria chave de operador) |

Também reais: pareamento, sessões, ajustes, transferência com aprovação no celular e pacotes assinados.

Indisponível com o piu-node (dito na tela, sem simular sucesso): busca e pareamento automáticos e teste real no assistente (o equipamento entra "registrado"), atualizar e reiniciar equipamento, backup e rotação da chave de operador, verificação/assinatura do nome público na malha.

Sem `piu-node` (site, prévia, selo "demonstração"), tudo funciona com os dados de exemplo de `src/data/`.

## Diferenças em relação ao protótipo
- O painel ocupa a janela inteira, em vez de um quadro fixo de 1280×820 com cantos arredondados. As “bolinhas” falsas da janela foram removidas; a faixa superior continua mostrando qual nó serve o painel e o estado “sem internet”. Largura mínima: 1180px.
- O mapa da Malha fica centralizado no cartão em telas largas, e os nós de um equipamento revogado somem do mapa.
- Controles com papéis acessíveis (`switch`, `radio`, `checkbox`, `aria-current`), foco visível, Esc fecha diálogos e o assistente.

## Segurança
- **CSP estrita** em `<meta>` no `index.html` (vale em qualquer servidor, inclusive o `piu-node`) e por header em `public/_headers` (Cloudflare Pages / Netlify): só recursos do próprio painel (`'self'`), sem scripts inline, sem `eval`, sem `data:` para fontes (`build.assetsInlineLimit: 0`). Estilos por atributo (`style=`) são liberados com `style-src-attr`.
- **Headers** (`public/_headers`): `X-Frame-Options: DENY` e `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva, `Cross-Origin-Opener-Policy`/`Resource-Policy`, HSTS (só tem efeito sob HTTPS).
- **piu-node** (`apps/piu-node`): envia os mesmos headers e exige pareamento antes de qualquer API.

## Com o piu-node (pareamento)
Quando servido pelo `apps/piu-node`, o painel só aparece depois do **pareamento**: o operador digita o código de 8 dígitos mostrado na tela do equipamento. A sessão fica num cookie `HttpOnly` (o painel nunca vê o token). Toda ação (pausar, revogar, transferir) vai para a API com o token CSRF da sessão. Transferências pedem um código novo do equipamento quando a última confirmação tem mais de 15 minutos. O botão "Sair" encerra a sessão no servidor.

Sem `piu-node` (hospedagem estática, prévia ou embutido no site), o painel roda como **demonstração**, com dados de exemplo e o selo "demonstração" no topo.

O link do instalador no assistente usa HTTPS e mostra o SHA-256 do manifesto assinado, mais o comando `verify-package.mjs`, que o instalador roda antes de executar.
