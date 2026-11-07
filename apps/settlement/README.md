# Validação de contribuições e liquidação em LUNES (Lunes Mainnet)

Dois passos do lado da Lunes, nesta ordem:
1. **Validador** (`src/validator.ts`): transforma os recibos de retransmissão e as provas de entrega em um lote semanal.
2. **Liquidação** (`src/settler.ts`): paga o lote na Lunes Mainnet e devolve o resultado ao validador.

Paga os **lotes semanais de créditos de rede** (FUN-018, seção 11 do documento de requisitos) em LUNES na Lunes Mainnet. É o componente "LUNES Reward Settlement" da arquitetura: liquidação periódica quando há conexão com a blockchain. A comunicação local nunca depende dele.

```bash
npm ci
npm test                 # validador (inclui ataques simulados), regras do lote e liquidação contra uma chain simulada
npm run validator:demo -- dados                  # gera dados de exemplo (4 nós, 400 entregas)
npm run validator:close -- --epoch 2026-S40 --budget 1000 --now 2026-10-13T00:00:00Z
npm run validator:close -- --epoch 2026-S41 --budget 1000 --now 2026-10-20T00:00:00Z   # gera dados/lotes/piu-lote-2026-S41.json
npm run validator:paid -- --lot piu-lote-2026-S41 --journal diario               # depois do lot:pay
npm run mainnet:check    # só leitura: confere a Mainnet contra o esperado (precisa de rede até a Lunes)
npm run lot:plan -- examples/lote-exemplo.json [--ws wss://…] [--from 5…]
npm run lot:pay  -- lote.json --confirm <id do lote> [--ws wss://…] [--journal diario] [--dir dados | --manual]
npm run validator:keygen -- --dir dados   # chave que abre as provas v2 (a pública vai no app)
npm run validator:bonds -- list           # cauções dos celulares no modo nó (docs/economia/no-celular.md)
```

## Validador de contribuições
Segue a proposta econômica. Os valores marcados como [decidir] lá são parâmetros aqui:

- **Evidências** (`dados/evidencias/*.json`, v1 ou v2): recibos de retransmissão, assinados pela chave do nó, e provas de entrega **v2** (assinadas pelo destino e seladas para a chave do validador). Desenho completo: `docs/economia/prova-de-entrega-v2.md`.
  - Livro v2 (`src/ledger-v2.ts`): `ackHash` do cabeçalho do envelope, a primeira prova válida vence e prova conflitante invalida o envelope, só nó registrado (`dados/operadores.json` + `dados/registro/*.json`, `src/registry.ts`), excesso de recibos = ninguém ganha (auditar), tetos por nó/dia e por destino/época.
  - Prova v1 (o `ackSecret` em claro) não rende nada: aparece no relatório como "só prova v1".
  - Recibo sem prova quando a época fecha não rende nada.
- **Teto por operador:** os 2% valem por nó **e** por operador (muitas chaves do mesmo operador não somam tetos).
- **Lote v2** (`stateHash`): `lot:pay` confere o lote contra `dados/validador.json` antes de conectar na chain (`src/binding.ts`); renomeado ou editado é recusado. O diário recusa os mesmos pagamentos com outro id.
- **Valor:** cada entrega comprovada vale 1 unidade, **dividida entre os relays**. Assim, nó falso no caminho não aumenta o total.
  - Valor da unidade = orçamento da época ÷ unidades da época.
  - Teto por nó: 2% do orçamento (`--cap`).
  - O total pago nunca passa do orçamento.
- **Épocas e prazos:**
  - a época é uma semana ISO, em UTC;
  - ela fecha uma semana depois de terminar, para dar tempo às provas;
  - o que rende só entra no lote seguinte (carência de 1 época);
  - mínimo de 5 LUNES por carteira (`--min`): abaixo disso, o valor fica para depois;
  - validade de 180 dias.
- **Carteira por lote** (`dados/carteiras/*.json`): o nó assina, com a chave dele, a carteira que recebe naquele lote (`PayoutClaim` no protocolo). Assim não se cria um vínculo público fixo entre nó e carteira.
  - Carteira forjada não vale.
  - Duas carteiras diferentes para o mesmo nó também não valem: o valor fica para depois.
  - Nós do mesmo operador podem usar a mesma carteira.
- **Auditoria** (`dados/auditorias/*.json`): um nó reprovado perde o que ainda não foi pago.
- **Reprodutível:** o livro é refeito a partir de todas as evidências a cada fechamento, em ordem estável. Só o estado do que cada nó tem a receber fica em `validador.json`.
- **Ciclo:** `validator:close` gera o lote, `lot:pay` paga, e `validator:paid` marca como pago. Se a liquidação falhar, os créditos voltam a aguardar e entram no próximo lote.

**Testes de ataque** (proposta, seção 9):
- **Sybil** com 7 nós falsos no caminho: o total por entrega não muda. O atacante fica com 7/8 da entrega, tirando dos honestos, por isso a auditoria por amostragem é necessária.
- **Recibos de entregas que não aconteceram:** zero.
- **Duplicatas:** zero.
- **Nó reprovado:** perde o que não foi pago.

**Limitações e decisões pendentes:**
- **Peso por tamanho e por meio (LoRa 1,5×):** não é aplicado. O recibo não traz tamanho nem meio, e a declaração do próprio nó não pode valer dinheiro. Precisa de uma forma verificável.
- **Teto de 2% com poucos nós:** com, por exemplo, 4 nós, o teto segura quase todo o orçamento (no exemplo, 80 de 1000 LUNES). O resto fica no fundo. Isso é intencional na proposta, mas vale decidir junto com o orçamento.
- **Caminho das evidências até o validador:**
  - o piu-node guarda recibos (`receiptLog`) e os passa a vizinhos (`RELAY_RECEIPT`);
  - as provas de entrega circulam no app;
  - ainda falta o gateway que junta isso e entrega aqui, e a tela do app e do painel onde o nó declara a carteira do lote.

## O que a Lunes Mainnet é (levantado no código da própria Lunes)
Fontes: `lunes-platform/lunes-nightly` (nó e runtime) e `lunes-platform/blockexplorer-ui` (explorador), versões de dez/2025.

| | |
|---|---|
| Base | Substrate (Aura produz os blocos, GRANDPA finaliza), runtime `lunes-nightly` v107 no repositório |
| Endereços WebSocket (produção, informados pela Lunes) | `wss://ws.lunes.io`, `wss://ws-lunes-main-01.lunes.io`, `wss://ws-lunes-main-02.lunes.io`, `wss://ws-archive.lunes.io` (nó de arquivo). O `.env` do explorador no GitHub cita outros, que não são usados aqui |
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
- **Só em redes de desenvolvimento:** `PIU_SETTLEMENT_SEED`. Na Lunes Mainnet (gênese `0xb9926ab2…61efac`) a semente em texto claro é recusada, e o keystore e o arquivo de senha precisam ter permissão `600`.

**Rede e nó RPC (auditoria final de 06/11/2026):**
- O liquidante confere o hash de gênese antes de assinar. Para uma rede de desenvolvimento, declare a gênese dela em `PIU_SETTLEMENT_GENESIS` (`0x` + 64 hex).
- `--ws`/`PIU_SETTLEMENT_WS`: só `wss://`; `ws://` apenas em `localhost`.
- Dois `lot:pay` do mesmo lote ao mesmo tempo: o segundo é recusado pela trava `diario/<lote>.lock`. Se nenhum estiver rodando (queda), a trava de um processo morto é retomada sozinha.
- Diário corrompido ou ilegível aborta o pagamento (nunca vira "lote novo").
- Caixa atrás de um proxy HTTPS neste computador: `validator:inbox -- --listen 8430 --trust-proxy` (limite por cliente pelo `X-Forwarded-For`). A caixa recusa com `507` quando `evidencias/` ou `registro/` passam de 200 000 arquivos.
- Cauções: `validator:bonds -- refund --operator <hex> --tx <hash da caução> --refund-tx <hash da devolução>` guarda a transação de devolução (a mesma não vale duas vezes); `--tx` é obrigatório quando o celular tem mais de uma caução ativa.

**Quem guarda essa conta e onde este serviço roda ainda é decisão em aberto.** Por exemplo: um serviço da Lunes com a carteira do tesouro de recompensas, com multisig ou não.

## Ainda falta
- Rodar `npm run mainnet:check` com acesso à Mainnet e ajustar o que vier `[DIFERENTE]`.
- Uma liquidação real de teste, com valor mínimo, numa conta de teste da Lunes.
- O caminho dos créditos até aqui:
  - hoje o app fecha lotes simulados (`apps/mobile/src/messaging/credits.ts`);
  - falta o validador que recebe recibos e provas pela malha, audita e gera o `lote.json` com as carteiras de destino.
