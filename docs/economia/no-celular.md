# Celular como nó ("Do celular" / modo nó)

- Data: 2026-11-06 · Estado: protocolo, validador e API do app implementados; **telas a desenhar**; recompensas **desligadas**; `BOND_ADDRESS` **a definir**
- Complementa: [`prova-de-entrega-v2.md`](prova-de-entrega-v2.md) (seção 10, "Celulares como relays")
- Código: `apps/mobile/src/protocol/phoneNode.ts` (fonte da verdade, copiada para `apps/settlement/src/protocol/` e `apps/piu-node/src/protocol/` pelos scripts `protocol:sync`), `apps/mobile/src/lib/{phoneNodeCore,phoneNodeStore}.ts`, `apps/mobile/src/state/phoneNode.tsx`, `apps/mobile/src/messaging/messenger.ts` (payloads `ar`/`av`), `apps/settlement/src/{bond,phone-nodes,registry,validator,validator-cli}.ts`, `apps/piu-node/src/{operator.ts,relay/registration.ts}`

## 1. O que muda

Os celulares já retransmitem (BLE, Wi-Fi Direct, `PiuRelayService` em segundo plano), mas no v2 só rende recibo de **nó registrado**: chave de nó com certificado `OPERATOR_CERT` de um operador admitido. A chave de nó do celular gira por dia e o celular não tinha chave de operador, então nada rendia.

Agora o celular pode virar nó que rende, por escolha da pessoa:

1. **Chave de operador do celular.** `derivePhoneOperatorKey(semente)` = HKDF(semente do Piu, `piu/v0/root`, `phone-node/operator/0/sign`). Rótulo próprio: não é a identidade pública nem a anônima, nem a chave do nó do dia, nem a carteira, e não dá para ligar uma à outra pela matemática. Ela sai da semente do Piu (`piu.keys.v2`, sem biometria, ver `docs/seguranca/biometria-cofre.md`), como a chave do nó: o segundo plano continua funcionando sem pedir nada.
2. **Certificado da chave do dia.** O celular assina, com essa chave, o **mesmo** `OPERATOR_CERT` que o piu-node emite (`piu/lnnp/v1/operator-cert` ‖ operador ‖ nó ‖ `issuedAt`), um por dia, sem cadeia de rotação (`issuedAt` = início do dia UTC). Ed25519 é determinístico: o certificado do app é idêntico, byte a byte, ao do piu-node (há teste).
3. **Classe `phone`.** O registro do celular declara a classe `phone`. O validador aplica a ele um teto menor (fração configurável do teto de um operador de piu-node; padrão: metade).
4. **Antissybil: caução + aval.** Chave de celular custa zero. Para habilitar, o celular precisa de uma **caução em LUNES** (padrão 100, mais a taxa da rede) e de **3 avais** de avalistas distintos já habilitados (de pelo menos 2 raízes), depois de **7 dias** de caução.
5. **Quem avaliza:** só contato **verificado pessoalmente** (o código de segurança conferido em Contato → Verificar, `verified` do `useStore`), que está no modo nó **há mais de 7 dias**. Operadores admitidos de piu-node continuam como semente. O aval leva a afirmação assinada `inPerson` (o validador não tem como conferir; ver seção 6).
6. **Ciclo de 7 dias com certificado (no aparelho):** o celular emite sozinho, **offline**, o certificado da chave de cada dia; 7 dias **seguidos** completam o ciclo, e um dia sem certificado zera a contagem. É uma regra do app (barra de 7 traços); o validador não depende disso nem de estar no ar (certificados de dias passados podem ser assinados a qualquer hora, então não provam presença).
7. **Limites no modo nó:** só Bluetooth e Wi-Fi local (o transporte do app não usa dados móveis: BLE e Wi-Fi Direct/Nearby), até **200 MB/dia** de tráfego de terceiros (o menor entre o ajuste da pessoa e 200 MB), e pausa com bateria em **30%** ou menos (o maior entre o ajuste da pessoa e 30%).

## 2. Formatos

Tudo em `apps/mobile/src/protocol/phoneNode.ts`. Binários em hex, horários em segundos, dias = dias UTC desde 1970.

| Objeto | Mensagem assinada | Quem assina |
|---|---|---|
| Certificado do nó do dia (`CertJson`) | SHA-256(`piu/lnnp/v1/operator-cert` ‖ opPk ‖ nodePk ‖ u32 issuedAt) | chave de operador do celular (Ed25519) |
| Aval (`EndorsementJson {endorserPk, phonePk, day, inPerson, sig}`) | SHA-256(`piu/phone-node/v2/endorsement` ‖ endorserPk ‖ phonePk ‖ u32 day ‖ u8 inPerson) | chave de operador de quem avaliza; `inPerson` = afirma ter verificado o código de segurança pessoalmente |
| Vínculo da carteira (`walletSig`) | texto `piu/phone-node/v2/bond-owner
<opPk>
<carteira>
<endereço da caução>` (bytes crus) | carteira sr25519 (contexto "substrate"); assinado na ATIVAÇÃO, antes de pagar, então o registro fecha depois sem biometria |
| Registro (`PhoneRegistrationJson {v:1, class:'phone', operatorPk, wallet, bond:{txHash, block}, walletSig, sig}`) | SHA-256(`piu/phone-node/v1/registration` ‖ opPk ‖ vbytes(carteira) ‖ vbytes(txHash) ‖ u32 bloco ‖ walletSig) | chave de operador do celular |
| Saída / volta (`PhoneExitJson {operatorPk, txHash, at, kind: 'exit'\|'cancel', sig}`) | SHA-256(`piu/phone-node/v2/exit` ‖ opPk ‖ vbytes(txHash) ‖ u32 at ‖ u8 kind) | chave de operador do celular; vale o evento de `at` maior daquela caução |
| Retirada de aval (`EndorsementRevocationJson {endorserPk, phonePk, at, sig}`) | SHA-256(`piu/phone-node/v1/endorsement-revoke` ‖ endorserPk ‖ phonePk ‖ u32 at) | quem tinha avalizado |

As duas assinaturas no registro fecham dois ataques: sem a da carteira, alguém usaria a caução (pública na chain) de outra pessoa; sem a do operador, alguém pagaria uma caução para a chave de outro celular e levaria as recompensas dele para a própria carteira.

**Arquivo de registro** (`dados/registro/*.json` do validador; o app monta com `registryFileOf`, nome `piu-registro-celular-AAAA-MM-DD.json`): é o `RegistryFile` de sempre, com campos novos opcionais:

```json
{ "v": 1,
  "certs": [CertJson…],            // chaves do dia, da ativação (até 60 dias para trás) a 7 dias à frente
  "revocations": [],
  "phones": [PhoneRegistrationJson],
  "endorsements": [EndorsementJson…],
  "exits": [PhoneExitJson],
  "endorsementRevocations": [EndorsementRevocationJson…] }   // avais que ESTE aparelho retirou
```

Limites por arquivo (o resto é ignorado antes de conferir assinaturas; repetidos saem pela assinatura): 256 certificados, 8 registros, 8 saídas, 500 avais, 500 retiradas; arquivo de registro maior que 4 MiB é ignorado pelo `validator:close`.

O validador lê avais de **qualquer** arquivo de registro: o operador de piu-node que avaliza um celular põe o aval no arquivo dele (`registrationFile(certs, lists, endorsements)` e `OperatorVault.endorsePhone`).

**Pelo mensageiro** (mensagem direta comum, prioridade baixa, `bulk`):
- `{ t: 'ar', p: <opPk do celular> }`: pedido de aval;
- `{ t: 'av', e: EndorsementJson }`: aval.

Só entre **contatos públicos aceitos** (nem anônimo, nem pedido de conversa, nem bloqueado), conferido no envio e no recebimento. **Apps antigos ignoram:** no `onDirect`, um `t` desconhecido cai em `if (p?.t !== 'm' …) return false` (sem conversa, sem aviso); há teste disso com um tipo desconhecido. Como toda mensagem direta, gera prova de entrega.

## 3. Regras do validador

`apps/settlement/src/phone-nodes.ts` (`phoneEligibility`), chamado por `validator:close` antes de montar o registro de nós.

### 3.1 Ingestão: `recordFirstSeen` (todo caminho de entrada)

```ts
recordFirstSeen(state: ValidatorState, items: { endorsements?, endorsementRevocations? }, o: { at: number; epoch?: string; policy? })
  → { state, added, rejected: { sig, reason }[] }
```

É a ÚNICA porta de entrada de avais e retiradas no validador. Hoje o `close` chama com os arquivos de `registro/` (`at` = agora, `epoch` = a época fechada). A caixa de entrada pela malha (outro trabalho em andamento) deve chamar a mesma função ao receber cada item (`at` = horário de chegada, sem `epoch`) e gravar o estado de forma atômica. Regras:

- repetidos pela assinatura saem antes de conferir; no máximo 500 de cada tipo por chamada; até 100 000 guardados (os mais velhos saem);
- aval: assinatura confere e o dia declarado cai em [início da época (ou `at`) − `endorsementBackdateDays` (7), `at`]; o **visto** gravado é max(início do dia declarado, início da janela) e **nunca muda** depois;
- retirada: assinatura confere; vale a partir de `at` (o horário em que o validador viu, não o `at` assinado);
- recusados aparecem no relatório do celular (`data do aval fora da janela`, `assinatura inválida`).

O estado (`validador.json`) ganha `phoneSeen: { endorsements: {sig: {e, seen}}, revocations: {sig: {r, seen}} }`.

### 3.2 Caução (`bond.ts`)

Pela abstração `ChainClient.transferOf` (só leitura; testada com a chain simulada), **por registro** (operador + tx):
- `walletSig` confere com a carteira declarada;
- a transferência com aquele hash está naquele bloco finalizado, é `balances.transferKeepAlive`/`transferAllowDeath`/`transfer` e executou;
- saiu da carteira declarada, foi para `bondAddress` e vale ≥ `minBondLunes` (endereços comparados pela chave pública, aceita prefixo 42 ou 57);
- **só depois** disso: a mesma caução legítima em duas chaves (a dona assinou as duas) deixa as duas fora; caução já gravada para um celular não serve para outro. Quem copia o hash público com uma assinatura qualquer só se derruba (revisão, item 2);
- no estado do validador não está `devolvida` nem `confiscada`.
Sem `bondAddress` configurado, nenhum celular é habilitado (a chain nem é consultada).

### 3.3 Habilitação

1. **Registro que vale:** assinatura do operador; chave que já é de operador admitido continua classe `node`. Com vários registros da mesma chave, vale o de caução ok sem saída vigente, depois o de bloco mais novo (revisão, item 7). A saída vale só para a caução em que foi assinada: com caução nova, a chave volta.
2. **Idade:** `agora ≥ horário do bloco da caução + minAgeDays` (7).
3. **Avalista:** a identidade de um operador admitido é a **raiz** dele no `operadores.json` (as chaves rotacionadas contam como uma, com uma cota). A de um celular é a chave dele.
4. **Avais que contam:** dentro da validade (`endorsementValidityDays`, 90, a partir do visto) e não retirados; um por (avalista, celular, mês); **cota mensal por avalista** (`maxEndorsementsPerMonth`, 5) pelo mês do **visto**, em ordem de (visto, celular).
5. **Avalista habilitado no momento do aval** (revisão, item 8): operador admitido (raiz não suspensa) ou celular habilitado com a janela cobrindo o visto do aval.
6. **Cobertura:** a janela de habilitação é o último trecho, até agora, em que há ao mesmo tempo avais válidos de `minEndorsements` (3) avalistas distintos, cortado por [caução + 7 dias, saída).
7. **Linhagem:** cada celular habilitado leva o conjunto de raízes dos avais da janela (operador admitido → a raiz; celular → as raízes dele). Precisa de `minRoots` (2) raízes diferentes. O operador corrupto e o próprio celular dele não fazem 2 raízes sozinhos.
8. **Teto por raiz:** cada raiz habilita no máximo `maxEnabledPerRootPerMonth` (10) celulares por mês (mês da habilitação). A primeira habilitação de cada caução fica gravada (`enabledFrom`, `roots` no registro da caução) e conta primeiro nos closes seguintes (estável).
9. **Confisco em cascata:** celulares confiscados contam contra as raízes da linhagem gravada deles; uma raiz com `rootSuspendAfterSlashes` (3) fica **suspensa**: os avais das chaves dela e a contribuição dela nas linhagens deixam de contar (`suspendedRoots` no relatório).
10. **Ponto fixo** a partir das raízes admitidas: um anel de celulares novos que se avalizam entre si nunca entra.

### 3.4 Fechamento

- **Teto:** para nós e operador de classe `phone`, min(`phoneCapFraction` × teto do nó, `phoneMaxPayoutBondRatio` × caução). Padrões: 0,5 × 2% do orçamento e 0,25 × 100 LUNES = **25 LUNES por época**.
- **Carteira do lote:** nó de celular sem `PayoutClaim` recebe na carteira do registro.
- **Relatório:** `phones[]` (habilitado ou motivo, janela, nº de raízes, avais contados e ignorados com motivo), `phoneCap`, `phoneCaps[]` (teto de cada celular e caução), `suspendedRoots`.
- Recibos fora da janela: `recibo anterior à habilitação do celular` / `celular fora da habilitação (saída ou avais vencidos)`.

O que **não** muda: operadores de piu-node, nós deles e celulares antigos (sem modo nó: chave do dia sem certificado continua `nó não registrado`). Há testes para os dois casos.

### 3.5 Caução pequena x retorno (decisão de produto)

A caução é de 100 LUNES (decisão de produto; antes, 10). Com o teto só pela fração do nó, um celular poderia render até 100 LUNES por época com orçamento de 10 000, e a caução se pagaria em uma semana: o confisco não assustaria ninguém. Por isso o teto por época de um celular é também limitado a `maxPayoutBondRatio` × caução (0,25 → 25 LUNES). Assim, uma chave confiscada perde pelo menos 4 épocas do que poderia render. A alternativa é **subir a caução** (e a razão): mais renda por celular, mais barreira de entrada.

## 4. Parâmetros

| Parâmetro | Onde | Padrão | Observação |
|---|---|---|---|
| `PHONE_NODE_BOND` | `apps/mobile/src/lib/phoneNodeCore.ts` | `'100'` LUNES (+ taxa da rede) | parâmetro de produto; tem de bater com `minBondLunes` |
| `BOND_ADDRESS` | `apps/mobile/src/lib/phoneNodeCore.ts` | `null` | **definir**; enquanto `null`, a caução fica "em breve" (`bondBlock` = `soon`) |
| `PHONE_NODE_REWARDS_ON` | `apps/mobile/src/lib/phoneNodeCore.ts` | `false` | a tela diz que as recompensas estão desligadas |
| `phone.bondAddress` | `dados/config.json` do validador | `null` | o mesmo endereço do app |
| `phone.minBondLunes` | `dados/config.json` | `"100"` | |
| `phone.minAgeDays` | `dados/config.json` | `7` | |
| `phone.minEndorsements` | `dados/config.json` | `3` | avalistas distintos; o app usa `PHONE_NODE_MIN_ENDORSEMENTS` = 3 |
| `phone.refundDelayDays` | `dados/config.json` | `7` | devolução devida = saída + 7 dias (`bonds due`) |
| `phone.maxEndorsementsPerMonth` | `dados/config.json` | `5` | por raiz/celular avalista; o app também limita a 5 dados por mês |
| `phone.minRoots` | `dados/config.json` | `2` | raízes diferentes na linhagem |
| `phone.maxEnabledPerRootPerMonth` | `dados/config.json` | `10` | celulares habilitados por raiz por mês |
| `phone.rootSuspendAfterSlashes` | `dados/config.json` | `3` | confiscos na linhagem até suspender a raiz |
| `phone.endorsementValidityDays` | `dados/config.json` | `90` | a partir do visto |
| `phone.endorsementBackdateDays` | `dados/config.json` | `7` | quanto antes do início da época o dia do aval é aceito |
| `phone.capFraction` | `dados/config.json` | `0.5` | no máximo 1 |
| `phone.maxPayoutBondRatio` | `dados/config.json` | `0.25` | teto por época = fração da caução |

```json
// dados/config.json (confiável, de quem opera o validador; opcional)
{ "phone": { "bondAddress": "5…", "minBondLunes": "100", "minAgeDays": 7, "minEndorsements": 3, "minRoots": 2, "maxEndorsementsPerMonth": 5,
             "maxEnabledPerRootPerMonth": 10, "rootSuspendAfterSlashes": 3, "endorsementValidityDays": 90, "endorsementBackdateDays": 7,
             "capFraction": 0.5, "maxPayoutBondRatio": 0.25, "refundDelayDays": 7 } }
```

## 5. Operação (caução)

Devolução e confisco são **manuais**. O validador só lê a chain; nunca envia transação.

```
npm run validator:close -- --epoch 2026-S44 --budget 10000 [--ws wss://…]   # confere as cauções (só leitura) e grava em validador.json (bonds)
npm run validator:bonds -- list                                              # cauções conhecidas: estado, valor, carteira, tx, saída e devolução devida
npm run validator:bonds -- due                                               # devoluções vencidas (saída assinada há 7 dias ou mais)
npm run validator:bonds -- refund --operator <hex> [--note "devolvida em 0x…"]  # depois de devolver À MÃO
npm run validator:bonds -- slash  --operator <hex> --note "fraude: …"           # confisco exige motivo
```

- O `close` só conecta à Lunes se houver registro de celular **e** `bondAddress` configurado.
- O celular pede para sair (`leave`): o pedido assinado vai no arquivo de registro; o `close` grava `exitAt` e `refundDueAt` (= saída + 7 dias) na caução; `bonds due` lista as vencidas. Quem tem a chave do endereço da caução devolve À MÃO e marca `refund`. "Voltar a ser nó" (evento `cancel` assinado, mais novo que a saída) apaga `exitAt`/`refundDueAt`; uma nova saída recomeça os 7 dias. Limite honesto: o `at` dos eventos é escolhido pelo celular; um "cancel" com data antiga só faria recibos do intervalo voltarem a contar. A partir daí aquele celular não rende mais (nem com aquela caução, nem cedendo-a a outro).
- Confisco: fraude comprovada (auditoria, sentinelas). Marcar `slash` tira o celular do programa e conta contra as raízes da linhagem dele (3 confiscos suspendem a raiz como avalista). Um registro novo exige caução nova.

## 6. Modelo de ameaças

| Ator | Pode | Não pode |
|---|---|---|
| Fazenda de celulares (Sybil) | gerar chaves de celular de graça; pagar várias cauções | habilitar sem caução por chave; habilitar sem 3 avais de quem já está dentro e 2 raízes na linhagem; passar de 10 habilitações por raiz por mês; ganhar mais que 1/4 da caução por época |
| Operador admitido corrupto | avalizar; rotacionar a chave; ter o próprio celular | contar como dois avalistas (raiz única, cota única); habilitar sozinho (precisa de outra raiz); passar do teto mensal da raiz; continuar avalizando depois de 3 confiscos na linhagem |
| Anel de celulares novos | avalizar uns aos outros | entrar sem um caminho de avais até um operador admitido (ponto fixo) |
| Avalista comprado / descuidado | dar avais; pôr qualquer data no aval | dar mais de 5 avais que contam por mês; voltar a data além da janela (o mês da cota é o do visto); ficar anônimo (o aval é assinado e fica no registro) |
| Quem manda arquivos enormes ao validador | encher `registro/` | fazer o validador conferir mais que os limites por arquivo, ou o mesmo item duas vezes |
| Quem copia a caução de outra pessoa | ler a chain | usar a caução sem a assinatura da carteira dona; derrubar a dona com um registro falso (só registros legítimos entram na regra de caução repetida) |
| Quem paga caução para a chave de outro celular | pagar | registrar sem a assinatura da chave de operador do celular |
| Contato malicioso | pedir aval, mandar aval falso | fazer o app guardar aval que não confere ou que não é para a chave dele; mandar pelo perfil anônimo ou sem ser contato aceito |
| Validador (curioso) | ver chaves de operador de celular, carteiras e o grafo de avais entre chaves de operador | ver identidades de conversa ou contatos (o aval não leva identidade) |

**Privacidade (honestidade):**
- O registro liga a chave de operador do celular à **carteira da caução** (pública na chain). Quem vê o arquivo de registro (o validador e quem o transportar) liga as duas. **Recomende uma carteira só para a caução** (e as recompensas), separada da carteira do dia a dia.
- O grafo de avais mostra ao validador **quem avalizou quem** entre chaves de operador: na prática, revela que aquelas pessoas se conhecem (são contatos), embora não mostre as identidades de conversa.

**Limites honestos:**
- "Contato público aceito" e "contatos distintos" são regras do app. O validador só vê chaves de operador: uma mesma pessoa com uma chave de piu-node e uma de celular conta como dois avalistas. O limite mensal e o ponto fixo é que freiam fazendas.
- Quem avaliza fica sabendo a chave de operador do celular do contato (está no pedido). Ela não é a identidade de conversa, mas liga "este contato" a "esta chave de celular" para quem avaliza.
- A caução só vale como freio se for maior que o que uma chave rende antes de ser pega. Com recompensas desligadas, isso ainda não foi calibrado: rever `PHONE_NODE_BOND` e `capFraction` antes de ligar o orçamento.
- Prova física de transmissão continua dependendo de auditoria por amostragem (sentinelas, ver `prova-de-entrega-v2.md`, seção 10).
- A idade de 7 dias conta do bloco da caução; o app só estima (conta de quando viu a caução finalizar).
- "Verificado pessoalmente" é afirmado pelo avalista (`inPerson` assinado no aval) e conferido só pelo app dele (o código de segurança marcado como verificado). Um app modificado pode afirmar sem ter verificado; o validador exige a afirmação de avalistas celulares, e o aval fica assinado para auditoria e confisco em cascata.
- "No modo nó há mais de 7 dias" é o que o contato avisa (`ns`); o validador confere de verdade pelo ponto fixo (o avalista precisa estar habilitado no momento do aval).
- O ciclo de 7 dias com certificado é do app: certificados de dias passados podem ser assinados a qualquer hora, então não provam que o aparelho esteve ligado.

## 7. App: API por tela (telas em design/handoff/docs/TELAS-NOVAS.md)

Tudo em `usePhoneNode()` (`apps/mobile/src/state/phoneNode.tsx`). Os efeitos que valem com o app em qualquer tela (certificado do dia a cada hora, registro quando a caução finaliza, devolução vista na carteira, aviso `ns` aos contatos verificados) ficam em `state/phoneNodeEffects.ts`, chamados pelo `MessagingProvider`. Erros das ações: `PhoneNodeError` com `code` (`noKeys`, `soon`, `requirements`, `cancelled`, `recover`, `wrongWallet`, `bond`, `insufficient`, `endorse`, `notEligible`) e `detail`. Nenhum texto de tela vem da API.

| Tela | Lê | Ações |
|---|---|---|
| M1 Ativar "Do celular" | `params` (`bond` 100, `minEndorsements` 3, `dailyBytes` 200 MB, `batteryPct` 30, `rewardsOn` false), `requirementsOk`, `status.phase === 'off'` | `activate(bindPrompt)`: confere requisitos, liga o modo e assina o vínculo da carteira (1 biometria). Erro `requirements` → M1e; `soon` = programa ainda sem endereço |
| M1e Faltam requisitos | `requirements[]`: `{ key, ok, action }` com `key` em `program`, `wallet`, `backup`, `freeSpace` (≥ 1 GB), `batterySaver` | a tela mapeia `action` para o botão (Liberar espaço, Fazer backup, …); Continuar desabilitado enquanto `!requirementsOk` |
| M2 Pagar caução | `bond.amount`, `bond.address`, `bond.block` (`soon`, `inactive`, `noWallet`, `pending`, `done` ou `null`) | `quoteBond()` → `{ quote, affordable }`; depois do gesto, `payBond({ quote, bindPrompt })` (biometria do `sendTransfer`) → M2b |
| M2e1 Saldo insuficiente | `quoteBond().affordable` = `{ ok:false, needed, available, missing }` (planck), ou erro `insufficient` do `payBond` | a tela abre Receber da carteira / pedir a um contato |
| M2b Aguardando a caução na rede | `bond.phase === 'confirming'`, `bond.sentAt`, `bond.transfer` (status da carteira) | nenhuma (fechar continua em segundo plano). Confirma quando o aparelho tem internet (`refreshBond()`) ou por recibo de gateway (a carteira atualiza); `confirmed` → o registro fecha sozinho (`registered`) → M3v |
| M2e2 Ainda não confirmada | `bond.phase === 'unconfirmed'` (2 min sem confirmação; não é falha) | `retryBond()` reenvia os MESMOS bytes assinados; Cancelar só fecha a tela. Se `bond.phase === 'failed'`: `abandonBond()` e voltar a M2 |
| M3 Painel do nó | `status` (`phase`: `certStreak` com `daysLeft`, `needsEndorsements`, `ready`; `endorsements`/`needed`), `certBar` (`dashes[7]`: `done`/`today`/`future`/`error`, `streak`, `complete`), `pause` (`off`, `battery`, `charging`, `dailyLimit`, `hours`, `noPeers` ou `null` = repassando), `relayToday` (`bytes`/`limit`), `credits()` | Pedir aval → M4; Sair → M6; `registryFile()`/`registryFileName()` para compartilhar com o validador |
| M3v Primeiro dia, sem avais | `bond.phase === 'registered'`, `status.endorsements === 0`, `certBar.streak <= 1` | Pedir aval → M4 |
| M3e Certificado não renovado | `certError` (`{ day, message }`) e `certBar.dashes` com `error` | `retryCert()` |
| M4 Pedir aval | `endorsers[]` (`{ contactId, chatId, name, verified }`: verificados pessoalmente, no modo nó há > 7 dias, sem aval meu ainda), `asked[]` (`expiresAt`) | `requestEndorsement(contactId)` (pedido vale 3 dias; leva se minha caução já finalizou); `cancelRequest(contactId)` |
| M4v Ninguém pode avalizar | `endorsers.length === 0` | a tela leva a verificar alguém por perto / convidar |
| M5 Pedido de aval recebido | `requests[]` (`{ contactId, chatId, name, createdAt, state, block }`), `given` (`thisMonth`/`max`) | `endorse(contactId)` depois do gesto (aval com `inPerson`); `decline(contactId)` (sem motivo, nada vai para quem pediu); `revokeEndorsement(contactId)` para retirar depois |
| M5e Pedido não vale mais | `requests[i].state`: `expired`, `cancelled`, `noBond` (caução de quem pediu não confirmada); ou `block` (`notVerified`, `tooNew`, `inactive`, `already`, `monthly`, `self`) | `decline(contactId)` fecha; abrir a conversa pelo `chatId` |
| M6 Sair e pedir a caução | `bond.amount`, `refund` | `leave()` depois do gesto → M6b |
| M6b Caução a caminho | `refund` = `{ phase: 'waiting', progress (dias ÷ 7), daysLeft, dueAt }` | `cancelExit()` ("Voltar a ser nó": cancela a saída; os dias zeram) |
| M6e Devolução pausada | `refund.phase === 'overdue'` (passou de 7 dias sem a devolução aparecer na carteira); `returned` quando aparece | "Tentar agora": recarregar o histórico da carteira (`useWallet().refreshHistory`); a devolução é manual no validador (`bonds due`) |

### 7.1 Telas do Piu 11 (N1…N10c, 2026-11-06)

As telas M1…M6e acima foram substituídas pelo design `design/handoff/design/Piu 11 Modo no e malha.dc.html`.
Apresentação em `apps/mobile/src/ui/NodeViews.tsx` (peças em `ui/PhoneNode.tsx`); regras de tela testadas em
`lib/phoneNodeView.ts`, `lib/carryView.ts` e `lib/phraseConfirm.ts` (`__tests__/piu11View.test.ts`). Galeria de
desenvolvimento com cada id: `/__dev/node?id=N3a` (só em `__DEV__`; conferido fora dos bundles de produção web e Android).

| Id | Rota | Ações |
|---|---|---|
| N1 | `provider/connect?mode=phone` | `activate()` (um toque; nada assinado). Requisito pessoal faltando → `provider/phone/activate`; sem `BOND_ADDRESS` → folha da caução em N3a, sem ligar |
| N2 / N2b / N7b / N10a–c | `provider/phone` | trilha (`trailSteps`), linha de fase no topo (`phaseCardOf`/`topCardOf`), créditos estimados (não é dinheiro), chave do nó, arquivo de registro, `carryEvidence` |
| N3 / N3a–h | `provider/phone/bond` | `quoteBond`, `payBond` (biometria do envio); estados por `bondSheetOf`, erros por `bondFailOf` |
| N4 / N4a–d | `provider/phone/confirm` | `confirmBond(prompt)`: vínculo carteira → chave do celular, registro na hora |
| N4e–h | `provider/phone/phrase` | `recoverPhrase` (as 12 palavras) |
| N5 / N5v | `provider/phone/ask` | `requestEndorsement` |
| N6 / N6a–d / N6v / N6n | `provider/phone/requests?c=` | `endorse` (segurar), `decline`; notificação em `ui/PhoneNodeWatch.tsx` |
| N7 | `provider/phone/leave` | `leave()` (segurar) |
| N8 / N8a–b | folha Enviar sem rede → `wallet/mesh` | `quoteCarriedTransfer`, `carryTransfer` |
| N9 / N9a–d | `wallet/transit`, atividade da carteira, folha Enviar | `recarryTransfer`, `retryTransfer` |
| N10 | Rede (aba) | `useNetwork().setGateway` |

Mudança de fluxo: o vínculo da carteira saiu da ativação e virou o N4 "Confirmar caução" (depois de a
transferência finalizar). São as mesmas duas assinaturas da carteira de antes (transferência + vínculo), cada
uma no seu momento; instalações que já assinaram o vínculo ao ativar fecham o registro sozinhas como antes.

Adaptações por honestidade (o design veio de um briefing antigo):
- Números sempre dos parâmetros (`nodeParamsOf`): 100 LUNES + taxa, 3 avais, 7 dias, aval 90 dias, pedido 3 dias,
  devolução 7 dias, 200 MB/dia, pausa em 30%. Recompensas desligadas: créditos são estimativa ("NÃO É DINHEIRO").
- N1: "Dados móveis" dizia que o nó usa dados para recibos; o transporte do nó não usa dados móveis — só o gateway.
- N4e: o design pede as palavras 3, 8 e 11. Com a biometria trocada o celular não tem mais a frase (só a semente,
  de mão única), então três palavras não a recuperam: a pessoa digita as 12 (sugestões da lista BIP39) ou usa o
  arquivo de backup, e o app confere derivando a semente (`recoverPhrase`). N4f diz só o que é seguro: palavra fora
  da lista (posição de algo que ela mesma digitou), frase inválida pelo checksum (sem dizer qual palavra) ou frase
  de outra identidade. Não há "sorteio de outras posições depois de 3 erros"; as palavras ficam na tela (captura
  bloqueada) para corrigir um erro de digitação e somem ao sair.
- N9: "Passou por 3 aparelhos" não existe no protocolo (o envelope não conta saltos): a etapa mostra só a hora em
  que saiu. Tudo o que um gateway diz fica "informado · não conferido"; "Confirmada" só pela leitura do aparelho.
- N10c: "tudo entregue" virou "tudo já foi solto na malha" (soltar não é entregar). N10b sem chave do validador.
- N7: "Recibos param de render" virou "param de contar" (com recompensas desligadas nada rende).
- Estados reais sem desenho, com as peças do Piu 11: caução sem confirmação depois de 2 min (reenvia os mesmos
  bytes), caução recusada, certificado do dia que falhou, requisitos antes de ativar, pedidos vencidos/cancelados.

## 8. Revisão independente (2026-11-06)

| # | Gravidade | Achado | Correção |
|---|---|---|---|
| 1 | Alta | Dia do aval escolhido por quem avaliza: datas retroativas furavam a cota mensal e anteciparam `from` | `recordFirstSeen` grava o visto no estado; dia aceito só em [início da época − 7 d, agora]; cota pelo mês do visto; `from` pelo visto |
| 2 | Alta | Griefing de caução: copiar o txHash público com assinatura falsa derrubava a vítima ("caução usada por outro") | A regra de caução repetida só considera registros que passaram em tudo (assinatura da carteira, transferência dela) |
| 3 | Alta | Um operador corrupto semeava fazenda ilimitada: chave de nó + chave de celular = 2 avalistas; cada chave rotacionada com cota própria | (a) chaves rotacionadas contam como a raiz; (b) linhagem com ≥ 2 raízes; (c) ≤ 10 habilitações por raiz por mês; (d) 3 confiscos na linhagem suspendem a raiz |
| 4 | Alta (econômica) | Caução de 10 contra teto de até 100 LUNES/época: a caução se pagava em menos de uma semana | Teto por época = min(fração do nó, 0,25 × caução) = 2,5 LUNES; trade-off na seção 3.5 |
| 5 | Média | DoS no validador: arquivos sem limite, conferência repetida, laços O(n²) | Limites por arquivo e de tamanho, repetidos saem pela assinatura antes de conferir, `push` no lugar de espalhar, sem `JSON.stringify` em laço |
| 6 | Média | Aval não vencia nem podia ser retirado | Validade de 90 dias a partir do visto; retirada assinada (`endorsementRevocations` no arquivo de registro), valendo do visto |
| 7 | Média | Saída e registros por chave impediam voltar | Saída amarrada ao txHash da caução; entre registros da mesma chave, vale o de caução ativa |
| 8 | Baixa | Avalista avaliado "agora" | O avalista precisa estar habilitado no momento (visto) do aval |
| 9 | Baixa | Privacidade | Documentado (seção 6); recomendação de carteira só para a caução |

### Decisões de produto depois do design (2026-11-06)

Caução 100 LUNES (+ taxa) e teto por época ≤ caução/4; 3 avais de raízes distintas; só avalizam contatos verificados pessoalmente com modo nó há mais de 7 dias (afirmação `inPerson` no aval; piu-node continua semente); aval vale 90 dias; pedido vence em 3 dias; devolução 7 dias depois da saída, com "voltar a ser nó"; 7 dias seguidos com certificado emitido offline pelo aparelho; limites de 200 MB/dia e 30% de bateria; caução confirmada pelo próprio aparelho ou por recibo de gateway, sem validador ao vivo.

## 9. Pendências

1. Definir `BOND_ADDRESS` (app) e `phone.bondAddress` (validador), o mesmo endereço, numa carteira só de cauções.
2. Desenhar e implementar as telas (lista em `Telas necessárias` do relatório desta mudança; a seleção "Do celular" em `provider/connect.tsx` continua "em breve").
3. Rota no painel do piu-node para avalizar um celular (`OperatorVault.endorsePhone`) e baixar o arquivo de registro.
4. Envio do arquivo de registro do celular ao validador (hoje: compartilhar o arquivo, como as evidências).
5. Calibrar caução e `capFraction` antes de ligar recompensas.
