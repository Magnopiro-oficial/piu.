# Liquidação em LUNES (Lunes Mainnet)

Paga os **lotes semanais de créditos de rede** (FUN-018, seção 11 do documento de requisitos) em LUNES na Lunes Mainnet. É o componente "LUNES Reward Settlement" da arquitetura: liquidação periódica quando há conexão com a blockchain. A comunicação local nunca depende dele.

```bash
npm ci
npm test                 # regras do lote e liquidação contra uma chain simulada
npm run mainnet:check    # só leitura: confere a Mainnet contra o esperado (precisa de rede até a Lunes)
npm run lot:plan -- examples/lote-exemplo.json [--ws wss://…] [--from 5…]
npm run lot:pay  -- lote.json --confirm <id do lote> [--ws wss://…] [--journal diario]
```

## O que a Lunes Mainnet é (levantado no código da própria Lunes)
Fontes: `lunes-platform/lunes-nightly` (nó e runtime) e `lunes-platform/blockexplorer-ui` (explorador), versões de dez/2025.

| | |
|---|---|
| Base | Substrate (Aura produz os blocos, GRANDPA finaliza), runtime `lunes-nightly` v107 no repositório |
| Endereços WebSocket (explorador) | `wss://ws-lunes-main-01.lunes.io`, `wss://ws-lunes-main-02.lunes.io`, `wss://ws-up.lunes.io`, `wss://ws-bolunes.lunes.io`, `wss://ws-lunesblock.lunes.io`, `wss://ws.lunes.io` |
| Indexador (histórico) | `https://lunes-squid.lunes.io/` |
| Moeda | LUNES, **8 casas** (1 LUNES = 100.000.000 planck) |
| Bloco | 6 s |
| Taxa | só por tamanho: 1.000 planck (0,00001 LUNES) por byte. A parte por peso é zero no runtime (`coeff_integer: 1 / 100`, divisão inteira). Distribuição: 75% para quem produz o bloco, e o resto para o tesouro e a queima (enquanto o total em circulação passar de 50 milhões) |
| Depósito existencial | 500 planck (0,000005 LUNES) |
| SS58 | o chain spec da Mainnet declara 57; o runtime e o explorador usam 42 (endereços começando com "5"). O lote aceita os dois |

**Nada disso foi conferido ainda contra o nó ao vivo**: deste ambiente, a rede até `*.lunes.io` está bloqueada. O documento pede validar endpoints, transferência, decimais, taxas, finalização e limites antes de liquidar: é o que `npm run mainnet:check` faz. Ele mostra cada item com `[ok]` ou `[DIFERENTE]`, mede o tempo de bloco nos últimos 20 blocos e estima a taxa de uma transferência, sem chave e sem enviar nada.

## Como um lote é pago
Entrada (gerada pelo validador de créditos):
```json
{ "id": "2026-W44", "payouts": [{ "address": "5F…", "lunes": "12.34" }] }
```

1. **Plano** (`src/lot.ts`):
   - os valores são exatos, em planck (`bigint`, sem ponto flutuante);
   - os endereços são normalizados, e o mesmo dono em formato 42 e 57 vira um pagamento só;
   - cada pagamento precisa de pelo menos 5 LUNES (mínimo da proposta econômica, configurável) e do depósito existencial;
   - um lote tem até 500 pagamentos.
2. **Conferência**: runtime, casas decimais e símbolo da chain, mais o saldo da conta pagadora (total + taxa + depósito existencial).
3. **Uma transação por lote**: `utility.batchAll([balances.transferKeepAlive…, system.remarkWithEvent("piu/lote/v1 <id> <sha256 dos pagamentos>")])`.
   - `batchAll` é tudo ou nada: ou todos recebem, ou ninguém.
   - `transferKeepAlive` não deixa a conta pagadora sumir.
   - Pelo remark, qualquer pessoa confere no explorador o que foi pago em cada lote.
4. **Diário à prova de pagamento duplo** (`src/journal.ts`, `src/settler.ts`):
   - a transação assinada, com era mortal de 64 blocos (cerca de 6,4 min), é gravada (0600) **antes** de ser enviada;
   - depois de qualquer queda, rodar de novo:
     - procura a transação nos blocos em que ela podia entrar;
     - se ainda vale, reenvia **os mesmos bytes** (o nonce garante uma execução só);
     - só assina de novo depois que a validade passou sem ela entrar.
   - Lote finalizado ou que falhou na chain nunca é repetido sozinho.
5. **Finalização**: espera o GRANDPA finalizar e grava bloco e resultado.

**Pressuposto:** a conta pagadora é usada só por este liquidante.

## Conta pagadora (custódia)
A chave nunca fica no código nem no diário (`src/signer.ts`). Há duas formas de informá-la:
- **Uso normal:** `PIU_SETTLEMENT_KEYSTORE`, o JSON cifrado exportado pela extensão ou app polkadot-js, mais `PIU_SETTLEMENT_PASSWORD_FILE`, um arquivo com a senha que precisa ter permissão `600`.
- **Só em redes de desenvolvimento:** `PIU_SETTLEMENT_SEED`.

**Quem guarda essa conta e onde este serviço roda ainda é decisão em aberto.** Por exemplo: um serviço da Lunes com a carteira do tesouro de recompensas, com multisig ou não.

## Ainda falta
- Rodar `npm run mainnet:check` com acesso à Mainnet e ajustar o que vier `[DIFERENTE]`.
- Uma liquidação real de teste, com valor mínimo, numa conta de teste da Lunes.
- O caminho dos créditos até aqui:
  - hoje o app fecha lotes simulados (`apps/mobile/src/messaging/credits.ts`);
  - falta o validador que recebe recibos e provas pela malha, audita e gera o `lote.json` com as carteiras de destino.
