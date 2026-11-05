# Contrato da API: carteira de provider na Lunes Mainnet (histórico e "assinar no celular")

Implementado em `apps/piu-node` (2026-11-04): `src/lunes/history.ts`, `src/lunes/signing.ts`, rotas em `src/app.ts`; testes em `test/lunes-history.test.ts` e `test/lunes-signing.test.ts` (RPC e indexador falsos; nada vai à Mainnet). Este documento é o que o **celular** (`apps/mobile`), o **painel** (`apps/provider-panel`) e o **Piu Desktop** (`apps/desktop`) consomem. Continua valendo `docs/carteira/proposta-carteira-propria.md` para os parâmetros da rede.

## 0. Princípios

- **A chave da carteira do provider fica só no celular.** Ela é derivada da mesma frase do backup com derivação dura `//piu-provider` (`deriveHard(secretFromSeed(mini), 'piu-provider')`, em `apps/mobile/src/lib/walletKey.ts`). O piu-node **nunca** guarda, recebe ou deriva chave Lunes; ele só conhece o **endereço** (`PUT /api/wallet/lunes`). Quem configura o endereço no painel deve colar exatamente o endereço que o celular mostra para `//piu-provider`; se não bater, o nó recusa o extrinsic assinado ("O assinante não é a carteira do provider configurada.").
- **O nó monta e confere; o celular assina.** O pedido carrega o contexto de assinatura lido ao vivo (runtime, gênese, bloco, nonce, taxa). O celular monta o extrinsic com `buildTransferKeepAlive` (`extrinsic.ts`) a partir desse contexto e devolve o hex. O nó decodifica e exige igualdade byte a byte com o pedido antes de enviar.
- **Autenticação igual à do resto da API**: cookie de sessão `__Host-piu_session` (obtido por `POST /api/pair` com o código de 8 dígitos do equipamento) e, nas rotas que mudam estado, cabeçalho `X-CSRF-Token` + `Origin` igual ao host (o app já faz isso em `nodeApi.ts`). Abrir um pedido exige **step-up** (autenticação há menos de `STEP_UP_MS`; senão `403 { error, reauth: true }` → `POST /api/reauth`). Devolver o extrinsic assinado não exige step-up: a assinatura é a prova.
- **Valores em planck, como texto** (`"100000000"` = 1 LUNES; 1 LUNES = 10^8 planck). JSON não tem bigint. Endereços SS58 no prefixo 57 (`6…`) ou 42 (`5…`); o nó aceita os dois e devolve como foi informado.
- **Erros** sempre `{ "error": "mensagem em português", ...extras }`. Mensagens já prontas para a tela.

## 1. `GET /api/wallet/lunes/history`

Histórico real do endereço configurado, lido do indexador público da Lunes (`https://lunes-squid.lunes.io`, o mesmo do explorador). Cache de 60 s por endereço no nó; depois de uma falha, 15 s antes de tentar de novo. Sessão.

Resposta `200`:
```json
{
  "address": "6iUb9r…Gse" | null,
  "indexer": "https://lunes-squid.lunes.io",
  "explorer": "https://blockexplorer.lunes.io/",
  "history": {
    "address": "6iUb9r…Gse",
    "moves": [
      { "id": "13301965-11", "direction": "out" | "in" | "self", "amount": "3320", "counterparty": "6…", "counterpartyId": "5…",
        "block": 13301965, "eventIndex": 11, "at": 1793830332000 | null }
    ],
    "total": 149, "truncated": true, "at": 1793830400000
  } | null,
  "error": null | "Sem conexão com o indexador da Lunes (…)",
  "cached": false
}
```
- Sem endereço configurado: `history: null, error: null` e o nó não consulta nada.
- `history` é a **última leitura** (pode ser antiga: olhe `history.at`) ou `null` se nunca houve. Quando `error` vem preenchido, mostre o erro e "tentar de novo"; **nunca** interprete `history: null` como "sem movimentações" — conta sem movimentações vem `history.moves: []` com `error: null`.
- `moves` da mais recente para a mais antiga; só transferências diretas de LUNES (`balances.Transfer`): taxas, staking e contratos não aparecem. `truncated: true` = a conta tem mais do que os 50 enviados + 50 recebidos pedidos. `counterparty` no prefixo do endereço informado; `counterpartyId` no prefixo 42 (para `explorer + 'account/' + counterpartyId`); link da movimentação: `explorer + 'block/' + block`.
- `401` sem sessão.

## 2. Pedidos de transferência: objeto `Transfer`

```json
{
  "id": "uuid",
  "from": "6iUb9r…Gse",                 // carteira do provider configurada (assinante esperado)
  "dest": "6mfqoT…wqr",                 // destino como informado (57 ou 42), já conferido
  "value": "100000000",                 // planck, texto
  "fee": "144000" | null,               // taxa estimada em planck (null se a consulta falhou; na Lunes = 1000 planck/byte)
  "ctx": {                              // contexto de assinatura, lido ao vivo na criação
    "specVersion": 107, "transactionVersion": 2,
    "genesisHash": "0xb992…efac",
    "blockHash": "0x…", "blockNumber": 13310000,   // último bloco finalizado na criação (referência da era)
    "nonce": 3, "period": 64, "tip": "0"
  },
  "createdAt": 1762300000000,
  "expiresAt": 1762300300000,           // até quando o celular pode assinar (criação + 5 min)
  "validUntil": 13310064,               // último bloco em que a era aceita (blockNumber + period)
  "updatedAt": 1762300000000,
  "status": "pending",
  "extrinsic": null | "0x3902…",        // hex assinado, depois que o nó aceitou
  "txHash": null | "0x4e08…",           // blake2b-256 do extrinsic (o hash que o explorador mostra)
  "signedAt": null | 1762300050000,
  "submittedAt": null | 1762300051000,
  "submitAttemptedAt": 1762300050000,  // opcional; tentativa persistida ANTES do envio (ausente em registros antigos)
  "block": null | { "number": 13310003, "hash": "0x…", "index": 1 },
  "error": null | "mensagem"
}
```

### Estados

```
pending ──(assinatura conferida)──▶ signed ──(resposta de aceitação)──▶ submitted
   │                                 │                                  │
   ├─ 5 min sem assinatura → expired  └──(hash encontrado em bloco)───────┤
   └─ cancelado → removido                                               ▼
                                                                    in_block
                                                                        │
                       bloco finalizado + System.ExtrinsicSuccess ──────┤──▶ finalized
                       bloco finalizado + System.ExtrinsicFailed ───────┘──▶ failed
signed/submitted ──(era finalizada inteira conferida, hash ausente)──▶ failed
signed ──(recusa de validação/runtime ANTES de qualquer tentativa de envio)──▶ failed
```

| Estado | Significado | O que mostrar |
|---|---|---|
| `pending` | esperando a assinatura do celular | painel: "aguardando o celular" + contagem até `expiresAt`; celular: confirmar e assinar |
| `signed` | assinatura conferida; envio não confirmado ou resultado incerto | "confirmando envio…" + `error`; não oferecer outro pagamento |
| `submitted` | um nó da Lunes aceitou na fila; procurando o hash calculado localmente em blocos | "enviada, aguardando bloco" + `txHash` |
| `in_block` | hash encontrado; falta finalização ou comprovação da execução | "no bloco #…; verificando execução" + `error`, se houver; não oferecer outro pagamento |
| `finalized` | bloco finalizado e evento `System.ExtrinsicSuccess` para o índice exato do extrinsic | "concluída" |
| `failed` | recusa antes do envio, execução falhou em bloco finalizado, ou ausência comprovada em toda a era finalizada | mostrar `error`; permitir novo pedido. Uma execução que falhou pode ter cobrado a taxa |
| `expired` | ninguém assinou em 5 min | "venceu", permitir novo pedido |

Um operador tem **um** pedido em andamento por vez (`pending`, `signed`, `submitted` ou `in_block`). Só `finalized`, `failed` e `expired` liberam outro pedido. O nó guarda até 50 pedidos por operador (os encerrados mais antigos saem).

**Resultado ambíguo bloqueia outro pagamento.** Um endpoint pode aceitar o extrinsic e perder a resposta; o failover seguinte pode responder `Already Imported`, `Stale` ou até `Payment` depois de o saldo já ter sido consumido. Nenhuma dessas respostas, após uma tentativa de envio, prova que o pagamento não ocorreu. O nó conserva os mesmos bytes e o hash calculado localmente, procura a inclusão antes de reenviar e não reassina com outro nonce. Registros antigos em `signed`, sem `submitAttemptedAt`, também são tratados como incertos. A era expirada só permite falha definitiva após conferir todos os blocos finalizados do intervalo; blocos ou RPC indisponíveis mantêm o bloqueio.

**Inclusão não prova execução.** `System.Events` e a metadata são consultados no hash do bloco, e os eventos são decodificados pelo `@polkadot/types`, carregado sob demanda. Apenas `ApplyExtrinsic` com o índice exato e um resultado único são aceitos. Eventos ausentes, ilegíveis, de outra fase/índice ou contraditórios mantêm `in_block` e um motivo em `error`; a consulta será repetida. Uma falha em bloco ainda reorganizável não é definitiva.

## 3. `POST /api/wallet/lunes/transfers` (painel / desktop / celular abrem o pedido)

Sessão + CSRF + step-up. Limite 20/min.

Corpo: `{ "dest": "6…|5…", "value": "100000000" }` (`value`: só dígitos, 1–39; planck).

- `201` → `Transfer` em `pending`. Mostre `value`, `fee`, `dest` e `expiresAt`; o celular vai listar este pedido.
- `400` → entrada inválida: SS58 errado ("…soma de verificação"), valor 0, valor maior que u128, destino igual à carteira do provider, `value` fora do padrão (número em vez de texto, decimais).
- `403 { reauth: true }` → sem step-up recente.
- `409` → (a) "Configure o endereço da carteira de provider antes de transferir."; (b) "Pareie um celular: é ele que guarda a chave e assina a transferência."; (c) "Já existe um pedido em andamento…" com `{ id, status }` do pedido ativo; (d) runtime da Lunes diferente do conferido (`{ runtime: {specVersion, transactionVersion}, checked: {107, 2} }`) → "Atualize o Piu antes de transferir." **Não** tente montar o extrinsic por conta própria nesse caso.
- `502` → o nó da Lunes recusou alguma consulta (mensagem do nó); `503` → sem resposta da Lunes Mainnet (nenhum endereço respondeu). Nada é registrado.

O nó **não** confere saldo ao abrir o pedido (o saldo é do celular/painel mostrar); o runtime valida antes de enviar (`Payment` nessa validação, sem tentativa anterior, leva a `failed`). A execução final também é conferida por eventos. Use `transfer_keep_alive`: a Lunes recusa o que levaria a conta abaixo do depósito existencial (500 planck).

## 4. `GET /api/wallet/lunes/transfers[?status=…]` e `GET /api/wallet/lunes/transfers/:id`

Sessão. Lista do operador da sessão, mais recente primeiro; `status` opcional (um dos sete). Pendentes vencidos já vêm como `expired`. `GET /:id` → `Transfer` ou `404` (inclusive pedido de outro operador).

**Celular**: consulte `?status=pending` ao abrir a tela (e, se quiser, a cada poucos segundos enquanto ela estiver aberta; não há push). **Painel/desktop**: consulte `/:id` a cada 3–6 s enquanto o estado não for final.

## 5. `POST /api/wallet/lunes/transfers/:id/signed` (o celular devolve o extrinsic)

Sessão + CSRF (sem step-up). Corpo: `{ "extrinsic": "0x…" }` (hex, até 4096 caracteres). Limite 10/min.

O que o celular faz, nesta ordem:
1. Mostra `dest`, `value` (e `fee`) e pede biometria/PIN (`confirmDevice()`).
2. Confere localmente `ctx.specVersion === 107 && ctx.transactionVersion === 2` e `ctx.genesisHash` igual ao da Mainnet conhecida (`0xb9926ab2…61efac`); se não, não assina e mostra "atualize o Piu".
3. Confere que `from` é o endereço de `//piu-provider` desta frase; se não, não assina ("este nó aponta para outra carteira").
4. `withWalletKey(frase, root => { const key = deriveHard(root.secret, 'piu-provider'); buildTransferKeepAlive(key, { dest, value: BigInt(value), ctx: { ...ctx, tip: BigInt(ctx.tip) } }) })` e envia `hex`. Zera a chave derivada (`wipe`).
5. Pode recusar o pedido localmente (não há rota de "recusar": basta não assinar; o pedido vence em 5 min, e o painel pode cancelar).

O nó confere e responde:
- `202` → assinatura aceita e guardada. Normalmente `submitted`; pode permanecer `signed` com `error` se a tentativa de envio recebeu uma resposta ambígua. Mostrar o hash e acompanhar `GET /:id`, sem permitir refazer o pagamento enquanto estiver ativo.
- `400` → o extrinsic **não corresponde ao pedido**; o pedido **continua `pending`** (dá para assinar de novo). Mensagens: "O extrinsic precisa vir em hex", "Extrinsic curto demais", "O tamanho do extrinsic não bate com o prefixo", "Esperava um extrinsic v4 assinado (0x84)", "O assinante não é a carteira do provider configurada", "A era não corresponde ao bloco do pedido", "O nonce (x) não é o do pedido (y)", "A gorjeta não é a do pedido", "O call não é balances.transfer_keep_alive(dest, value)", "O destino não é o do pedido", "O valor (x planck) não é o do pedido (y)", "A assinatura não confere com o pedido (chave, gênese, runtime ou bloco diferentes)".
- `404` → pedido inexistente ou de outro operador.
- `409` → pedido não está `pending` (`{ status }`): já assinado/enviado, `expired`, `failed`; **ou** o runtime mudou entre o pedido e a assinatura (vira `failed`).
- `422` → o runtime recusou em `validate_transaction` antes de qualquer tentativa de envio (vira `failed`, nada enviado). `error` traz a variante: `Payment` (sem saldo para valor + taxa), `BadProof` (assinatura não aceita pelo runtime), `Stale`/`Future` (nonce), `AncientBirthBlock` (era velha), etc. Extra `validity`.
- `502` → consulta ao runtime/validação recusada por RPC; a assinatura continua guardada e deve ser acompanhada pelo mesmo pedido. Erros recebidos depois de tentar `author_submitExtrinsic` retornam `202`, estado `signed` e motivo em `error`: não provam ausência de pagamento.
- `503` → sem resposta da Lunes. A assinatura **foi aceita e guardada**: o pedido fica `signed`. A cada 6 s, o nó procura o hash em blocos antes de tentar reenviar os mesmos bytes. O celular não precisa assinar de novo; acompanhe por `GET /:id`. Não interpretar uma falha de conexão como autorização para pagar novamente.

## 6. `DELETE /api/wallet/lunes/transfers/:id`

Sessão + CSRF. Remove um pedido `pending` ou `expired` (`204`). `409 { status }` se já foi assinado/enviado (fica como histórico). `404` se não existe ou é de outro operador.

## 7. O que cada consumidor precisa fazer

**Celular (`apps/mobile`)**
- Tela "Carteira do provider": mostrar o endereço de `//piu-provider` (para o operador colar no painel) e um aviso: "quem tem a frase tem as conversas e o dinheiro".
- Tela "Assinar transferências": `GET /api/wallet/lunes/transfers?status=pending` do nó pareado (mesma sessão de `nodeApi.ts`); para cada pedido, confirmar + biometria + assinar + `POST …/signed`; tratar `400` (mostrar `error`, permitir tentar de novo), `409`, `422`, `502`, `503` como na seção 5. Depois do `202`, acompanhar `GET /:id` e mostrar `txHash`/explorador.
- Nunca mandar a frase, o mini-secret ou a chave derivada para o nó. O único segredo que sai do aparelho é o extrinsic assinado.

**Painel (`apps/provider-panel`)**
- Carteira Lunes: além do saldo (`GET /api/wallet/lunes`), listar o histórico (`GET …/history`), com estado de erro honesto e "tentar de novo".
- Enviar: formulário destino + valor em LUNES (converter para planck como texto: `Math.round(x * 1e8)` não serve para valores grandes — use aritmética inteira sobre a string), `POST …/transfers` com tratamento de `403 reauth` (fluxo de step-up já existente), `409` (sem endereço / sem celular / já em andamento / runtime), e então uma tela "assine no celular" com contagem até `expiresAt`, polling de `GET /:id` e botão cancelar (`DELETE`). Mostrar a linha do tempo dos estados e o link do explorador em `in_block`/`finalized`.
- Lista dos últimos pedidos (`GET …/transfers`) com estado e erro.

**Piu Desktop (`apps/desktop`)**
- Mesmas rotas do painel (o desktop sobe o próprio piu-node e já tem sessão). Como o nó roda no mesmo processo, pode usar `GET /:id` sem pudor a cada bloco. Nada de chave no desktop também.

## 8. Riscos e limites conhecidos

- **Runtime fixo em 107/2**: qualquer upgrade da Lunes para o nó recusar pedidos (`409`) até alguém reconferir as signed extensions e atualizar `extrinsic.ts` + `CHECKED_RUNTIME`. É intencional (bytes assinados mudariam), mas significa indisponibilidade da função até o Piu ser atualizado.
- **Nonce**: um pedido em andamento por operador, incluindo `in_block`. `Stale`/`Future` antes de qualquer tentativa de envio podem encerrar o pedido; depois de uma tentativa, o resultado permanece incerto até a reconciliação. Não refazer enquanto o pedido estiver ativo.
- **Era de 64 blocos (~6,4 min)** a partir do bloco finalizado da criação; com 5 min para assinar, sobra pouco se a rede estiver lenta. Só depois de comprovar a ausência do hash em toda a era finalizada o estado vira `failed` "A era passou…" e permite outro pedido. Para pagamento sem internet (regra 7.3) será preciso era maior/imortal; decisão separada.
- **Indexador fora da cadeia**: o histórico depende de `lunes-squid.lunes.io`; o saldo (RPC) continua funcionando sem ele. O indexador não traz horário no transfer (segunda consulta por bloco) e só lista `balances.Transfer`.
- **Acompanhamento** só enquanto o nó estiver ligado (6 s por passo; cursor `scanned` persiste no `state.json`, então reiniciar retoma de onde parou). Reorganização de bloco antes de finalizar volta o pedido para `submitted` e procura de novo.
- **`@scure/sr25519`** é autoauditado (não auditado por terceiros); no nó só verifica assinatura, e a conferência final é do runtime (`validate_transaction`).
