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
Servido pelo `piu-node` (com sessão), estes dados e ações são **reais**:
- equipamentos: lista, pausar, revogar e **ativar pelo assistente** (`POST /api/devices`);
- **limites globais e política de tráfego**: carregados e salvos no nó, por operador;
- **acessos a este painel**: a lista real de sessões ("Chrome · Linux", "App Piu Provider · macOS") e **Encerrar outras sessões** (pede um código novo do equipamento se a última confirmação passou de 15 min);
- carteira: saldo e **transferência para a carteira pessoal ou para um endereço `lunes:…` colado** (com step-up);
- **aprovação no celular**: em Configurações → Parear celular, o app Piu lê o QR e devolve 6 dígitos. Depois disso, "Assinar no celular" mostra o QR do pedido e o código de conferência, e a transferência só sai com o código de aprovação que o celular mostra depois da biometria (ver `apps/piu-node/README.md`);
- pacotes assinados do instalador.

Ainda **simulados** (dados de `src/data/`, também com o `piu-node`):
- Visão geral, Malha e Ganhos (métricas, topologia, créditos e lotes), que ainda não leem `GET /api/relay`;
- movimentações da carteira (só o saldo é real). Na demonstração, sem nó, a aprovação no celular continua simulada;
- busca, pareamento e teste real no assistente (temporizadores);
- atualizar e reiniciar equipamento, backup e rotação da chave de operador (só aviso).

Sem `piu-node` (site, prévia), tudo funciona com os dados de exemplo.

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
