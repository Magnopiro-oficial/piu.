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

## O que ainda é simulado
Ainda não existe API do `piu-node`, então os dados vêm de `src/data/` e algumas ações só mostram o resultado:
- busca e pareamento de equipamento, teste real (temporizadores);
- aprovação da transferência no celular (“Simular aprovação no celular”);
- atualizar, reiniciar, encerrar sessões, backup e rotação de chaves (só toast).

Funcionam de verdade: navegação, filtros e busca, pausar e revogar, adicionar equipamento, checagem do nome `piu.*`, limites e políticas, tema, **Exportar CSV** (baixa o arquivo) e copiar endereço ou link (área de transferência).

## Diferenças em relação ao protótipo
- O painel ocupa a janela inteira, em vez de um quadro fixo de 1280×820 com cantos arredondados. As “bolinhas” falsas da janela foram removidas; a faixa superior continua mostrando qual nó serve o painel e o estado “sem internet”. Largura mínima: 1180px.
- O mapa da Malha fica centralizado no cartão em telas largas, e os nós de um equipamento revogado somem do mapa.
- Controles com papéis acessíveis (`switch`, `radio`, `checkbox`, `aria-current`), foco visível, Esc fecha diálogos e o assistente.
