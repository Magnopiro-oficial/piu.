# Contribuindo com o Piu

## Fluxo

1. Crie uma branch a partir da `main`: `feat/...`, `fix/...`, `docs/...` ou `chore/...`.
2. Faça commits pequenos, com mensagens no imperativo (ex.: `Add mesh legend`).
3. Abra um pull request para a `main` preenchendo o modelo. O CI roda typecheck e build.

## Design

- A fonte da verdade visual são os protótipos em [`design/`](design) e a especificação em [`docs/design-spec.md`](docs/design-spec.md). Fidelidade alta: cores, tipografia, espaçamentos, raios e animações são finais.
- Monocromático: nenhuma cor de acento. Ênfase = inverter (`ink` de fundo, `invink` de texto).
- Tema escuro é obrigatório. Toda animação respeita *reduzir movimento*.
- Ícones: Material Symbols Rounded. Fontes: Geist e Geist Mono, empacotadas localmente (os apps funcionam sem internet).

## Regras de produto que o front precisa respeitar

Resumo de `docs/design-spec.md`; os IDs vêm de [`docs/requisitos/`](docs/requisitos).

- Nunca prometer retransmissão 24 h no celular (no iPhone, só com o app aberto).
- Mídia nunca por LoRa: pausar e esperar um transporte de maior capacidade.
- Duplicatas e rotas circulares não geram crédito.
- Nome público `piu.*` só é confiável com assinatura; SSIDs sem assinatura aparecem como imitação.
- Identidade do nó, identidade social e carteira não compartilham chaves.
- Nada de mensagens na blockchain.

## Apps

| App | Pasta | Comandos |
|---|---|---|
| Painel do provider | `apps/provider-panel` | `npm install`, `npm run dev`, `npm run build` |
| Site (PT e EN) | `apps/site` | `npm install`, `npm run dev`, `npm run build` |
