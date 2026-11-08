# Super Node com LoRa

Status: caminho A implementado no app e no piu-node (2026-11-08); caminho B com a porta `rnode:` do piu-node pronta, app em andamento (Heltec V3, firmware RNode). Decisão do dono do produto: **os dois, A primeiro**; com os dois por perto, o app prefere o LoRa próprio ao Meshtastic.

## A. Super Node no canal Meshtastic

O Super Node (piu-node) ganha um rádio Meshtastic no USB e entra na mesma malha que os celulares já usam (`piu-sobre-meshtastic.md`): porta `PRIVATE_APP = 256`, canal 0, mesmos pedaços "P1". Nada muda no rádio das pessoas.

### No piu-node

- `PIU_SERIAL=meshtastic:/dev/ttyACM0@115200` liga o rádio pela **API serial de cliente** do Meshtastic: cada mensagem protobuf vai num quadro `0x94 0xC3 · tamanho u16 (big-endian) · ToRadio/FromRadio`. Começa com `want_config_id` e lê até `config_complete_id`, como pelo Bluetooth.
- O canal é aberto (chave pública conhecida) e sem sessão LNNP: o motor ganha uma **porta de malha aberta** (`attachMesh`). Entram e saem só envelopes do Piu inteiros, já selados ponta a ponta; o roteador trata a malha como um vizinho `lora:mesh` (classe `lora`), com as mesmas regras de sempre: deduplicação, prazo, limites, nunca mídia, só envelopes até `LORA_MAX_ENVELOPE` (904 bytes).
- Boa vizinhança: o mesmo balde de tempo de rádio dos celulares, mais folgado por ser um nó fixo (padrão 6 pedaços/min, rajada 8; `PIU_MESHTASTIC_PER_MIN`). Envelopes de terceiros só com o modo nó ligado e dentro do horário do operador.
- Cargas para gateway pela malha aberta têm o teto próprio por "vizinho" como nos outros meios (o endereço é `lora:mesh`).
- `GET /api/relay` mostra a porta Meshtastic com nome do rádio, nós ouvidos e pedaços enviados e recebidos.

### Anúncio do Super Node ("PN")

Na mesma porta 256, um pacote de 104 bytes, sozinho (não é pedaço):

| bytes | campo |
|---|---|
| 0–1 | `0x50 0x4E` ("PN") |
| 2 | versão (1) |
| 3–34 | chave técnica do nó (Ed25519, a do handshake LNNP) |
| 35–38 | quando (s, u32) |
| 39 | `bit0` retransmite para terceiros agora · `bit1` gateway |
| 40–103 | assinatura Ed25519 de `"piu/v0/lora-node" ‖ bytes 0–39` |

O nó anuncia ao ligar o rádio e a cada 15 min (≈0,3 s no ar). O app aceita o anúncio com assinatura válida e horário a menos de 1 h do relógio dele; considera o Super Node "por perto" por 40 min depois do último. Repetir um anúncio antigo só diz que o nó existiu há pouco: não dá acesso a nada.

### No app

- Aba Rede, linha LoRa conectada: "Super Node Piu por perto" (e "gateway" quando for), contado pelos anúncios válidos.
- O Super Node guarda e repassa: com ele por perto, a mensagem que sai pelo LoRa não depende de o contato estar ouvindo naquela hora.

## B. LoRa próprio (sem Meshtastic)

Primeira placa: **Heltec WiFi LoRa 32 V3** (ESP32-S3, SX1262, tela OLED, BLE) com o **firmware RNode** (`markqvist/RNode_Firmware`, instalado com `rnodeconf`). Lista de placas: `docs/hardware/placas-lora.md`.

### Modelo

O mesmo do caminho A, num canal só nosso: o rádio é um modem burro, e no ar passam os pedaços "P1" dos envelopes já selados e o anúncio "PN" do Super Node. O celular não tem sessão LNNP com vizinhos (entre celulares também é assim); a malha `lora:piu` é um vizinho virtual, como a `lora:mesh`. Entre dois Super Nodes, o `PIU_SERIAL=lora:` (LNNP por KISS) continua valendo.

Vantagens sobre o A: sem o cabeçalho e o canal público do Meshtastic (ninguém vê o número do rádio), frequência e tempo de rádio nossos, e o Super Node com os dois rádios vira **ponte** entre a rede Meshtastic e a nossa (o roteador manda cada envelope uma vez para cada malha).

### Rádio (RNode por KISS)

O RNode espera a configuração de quem conecta, a cada conexão: `0xC0 · comando · dados (com escape KISS) · 0xC0`.

| comando | código | dados | o Piu manda |
|---|---|---|---|
| detectar | `0x08` | `0x73` (resposta `0x46`) | sempre, primeiro |
| frequência | `0x01` | Hz, u32 big-endian | o meio da faixa da região (Brasil: 904 750 000) |
| banda | `0x02` | Hz, u32 | 125 000 (812 500 em 2,4 GHz) |
| potência | `0x03` | dBm, u8 | 17, ou o máximo da região se for menor |
| SF | `0x04` | u8 | 9 |
| CR | `0x05` | u8 (5–8 = 4/5–4/8) | 5 |
| limite de tempo no ar (longo prazo) | `0x0C` | centésimos de %, u16 | 1000 (10 %), ou o limite da região se for menor |
| rádio | `0x06` | `0x01` liga | por último |
| dados | `0x00` | um pacote no ar (até 255 bytes; o firmware divide até 508) | cada pedaço "P1" ou anúncio "PN" |

O RNode responde cada ajuste com o valor em vigor; o enlace só sobe quando todos conferem e o rádio está ligado. Erro (`0x90`) derruba o enlace com o código. ### Regiões

O Piu é usado no mundo inteiro: os valores saem de `piuRadio(região)` (`src/transport/rnode/regions.ts`), com as 27 regiões livres do Meshtastic (sem as faixas de radioamador). Todos os rádios do Piu numa região usam o mesmo canal. O app sugere a região pelo país do aparelho e a pessoa pode trocar; no Super Node é `PIU_RNODE_REGION` (padrão `BR_902`), com `PIU_RNODE_FREQ_HZ` e `PIU_RNODE_TX_DBM` para casos especiais. A tabela completa, com os chips que atendem cada região, está em `docs/hardware/placas-lora.md`.

### Bluetooth (celular)

Serviço Nordic UART do RNode: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`, escrita em `…0002`, notificação em `…0003`. O pareamento é por PIN de 6 dígitos que aparece na tela da Heltec V3 enquanto ela está em modo de pareamento (botão PRG).

### Preferência

Novo meio `piulora` (custo 3, LoRa Meshtastic é 4): com os dois disponíveis, o seletor de enlaces escolhe o rádio próprio; o Meshtastic fica de reserva. Os dois têm o mesmo limite de envelope (904 bytes, 4 pedaços). Os dois rádios são a mesma malha, o mesmo vizinho virtual `lora:mesh`: para o mensageiro é um vizinho só, com dois enlaces, e se o rádio próprio cair ou falhar o envio segue pelo Meshtastic sem desconectar. As regras do LoRa (nunca mídia, nunca voz, texto curto) valem para os dois; no roteador do celular, o vizinho LoRa entra com a classe `lora`.

Região no app: a que a pessoa escolheu; senão a do país do aparelho (`initialRegion`); senão o rádio não sobe e a tela pede a região. Trocar a região reconfigura o rádio conectado.

### Estado

- Feito: regiões do mundo e plano do rádio (`regions.ts`), núcleo do RNode (KISS e conferência da configuração, `rnode.ts`) e a porta `PIU_SERIAL=rnode:` no piu-node (malha `lora:piu`, anúncio "PN", tempo de rádio pela região, nova tentativa a cada minuto, ponte com a Meshtastic), com testes.
- Feito no app: o meio `piulora`, o enlace sobre o RNode (`src/transport/rnode/link.ts`), a fonte combinada com os dois LoRa, a região inicial pelo país do aparelho, o módulo Bluetooth do Android (`PiuRNode`, no pacote nativo do `piu-meshtastic`: busca pelo serviço ou pelo nome "RNode …", PIN pelo diálogo do Android, escritas em pedaços do MTU) e o cliente `src/transport/rnode/radio.ts`, ligado em `native.ts`, com testes. A chave "Rádio LoRa" da aba Rede desliga os dois rádios.
- Feito nas telas (desenho Piu 17): o bloco LoRa da aba Rede com os dois rádios, "em uso", aviso de espera com "enviar pelo outro" e a escolha Automático / Só Piu / Só Meshtastic (guardada); a folha do tipo de rádio; a folha de conexão (busca, PIN, configurando, falhas); a tela de região, com a sugestão pelo país, busca e troca confirmada (guardada); o "via" em cada mensagem. Galeria de desenvolvimento em `/__dev/radio`.
- Falta: o teste com a placa (Heltec V3) e a linha "por quê" do Automático (o app ainda não registra quando trocou de caminho).
