# Prova de entrega v2

- Data: 2026-11-06 · Estado: implementado (validador, app, liquidante); chave do validador e registro de operadores **a configurar** (ver "Pendências")
- Corrige: auditoria `docs/seguranca/auditoria-2026-11-06/node-settlement.md`, achados **C-01**, **A-01** e **M-05**
- Código: `apps/mobile/src/protocol/proof.ts` (fonte da verdade, copiado para `apps/settlement/src/protocol/` por `npm run protocol:sync`), `apps/settlement/src/{registry,ledger-v2,binding,validator}.ts`, `apps/mobile/src/messaging/{messenger,evidence,credits}.ts`

## 1. O problema em uma frase

No v1, o validador calculava o `ackHash` a partir do próprio segredo enviado. Qualquer par `{envelopeId aleatório, segredo aleatório}` "comprovava" uma entrega, chaves de nó custam zero, e o atacante levava o orçamento inteiro de cada época (C-01). Além disso, a última prova sobrescrevia as anteriores e as 8 vagas por envelope iam para quem declarava o `at` mais cedo (A-01). No liquidante, o mesmo trabalho podia ser pago de novo com outro id de lote (M-05).

## 2. Modelo de ameaças

| Ator | Pode | Não pode |
|---|---|---|
| Relay honesto | ver cabeçalho (`envelopeId`, `ackHash`, destino lógico, validade); assinar recibo com a chave dele | ler o conteúdo, saber o `ackSecret` antes de o destino revelá-lo |
| Relay malicioso / Sybil | gerar quantas chaves de nó quiser; assinar recibos com qualquer `envelopeId`, `ackHash` e `at`; repetir, reordenar e omitir provas e recibos que viu; escrever arquivos de evidência | assinar como o destino; abrir provas seladas; registrar um nó sem a chave de um operador admitido |
| Remetente malicioso | conhece o `ackSecret` das próprias mensagens | assinar como o destino |
| Destino malicioso | assinar provas do que recebeu | assinar provas de envelopes que não abriu sem conhecer o `ackSecret` |
| Operador admitido malicioso | registrar muitos nós próprios; gerar tráfego próprio (remetente + destino + relays dele) | passar do teto por operador por época; escapar da auditoria (o registro dá um responsável) |
| Quem edita `dados/` do validador | renomear ou editar lotes | fazer o liquidante pagar um lote que não bate com o estado do validador |

Hipóteses: o validador e o liquidante rodam em máquina confiável (a pasta `dados/` e `operadores.json` são dele); a suíte criptográfica é a v0 do app (Ed25519, X25519, XChaCha20-Poly1305, HKDF-SHA256).

**O que a criptografia resolve e o que não resolve (honestidade).** Identidades de conversa também são de graça. Por isso nenhuma assinatura, sozinha, impede um atacante de mandar mensagens para si mesmo pelos próprios relays. A v2 fecha a falsificação **por terceiros**: forjar entrega de envelope que não existiu ou que outra pessoa recebeu, roubar ou negar crédito alheio, sobrescrever provas, e repagar. O autoatendimento (tráfego sintético) é limitado pelo **registro** de nós sob operadores admitidos, pelo **teto por operador** e pelo **teto por destino**, e fica atribuível a um operador para auditoria. Impedir de vez exige stake ou registro on-chain (fora do escopo, ver seção 10).

## 3. Visão geral

```
remetente ──envelope v0 (ackHash = H(ackSecret)[:16] no cabeçalho autenticado)──▶ relays ──▶ destino
                                                         │ recibo (v1, inalterado)          │ abre (AEAD + assinatura do remetente)
                                                         ▼                                  ▼
                                                   evidência do nó         prova v2 assinada pelo destino,
                                                                            selada para a chave do validador
                                                                                            │ quadro "P2" pela malha
                                                                                            ▼
validador v2: abre a prova ─ confere assinatura do destino, H(ackSecret) = ackHash do cabeçalho
            ─ recibo só de nó registrado, com ackHash do cabeçalho e horário dentro da vida do envelope
            ─ excesso de recibos ou provas conflitantes: ninguém ganha, vai para auditoria
            ─ lote amarrado ao estado (hash) ─▶ liquidante confere antes de pagar
```

Nada muda no fio dos envelopes nem dos recibos. A v2 acrescenta um formato novo (prova selada), um quadro novo da malha que os aparelhos antigos ignoram, e regras novas no validador e no liquidante.

## 4. Formatos

Tudo big-endian; hashes SHA-256; `H(x)[:16]` são os 16 primeiros bytes.

### 4.1 Envelope (inalterado, versão 0)

Cabeçalho de 104 bytes (`apps/mobile/src/protocol/envelope.ts`). O campo `ackHash` (offset 84, 16 bytes) já é escolhido pelo remetente como `H(ackSecret)[:16]`, e o `ackSecret` vai dentro do conteúdo cifrado. O cabeçalho com os saltos zerados ("cabeçalho autenticado") é o dado associado do AEAD **e** entra na assinatura do remetente. Ou seja, o compromisso do remetente com o `ackHash` já existe e é conferido por quem abre o envelope. O que faltava era levar isso ao validador sem revelar o remetente (remetente selado). A v2 faz isso pela assinatura do destino, que conferiu o remetente ao abrir.

Mudar o cabeçalho quebraria os celulares instalados (`parseHeader` recusa outra versão, e os relays antigos descartariam o envelope). Por isso o envelope fica igual.

### 4.2 Recibo de retransmissão (inalterado, `piu/v0/relay-receipt`)

`{envelopeId, ackHash, nodePk, at (hora cheia), sig}`. Continua o mesmo para os relays antigos. No v2 ele só vale com as regras da seção 6.

### 4.3 Prova de entrega v2 (237 bytes)

| Offset | Tam. | Campo |
|---|---|---|
| 0 | 1 | versão = `2` |
| 1 | 16 | `envelopeId` (hash do envelope sem saltos, como no roteador) |
| 17 | 104 | cabeçalho autenticado (saltos = 0) |
| 121 | 16 | `ackSecret` |
| 137 | 32 | pseudônimo do destino `Q` (Ed25519) |
| 169 | 4 | `provedAt` (s, arredondado para a hora, para baixo) |
| 173 | 64 | `sig` = Ed25519(`q`, SHA-256(`"piu/v2/delivery-proof"` ‖ bytes 0..172)) |

Pseudônimo: `q = HKDF(signSk da identidade, salt = V, "piu/proof/pseudonym/v2")`, `Q = q·G`. `V` é a chave do validador. O mesmo destino tem sempre o mesmo pseudônimo diante de um validador, o que serve ao teto por destino. Já a identidade pública e a anônima, ou outro validador, dão pseudônimos sem ligação entre si, e ninguém volta de `Q` à identidade social.

Quem assina: **o destino**, com o pseudônimo da identidade que abriu o envelope, só depois de abrir com sucesso (AEAD e assinatura do remetente conferidas). Se o aparelho não sabe com certeza qual das duas identidades é o destino (as duas aceitam o destino lógico, nenhuma aceita, ou houve erro), **não gera prova**, para não assinar com a identidade errada. Sinal efêmero ("digitando…") não gera prova, como no v1. Mensagens de grupo **não** geram prova v2 (ver seção 10).

### 4.4 Prova selada (310 bytes)

A prova viaja cifrada para a chave X25519 do validador, para que os relays não liguem provas entre si pelo pseudônimo:

| Offset | Tam. | Campo |
|---|---|---|
| 0 | 1 | versão = `2` |
| 1 | 32 | chave efêmera X25519 `E` |
| 33 | 24 | nonce |
| 57 | 253 | XChaCha20-Poly1305(prova de 237 bytes) + tag de 16 |

Chave: `HKDF(X25519(e, V), salt = E ‖ V, "piu/v2/proof/seal")`. Dado associado: `"piu/v2/sealed-proof"` ‖ `envelopeId` ‖ `V`. O validador vê só o pseudônimo do destino, nunca a identidade social, e nunca quem enviou.

### 4.5 Quadro "P2" da malha (aparelho ↔ aparelho)

`0x50 0x32` ("P2") ‖ `n` (u8, 1..8) ‖ `n` × (`envelopeId` 16 ‖ prova selada 310). Os aparelhos antigos não conhecem o quadro: não é "PR" nem "PN", e o primeiro byte não é `0` (versão de envelope), então eles o descartam como envelope inválido, sem efeito colateral. O quadro "PR" do v1 (segredo em claro) continua sendo enviado, para os créditos locais dos aparelhos antigos continuarem andando. Pelo validador v2, ele não vale nada.

Regras de repasse: como no "PR", só guarda e repassa prova de envelope que passou pelo aparelho (`hasSeen`) e ela circula por até 48 h. Diferente do "PR", guarda até **3 provas diferentes por envelope**: o aparelho não abre a prova selada, então uma falsa que chegue antes não pode barrar a verdadeira. A prova do próprio destino entra na frente. O validador descarta as que não conferem. Ficam guardadas por 8 dias, em até 2000 envelopes.

Aparelhos antigos com o quadro "P2": o roteador v1 tenta lê-lo como envelope e o recusa (`VERSION`). Antes disso, ele consome uma ficha do balde daquele vizinho (`take`, 120 de rajada). Não há bloqueio, aviso ao usuário nem registro em log. O efeito é no máximo uma ficha por quadro, e o app manda no máximo um quadro "P2" por vizinho a cada envio.

### 4.6 Arquivo de evidências v2 (JSON)

```json
{ "v": 2,
  "receipts": [{ "envelopeId": "…", "ackHash": "…", "nodePk": "…", "at": 0, "sig": "…" }],
  "proofs": [{ "envelopeId": "…", "ackSecret": "…" }],
  "sealedProofs": [{ "envelopeId": "…", "sealed": "…" }] }
```

`proofs` é o legado v1: o validador v2 só conta (relatório "só prova v1"). Arquivos `v: 1` continuam sendo lidos: os recibos valem se houver prova v2 em qualquer outro arquivo.

### 4.7 Registro de nós

- `dados/operadores.json` (confiável, mantido por quem opera o validador): `{ "v": 1, "operators": [{ "pk": "<hex Ed25519>", "name": "…" }] }`. Sem ele o `validator:close` aborta.
- `dados/registro/*.json` (não confiável, se autoverifica): `{ "v": 1, "certs": [CertJson], "revocations": [ListJson] }` (mais `phones`, `endorsements` e `exits` opcionais dos celulares, ver [`no-celular.md`](no-celular.md)), no mesmo formato JSON que o piu-node já usa (`certToJson`/`listToJson` de `apps/piu-node/src/relay/operator-frames.ts`, mensagens `piu/lnnp/v1/operator-cert`, `…/operator-rotation`, `…/revocation`).

O certificado é o `OPERATOR_CERT` que o operador já emite para cada equipamento no painel. A rotação da chave de operador é seguida pelos passos das cadeias, a partir de uma chave admitida. Cada chave tem uma vigência:
- depois de uma rotação em `at`, a chave anterior só vale para certificados e listas emitidos **antes** de `at`;
- a nova só vale a partir de `at`;
- passo retroativo, certificado retroativo e lista emitida por chave já substituída são recusados.

### 4.8 Lote v2

```json
{ "v": 2, "id": "piu-lote-2026-S41", "epoch": "2026-S41",
  "payouts": [{ "address": "5…", "lunes": "12.5" }],
  "accruals": 3, "stateHash": "<hex>" }
```

`stateHash` = SHA-256(`"piu/lote/v2/estado\n"` ‖ id ‖ `"\n"` ‖ linhas ordenadas `node:epoch:planck:address`) sobre os créditos do `validador.json` com `lot = id` e estado `em-lote`. O crédito guarda a carteira (`address`) ao entrar no lote.

## 5. Quem assina o quê

| Objeto | Assinado por | Prova o quê |
|---|---|---|
| cabeçalho autenticado + conteúdo | remetente (dentro da cifra) | o `ackHash` é do remetente; ninguém troca o cabeçalho |
| recibo | chave técnica do nó | "este nó repassou o envelope `id` com este `ackHash`, nesta hora" |
| certificado `OPERATOR_CERT` | chave do operador | "este nó é meu" |
| lista de revogação | chave do operador | "estes nós não são mais meus" |
| prova v2 | pseudônimo do destino (por validador) | "abri o envelope `id`, que tinha este cabeçalho, e o segredo é este" |
| carteira (`PayoutClaim`) | chave técnica do nó | inalterado |

## 6. Regras do validador v2

Montagem do livro (`apps/settlement/src/ledger-v2.ts`). É reprodutível: a mesma entrada dá o mesmo resultado em qualquer ordem de arquivos.

1. **Recibos.** Confere a assinatura do nó; cada recibo conta uma vez por (envelope, nó). Dois recibos diferentes do mesmo nó para o mesmo envelope: os dois são recusados. O nó precisa estar **registrado** (certificado que leva a um operador admitido, não revogado, emitido antes do recibo com 1 h de folga) e não pode estar bloqueado por auditoria. Recibo no futuro é recusado.
2. **Provas.** Abre cada prova selada. Ela vale se:
   - o `envelopeId` de fora bate com o de dentro;
   - o cabeçalho é um v0 de mensagem direta;
   - a assinatura do pseudônimo confere;
   - `H(ackSecret)[:16]` = `ackHash` **do cabeçalho**;
   - `provedAt` cai dentro da vida do envelope.

   Além disso, a prova só **conta** se o `ackHash` dela for o de algum recibo de nó registrado daquele envelope. O validador não vê a assinatura do remetente, então quem prova escolhe o cabeçalho. Sem essa regra, qualquer um forjaria um cabeçalho com outro `ackHash`, faria uma prova "válida" para o id real e provocaria conflito sem custo nenhum. Agora isso vira ruído (`badProofs`). Prova v1 (segredo em claro) nunca valida nada.
3. **Primeira prova vence, conflito invalida.** Repetir a mesma prova (inclusive em outra hora) não muda nada. Uma segunda prova que conta e é **diferente** (outro cabeçalho ou outro pseudônimo) marca o envelope como `conflito`, e nenhum recibo dele ganha. Para isso, o atacante precisa assinar um recibo com um nó registrado, e fica identificado.
4. **Recibo contra a prova.** O `ackHash` do recibo tem de ser o do cabeçalho comprovado. O `at` tem de cair na vida do envelope (`expiresAt − 7 dias − 1 h` até `expiresAt + 5 min`).
5. **Época do envelope.** É a do recibo válido mais antigo dele. O fechamento e o teto por destino usam essa mesma regra, então um envelope não aparece em duas épocas.
6. **Vagas (A-01).** Se um envelope tiver mais de `maxRelaysPerEnvelope` (8) recibos válidos:
   - saem os recibos dos operadores com **mais de um** recibo nele, e cada um desses operadores leva uma marca;
   - se ainda passar de 8, nenhum é creditado (`excesso de recibos`) e o envelope vai para auditoria.

   Um operador com `maxFlagsPerOperator` marcas na época (padrão 3) fica **fora da época inteira**: nenhum recibo dele rende, e o relatório lista o caso em `operatorFlags`. O `at` não decide mais quem fica com as vagas, e quem não é registrado não ocupa vaga.
7. **Tetos.**
   - Por destino (pseudônimo) por época: 1000 entregas.
   - Por nó por dia: 5000, em ordem de `envelopeId`; o `at` escolhido pelo nó só mexe nele mesmo.
   - No fechamento, 2% do orçamento por nó **e** por operador (celular de classe `phone`: `phoneCapFraction` disso, padrão metade; [`no-celular.md`](no-celular.md)), aplicados **antes** de dividir, por enchimento (`allocate`): quem bate no teto fica no teto, e o excedente é redividido entre os outros pelas unidades deles. Assim, tráfego sintético de um operador admitido não dilui os honestos além da fatia (com teto) desse operador.
8. **Auditoria.** Como antes: reprovado perde o que não foi pago e é bloqueado.

## 7. Lote amarrado ao estado (M-05)

- `validator:close` grava em cada crédito que entra no lote a carteira e o id do lote, e escreve o lote v2 com `stateHash`.
- `lot:pay` (e `payLot`) com lote v2 lê o `validador.json` (`--dir`, padrão `dados`) e recusa se: não houver crédito `em-lote` com esse id; o `stateHash` não bater; ou a soma por carteira dos créditos não for exatamente a do lote. Renomear o arquivo do lote (outro id) dá "nenhum crédito em lote com este id". Editar carteiras ou valores dá "não bate".
- O diário e o estado do validador são gravados de forma atômica com `fsync` (`apps/settlement/src/fsutil.ts`, o mesmo padrão do piu-node). Uma queda de energia não apaga a barreira contra pagamento duplo.
- Defesa extra no diário: cada entrada guarda `payoutsDigest` (hash só dos pagamentos, sem o id). Um lote com os mesmos pagamentos de outro lote do diário que não terminou em `falhou` é recusado.
- Lote v1 (manual, sem estado do validador) só é pago com `--manual`, e o índice do diário vale para ele também.

## 8. Migração e compatibilidade

- **Mensagens:** envelope e recibo não mudaram. Celulares antigos e novos continuam trocando, retransmitindo e entregando entre si exatamente como antes (há testes para isso). Os celulares antigos descartam o quadro "P2" sem efeito.
- **Provas v1:** continuam circulando (quadro "PR") e validando os créditos **locais** (estimativa na carteira do app). Pelo validador v2, uma entrega com só prova v1 não rende nada e aparece no relatório como `só prova v1 (legado, sem recompensa)`.
- **Arquivos:** o validador lê evidências `v: 1` e `v: 2`. O app exporta `v: 2`. O piu-node ainda exporta `v: 1` (só recibos, que é o que ele tem); vale igual.
- **Estado do validador:** `validador.json` v1 continua abrindo. Os créditos ganham `address` quando entram num lote novo. Lotes v1 já pagos não mudam.
- **Diário:** entradas antigas não têm `payoutsDigest`. Para elas, só a proteção por id e pelo estado do validador vale.
- **Ativação:** enquanto o app não tiver a chave pública do validador (`VALIDATOR_PROOF_PK` em `proof.ts`, hoje `null`), ele não gera prova v2. Nesse estado, nada é pago pelo validador v2. Isso é de propósito: melhor não pagar do que pagar a forjadores.

## 9. Operação

```
npm run validator:keygen -- --dir dados     # gera dados/chave-provas.json (0600); imprime a chave pública para o app
# dados/operadores.json: operadores admitidos
# dados/registro/*.json: certificados e revogações (exportados pelo painel do operador)
npm run validator:close -- --epoch 2026-S44 --budget 10000
npm run lot:pay -- dados/lotes/piu-lote-2026-S45.json --confirm piu-lote-2026-S45 --dir dados
npm run validator:bonds -- list          # cauções dos celulares (devolução/confisco manuais, ver no-celular.md)
```

A semente da chave das provas também pode vir de `PIU_VALIDATOR_PROOF_SEED` (hex, 32 bytes).

## 10. Fora do escopo (ainda aberto)

- **Sybil por operador admitido:** (para celulares, a caução e o aval já existem: [`no-celular.md`](no-celular.md)) o registro limita e identifica, e o teto por enchimento impede a diluição dos honestos, mas nada impede um operador de gerar tráfego próprio dentro do teto dele. **Antes de ligar recompensas com orçamento relevante**, duas decisões de produto são obrigatórias:
  - uma caução ou stake por operador, que se perde em fraude comprovada;
  - amostragem por sentinelas do validador: mensagens de teste que o próprio validador envia e cujo caminho ele confere.
- **Celulares como relays:** a chave técnica do celular gira por dia. Sem o modo nó, recibos de celular não são de nó registrado e não rendem no v2. Com o modo nó ([`no-celular.md`](no-celular.md)), o app tem uma chave de operador do aparelho que certifica a chave do dia com o mesmo `OPERATOR_CERT`, e o celular é habilitado (classe `phone`, teto menor) com caução em LUNES (100) e 3 avais de contatos verificados pessoalmente. As telas ainda vão ser desenhadas.
- **Grupos:** o destino de grupo é derivado da chave do grupo, e uma prova assinada por um membro não diz quantos membros receberam. Mensagens de grupo não geram prova v2 e não rendem.
- **Destino conferido:** com sessão estabelecida, o destino lógico vem de um segredo da sessão, então o validador não consegue conferir que a identidade que assinou era o destino. Ele confere que ela conhecia o `ackSecret` e conferiu o cabeçalho. O teto por destino limita o abuso.
- **Prova pelo piu-node:** o LNNP não tem quadro de prova, e o piu-node não carrega provas. Os recibos dele rendem quando a prova chega por algum celular (o destino ou um relay que exportou evidências).
- **Exportação do registro pelo piu-node:** o painel ainda não tem um botão "exportar registro para o validador". `apps/piu-node/src/relay/registration.ts` monta o arquivo; falta ligar numa rota de `app.ts`.
- **Privacidade frente ao validador:** o validador vê um pseudônimo por destino, estável e próprio daquele validador (nunca a identidade social nem o remetente). Ele consegue contar quantas entregas cada pseudônimo recebeu, que é o necessário para o teto por destino.
- **Prova física de transmissão:** continua dependendo de auditoria por amostragem (documento, seção 11).

## 11. Pendências para ativar

1. Gerar a chave do validador (`validator:keygen`) em máquina segura e pôr a chave pública em `VALIDATOR_PROOF_PK` (`apps/mobile/src/protocol/proof.ts`), com backup da semente.
2. Criar `dados/operadores.json` com os operadores admitidos e receber os certificados deles em `dados/registro/`.
3. Telas: mostrar no app que créditos de celular e de grupo são só estimativa e que o v2 exige prova do destino (strings de i18n, fora deste trabalho).

## 12. Revisão independente (2026-11-06)

| # | Achado | Correção |
|---|---|---|
| 1 | Conflito sem custo: qualquer prova "válida" com outro cabeçalho zerava o envelope | A prova só conta se o `ackHash` dela for o de um recibo de nó registrado (seção 6, item 2) |
| 2 | Tráfego sintético de um operador admitido diluía os honestos (o teto era aplicado depois de dividir) | Teto por nó e por operador por enchimento, antes de dividir (`allocate`) |
| 3 | Um operador com 9 nós zerava qualquer envelope | Saem os recibos dos operadores repetidos no envelope; marca por operador; N marcas = fora da época |
| 4 | Só a primeira prova selada por envelope era guardada (uma falsa barrava a verdadeira) | Até 3 diferentes por envelope; a do destino entra na frente |
| 5 | Diário e estado gravados sem `fsync` | `writeFileAtomic` com `fsync` e troca de nome |
| 6 | Chave antiga continuava valendo depois da rotação | Vigência por chave; retroativos recusados |
| 7 | A prova revelava a identidade do destino ao validador; na dúvida, assinava com a pública | Pseudônimo por validador; na dúvida, não gera prova |
| 8 | O teto por destino usava a época do vencimento, e os recibos a do `at` | Época do envelope (recibo válido mais antigo) para os dois |
