# Piu sobre Meshtastic (LoRa)

Status: em implementação (2026-11-07). Decisões do dono do produto: conexão pelo **Bluetooth do rádio**, **só texto curto e recibos**, **canal público padrão** do Meshtastic.

## Ideia

O Piu continua com o próprio protocolo (LNNP, envelopes selados, Double Ratchet). O LoRa vira só mais um **meio** (`lora`), como Bluetooth LE ou Wi-Fi local. O envelope do Piu viaja, já cifrado, dentro de pacotes Meshtastic numa **porta privada** (`PRIVATE_APP = 256`). Os repetidores Meshtastic da comunidade repassam esses pacotes como fazem com qualquer pacote do canal, mas não conseguem ler: o canal público tem chave conhecida, e mesmo assim só aparece um envelope do Piu cifrado ponta a ponta.

```
[Piu A] --BLE--> [rádio A] ~~LoRa~~> [repetidores Meshtastic] ~~LoRa~~> [rádio B] --BLE--> [Piu B]
         envelope Piu (cifrado)  →  pedaços na porta 256  →  remontado  →  envelope Piu
```

## Modelo no transporte

- A malha LoRa inteira aparece para o roteador do Piu como **um vizinho virtual**, `lora:mesh`. Mandar para ele = transmitir no canal (destino `0xFFFFFFFF`). Tudo que chega na porta 256 com o cabeçalho do Piu vira um envelope vindo de `lora:mesh`.
- O roteador já descarta repetidos pelo id do envelope; o eco dos repetidores não duplica nada.
- O meio `lora` tem `maxEnvelopeBytes` pequeno, então o seletor de enlaces (`select.ts`) nunca escolhe LoRa para envelope grande; ele também fica atrás de todos os outros meios (custo e banda), ou seja, só é usado quando não há outro caminho.

## O que pode ir pelo LoRa

- **Só envelopes pequenos:** até 4 pedaços (`LORA_MAX_ENVELOPE = 4 × 226 = 904 bytes`). Só o primeiro tamanho de preenchimento cabe: medido no mensageiro, texto de até ~160 bytes vira um envelope de 593 bytes (3 pedaços); acima disso o envelope pula para 1361 bytes e não cabe. O app usa `LORA_TEXT_BYTES = 150` (`src/lib/loraChat.ts`, com folga para o nome que vai na 1ª mensagem), conferido por teste. Recibos são menores.
- **Nunca:** arquivos, fotos, áudio, quadros de voz da chamada (`'V'`), sinais de chamada ao vivo. A chamada exclui o meio `lora` dos enlaces de voz.
- O que não cabe fica na fila do roteador (como hoje, sem caminho) até aparecer outro meio.

## Formato do pedaço (payload na porta 256)

| bytes | campo | |
|---|---|---|
| 0–1 | `0x50 0x31` ("P1") | marca e versão: a porta 256 é compartilhada com outros apps |
| 2–5 | id da mensagem | aleatório, u32 (agrupa os pedaços) |
| 6 | `índice << 4 \| total` | 0–15 / 1–15 (usamos até 4) |
| 7… | até 226 bytes do envelope | `DATA_PAYLOAD_LEN` 233 − 7 |

Remontagem: guarda até 32 mensagens incompletas por 60 s; pedaço repetido é ignorado; total diferente para o mesmo id descarta a mensagem.

## Boa vizinhança na rede compartilhada

- **Orçamento de tempo de rádio** (balde de fichas): 3 pedaços por minuto em regime, rajada de 4 (uma mensagem inteira). No LongFast (≈1 kbps), cada pedaço cheio leva ~1,8 s no ar; 3/min ≈ 9 % de um canal só para este aparelho.
- **Prioridade:** primeiro o que é meu (mensagem e recibo); repassar envelopes de outros pelo LoRa usa o mesmo orçamento e só quando sobra.
- `hop_limit` padrão do rádio (3), `want_ack` desligado (o recibo cifrado do Piu já confirma a entrega), prioridade `BACKGROUND` no Meshtastic.
- Sem orçamento, o envio falha com "LoRa ocupado" e o roteador tenta de novo depois (sem perder nada).

## Conexão com o rádio (Bluetooth, API de cliente do Meshtastic)

Serviço `6ba1b218-15a8-461f-9fa8-5dcae273eafd`:
- `ToRadio` `f75c76d2-129e-4dad-a1dd-7866124401e7` (escrita): `ToRadio` em protobuf.
- `FromRadio` `2c55e69e-4993-11ed-b878-0242ac120002` (leitura): ler até vir vazio.
- `FromNum` `ed9da18c-a800-4f66-a670-aa7547e34453` (notificação): há algo para ler.

Início: escrever `ToRadio{want_config_id: n}` e ler `FromRadio` até `config_complete_id == n` (pega `my_info.my_node_num`). Enviar: `ToRadio{packet: MeshPacket{to: 0xFFFFFFFF, channel: 0, hop_limit: 3, priority: BACKGROUND, decoded: Data{portnum: 256, payload}}}`. Receber: `FromRadio{packet}` com `decoded.portnum == 256`. `QueueStatus` informa a fila do rádio.

O app codifica só o subconjunto de protobuf de que precisa (`src/transport/meshtastic/proto.ts`), sem dependência nova. Os números de campo seguem `meshtastic/protobufs` (mesh.proto, portnums.proto) e são conferidos por teste.

## Interface

- Aba Rede, linha LoRa: "Conectar rádio Meshtastic" → lista de rádios por perto (Bluetooth) → conectado: nome, bateria do rádio, orçamento restante, chave liga/desliga.
- Rota da mensagem (desenho 4b): você → seu rádio por Bluetooth LE → "por LoRa (Meshtastic)" → destino. Os rádios da malha no meio não se identificam ao Piu e não aparecem, nem a distância.
- Conversa quando só o LoRa alcança (4a, 4c): cartão fixo no topo, "LoRa ocupado · ~N s" quando algo espera a vez, cada balão com "na vez do rádio" ou "espera outro caminho"; contador a partir de 120 bytes e, acima de 150, a dica e o botão "agendar" (a mensagem não é bloqueada).
- Chamada (5a): folha "pre" com o rádio no diagrama, "Pelo LoRa não dá para falar ao vivo" e sem "Gravar um áudio". O número de saltos não aparece: o rádio só informa o do último pacote recebido, de qualquer pessoa.
- Primeira conexão: o Android pede pareamento com o PIN do rádio (padrão `123456` nos firmwares com tela).

## Fora do escopo agora

- iPhone (sem módulo nativo de cliente Meshtastic ainda) e Desktop pela USB (próximo passo: mesmo núcleo, porta serial).
- Configurar o rádio (região, preset): a pessoa usa o app oficial uma vez; o Piu só usa o canal 0 como está. No Brasil, a região do rádio precisa estar na faixa de 915 MHz permitida pela Anatel (conferir a opção no app oficial).
