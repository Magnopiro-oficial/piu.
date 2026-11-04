# LNNP — Lunes Network Node Protocol · Especificação v1

| | |
|---|---|
| Versão do protocolo | **1** (`LNNP_VERSION = 1`, identificador de serviço `net.piu.lnnp.v1`) |
| Estado | Rascunho de referência (protótipo). Sujeito à revisão formal de segurança exigida na seção 9 do documento de requisitos |
| Implementação de referência | `apps/mobile/src/protocol/lnnp.ts` (TypeScript puro; roda no app, no navegador e no Node) |
| Nó de referência | `apps/piu-node` (motor de retransmissão com adapter LAN: Ethernet e Wi‑Fi local) |
| Requisitos | INF-003, INF-005, INF-006, INF-007, INF-011, INF-012, INF-013, NFR-003; seção 7, item 3; seção 8 |

As palavras **DEVE**, **NÃO DEVE**, **DEVERIA** e **PODE** têm o sentido usual de especificação (obrigatório, proibido, recomendado e opcional).

## 1. Escopo e camadas

O documento de requisitos (seção 7) separa duas camadas, e esta especificação segue a separação:

| Camada | O que é | Versão | Onde |
|---|---|---|---|
| **Communication Protocol** (item 2) | O **envelope**: o que vai de ponta a ponta, cifrado para o destino, com id, destino lógico, prioridade, TTL, saltos e integridade | formato **0** (`PROTOCOL_VERSION = 0`, byte 0 do cabeçalho) | `envelope.ts` |
| **LNNP — Node Protocol** (item 3) | O **enlace entre dois vizinhos**: identidade técnica do nó, handshake, negociação de capacidades, autorização, encaminhamento, deduplicação e recibos | **1** | `lnnp.ts` |

### 1.1 Envelope v0 × LNNP v1 (não é inconsistência)

O `SERVICE_ID = 'net.piu.lnnp.v1'` (`src/transport/types.ts`) identifica o **LNNP versão 1**; o byte de versão `0` no cabeçalho de 104 bytes identifica o **formato do envelope**. São numerações independentes, de camadas diferentes, como o IP e o TCP:

- O LNNP v1 **transporta** envelopes. Cada nó anuncia no handshake os formatos de envelope que aceita (capacidade `ENVELOPE_VERSIONS`, hoje `[0]`) e as suítes criptográficas (`SUITES`, hoje `[1]`).
- Um formato de envelope novo (v1, v2…) **não exige** LNNP novo: basta anunciá-lo em `ENVELOPE_VERSIONS`. Um LNNP v2 **não exige** envelope novo.
- O envelope continua `0` porque ainda é o formato do protótipo; ao estabilizar depois da revisão formal, ganha um número novo e passa a ser anunciado ao lado do `0` durante a transição.
- O nó retransmissor NÃO DEVE mudar nada no envelope além do contador de saltos (byte 5), que já fica fora do id e da integridade.

## 2. Identidade técnica do nó

- Cada nó tem um par **Ed25519** só para a rede, derivado com `deriveNodeKey(semente, índice)` (`keys.ts`, rótulo `node/<índice>/sign`). No celular, vem da semente da pessoa, mas por um ramo de derivação separado; no piu-node, de uma semente própria do equipamento (`<data>/lnnp/node.seed`, permissão 0600).
- A identidade do nó **NÃO DEVE** ser a identidade social (pública ou anônima) nem a chave da carteira (seção 9: separação entre identidade social e identidade técnica). O handshake só leva a chave do nó.
- Ela assina o handshake e os recibos de retransmissão (`receipts.ts`).
- **Id do vizinho**: os 16 primeiros caracteres hex da chave pública (para logs, estatísticas e o roteador).
- **Etiqueta** (descoberta): `SHA-256("piu/lnnp/v1/tag" ‖ chave)[0..8]`.
- Revogação (INF-012): um nó PODE recusar chaves revogadas ou aceitar só uma lista de permitidos. A revogação feita pelo operador dos equipamentos e a distribuição dela entre os nós do mesmo operador estão na seção 8.1. A revogação pela Lunes (chave de release, nós de toda a rede) continua para a especificação de atualização.

## 3. Descoberta (adapter LAN)

Cada meio tem a sua descoberta (BLE, Wi‑Fi Direct, LoRa…). No adapter LAN (Ethernet/Wi‑Fi local, INF-007):

- **Anúncio UDP** a cada 5 s (configurável) para o broadcast da rede (padrão `255.255.255.255:8423`), com 18 bytes:

```
"LNNP" (4) · 0xBE · versão mínima u8 · versão máxima u8 · porta TCP do enlace u16 · etiqueta (8) · flags u8 (bit 0 = retransmite)
```

- O anúncio **não é autenticado**: é só uma dica de onde há um nó. A identidade é provada no handshake.
- Quem recebe um anúncio **conecta só se a sua etiqueta for menor**; o outro espera. Assim os dois lados não abrem duas conexões.
- Anúncio com faixa de versões sem interseção com a sua é ignorado (nem conecta).
- **Vizinhos fixos** (`host:porta`) PODEM ser configurados para redes que bloqueiam broadcast ou enlaces ponto a ponto. Se houver duas conexões com o mesmo nó, fica a aberta pelo nó de chave menor e a outra é fechada; os dois lados chegam à mesma decisão.

### 3.1 Descoberta e enlace pela porta serial (LoRa e USB)

Rádio LoRa e cabo USB entre nós (INF-005, INF-007) usam o mesmo adapter (`apps/piu-node/src/relay/serial.ts`). Pela porta serial vai **KISS** (`FEND` 0xC0 · comando 0x00 · dados com escape · `FEND`), o enquadramento padrão dos modems de rádio. Para o LoRa, a placa precisa de um firmware de modem KISS que guarde frequência, SF e banda. Cada quadro KISS é um pacote:

```
tipo u8 · destino u32 · origem u32 · seq u8 · dados
```

- **Endereço curto**: os 4 primeiros bytes da etiqueta do nó; `0xFFFFFFFF` é o anúncio. Ele só separa quem fala no meio compartilhado: a identidade continua sendo provada no handshake.
- **Tipos**:
  - `1` ANÚNCIO: o mesmo de 18 bytes da seção 3, com o campo "porta" levando o maior pacote do meio;
  - `2` HELLO e `3` HANDSHAKE: quadros em claro do handshake, AUTH ou ERRO;
  - `4` DADOS: registro cifrado da seção 8;
  - `5` ACK.
- **Confirmação**: HELLO, HANDSHAKE e DADOS são confirmados um a um, para e espera por vizinho, com até 4 repetições. A repetição idêntica (mesmo `seq` e mesmo conteúdo) é confirmada de novo, mas não é entregue duas vezes. Perda que sobrar vira lacuna no contador dos registros, e o envelope volta a poder ir ao vizinho.
- **Handshake em sequência**: só o nó de **endereço curto menor** começa (manda HELLO ao ouvir o anúncio). O outro, a cada HELLO, começa do zero e responde HELLO e AUTH. O primeiro manda AUTH. AUTH de tentativa antiga é descartado.
- **Sessão perdida**: quem recebe DADOS sem sessão (reiniciou) não confirma e responde ERRO em claro. O vizinho derruba o enlace e refaz o handshake no próximo anúncio.
- **LoRa**:
  - pacote de até 255 bytes; MTU anunciada 245;
  - meio LoRa (8);
  - mídia (`bulk`) nunca vai, e envelope acima de `PIU_LORA_MAX_ENVELOPE` (1536 bytes) fica para outro meio;
  - anúncio a cada 30 s e espera aleatória antes de cada envio;
  - o tempo no ar de cada pacote é calculado pela fórmula da Semtech, e o nó não passa de `PIU_LORA_DUTY` % do canal por hora (padrão 10). Os ACKs sempre passam.
- **USB**: pacote de até 4096 bytes, meio USB (32), mídia permitida, sem limite de tempo no ar.

## 4. Enquadramento

- **Em fluxo (TCP)**: cada quadro vai com um prefixo de tamanho `u32` big-endian. Antes do handshake terminar, um quadro DEVE ter no máximo 4096 bytes; depois, no máximo `64 KiB + 20`. Tamanho 0 ou acima do limite fecha a conexão.
- **Em datagrama (BLE, LoRa)**: um quadro por datagrama. O que não couber na MTU vai em quadros `FRAGMENT` (seção 8).
- Todos os inteiros são big-endian.

## 5. Handshake

Simétrico: os dois lados fazem a mesma coisa, sem papel de cliente e servidor.

```
A → B: HELLO_A                  B → A: HELLO_B          (em paralelo, em claro)
A → B: AUTH_A = Sig_A(H(HELLO_A) ‖ H(HELLO_B))
B → A: AUTH_B = Sig_B(H(HELLO_B) ‖ H(HELLO_A))
(depois disso, só registros cifrados)
```

### 5.1 HELLO (tipo `0x01`)

O formato do HELLO é **fixo em todas as versões do LNNP**, para que qualquer versão consiga ler a faixa da outra e negociar.

```
0x01 · "LNNP" (4) · versão mínima u8 · versão máxima u8 · horário u32 (s, Unix)
· chave do nó Ed25519 (32) · chave efêmera X25519 (32) · desafio aleatório (32)
· tamanho das capacidades u16 · capacidades (TLV, seção 6)
```

Bytes depois das capacidades são reservados para versões futuras e DEVEM ser ignorados.

Quem recebe um HELLO DEVE recusar (seção 10), nesta ordem:

1. tipo, prefixo `"LNNP"` ou faixa inválida (`mínima = 0` ou `mínima > máxima`) → `MALFORMED`;
2. a própria chave de nó → `SELF` (conexão consigo mesmo ou HELLO refletido);
3. horário a mais de 5 min do seu → `CLOCK`;
4. desafio igual ao seu, ou já visto nos últimos 10 min (`ReplayGuard`) → `REPLAY`;
5. negociação sem resultado (seção 7) → `NO_COMMON_VERSION`, `NO_COMMON_SUITE`, `NO_COMMON_FORMAT`, `MISSING_CAPABILITY`;
6. política local de autorização → `UNAUTHORIZED`.

### 5.2 AUTH (tipo `0x02`)

```
0x02 · assinatura Ed25519 (64) de SHA-256("piu/lnnp/v1/auth" ‖ SHA-256(meu HELLO) ‖ SHA-256(HELLO do vizinho))
```

Quem recebe confere a assinatura com a chave do nó que veio no HELLO do vizinho, com os HELLO na ordem do vizinho. Falhou → `BAD_SIGNATURE`.

Propriedades:

- **Autenticação mútua**: cada lado prova a posse da chave do nó assinando um HELLO que contém o desafio **novo** do outro lado.
- **Anti-replay**: um AUTH gravado não serve em outra sessão (assinou o desafio antigo), e um HELLO repetido é recusado pelo `ReplayGuard` e pelo horário.
- **Anti-downgrade**: a assinatura cobre os dois HELLO inteiros (faixas de versão e capacidades). Alterar qualquer byte no caminho faz a verificação falhar nos dois lados.
- **Privacidade**: nenhuma identidade social aparece. A chave do nó vai em claro no HELLO (limitação conhecida, seção 12).

### 5.3 Chaves do enlace

Com as duas assinaturas conferidas:

```
segredo = X25519(efêmera minha, efêmera do vizinho)
th      = SHA-256("piu/lnnp/v1/transcript" ‖ HELLO_lo ‖ HELLO_hi)       (lo = nó de chave menor)
chave   = HKDF-SHA256(segredo, sal = th, info = "piu/lnnp/v1/key/lo-hi"  | "…/hi-lo", 32)
prefixo = HKDF-SHA256(segredo, sal = th, info = "piu/lnnp/v1/nonce/lo-hi" | "…/hi-lo", 20)
```

Uma chave por sentido. As chaves efêmeras são apagadas depois: o enlace tem sigilo futuro.

## 6. Capacidades (TLV)

Cada capacidade: `tag u8 · tamanho u16 · valor`. No máximo 1024 bytes no total.

| Tag | Nome | Valor | Obrigatória | Padrão se ausente |
|---|---|---|---|---|
| 1 | `MTU` | u32: maior quadro que o meio deste nó leva de uma vez | não | 512 |
| 2 | `MEDIA` | u16 bitmask: 1 BLE · 2 Wi‑Fi Direct · 4 Wi‑Fi Mesh · 8 LoRa · 16 Ethernet · 32 USB | não | 0 |
| 3 | `RELAY` | u8: 1 = retransmite envelopes de terceiros agora | não | 0 |
| 4 | `STORAGE` | u32: espaço livre aproximado para terceiros, em MiB | não | 0 |
| 5 | `SUITES` | lista de u8: suítes de envelope aceitas (`suite.ts`) | **sim** | — |
| 6 | `ENVELOPE_VERSIONS` | lista de u8: formatos de envelope aceitos | **sim** | — |
| 7 | `FEATURES` | u32 bitmask: 1 fragmentos · 2 recibos de retransmissão · 4 `CAPS_UPDATE` | não | 0 |

Regras:

- Tag **desconhecida** DEVE ser ignorada (compatibilidade para frente).
- Tag **repetida** ou com tamanho errado → `MALFORMED`.
- Obrigatória ausente → `MISSING_CAPABILITY`.
- Opcional ausente → o padrão da tabela (conservador: MTU pequena, sem relay, sem recursos).

## 7. Negociação e regra de compatibilidade (INF-013, NFR-003)

- **Versão**: a **maior versão comum** às duas faixas: `v = min(máx_A, máx_B)`, válida se `v ≥ max(mín_A, mín_B)`. Senão → `NO_COMMON_VERSION`.
- Uma versão **desconhecida** (maior que a minha) no outro lado **não derruba o enlace**: enquanto as faixas se cruzarem, os dois falam a maior versão comum. Por isso uma rede com nós de versões diferentes continua funcionando durante uma atualização gradual.
- **Suítes** e **formatos de envelope**: a interseção. Vazia → `NO_COMMON_SUITE` ou `NO_COMMON_FORMAT`. Só envelopes de uma suíte e formato da interseção DEVEM ser enviados no enlace.
- **MTU efetiva**: a menor das duas. **Recursos efetivos**: o E lógico dos dois bitmasks.
- `RELAY`, `MEDIA` e `STORAGE` são informativos: ajudam a escolher vizinhos, mas um nó sem relay ainda recebe o que é para ele (o remetente não sabe quem é o destino).
- Implementações compatíveis com a mesma versão do LNNP, com suíte e formato de envelope em comum, DEVEM conseguir trocar envelopes (NFR-003).

## 8. Registros e quadros depois do handshake

Cada registro:

```
contador u32 · XChaCha20-Poly1305(chave do sentido, nonce = prefixo (20) ‖ contador u32,
                                  texto = tipo u8 ‖ corpo,
                                  dado associado = "LNNP" ‖ versão negociada u8 ‖ contador u32)
```

- O contador começa em 0 e **só cresce**. Registro com contador repetido ou menor → `REPLAY`; falha de autenticação → `BAD_SIGNATURE`. Nos dois casos a conexão é fechada.
- Em 2³² registros o enlace DEVE ser refeito (novo handshake).
- **Tipo desconhecido DEVE ser ignorado**, sem fechar o enlace.

| Tipo | Nome | Corpo |
|---|---|---|
| `0x10` | `ENVELOPE` | o envelope inteiro (`envelope.ts`), até 32 KiB |
| `0x11` | `FRAGMENT` | `id do envelope (16) · índice u16 · total u16 · dados` (`fragment.ts`). Usado quando o envelope não cabe na MTU efetiva menos 21 bytes; exige o recurso 1 |
| `0x12` | `RELAY_RECEIPT` | `id do envelope (16) · hash do segredo de entrega (16) · chave do nó (32) · horário u32 · assinatura (64)` (`receipts.ts`); exige o recurso 2 |
| `0x20` / `0x21` | `PING` / `PONG` | até 8 bytes, devolvidos no `PONG` |
| `0x30` | `CAPS_UPDATE` | capacidades (TLV) atualizadas, por exemplo quando o horário do operador liga ou desliga a retransmissão; exige o recurso 4 |
| `0x7e` | `CLOSE` | vazio ou código u8 |
| `0x7f` | `ERROR` | igual ao da seção 10 |
| `0x40` | `OPERATOR_CERT` | certificado do nó assinado pelo operador (seção 8.1) |
| `0x41` | `REVOCATION_LIST` | lista de revogação assinada pelo operador (seção 8.1) |
| `0x42` | `DEVICE_POLICY` | pausa e regras de um equipamento, assinadas pelo operador (seção 8.2) |
| `0x43` | `DEVICE_REPORT` | resumo das estatísticas de um nó, assinado por ele (seção 8.2) |

### 8.1 Extensão de operador: certificado, rotação e revogação

O operador dos equipamentos (quem instala e paga a infraestrutura) tem uma **chave de operador** Ed25519 própria, separada da identidade de conversa, da carteira e da chave técnica de cada nó. Ela assina a identidade técnica de cada equipamento e a lista de revogação. Implementação de referência: `apps/piu-node/src/relay/operator-frames.ts` (quadros) e `apps/piu-node/src/operator.ts` (chave, backup e rotação).

Os dois tipos são uma **extensão compatível** da v1: não mudam o handshake, não ganham bit em `FEATURES` e um nó que não os conhece os ignora (regra do tipo desconhecido, acima). Eles só circulam depois do handshake, cifrados como qualquer registro.

Mensagens assinadas (`H` = SHA-256, inteiros big-endian):

```
certificado = H("piu/lnnp/v1/operator-cert"     ‖ chave do operador (32) ‖ chave do nó (32) ‖ emitido u32)
rotação     = H("piu/lnnp/v1/operator-rotation" ‖ chave antiga (32) ‖ chave nova (32) ‖ horário u32)   assinada pela antiga
revogação   = H("piu/lnnp/v1/revocation"        ‖ chave do operador (32) ‖ número u32 ‖ emitida u32 ‖ quantidade u16 ‖ chaves de nó (32 cada))
```

Corpos:

| Tipo | Corpo |
|---|---|
| `0x40` `OPERATOR_CERT` | `chave do operador (32) · chave do nó (32) · emitido u32 · assinatura (64) · passos u8 · passo*`, com `passo = chave antiga (32) · chave nova (32) · horário u32 · assinatura da antiga (64)`; no máximo 16 passos |
| `0x41` `REVOCATION_LIST` | `chave do operador (32) · número u32 · emitida u32 · quantidade u16 · chave de nó (32)* · assinatura (64)`; no máximo 1024 chaves, em ordem crescente e sem repetição |

Bytes depois do fim do corpo são reservados e DEVEM ser ignorados. Corpo truncado ou acima dos limites é descartado (conta como recusado), sem fechar o enlace.

Regras:

- **Linhagem**: cada nó conhece as chaves do seu operador, da primeira à atual. Um certificado é **do mesmo operador** se a chave dele está na linhagem, ou se os passos de rotação que ele traz a estendem **a partir da chave atual** (cada passo assinado pela chave anterior). Assim a linhagem cresce. Um ramo que parte de uma chave antiga NÃO DEVE ser aceito, porque essa chave pode ter vazado.
- **Depois do handshake**, o nó que tem certificado DEVE mandar `OPERATOR_CERT` com o seu. Se o vizinho é um equipamento que ele certificou, PODE mandar também o certificado do vizinho (assinado pela chave atual). É assim que os equipamentos **recebem a nova chave na próxima sincronização**. Quem recebe o próprio certificado, ligado à linhagem e assinado pela chave atual, passa a anunciá-lo.
- O certificado só vale se `chave do nó` for a chave do vizinho autenticada no handshake (ou a do próprio nó que recebe). Assinatura que não confere é descartada.
- Ao reconhecer um vizinho do mesmo operador pela primeira vez no enlace, o nó DEVE devolver o seu certificado (o vizinho pode ter acabado de receber a chave) e mandar a lista de revogação em vigor.
- **Lista de revogação**: completa (não incremental), numerada. Só é aceita de um vizinho do mesmo operador, assinada pela **chave atual** da linhagem e com número **maior** que o da lista em vigor. Aceita, ela substitui a anterior e DEVE ser repassada aos outros vizinhos do mesmo operador (o número maior evita laço). Ao rotacionar a chave, o operador emite de novo a lista com a chave nova e número maior.
- **Efeito**: o nó DEVE recusar o handshake de uma chave revogada com `UNAUTHORIZED` (seção 10) e fechar o enlace que já existia com ela.
- O nó guarda o que aprendeu (passos de rotação, o próprio certificado, a lista) para valer depois de reiniciar.

Limites desta extensão: ela só alcança os nós do **mesmo operador** que estão conectados (direta ou indiretamente, por nós do mesmo operador). Um nó de outro operador continua aceitando a chave revogada, e um equipamento revogado que tinha uma cópia da chave de operador continua podendo assinar: nesse caso o operador DEVE rotacionar a chave. Revogar na rede inteira depende de uma autoridade comum (a Lunes) e fica para a especificação de atualização.

### 8.2 Ajustes e resumo dos equipamentos do operador

Também extensão compatível (sem bit em `FEATURES`; quem não conhece ignora), só entre vizinhos que se reconheceram como do **mesmo operador** (seção 8.1). Implementação de referência: `apps/piu-node/src/relay/operator-frames.ts` e `engine.ts`.

Mensagens assinadas:

```
ajustes = H("piu/lnnp/v1/device-policy" ‖ corpo sem a assinatura)   assinada pela chave de operador
resumo  = H("piu/lnnp/v1/device-report" ‖ corpo sem a assinatura)   assinada pela chave do nó que resume
```

| Tipo | Corpo |
|---|---|
| `0x42` `DEVICE_POLICY` | `chave do operador (32) · chave do nó (32) · número u32 · emitido u32 · sinais u8 · banda u8 · armazenamento u8 · horário u8 · assinatura (64)`; sinais: bit 0 = pausado, bit 1 = tem regras. Com regras: banda 5, 20 ou 50 (Mbps), armazenamento 1, 4 ou 8 (GB), horário 0 = sempre, 1 = 22h–7h, 2 = 8h–18h; outro valor é malformado. Sem regras, os três bytes vão em zero |
| `0x43` `DEVICE_REPORT` | `chave do nó (32) · horário u32 · sequência u32 · ligado desde u32 · encaminhados u32 · guardados u32 · recibos u32 · vizinhos u16 · sinais u8 · ajuste em vigor u32 · assinatura (64)`; sinais: bit 0 = pausado, bit 1 = retransmitindo. Contadores desde que o nó ligou, saturados em 2^32−1 |

Regras:

- **Ajustes**: um por equipamento (chave do nó), numerados por quem emite; o de número maior substitui o anterior. Só é aceito de um vizinho do mesmo operador, assinado pela **chave atual** da linhagem, com número **maior** que o conhecido para aquele equipamento (anti-replay) e `emitido` não mais que a tolerância do relógio (5 min) no futuro. Aceito, é guardado (para valer depois de reiniciar), repassado aos outros vizinhos do mesmo operador e, se a chave do nó é a do próprio nó, aplicado: pausado não guarda nem repassa terceiros; as regras valem junto com os limites locais (fica o mais restrito; todos os horários ao mesmo tempo). Depois de reconhecer um vizinho do mesmo operador, o nó DEVE mandar os ajustes que conhece. Um nó guarda no máximo 256.
- **Resumo**: cada nó manda o seu periodicamente (a referência usa 30 s) e quando a pausa muda, só a vizinhos do mesmo operador. Só é aceito se a chave que assina é a do vizinho autenticado no handshake ou a de um equipamento que o nó certificou, se `(horário, sequência)` é maior que o do último resumo daquela chave (a sequência recomeça quando o nó liga; o horário não volta) e se o horário não está mais que 5 min no futuro. Pode ser repassado aos outros vizinhos do mesmo operador. Não leva conteúdo, destino, ids de envelope nem chave secreta.
- O número do ajuste em vigor no resumo permite ao operador ver que o equipamento aplicou o que foi emitido.

Limites: alcança só equipamentos ligados (direta ou indiretamente) a nós do mesmo operador; um equipamento desligado recebe os ajustes quando voltar. O resumo é o último estado, não um histórico.

## 9. Encaminhamento, deduplicação e recibos

O nó repassa envelopes com o roteador do protocolo (`router.ts`), sem chave nenhuma, lendo só o cabeçalho:

- **Store-and-forward** (FUN-010): o envelope de terceiro fica guardado até vencer e sai quando surge um vizinho.
- **Deduplicação** (FUN-012): pelo id criptográfico (hash do envelope sem o contador de saltos). Um id já visto é descartado, venha por qual caminho vier; os ids vistos ficam guardados até o envelope vencer (até `maxSeen`).
- **Anti-loop**: saltos restantes (decrementados a cada repasse; zero não sai mais), não devolve a quem mandou, não repete ao mesmo vizinho, no máximo `maxCopies` cópias.
- **TTL** (FUN-011): vencido é apagado sem comando remoto; TTL acima de 7 dias é recusado.
- **Limites** (FUN-018, INF-009): espaço, quantidade, tamanho, retenção, balde de fichas por vizinho e banda para terceiros. O que for de menor prioridade e vencer antes sai primeiro.
- **Mídia** (flag `bulk`) nunca vai por LoRa, e o operador PODE recusar mídia de terceiros.
- **Recibos** (seção 11 do documento): na primeira cópia de um envelope de terceiro, o nó assina um recibo com a chave do nó. Os recibos ficam guardados e PODEM ser passados em `RELAY_RECEIPT` a um vizinho com rota até o validador. Quem recebe DEVE conferir a assinatura.

## 10. Erros

Antes do handshake terminar, o erro vai **em claro**: `0x7f · código u8 · tamanho u8 · motivo UTF-8 (até 200 bytes)`. Depois, vai como registro cifrado do tipo `0x7f`. Em todos os casos, quem envia fecha a conexão em seguida. O motivo é só para diagnóstico e NÃO DEVE conter dados sensíveis.

| Código | Nome | Quando |
|---|---|---|
| 1 | `MALFORMED` | quadro, HELLO ou capacidade malformados |
| 2 | `NO_COMMON_VERSION` | as faixas de versão não se cruzam |
| 3 | `NO_COMMON_SUITE` | nenhuma suíte criptográfica em comum |
| 4 | `NO_COMMON_FORMAT` | nenhum formato de envelope em comum |
| 5 | `MISSING_CAPABILITY` | falta capacidade obrigatória |
| 6 | `BAD_SIGNATURE` | AUTH, chave efêmera ou registro que não conferem |
| 7 | `REPLAY` | desafio repetido ou contador que não cresce |
| 8 | `CLOCK` | horário fora da tolerância de 5 min |
| 9 | `SELF` | conexão consigo mesmo |
| 10 | `UNAUTHORIZED` | recusado pela política local (lista de permitidos ou chave revogada) |
| 11 | `STATE` | quadro fora de hora ou tempo de handshake esgotado (5 s) |
| 12 | `TOO_LARGE` | quadro acima do limite |
| 13 | `BUSY` | handshakes simultâneos demais |

## 11. Limites recomendados

| Item | Valor |
|---|---|
| Quadro antes do handshake | 4096 bytes |
| Quadro depois do handshake | 64 KiB (+20 do registro) |
| Envelope | 32 KiB (`MAX_ENVELOPE_BYTES`) |
| Capacidades | 1024 bytes; até 32 tags desconhecidas guardadas |
| Tempo de handshake | 5 s |
| Tolerância de relógio | 5 min |
| Janela do `ReplayGuard` | 10 min, até 10.000 desafios |
| Handshakes simultâneos / enlaces por nó (LAN) | 16 / 64 |
| Remontagem de fragmentos | 64 em andamento, 64 KiB cada, 10 min |

## 12. Limitações conhecidas (para a revisão formal)

1. **A chave do nó vai em claro no HELLO**: um observador passivo na mesma rede liga anúncios e handshakes ao mesmo nó. Num Home Node isto é aceitável (ele é infraestrutura fixa); no celular, o índice de `deriveNodeKey` DEVERIA girar (por exemplo, por dia). Um handshake no estilo Noise XX, que esconde as identidades, é candidato para a v2.
2. **O anúncio UDP não é autenticado**: serve só para achar o endereço. Um atacante pode gastar conexões (há limite de handshakes simultâneos), mas não consegue se passar por outro nó.
3. **Listas de revogação**: a do operador, entre os nós do mesmo operador, está na seção 8.1. A distribuição autenticada para a rede inteira (INF-012) ainda não foi especificada.
4. **Recibos não provam a transmissão física** (como diz a seção 11 do documento): precisam ser combinados com auditoria por amostragem.
5. **Registros com contador estritamente crescente** pressupõem um meio ordenado. No TCP isso é dado; no adapter serial, a confirmação para e espera por vizinho mantém a ordem, e lacunas são aceitas. Para meios sem ordem nenhuma, a v2 deve definir uma janela de anti-replay.
6. **O adapter serial não é autenticado antes do handshake**: um ERRO "sem sessão" forjado no rádio derruba um enlace, que é refeito no anúncio seguinte. Quem consegue transmitir na faixa também consegue simplesmente interferir no canal.
7. Nenhum algoritmo aqui é decisão final: a suíte segue a do envelope (`suite.ts`) e depende da revisão formal e da auditoria independente.

## 13. Histórico

| Versão | Mudança |
|---|---|
| 1 | Primeira versão: HELLO/AUTH simétricos, capacidades TLV, registros XChaCha20-Poly1305, `ENVELOPE`, `FRAGMENT`, `RELAY_RECEIPT`, `PING`/`PONG`, `CAPS_UPDATE`, `CLOSE`, `ERROR`; descoberta LAN por UDP |
| 1 (adapter) | Adapter serial (LoRa e USB): KISS, pacote com endereço curto e confirmação, handshake em sequência (seção 3.1). Não muda o protocolo LNNP. |
| 1 (extensão de operador) | `OPERATOR_CERT` (`0x40`) e `REVOCATION_LIST` (`0x41`): certificado do nó, rotação e revogação pelo operador (seção 8.1). Compatível: quem não conhece ignora. |
| 1 (ajustes e resumo) | `DEVICE_POLICY` (`0x42`) e `DEVICE_REPORT` (`0x43`): pausa e regras de cada equipamento assinadas pelo operador e resumo assinado de cada nó, entre nós do mesmo operador (seção 8.2). Compatível: quem não conhece ignora. |
