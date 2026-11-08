# Placas LoRa compatíveis com o Piu

Levantado em 2026-11-08 nas fontes oficiais:
- **Meshtastic:** código do firmware, `meshtastic/firmware` (commit `11e3b28`, 7 nov 2026). Cada placa tem um arquivo de definição com nome, chip de rádio e nível de suporte.
- **RNode:** firmware `markqvist/RNode_Firmware` (README e `Boards.h`) e a edição comunitária `liberatedsystems/RNode_Firmware_CE`.

O Piu não limita placa nem país: qualquer placa que rode o firmware Meshtastic, em qualquer região, serve para o **caminho A** (`docs/transporte/piu-sobre-meshtastic.md`, `docs/transporte/super-node-lora.md`). As marcadas na última coluna também rodam o firmware RNode, que é o **caminho B** (rádio próprio, sem Meshtastic).

## Antes de comprar: a faixa de frequência do país

O Piu funciona no mundo inteiro. Cada país libera algumas faixas para LoRa sem licença, e o **chip** de rádio da placa define quais faixas ela alcança. A regra é sempre a mesma: escolha a região do país e compre uma placa cujo chip atenda essa região, com **antena da mesma faixa**. Ligar a placa para transmitir sem antena pode queimar o rádio.

### Chips e faixas

| Chip | Faixa do chip | Regiões que atende |
|---|---|---|
| SX1262 | 150–960 MHz | todas as sub-GHz: 433, 470, 865–868, 868, 902–928 MHz |
| LLCC68 | 150–960 MHz | todas as sub-GHz (versão econômica do SX1262, sem os fatores de espalhamento mais altos) |
| SX1276 | 137–1020 MHz | todas as sub-GHz |
| SX1268 | 410–810 MHz | 433 MHz e China (470–510 MHz) |
| SX1278 | 137–525 MHz | 433 MHz e China (470–510 MHz) |
| SX1280 | 2,4 GHz | 2,4 GHz, livre no mundo todo, com alcance bem menor |
| LR1110 | sub-GHz | todas as sub-GHz |
| LR1120, LR1121, LR2021 | sub-GHz e 2,4 GHz | todas, inclusive 2,4 GHz |
| STM32WL (rádio dentro do processador) | 150–960 MHz | todas as sub-GHz |

- **"SX1276/SX1278 (RF95)"** na tabela de placas: o mesmo firmware serve para os dois chips. A placa vendida para 868/915 MHz traz o SX1276; a de 433 MHz traz o SX1278.
- **Quando aparece "ou"**: o mesmo modelo é vendido com chips diferentes (por exemplo, T-Beam com SX1262 ou SX1268). Compre a versão da faixa do seu país.
- **Mesma placa, outra faixa**: um SX1262 alcança 433 a 960 MHz, mas a placa costuma vir com filtro e antena para uma faixa só. A loja vende como "433 MHz", "868 MHz" ou "915 MHz": vale o que está escrito na placa.

### Regiões do mundo

Fonte: tabela de regiões do firmware Meshtastic, a mesma que os rádios usam no caminho A. A última coluna é o canal que o rádio próprio do Piu (caminho B) usa na região, no meio da faixa, com potência e tempo no ar dentro do limite. O Super Node e o app escolhem a região pelo país; onde o país não tem uma regra conhecida no código (por exemplo, Argentina, Chile, Colômbia), a pessoa escolhe a região.

| Região | Código no Meshtastic | Faixa | Potência máx. | Tempo no ar máx. | Canal do Piu (caminho B) | Chips que atendem |
|---|---|---|---|---|---|---|
| Estados Unidos, Canadá, México | US (1) | 902–928 MHz | 30 dBm | sem limite | 915 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| União Europeia (433 MHz) | EU_433 (2) | 433–434 MHz | 10 dBm | 10 % | 433,5 MHz · 10 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| União Europeia, Reino Unido, Suíça, Noruega (868 MHz) | EU_868 (3) | 869,4–869,65 MHz | 27 dBm | 10 % | 869,525 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| União Europeia (866 MHz) | EU_866 (29) | 865,6–867,6 MHz | 27 dBm | 2,5 % | 866,6 MHz · 17 dBm · 2,5 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| União Europeia (868 MHz, banda estreita) | EU_N_868 (32) | 869,4–869,65 MHz | 27 dBm | 10 % | 869,525 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| China | CN (4) | 470–510 MHz | 19 dBm | sem limite | 490 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| Japão | JP (5) | 920,5–923,5 MHz | 13 dBm | sem limite | 922 MHz · 13 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Austrália e Nova Zelândia (915 MHz) | ANZ (6) | 915–928 MHz | 30 dBm | sem limite | 921,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Austrália e Nova Zelândia (433 MHz) | ANZ_433 (22) | 433,05–434,79 MHz | 14 dBm | sem limite | 433,925 MHz · 14 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| Rússia | RU (9) | 868,7–869,2 MHz | 20 dBm | sem limite | 868,95 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Coreia do Sul | KR (7) | 920–923 MHz | 23 dBm | sem limite | 921,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Taiwan | TW (8) | 920–925 MHz | 27 dBm | sem limite | 922,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Índia | IN (10) | 865–867 MHz | 30 dBm | sem limite | 866 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Nova Zelândia (865 MHz) | NZ_865 (11) | 864–868 MHz | 36 dBm | sem limite | 866 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Tailândia | TH (12) | 920–925 MHz | 27 dBm | 10 % | 922,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Ucrânia (433 MHz) | UA_433 (14) | 433–434,7 MHz | 10 dBm | 10 % | 433,85 MHz · 10 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| Malásia (433 MHz) | MY_433 (16) | 433–435 MHz | 20 dBm | sem limite | 434 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| Malásia (919 MHz) | MY_919 (17) | 919–924 MHz | 27 dBm | sem limite | 921,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Singapura | SG_923 (18) | 917–925 MHz | 20 dBm | sem limite | 921 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Filipinas (433 MHz) | PH_433 (19) | 433–434,7 MHz | 10 dBm | sem limite | 433,85 MHz · 10 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| Filipinas (868 MHz) | PH_868 (20) | 868–869,4 MHz | 14 dBm | sem limite | 868,7 MHz · 14 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Filipinas (915 MHz) | PH_915 (21) | 915–918 MHz | 24 dBm | sem limite | 916,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Cazaquistão (433 MHz) | KZ_433 (23) | 433,075–434,775 MHz | 10 dBm | sem limite | 433,925 MHz · 10 dBm · 10 % | SX1262, LLCC68, SX1276, SX1268, SX1278, LR1121, LR2021 |
| Cazaquistão (863 MHz) | KZ_863 (24) | 863–868 MHz | 30 dBm | sem limite | 865,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Nepal | NP_865 (25) | 865–868 MHz | 30 dBm | sem limite | 866,5 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Brasil | BR_902 (26) | 902–907,5 MHz | 30 dBm | sem limite | 904,75 MHz · 17 dBm · 10 % | SX1262, LLCC68, SX1276, LR1121, LR2021 |
| Mundo todo (2,4 GHz) | LORA_24 (13) | 2,4 GHz | 10 dBm | sem limite | 2.441,75 MHz · 10 dBm · 10 % | SX1280, LR1121, LR2021 |

- **Brasil**: o padrão é a faixa 902–907,5 MHz (BR_902, a mesma do Meshtastic no país). A Anatel também libera 915–928 MHz: quem já usa rádios nessa faixa pode escolher a região ANZ, mas todos os rádios da mesma rede precisam estar na mesma região.
- **Radioamador** (2 m, 70 cm, 1,25 m): o Meshtastic tem essas faixas, o Piu não. Elas exigem licença e não permitem conteúdo cifrado.
- **Os limites são os do Meshtastic**; quem opera Super Node confere a regra local antes de aumentar a potência.

## Como ler a tabela

- **Bluetooth (celular):** como o app Piu conversa com o rádio. Placas com "sim (BLE)" funcionam com o módulo Android do Piu. As de processador RP2040 não têm Bluetooth no Meshtastic: servem só como Super Node, ligadas no USB do piu-node.
- **Nível no Meshtastic** (o mesmo do instalador web do Meshtastic): **principal** = placa de linha principal, mais testada; **nicho** = suportada, uso específico; **antiga** = modelo legado ou sem nível definido. Placa antiga continua funcionando, mas recebe menos atenção.
- **Também roda RNode:** a placa tem definição no firmware RNode. Para o caminho B, interessam as que têm **BLE** no RNode:
  - Heltec V3 e V4, Heltec T114;
  - LILYGO T-Beam Supreme, T3-S3, T-Deck e T-Echo;
  - RAK WisBlock 4631;
  - Seeed XIAO ESP32-S3.

  As de ESP32 original (T-Beam v1.1, LoRa32 V1/V2/V2.1, Heltec V2) usam **Bluetooth clássico** no RNode. Isso é possível no Android, mas pede outro módulo nativo, e no iPhone não funciona.

## Todas as placas do firmware Meshtastic (123 modelos)

| Placa | Chip de rádio | Processador | Bluetooth (celular) | Nível no Meshtastic | Também roda RNode (caminho B) |
|---|---|---|---|---|---|
| Axiometa Genesis Mini | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Canary One | SX1262 | nRF52840 | sim (BLE) | antiga |  |
| Crowpanel Adv 2.4/2.8 TFT | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Crowpanel Adv 3.5 TFT | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Crowpanel Adv 4.3/5.0/7.0 TFT | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| DIY V1 | LLCC68 ou SX1276/SX1278 (RF95) ou SX1262 ou SX1268 | ESP32 | sim (BLE) | antiga |  |
| DR-DEV | LLCC68 ou SX1276/SX1278 (RF95) ou SX1262 ou SX1268 | ESP32 | sim (BLE) | antiga |  |
| EBYTE EoRa-S3 | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | antiga |  |
| Elecrow ThinkNode M3 | LR1110 | nRF52840 | sim (BLE) | principal |  |
| Elecrow ThinkNode M8 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Heltec HT62 | SX1262 | ESP32-C3 | sim (BLE) | principal |  |
| Heltec Mesh Node 096 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Heltec Mesh Node T1 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Heltec Mesh Node T114 | SX1262 ou SX1268 | nRF52840 | sim (BLE) | principal | sim |
| Heltec Mesh Pocket | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Heltec MeshSolar | SX1262 ou SX1268 | nRF52840 | sim (BLE) | principal |  |
| Heltec MeshTower V2 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Heltec RC32 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec RC52 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Heltec RCC6 | SX1262 | ESP32-C6 | sim (BLE) | principal |  |
| Heltec V1 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga |  |
| Heltec V2.0 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga | sim |
| Heltec V2.1 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga | sim |
| Heltec V3 | SX1262 | ESP32-S3 | sim (BLE) | principal | sim |
| Heltec V4 | SX1262 | ESP32-S3 | sim (BLE) | principal | sim |
| Heltec V4 R8 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec V4 R8 TFT | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec V4 TFT | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Vision Master E213 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Vision Master E290 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Vision Master T190 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Wireless Paper | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Wireless Paper V1.0 | SX1262 | ESP32-S3 | sim (BLE) | antiga |  |
| Heltec Wireless Stick Lite V3 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Wireless Tracker V1.0 | SX1262 | ESP32-S3 | sim (BLE) | antiga |  |
| Heltec Wireless Tracker V1.1 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Heltec Wireless Tracker V2 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Hydra | SX1262 ou SX1268 | ESP32 | sim (BLE) | antiga |  |
| LILYGO Mini ePaper S3 E-Ink | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| LILYGO T-Beam | SX1276/SX1278 (RF95) ou SX1262 ou SX1268 | ESP32 | sim (BLE) | antiga | sim |
| LILYGO T-Beam 1W | LR1121 ou LR2021 ou SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| LILYGO T-Beam BPF | SX1276/SX1278 (RF95) | ESP32-S3 | sim (BLE) | antiga |  |
| LILYGO T-Beam Supreme | LR1121 ou SX1276/SX1278 (RF95) ou SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | principal | sim |
| LILYGO T-Beam V0.7 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga |  |
| LILYGO T-Connect Pro | SX1262 | ESP32-S3 | sim (BLE) | antiga |  |
| LILYGO T-Deck | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | principal | sim |
| LILYGO T-Deck Pro | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | principal |  |
| LILYGO T-Echo | SX1262 ou SX1268 | nRF52840 | sim (BLE) | principal | sim |
| LILYGO T-Echo Lite | SX1262 ou SX1268 | nRF52840 | sim (BLE) | principal |  |
| LILYGO T-Echo Plus | SX1262 ou SX1268 | nRF52840 | sim (BLE) | principal |  |
| LILYGO T-Impulse Plus | SX1262 | nRF52840 | sim (BLE) | principal |  |
| LILYGO T-LoRa Pager | LR1121 ou SX1262 ou SX1268 ou SX1280 | ESP32-S3 | sim (BLE) | principal |  |
| LILYGO T-LoRa T3-S3 | LR1121 ou SX1276/SX1278 (RF95) ou SX1262 ou SX1280 | ESP32-S3 | sim (BLE) | principal | sim |
| LILYGO T-LoRa T3-S3 E-Ink | SX1276/SX1278 (RF95) ou SX1262 ou SX1280 | ESP32-S3 | sim (BLE) | principal |  |
| LILYGO T-LoRa V1 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga | sim |
| LILYGO T-LoRa V2 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga | sim |
| LILYGO T-LoRa V2.1-1.6 | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga | sim |
| LILYGO T-LoRa V2.1-1.8 | SX1280 | ESP32 | sim (BLE) | antiga |  |
| LILYGO T-Watch S3 | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | principal |  |
| LilyGo T3-C6 | SX1262 | ESP32-C6 | sim (BLE) | principal |  |
| LilyGo T5 E-paper S3 Pro V1 | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | antiga |  |
| LilyGo T5 E-paper S3 Pro V2 | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | antiga |  |
| LilyGo T5 E-paper S3 Pro V2 InkHUD | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | antiga |  |
| M5 Stack | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | antiga |  |
| M5Stack Unit C6L | SX1262 | ESP32-C6 | sim (BLE) | principal |  |
| Makerfabs Nomad Terminal | LR1121 | ESP32-S3 | sim (BLE) | nicho |  |
| Meshnology W10 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Meshnology W12 | LR2021 | ESP32-S3 | sim (BLE) | principal |  |
| muzi BASE | LR1121 ou SX1262 | nRF52840 | sim (BLE) | principal |  |
| muzi R1 Neo | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Nano G1 | SX1276/SX1278 (RF95) ou SX1262 | ESP32 | sim (BLE) | antiga |  |
| Nano G1 Explorer | SX1276/SX1278 (RF95) ou SX1262 | ESP32 | sim (BLE) | antiga |  |
| Nano G2 Ultra | SX1262 | nRF52840 | sim (BLE) | nicho |  |
| Nodara | SX1262 ou SX1268 | nRF52840 | sim (BLE) | principal |  |
| NomadStar Meteor Pro | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Nordic nRF54L15-DK | SX1262 | nRF54L15 | sim (BLE) | antiga |  |
| NRF52 Pro-micro DIY | LLCC68 ou LR1121 ou LR2021 ou SX1276/SX1278 (RF95) ou SX1262 ou SX1268 ou SX1280 | nRF52840 | sim (BLE) | antiga |  |
| Pi Computer S3 | SX1276/SX1278 (RF95) | ESP32-S3 | sim (BLE) | antiga |  |
| RadioMaster 900 Bandit Nano | SX1276/SX1278 (RF95) | ESP32 | sim (BLE) | nicho |  |
| RAK WisBlock 11200 | SX1262 | ESP32 | sim (BLE) | antiga |  |
| RAK WisBlock 11310 | SX1262 | RP2040 | não | nicho |  |
| RAK WisBlock 4631 | SX1262 | nRF52840 | sim (BLE) | principal | sim |
| RAK WisMesh Dongle | SX1262 | nRF52840 | sim (BLE) | principal |  |
| RAK WisMesh Pocket V3 | SX1262 | nRF52840 | sim (BLE) | antiga |  |
| RAK WisMesh Pod | SX1262 | nRF52840 | sim (BLE) | antiga |  |
| RAK WisMesh Repeater | SX1262 | nRF52840 | sim (BLE) | principal |  |
| RAK WisMesh Repeater (SensorHub uplink) | SX1262 | nRF52840 | sim (BLE) | principal |  |
| RAK WisMesh Repeater Mini V2 | SX1262 | nRF52840 | sim (BLE) | antiga |  |
| RAK WisMesh Repeater Mini V2 HP | SX1262 | nRF52840 | sim (BLE) | antiga |  |
| RAK WisMesh Tag | SX1262 | nRF52840 | sim (BLE) | principal |  |
| RAK WisMesh Tap | SX1262 | nRF52840 | sim (BLE) | principal |  |
| RAK WisMesh Tap V2 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| RAK3312 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| RAK3401 1W | SX1262 | nRF52840 | sim (BLE) | principal |  |
| RAK3401 LR2021 | LR2021 | nRF52840 | sim (BLE) | antiga |  |
| Raspberry Pi Pico | SX1262 | RP2040 | não | antiga |  |
| Raspberry Pi Pico W | SX1262 | RP2040 | não | antiga |  |
| RP2040 LoRa | SX1262 | RP2040 | não | nicho |  |
| Seeed SenseCAP Indicator | SX1262 ou SX1268 | ESP32-S3 | sim (BLE) | principal |  |
| Seeed SenseCAP Mesh-Tracker-X1 | LR2021 | nRF52840 | sim (BLE) | principal |  |
| Seeed SenseCAP Solar Node | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Seeed SenseCAP T1000-E | LR1110 | nRF52840 | sim (BLE) | principal |  |
| Seeed Wio Tracker L1 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Seeed Wio Tracker L1 E-Ink | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Seeed Wio Tracker L1 Pro 1W | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Seeed Wio Tracker L2 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| Seeed Wio WM1110 Tracker | LR1110 | nRF52840 | sim (BLE) | antiga |  |
| Seeed Xiao ESP32-S3 | SX1262 | ESP32-S3 | sim (BLE) | antiga | sim |
| Seeed Xiao NRF52840 Kit | SX1262 | nRF52840 | sim (BLE) | principal |  |
| Seeed XIAO nRF54L15 | LR2021 ou SX1262 | nRF54L15 | sim (BLE) | antiga |  |
| Seeed XIAO nRF54L15 LoRa Plus | LR2021 ou SX1262 | nRF54L15 | sim (BLE) | nicho |  |
| Station G1 | SX1276/SX1278 (RF95) ou SX1262 | ESP32 | sim (BLE) | antiga |  |
| Station G2 | SX1262 | ESP32-S3 | sim (BLE) | nicho |  |
| Station G3 | SX1262 | ESP32-S3 | sim (BLE) | nicho |  |
| T-Watch Ultra | SX1262 ou SX1280 | ESP32-S3 | sim (BLE) | principal |  |
| ThinkNode M1 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| ThinkNode M2 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| ThinkNode M5 | SX1262 | ESP32-S3 | sim (BLE) | principal |  |
| ThinkNode M6 | SX1262 | nRF52840 | sim (BLE) | principal |  |
| TrackSenger (big OLED) | SX1262 | ESP32-S3 | sim (BLE) | antiga |  |
| TrackSenger (big TFT) | SX1262 | ESP32-S3 | sim (BLE) | antiga |  |
| TrackSenger (small TFT) | SX1262 | ESP32-S3 | sim (BLE) | antiga |  |
| unPhone | SX1276/SX1278 (RF95) | ESP32-S3 | sim (BLE) | antiga |  |

## Só no RNode (fora do Meshtastic)

| Placa | Chip de rádio | Processador | Bluetooth |
|---|---|---|---|
| Handheld RNode v2.x (unsigned.io) | SX1276 | ESP32 | clássico |
| openCom XL (Liberated Embedded Systems) | SX1262 e SX1280 juntos | nRF52 | BLE |
| RNode NG 2.0 / 2.1 | SX1276 | ESP32 | clássico |
| Adafruit Feather ESP32 (HUZZAH32) montada em casa | qualquer suportado | ESP32 | clássico |
| ESP32 genérica montada em casa | qualquer suportado | ESP32 | clássico |
| nRF52 genérica montada em casa | SX1262 ou SX1276 | nRF52 | BLE |
| ATmega1284p / ATmega2560 montadas em casa | qualquer suportado | AVR | não |

## O que isso muda no plano

- **Caminho A** (já implementado): funciona com qualquer placa da tabela, na região do país. Para usar com o celular, ela precisa ter BLE; para o Super Node, basta ser ligada no USB.
- **Caminho B**: o primeiro alvo são as placas com SX1262 (que atende todas as regiões sub-GHz) e BLE nos dois firmwares, porque a mesma placa serve para A e B. Ordem sugerida para testar: Heltec V3, LILYGO T-Beam Supreme, RAK WisBlock 4631 e LILYGO T-Echo. Juntas, elas cobrem os dois processadores (ESP32-S3 e nRF52840).
