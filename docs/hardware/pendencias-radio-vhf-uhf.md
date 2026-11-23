# Pendências de bancada: modem KISS de banda estreita (VHF/UHF)

Situação em 2026-11-23: o adaptador `tnc` do `piu-node` (`apps/piu-node/src/relay/tnc.ts`) existe e passa nos testes com um **modem KISS emulado em memória** (`apps/piu-node/test/tnc.test.ts`). **Nenhum teste foi feito com modem ou rádio de verdade.** Esta lista diz o que falta, o que comprar e o passo a passo.

Origem: estudo `docs/estudos/2026-11-23-comunicacao-uhf-vhf.md` (ramo `docs/estudo-uhf-vhf`), seção 5, spikes 1 a 9.

## Regra que vale para todos os testes

- **Nada de transmitir em faixa de radioamador (2 m, 70 cm) com o Piu.** O Piu só leva mensagens cifradas, e o radioamador proíbe criptografia (Ato Anatel 926/2024, item 6.11).
- Os testes 1 a 5 **não transmitem no ar**: usam áudio por cabo, ou rádio ligado em carga fantasma (resistor de 50 Ω no lugar da antena).
- Teste no ar só em canal com licença (Serviço Limitado Privado) ou em faixa de uso livre que aceite dados, com equipamento homologado.

## O que os testes automáticos já cobrem (sem hardware)

- Enquadramento KISS, cabeçalho AX.25 UI de 16 bytes, pedaços "P1", anúncio "PN".
- Conta de tempo no ar por bps e TXDELAY, limite por hora, reserva de 20 % para prioridade alta.
- Tráfego de outros no canal (APRS) ignorado.
- Conexão por TCP com um servidor local.
- Recusa de subir sem `PIU_TNC_BAND` e com faixa de radioamador.

## O que NÃO foi validado (hipóteses)

| # | Hipótese | Onde aparece no código |
|---|---|---|
| H1 | O Direwolf aceita, pela porta KISS, um quadro AX.25 UI com conteúdo binário qualquer de até 249 bytes (16 + 233) | `ax25.ts`, `tnc.ts` |
| H2 | O NinoTNC aceita o mesmo quadro pela serial USB, em 1200 e 9600 bps com IL2P | idem |
| H3 | O tempo no ar real bate com `tncAirtimeMs` (a conta não inclui bit stuffing nem a correção de erro do IL2P/FX.25) | `tnc.ts` |
| H4 | Mandar só o TXDELAY pelo KISS basta; `PERSIST` e `SLOTTIME` do modem servem como vêm | `tnc.ts`, `start()` |
| H5 | A porta serial do NinoTNC abre com o `stty` que o nó já usa | `serial.ts`, `openSerialModem` |
| H6 | Vários nós no mesmo canal não se atropelam além do aceitável (o modem escuta antes de falar) | fora do código |

## Lista de compras para o piloto de bancada

Preços de 2026-11, aproximados (fontes no estudo).

| Item | Qtde | Para quê | Preço aprox. |
|---|---|---|---|
| Raspberry Pi (ou qualquer PC Linux; os próprios nós servem) | 2 | Rodar `piu-node` + Direwolf | já temos / US$ 50 cada |
| Cabo de áudio P2 macho-macho + placa de som USB simples | 2 + 2 | Teste 1: Direwolf com Direwolf, sem rádio | ~US$ 10 no total |
| NinoTNC (N9600A) montado | 2 | Testes 2 e 5: modem USB KISS | £75 cada (kit £35) |
| Interface AIOC (cabo tudo-em-um para portátil) | 2 | Teste 5: Direwolf com rádio | ~US$ 33 cada |
| Rádio portátil FM VHF/UHF | 2 | Teste 5, **só em carga fantasma** | ~US$ 25–40 cada |
| Carga fantasma 50 Ω (5 W ou mais) com conector do rádio | 2 | Transmitir sem irradiar | ~US$ 10 cada |
| Atenuadores (30 dB + 30 dB) e cabo coaxial | 1 jogo | Ligar dois rádios por cabo | ~US$ 30 |

Para o teste 1 basta o que já temos mais os cabos de áudio.

## Passo a passo

### Teste 1: dois Direwolf por cabo de áudio (valida H1, H3, H4)

1. Instale o Direwolf nas duas máquinas (`sudo apt install direwolf`).
2. Em cada uma, `direwolf.conf` com a placa de som USB, `MODEM 1200`, `KISSPORT 8001` e PTT desligado.
3. Ligue a saída de áudio de uma na entrada da outra, e vice-versa.
4. Em cada nó: `PIU_SERIAL=tnc:tcp://127.0.0.1:8001 PIU_TNC_BAND=licensed npm run dev` (o valor só destrava o adaptador; aqui nada vai ao ar).
5. Mande um texto curto de um celular ligado ao nó A para um contato ligado ao nó B.
6. Confira: a mensagem chega; o log do Direwolf mostra quadros de `PIU` para `PIU`; `GET /api/relay` mostra `tnc.sent` e `tnc.received` subindo.
7. Meça com cronômetro (ou pelo log do Direwolf) o tempo de um texto curto e compare com `airtimeMs`.
8. Repita com `MODEM 9600` e `PIU_TNC_BPS=9600`.

Se o Direwolf recusar o quadro, anote a mensagem de erro: o cabeçalho (`ax25.ts`) é o primeiro suspeito.

### Teste 2: dois NinoTNC por cabo (valida H2, H5)

1. Ligue os dois NinoTNC entre si pelo conector de rádio (TX de um no RX do outro), conforme o manual.
2. Escolha o modo nas chaves: primeiro 1200 AFSK AX.25, depois 9600 IL2P.
3. Em cada nó: `PIU_SERIAL=tnc:/dev/ttyACM0@57600 PIU_TNC_BAND=licensed`.
4. Mesmo roteiro do teste 1, passos 5 a 7.

### Teste 3: vários nós e perda (valida H6)

1. Com três máquinas e um misturador de áudio simples (ou três Direwolf no mesmo barramento de áudio), repita o teste 1 com três nós.
2. Mande 20 textos de cada nó em 10 minutos e conte quantos chegam.

### Teste 4: canal cheio e prioridade

1. Com `PIU_TNC_DUTY=1`, mande textos até `tnc.busy` subir.
2. Publique um alerta de prioridade alta e confira que ele sai antes dos textos parados.

### Teste 5: rádios em carga fantasma (valida níveis de áudio e TXDELAY reais)

1. Ponha a carga fantasma no lugar da antena dos dois rádios. **Sem antena.**
2. Ligue cada rádio ao Direwolf pela AIOC (ou ao NinoTNC).
3. Aproxime os rádios (a fuga da carga basta a centímetros) ou ligue por cabo com 60 dB de atenuação.
4. Ajuste o volume até o Direwolf decodificar; ajuste `PIU_TNC_TXDELAY_MS` até não perder o começo do quadro.
5. Repita o roteiro do teste 1 e anote a taxa de perda.

### Pendências que não são de bancada

- **Consulta à Anatel ou a consultor de homologação:** Serviço Limitado Privado para dados cifrados em 148–174 MHz: quem pode pedir, taxas, prazo e quais rádios homologados servem.
- **Medição de laboratório** da densidade de potência do LoRa de 125 kHz a 17, 20 e 22 dBm (teto de 8 dBm a cada 3 kHz em 902–907,5 / 915–928 MHz).
- **Painel e celular:** o painel do provider e o app ainda não mostram o modem `tnc`; hoje ele aparece só em `GET /api/relay`.
- **Decisão do dono (não implementado):** modo aberto de radioamador, sem cifra, só para alertas públicos (opção C do estudo). Muda o protocolo e o celular.
