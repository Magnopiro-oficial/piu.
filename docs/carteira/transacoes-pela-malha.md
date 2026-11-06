# Transações e evidências pela malha (store-and-forward até um gateway)

Estado: implementado na lógica (protocolo, mensageiro, carteira, gateways, validador), **sem telas**. As
telas estão listadas no fim ("Telas necessárias"). Nada disto foi enviado à Mainnet: os testes usam uma
Lunes falsa.

## O problema

Até aqui a carteira assinava no celular e enviava direto pela internet (`lib/walletTransfer.ts` →
`author_submitExtrinsic`). Sem internet na hora, nada saía. O site dizia que a transação "viaja pela malha
e é liquidada quando um gateway alcança a Mainnet", mas esse caminho não existia (conferido em
2026-11-06: nenhum envio de extrinsic assinado pela malha em `apps/mobile/src`, `apps/piu-node` ou nos
docs da carteira). As evidências do modo nó (provas v2 seladas, arquivo de registro do celular) só
chegavam ao validador por arquivo compartilhado à mão.

## Como funciona

```
celular sem internet ──(BLE/Wi-Fi/LoRa/LAN)──▶ relays (celular, piu-node, computador, versões antigas)
        ▲                                               │
        │ recibo (envelope direto comum)                ▼
        └──────────────── malha ◀──────────── gateway com internet ──▶ Lunes Mainnet
                                                       └──────────────▶ caixa do validador (pacotes)
```

1. **Assinar sem rede** (`lib/walletCarry.ts`). A carteira usa o contexto lido da última vez que houve
   rede (`WalletOfflineContext`: runtime, gênese, nonce, saldo disponível e taxa; guardado em
   `wallet.offlineCtx`, atualizado junto com a leitura do saldo). Mesmas conferências do envio direto:
   runtime e gênese conferidos (`checkedRuntime`), biometria, a frase tem de ser da carteira,
   `checkedSigned` confere destino, valor, nonce, era e assinatura, e **os bytes são gravados antes de sair**.
   O registro fica `status: 'signed'` com `carried` ("em trânsito pela malha").
2. **Carga** (`protocol/carry.ts`). A transação vai num envelope direto comum (formato 0, sem mudança no
   cabeçalho) para uma identidade **pública e conhecida por todos**: `GATEWAY_TX_IDENTITY` (transações) ou
   `GATEWAY_INBOX_IDENTITY` (pacotes para o validador). O remetente é uma **identidade descartável**, nova
   a cada carga. Tipo novo `MsgType.Carry` (5).
3. **Relays** guardam e repassam como qualquer envelope de terceiros (TTL, retenção, cópias limitadas,
   prioridade Alta). Aparelhos antigos fazem o mesmo sem saber o que é.
4. **Gateway** (`lib/carryGateway.ts`: celular, piu-node e computador usam o mesmo código). Só "pega" a carga
   enquanto tem o papel ligado **e** a Lunes responde (sonda periódica); sem rota, a carga segue pela malha.
   Confere que é uma `transfer_keep_alive` assinada, valida (`validate_transaction`), envia
   (`author_submitExtrinsic`; "já está no pool" conta como aceito), acompanha até um bloco finalizado e
   responde a cada mudança: `pool` → `included` → `finalized`, ou `invalid` com o motivo da Lunes.
5. **Recibo** volta num envelope direto para a identidade descartável (o "token de retorno de uso único").
   A carteira guarda como **dica** (`carried.report`); não muda o estado.
6. **Conciliação** (`reconcileCarriedTransfer`). Quando o próprio celular tem internet, ele resolve sozinho,
   sem depender de recibo:
   - o recibo apontou um bloco → confere se é o bloco canônico e contém o hash → acompanhamento normal
     (indexador para o resultado da execução, como no envio direto);
   - o nonce da conta já passou → procura o hash nos blocos que o indexador aponta e, se preciso, varre os
     blocos desde a assinatura em partes de 400; só diz "não concluída" depois de olhar tudo (dizer isso de
     uma que entrou levaria a pagar duas vezes);
   - o nonce está livre → o celular envia **os mesmos bytes** (idempotente) e acompanha a partir do bloco em
     que o nonce estava livre;
   - a Lunes recusa (saldo, runtime) → "não concluída", com o aviso de que a assinatura ainda vale até outra
     transação da carteira usar o nonce.

Evidências: `lib/evidenceCarry.ts` divide o arquivo de evidências (`EvidenceFile` v2) e o de registro do
modo nó (`PhoneRegistryFile`) em partes que são, cada uma, um arquivo válido sozinho, sela cada parte para a
chave X25519 do validador (a mesma das provas v2, `VALIDATOR_PROOF_PK`) e solta como carga para
`GATEWAY_INBOX_IDENTITY`. Só gateways com a caixa configurada pegam; os outros repassam. O gateway faz
`POST` binário para a caixa; o validador abre e grava em `evidencias/` ou `registro/`
(`apps/settlement/src/inbox.ts`, `npm run validator:inbox`). O `close` confere esses arquivos exatamente como
os compartilhados à mão. O arquivo manual continua valendo.

## Era e nonce (a decisão mais importante)

**Era imortal** (`IMMORTAL_PERIOD = 0`, byte `0x00`, bloco da era = gênese) para a transação levada pela malha.

- Por quê: a Lunes guarda só os **2400** hashes de bloco mais recentes (`System.BlockHash`, lido ao vivo,
  somente leitura, em 2026-11-06: o bloco finalizado − 2400 existe, − 2401 não). Uma era mortal precisa do
  hash do bloco de nascimento, então dura no máximo ~2400 blocos (~4 h com blocos de 6 s), contados a partir
  do último bloco que o celular viu. Para uma malha offline isso é pouco.
- Conferido: uma transferência imortal assinada por uma conta nova e sem saldo foi validada na Mainnet com
  `TaggedTransactionQueue_validate_transaction` (**sem enviar**): resultado `Invalid(Payment)`, ou seja,
  assinatura e era aceitas. A mesma com outro hash de bloco deu `BadProof`.
- **Risco aceito:** enquanto o nonce não for usado e o runtime não mudar (spec/tx version), a transação
  assinada pode ser enviada por qualquer pessoa que tenha os bytes, inclusive dias depois. Ela paga o que a
  pessoa autorizou, mas pode chegar tarde.
- Como o Piu limita: só **uma** transferência em andamento por conta (regra `busy` que já existia). Enquanto
  a levada não se resolve, nada novo sai da carteira. Qualquer transação nova da conta usaria o mesmo
  nonce, então **no máximo uma das duas é liquidada, nunca as duas**. Quando uma transferência ocupa um
  bloco, o contexto guardado avança o nonce (`advanceOfflineContext`).
- Contexto com mais de 7 dias: recusa (`offline_context`). O runtime pode ter mudado.
- Taxa: sem rede não dá para cotar. O saldo da última leitura precisa cobrir o valor mais **2×** a última
  taxa (a taxa não entra na assinatura; é cobrada na inclusão).
- O envio direto (com internet) continua com era mortal de 64 blocos, sem mudança.

## Privacidade no fio

- A transação assinada é pública de qualquer jeito (vai para a chain). Qualquer relay pode abrir a carga,
  porque a chave do gateway é pública.
- Nada liga a carga à identidade de mensagens: o remetente é uma identidade descartável (teste "nenhuma
  chave de mensagens da pessoa vai no fio"), duas cargas não se ligam pelo remetente, e o recibo volta para
  a descartável, de outra descartável do gateway.
- Resíduo: a própria transação mostra o endereço da carteira, e o primeiro vizinho vê que a carga saiu do
  enlace deste aparelho (o enlace usa a chave técnica do dia, não a social). O "Atraso aleatório no envio"
  vale também para a carga. Pacotes de evidências vão selados para o validador; relays e gateways não leem.

## Modelo de ameaças

| Ameaça | O que acontece | Mitigação |
|---|---|---|
| Relay descarta a carga | Não chega ao gateway por aquele caminho | Cópias por vários vizinhos (spray limitado); o celular guarda a própria até o TTL (7 dias) e volta a soltar ao reabrir; `recarryTransfer` solta de novo os mesmos bytes; com internet, o próprio celular envia |
| Relay atrasa | Chega tarde | Imortal: ainda vale. Enquanto isso a carteira bloqueia novos envios |
| Relay repete (replay) | Mesma carga várias vezes | Deduplicação por id de envelope no roteador; no gateway, por hash da transação (os mesmos bytes, o mesmo hash); a Lunes recusa o nonce repetido |
| Relay altera bytes | — | Envelope autenticado (AEAD + assinatura da descartável); a transação é assinada pela carteira (sr25519) |
| Recibo forjado | Qualquer relay que viu a carga conhece a descartável e pode forjar "finalizada" ou "invalid" | O recibo é só dica: não muda o estado nem libera novos envios. "Confirmada" só com a leitura da Mainnet pelo próprio celular |
| Gateway censura (não envia) | Fica parado nele | Outros gateways recebem outras cópias; o gateway não sabe quem mandou; o celular envia sozinho quando tiver internet |
| Enxurrada de cargas | Gateway gastando consultas | Teto por enlace (30/h, rajada 10) no celular e no piu-node, teto do roteador por vizinho, 20 envios/min e 10 pacotes/min por gateway, fila de 200, 500 acompanhadas, 4 respostas por item, só `transfer_keep_alive` de até 512 bytes |
| Nonce em conflito | Duas transações com o mesmo nonce | Só uma em andamento; nova transação reusa o nonce (no máximo uma é liquidada) |
| Era | Mortal expira em ~4 h | Imortal, com o risco acima; morre com troca de runtime |
| "Não concluída" falsa | Pagar duas vezes | Só depois da busca completa nos blocos; o indexador só acelera |
| Pacote de evidências lido no caminho | — | Selado para a chave do validador |
| Pacote falso na caixa | — | A caixa só confere a forma; o `close` confere as assinaturas como num arquivo manual. Arquivo por referência do pacote: repetido não grava |

## Compatibilidade

- O cabeçalho do envelope não mudou. Aparelhos antigos guardam e repassam a carga como envelope de
  terceiros (teste "nó antigo… guarda e repassa") e recusam o tipo 5 se um dia tentarem abrir
  (`readInner` antigo aceita só até 4).
- O roteador ganhou `openExtra` (abre só envelopes com destino de gateway ou de uma descartável minha, sem
  custar uma troca de chaves a mais em cada envelope que chega). Cópias sincronizadas no piu-node e no
  validador (`protocol:sync`, `lunes:sync`).

## Parâmetros

| Parâmetro | Valor | Onde |
|---|---|---|
| Era da transação levada | imortal (`IMMORTAL_PERIOD = 0`) | `lib/extrinsic.ts` |
| Hashes de bloco guardados pela Lunes | 2400 (medido) | — |
| Vida da carga e do recibo | 7 dias (`MAX_TTL_SEC`) | `protocol/carry.ts` |
| Contexto sem rede, idade máxima | 7 dias | `lib/walletCarry.ts` |
| Folga da taxa | 2× | `CARRY_FEE_MARGIN` |
| Busca por conferência | 400 blocos | `RECONCILE_SCAN_BLOCKS` |
| Transação levada, tamanho máximo | 512 bytes | `MAX_CARRIED_TX_BYTES` |
| Pacote selado, tamanho máximo | 12 KB | `MAX_BUNDLE_BYTES` |
| Cargas por enlace | 30/h, rajada 10 | `CarryLimiter` |
| Cargas minhas esperando recibo | 32 (sai o pacote mais antigo; transação nunca) | `messaging/messenger.ts` |
| Gateway: envios/min, pacotes/min, fila, acompanhadas, respostas por item, blocos acompanhados, tentativas | 20, 10, 200, 500, 4, 50, 6 | `DEFAULT_GATEWAY_LIMITS` |
| Caixa do validador (app) | `null` | `lib/carryConfig.ts` (`VALIDATOR_INBOX_URL`) |
| Chave do validador (selo) | `null` | `protocol/proof.ts` (`VALIDATOR_PROOF_PK`) |
| Celular como gateway | desligado (`net.gateway`) | `state/network.tsx` |
| piu-node como gateway | ligado (`PIU_GATEWAY`, `0` desliga) | `apps/piu-node/src/config.ts` |
| piu-node, caixa do validador | nenhuma (`PIU_VALIDATOR_INBOX`, só `https://`) | idem |
| Computador como gateway | desligado (`PIU_GATEWAY=1` liga; `PIU_VALIDATOR_INBOX`) | `apps/desktop/src/main/core.ts` |
| Caixa HTTP do validador | `POST /caixa`, 120/min por endereço, sem TLS (proxy HTTPS na frente) | `apps/settlement/src/inbox.ts` |

## Ainda falta

- Telas (abaixo) e textos nos 11 idiomas.
- Celular como gateway "só no Wi-Fi": sem módulo de rede nativo no app, hoje o celular-gateway age quando a
  Lunes responde (pode ser dados móveis). Para restringir ao Wi-Fi, falta `expo-network` (build nativo).
- Substituir uma transferência levada (mesmo nonce, outro destino) e "cancelar" (gastar o nonce): não há.
- O gateway não guarda em disco o que acompanha: depois de reiniciar, o celular concilia sozinho.
- Publicar `VALIDATOR_PROOF_PK` e o endereço da caixa (`VALIDATOR_INBOX_URL`, `PIU_VALIDATOR_INBOX`).
- Recibo assinado por gateways conhecidos (hoje qualquer relay pode forjar; por isso é só dica).

## Telas necessárias

1. **Enviar → sem internet**: aviso de que vai pela malha (era imortal: "pode ser liquidada dias depois;
   nada novo sai da carteira até resolver"), taxa estimada com folga, idade da última leitura;
   `canCarry`, `quoteCarriedTransfer`, `carryTransfer`. Erros `offline_context` (conecte-se uma vez) e `funds`.
2. **Estado "em trânsito pela malha"** na linha da atividade e no detalhe da transferência
   (`transferInTransit`, `pendingTransfer.carried`), com o que o gateway disse (`carried.report`: no pool, em
   bloco #n, recusada, motivo) marcado como "informado por um gateway, ainda não conferido", e o botão
   "Soltar de novo na malha" (`recarryTransfer`). O registro usa `status: 'signed'`, cujo texto atual é
   "Assinada · envio ainda não confirmado".
3. **Ajuste "Usar este celular como gateway"** (Rede/Modo nó): `useNetwork().gateway` / `setGateway`, com o
   aviso de dados e bateria.
4. **Créditos/Modo nó → "Enviar evidências pela malha"**: `useMessaging().carryEvidence(registryFile)`;
   estados `no-validator-key` e `not-ready`; o compartilhamento do arquivo continua ao lado.
5. **Painel do piu-node**: estado do gateway (`relay.gateway.stats()`: online, caixa, enviados, finalizados,
   na fila) e os dois ajustes (hoje por variável de ambiente).
