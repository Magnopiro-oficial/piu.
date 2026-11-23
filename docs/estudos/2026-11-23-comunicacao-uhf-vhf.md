# Estudo: comunicação UHF/VHF no Piu

Data: 2026-11-23 · Situação: **estudo, nada implementado** · Pedido do dono: "Faça um estudo para implementação de comunicação UHF/VHF."

## Resumo em uma página

- **O Piu já fala em UHF.** UHF vai de 300 MHz a 3 GHz. O LoRa do Piu no Brasil usa 902–907,5 MHz, e a tabela de regiões cobre também 433 MHz, 470 MHz, 865–870 MHz e 2,4 GHz. Tudo isso é UHF. O que o Piu **não** tem é VHF (30–300 MHz) nem rádio de banda estreita (os rádios de voz com modem de dados).
- **O obstáculo do VHF é a lei, não a técnica.** O Piu só leva envelopes cifrados de ponta a ponta. No Brasil:
  - radioamador (2 m e 70 cm) **proíbe criptografia** de forma expressa;
  - não achamos faixa VHF de uso livre (radiação restrita) que sirva para dados;
  - sobra o **Serviço Limitado Privado (SLP)**, com licença, em 148–174 MHz e 400–470 MHz. É caminho para instituição (prefeitura, defesa civil, cooperativa, empresa), não para o público.
- **433 MHz no Brasil não compensa:** o limite é 10 mW. A faixa de 915 MHz, que o Piu já usa, permite até 1 W.
- **Tecnicamente o encaixe é pequeno.** O `piu-node` já fala KISS pela serial, e KISS é a língua dos modems de rádio VHF/UHF (Direwolf, NinoTNC). Falta um adaptador novo, parecido com o do RNode, e a conta de tempo no ar por bits por segundo.
- **Recomendação:** (1) tirar mais alcance do UHF livre que já existe; (2) fazer em bancada, **sem transmitir no ar**, um adaptador "modem KISS de banda estreita", pronto para um parceiro com licença SLP; (3) deixar o "modo aberto de radioamador" (sem cifra, só alertas públicos assinados) como decisão de produto para depois.

### Como ler este documento

Cada afirmação leva uma marca:

- **[Código]**: lido no repositório nesta data (ramo `main`, commit `bba351f`).
- **[P]**: conferido em fonte primária na web (norma, documentação oficial), com link na seção de fontes.
- **[S]**: fonte secundária (loja, apresentação, notícia).
- **[H]**: hipótese ou cálculo nosso, ainda sem teste.
- **[NC]**: procuramos e não conseguimos confirmar.

A pesquisa na web foi feita por dois agentes de pesquisa em 2026-11-23; os links estão no fim. Normas mudam: antes de qualquer piloto com transmissão, o texto vigente precisa ser relido e, de preferência, confirmado com a Anatel ou com um consultor de homologação.

---

## 1. Como o Piu fala por rádio hoje

### 1.1 Os três adaptadores de rádio do `piu-node` [Código]

`PIU_SERIAL=tipo:caminho@velocidade` liga portas seriais ao motor (`apps/piu-node/src/relay/engine.ts`). Tipos aceitos: `lora`, `usb`, `meshtastic`, `rnode` (`parseSerialSpec`, em `relay/serial.ts`).

| Tipo | Arquivo | O que é | Como entra no motor | Maior envelope |
|---|---|---|---|---|
| `lora` | `relay/serial.ts` | Rádio LoRa com firmware de **modem KISS** (o rádio guarda frequência, SF e banda) | Enlace LNNP com handshake, pacote de até 255 bytes com cabeçalho próprio de 10 bytes, confirmação pacote a pacote (para e espera) | `PIU_LORA_MAX_ENVELOPE`, padrão 1536 bytes |
| `meshtastic` | `relay/meshtastic.ts` | Rádio com firmware Meshtastic (API serial `0x94 0xC3`) | Malha aberta `lora:mesh`, pedaços "P1" na porta 256 | 904 bytes (4 pedaços de 226) |
| `rnode` | `relay/rnode.ts` | Rádio com firmware RNode; o nó configura frequência, banda, SF e potência | Malha aberta `lora:piu`, os mesmos pedaços "P1" e o anúncio "PN" | 904 bytes |

O que já existe e interessa para VHF/UHF de banda estreita:

- **KISS já está pronto**: `relay/kiss.ts` codifica e decodifica quadros KISS (`FEND 0xC0`, comando `0x00` = dados). É o mesmo enquadramento dos TNCs de rádio.
- **A porta é abstrata**: a interface `Modem` (`write`, `onData`, `close`) é só um fluxo de bytes. Hoje é porta serial ou o rádio simulado (`relay/radio-sim.ts`). Um soquete TCP serve do mesmo jeito.
- **Tempo no ar**: `relay/airtime.ts` calcula o tempo no ar pela fórmula do LoRa (Semtech AN1200.13) e limita a ocupação por hora (`DutyCycle`, padrão `PIU_LORA_DUTY=10` %). O RNode e o Meshtastic usam um balde de fichas (`AirtimeBudget`: 6 pedaços por minuto, rajada de 8). **A fórmula é só de LoRa**: um modem de 1200 bps precisa de outra conta.

### 1.2 Limites do protocolo [Código]

- Guarda e repassa (`protocol/router.ts`, `DEFAULT_LIMITS`): até **20 mil envelopes**, até **32 KB** cada, por até **48 h**, no máximo 6 cópias por envelope.
- Classes de transporte: `'ble' | 'direct' | 'mesh' | 'lora' | 'eth'`.
- **Mídia e sinal ao vivo nunca vão por LoRa**: `if ((e.header.bulk || e.header.live) && via === 'lora') continue;`.
- Fila de saída ordenada por **prioridade** (`Low 0`, `Normal 1`, `High 2`, `Critical 3`) e depois pelo que vence antes. O que é do próprio nó sai antes do que é de terceiros.
- Envelope: cabeçalho de 104 bytes; o corpo é preenchido até 256, 1024, 4096 ou 16384 bytes. Um texto curto (até ~160 bytes) vira um envelope de **593 bytes**, ou seja, 3 pedaços de rádio (medido, `docs/transporte/piu-sobre-meshtastic.md`).
- `src/protocol/*` e `src/rnode/regions.ts` do nó são **gerados** a partir de `apps/mobile`. Qualquer mudança de protocolo ou de região nasce no mobile.

### 1.3 Em que faixas o LoRa do Piu opera [Código]

Tabela `REGIONS` (`apps/piu-node/src/rnode/regions.ts`, copiada do firmware Meshtastic), 27 regiões:

| Faixa | Regiões | VHF ou UHF |
|---|---|---|
| 433–435 MHz | EU_433, ANZ_433, UA_433, MY_433, PH_433, KZ_433 | UHF |
| 470–510 MHz | CN | UHF |
| 864–870 MHz | EU_868, EU_866, EU_N_868, IN, NZ_865, RU, KZ_863, NP_865, PH_868 | UHF |
| 902–928 MHz | US, **BR_902 (902–907,5 MHz, padrão no Brasil)**, ANZ, JP, KR, TW, TH, MY_919, SG_923, PH_915 | UHF |
| 2400–2483,5 MHz | LORA_24 | UHF |

Plano do Piu em cada região (`piuRadio`): canal no meio da faixa, 125 kHz de banda, SF 9, CR 4/5, **17 dBm** (ou o máximo da região, se menor), no máximo 10 % do tempo no ar.

Conclusão: **todo o rádio atual do Piu é UHF**. Não há nada em VHF. O próprio código explica por que as faixas de radioamador ficaram de fora: "exigem licença e não aceitam conteúdo cifrado" (comentário em `regions.ts`; `docs/hardware/placas-lora.md`, linha 66).

---

## 2. Caminhos para VHF e para mais UHF

### 2.1 Por que alguém quer VHF [H]

- Perda no espaço livre: de 146 MHz para 915 MHz a perda sobe **15,9 dB** (20·log(915/146)); de 433 para 915, 6,5 dB. Em VHF o sinal também contorna melhor morro e mata.
- Em troca: antena maior (¼ de onda ≈ 49 cm em 146 MHz, 16,5 cm em 433 MHz, 8 cm em 915 MHz), canais estreitos (12,5 a 25 kHz) e, por isso, taxa baixa.
- O LoRa compensa parte disso com sensibilidade: o preset LongFast do Meshtastic tem orçamento de enlace de 153 dB com 22 dBm [P]. Um rádio FM de voz com modem de 1200 bps precisa de sinal bem mais forte, e compensa com potência (5 W ou mais) e antena.

### 2.2 Comparação das opções

| Caminho | Taxa | Quadro | Alcance típico [H] | Hardware e custo | Maturidade | Encaixe no `piu-node` |
|---|---|---|---|---|---|---|
| **AX.25 1200 bps AFSK** (o do APRS) | 1200 bruta, ~700 bps úteis [H] | ~256 bytes [H] | 20–50 km em visada, 2–8 km urbano com portátil | Rádio FM + interface de áudio AIOC ~US$ 33 [S] + Direwolf num Raspberry Pi | Muito maduro; Direwolf 1.8.1 (nov/2025), GPL-2.0 [S] | KISS por TCP (porta 8001) ou serial [P]. Falta cabeçalho AX.25 e tempo no ar por bps |
| **9600 bps G3RUH** | 9600 bruta, ~5–6 kbps úteis [H] | ~256 bytes | Menor que o de 1200 (pede ~6–10 dB a mais de sinal) [H] | Rádio com porta de dados "plana" (portátil barato não serve) + NinoTNC (£35 kit, £75 montado) [S] | Maduro | NinoTNC é **USB-serial KISS** [P]: quase igual ao tipo `lora` atual |
| **IL2P / FX.25** (correção de erro sobre os dois acima) | mesma | mesma | Melhor em sinal fraco | Direwolf ou NinoTNC | IL2P desde o Direwolf 1.7 [P] | Transparente para o nó |
| **VARA FM** | ~12,7 kbps (estreito), ~25 kbps (largo) [S] | fluxo com ARQ | — | PC com Windows; licença ~US$ 69 [S] | Proprietário, só Windows [H] | **Não recomendado**: prende o nó a Windows e a software fechado |
| **Módulo SA818 / DRA818** | só voz FM, 1 W [P] | — | 3–5 km (fabricante) | US$ 9–15 [S] | Estável | Precisa de modem AFSK externo (Direwolf/NinoTNC). Serve para montar um "rádio de dados" barato |
| **LoRa em VHF** (Ebyte E22-170, SX1262, 150–173 MHz, até 30 dBm) | 0,3–20 kbps | ~240 bytes | 10 km+ (fabricante) | ~US$ 15–25 [H] | Módulo existe [S]; versão UART fala protocolo próprio, não KISS [H] | A versão SPI (E22-170M30S) com firmware RNode daria o mesmo adaptador `rnode` [H, a testar] |
| **LoRa 433 MHz** (SX1278/SX1262) | igual ao LoRa atual | 233 bytes úteis | Um pouco melhor que 915 com a mesma potência | Placas de US$ 20–50 | Pronto | **Já suportado** (regiões `*_433`); falta só uma região para o Brasil, que não compensa (seção 3.1) |
| **Meshtastic em 2 m / 70 cm** | igual | igual | — | Placa com frente de rádio VHF | Existe no firmware, só em modo licenciado, que **desliga a cifra** [P] | Não serve ao Piu cifrado |
| **Reticulum / RNode** | LoRa; aceita também qualquer modem KISS [P] | MTU 500 bytes [P] | — | Mesmas placas | Autor original saiu em dez/2025; forks da comunidade ativos em 2026 [S] | Já usamos só o firmware RNode como modem. Risco de manutenção: médio |
| **M17 (modo pacote)** | 9600 bruta, ~4,5 kbps [P] | ~800 bytes | Parecido com FM | Modem ou SDR | Especificação 3.0 em rascunho [P] | Sem interface pronta |
| **NPR-70** (70 cm) | 70–500 kbps [S] | IP | — | ~US$ 79 | Parado desde 2020 [S] | Não recomendado |
| **Wi-Fi HaLow** (802.11ah, ~900 MHz) | Mbps | IP | ~1 km | Módulos Morse Micro | Novo; homologação no Brasil [NC] | Entraria como rede local (`eth`/`mesh`), sem adaptador novo. Observar |
| **SDR** (HackRF, Pluto, LimeSDR) | qualquer | qualquer | Fraco sem amplificador | US$ 150–400 [S] | Laboratório | Bom para medir e simular, ruim para piloto de campo |

### 2.3 O motor já fala KISS/serial?

**Sim, em parte.** O que há e o que falta para um TNC de banda estreita:

| Peça | Situação |
|---|---|
| Enquadramento KISS | Pronto (`relay/kiss.ts`) [Código] |
| Porta serial USB (NinoTNC) | Pronta (`Modem`) [Código] |
| KISS por TCP (Direwolf, porta 8001) | **Falta**: um `Modem` sobre soquete TCP (pequeno) |
| Cabeçalho AX.25 | **Falta.** O Direwolf trata o que chega por KISS como quadro AX.25 (endereços de origem e destino, 16 bytes) [H, a confirmar no spike]. O adaptador precisa pôr e tirar esse cabeçalho |
| Tempo no ar | **Falta**: conta por bits por segundo + TXDELAY, no lugar da fórmula do LoRa |
| Classe de transporte | Reusar `'lora'` (hoje significa, na prática, "rádio lento"): já bloqueia mídia e sinal ao vivo. Criar `'vhf'` mexeria no protocolo gerado a partir do mobile, sem ganho |
| Modelo do adaptador | Seguir o `rnode.ts` (malha aberta, pedaços "P1", anúncio "PN", balde de fichas), **não** o `serial.ts` com handshake: handshake e confirmação pacote a pacote custam segundos de ar a 1200 bps |

---

## 3. Regulamentação

### 3.1 Brasil (Anatel)

**Radiação restrita (uso sem licença)**

- Norma: Resolução 680/2017 (alterada; Anexo I reescrito pela Res. 772/2025 [S]) e **Ato 14448/2017**, que **continua valendo**, com alterações; a última é o Ato 14158, de 01/10/2025 [P].
- O equipamento precisa ser **homologado** pela Anatel; não tem proteção contra interferência e não pode causar interferência [P].
- Limites que importam [P, texto consolidado do Ato 14448]:

| Faixa | Limite | Serve ao Piu? |
|---|---|---|
| 433–435 MHz | **10 mW** (item 4.1.5) | Legal, mas fraco. É faixa primária de radioamador |
| 902–907,5 e 915–928 MHz | Salto de frequência: até 1 W com 35 canais ou mais. Modulação digital: até 1 W e **no máximo 8 dBm a cada 3 kHz**. O mínimo de 500 kHz de largura foi **revogado** pelo Ato 14158 | **Sim, é o que já usamos** |
| 2400–2483,5 MHz | até 1 W, mesmas regras | Sim (região LORA_24) |
| 40,66–40,70 MHz | campo muito baixo, transmissão de até 1 s e silêncio de 30 vezes a duração | Não |
| 26/27, 50/53, 72/75 MHz (telecomando) | **dados proibidos** além do código de identificação | Não |
| 138–174 MHz | só operação periódica, campo muito baixo | Não |
| 169 MHz | nenhuma regra encontrada | Não |

- Conclusão: **no Brasil não existe faixa VHF de uso livre útil para dados.** [P pela leitura do Ato; ausência é sempre mais fraca que presença]
- Não achamos regra de radiação restrita que proíba cifra. [P por ausência]
- **Conta nossa [H]:** um sinal LoRa de 125 kHz espalha a potência em ~42 fatias de 3 kHz (16,2 dB). Para respeitar 8 dBm por 3 kHz, a potência total ficaria em torno de **24 dBm**, não 30 dBm. O padrão do Piu (17 dBm) e o teto das placas comuns (22 dBm) ficam dentro. Quem vale é a medição do laboratório de homologação.
- **433 MHz não compensa no Brasil [H]:** 433 ganha 6,5 dB de propagação sobre 915, mas perde 7 dB (contra 17 dBm) a 14 dB (contra ~24 dBm) de potência permitida.

**Serviço de Radioamador (2 m: 144–148 MHz; 70 cm: 430–440 MHz)**

- A Res. 449/2006 foi **revogada**. Valem o RGST (Res. 777/2025, art. 26), o **Ato 926/2024** (requisitos técnicos) e o **Ato 3448/2026** (operação) [P].
- Ato 926, item 6.11: **"Não é permitida a criptografia na[s] aplicações de Modos Digitais e Voz Digital."** [P]
- Item 6.12: espalhamento espectral e salto de frequência proibidos abaixo de 440 MHz [P]. Isso afeta o próprio LoRa em 2 m e em boa parte dos 70 cm.
- RGST art. 26: uso "unicamente a título pessoal", sem objetivo comercial [P]. Ato 3448: vedado "desvirtuar a natureza do Serviço"; comunicado internacional de terceiros proibido, salvo emergência ou acordo [P].
- Dados (APRS, AX.25) são permitidos para quem tem licença, nas classes A, B e C; APRS em 145,565–145,575 MHz [P].

**Rádio do Cidadão e "uso geral"**

- Rádio do Cidadão (27 MHz): voz e telecomando; dados não previstos [P]. Nem é VHF.
- "Uso geral" em 462/467 MHz (Ato 14448, seção 15, parecido com o FRS): 500 mW, canal de 12,5 kHz, **finalidade de voz entre pessoas**, interligação com redes proibida [P]. Dados não são citados. Não serve.
- Equivalente a PMR446 ou MURS: não achamos [NC].

**Serviço Limitado Privado (SLP)**

- Ato 915/2024 (alterado pelo Ato 2091/2025): **VHF 148–174 MHz** e **UHF 400–470 MHz**, canais de 12,5/20/50 kHz, sistemas digitais; **nada sobre proibir criptografia** [P].
- A outorga é pedida no sistema Mosaico; há taxas de fiscalização por estação (valores na página da Anatel sem data [NC]). Não confirmamos se pessoa física pode obter nem o prazo [NC].
- É o único caminho que achamos para **VHF com cifra** no Brasil, e é para uma entidade com licença e canal próprio.

### 3.2 Estados Unidos (resumo) [P, eCFR]

- **Part 15.247** (902–928 MHz): como o Brasil, até 1 W; na modulação digital ainda exige 500 kHz de largura mínima.
- **Part 97** (radioamador): 97.113(a)(4) proíbe mensagens "encoded for the purpose of obscuring their meaning". Em VHF/UHF ainda há limite de taxa de símbolos (97.307(f)).
- **MURS** (151/154 MHz, 2 W, sem licença): **dados permitidos**, mas **repetidora e guarda-e-repassa proibidos** (95.2733). O Piu é guarda-e-repassa: serviria só para conversa direta entre dois rádios, sem retransmissão.
- **FRS**: só texto curto ou posição, 1 s a cada 30 s, sem guarda-e-repassa. **GMRS**: proíbe mensagens codificadas. Não servem.

### 3.3 Europa (resumo) [P, ERC Rec 70-03, edição fev/2025]

- **433,05–434,79 MHz**: 10 mW, até 10 % do tempo.
- **869,4–869,65 MHz**: 500 mW, 10 % (já é a região EU_868 do Piu).
- **169,4–169,475 MHz**: **500 mW, até 1 % do tempo**. É a única faixa **VHF de uso livre** que achamos onde dados cifrados cabem. Com 1 % (36 s por hora), dá para algo como 10 mensagens curtas por hora por rádio [H].
- **PMR446** (446 MHz, 500 mW, antena fixa no aparelho, sem repetidora): dados não confirmados no texto atual [NC].
- Radioamador: regra da UIT (RR 25.2A) proíbe codificar para ocultar o significado nas comunicações entre países; cada país repete a regra [P para a UIT, NC país a país].

### 3.4 O conflito, dito de forma direta

> O Piu só transporta envelopes cifrados de ponta a ponta. Radioamador não aceita cifra, em nenhum dos três blocos pesquisados, e no Brasil a proibição é textual. Então **"Piu em 2 m ou 70 cm" não existe como produto legal** enquanto o Piu for só cifrado.

Restam três saídas: ficar no uso livre (UHF, que já temos), licenciar canal privado (SLP), ou criar um modo sem cifra só para conteúdo que já é público (opção C da seção 5).

---

## 4. O que cabe no protocolo

### 4.1 Tamanho de quadro e fragmentação

- LoRa hoje: pedaço "P1" de 233 bytes (7 de cabeçalho + 226 de envelope), no máximo 4 pedaços = **904 bytes** [Código].
- AX.25: quadro usual de 256 bytes de dados + 16 de endereços + 2 de verificação [H]. **O mesmo pedaço "P1" de 233 bytes cabe sem mudar nada.** Não é preciso fragmentação nova.
- Texto curto = envelope de 593 bytes = 3 pedaços [Código/doc].

### 4.2 Tempo no ar [H, contas nossas]

Um pedaço de 233 bytes com cabeçalho AX.25 ≈ 255 bytes no ar. Com 0,3 s de TXDELAY (tempo para o rádio "abrir"):

| Enlace | Um pedaço | Texto curto (3 pedaços) | Envelope de 32 KB |
|---|---|---|---|
| 1200 bps AFSK | ~2,0 s | **~6 s** | ~4 a 5 minutos de transmissão contínua |
| 9600 bps | ~0,5 s | ~1,5 s | ~1 minuto |
| LoRa SF9/125 kHz (Piu hoje) | ~1,1 s | ~3,3 s | não se aplica (teto de 904 bytes) |

Com o limite de 10 % do tempo no ar (360 s por hora), um canal de 1200 bps leva **cerca de 60 textos curtos por hora, somando todos os nós que se ouvem**. É um canal de recados, não de conversa em grupo.

### 4.3 Regras propostas para um enlace de banda estreita

- **Classe `lora`** (rádio lento): mídia e sinal ao vivo já ficam de fora pelo roteador.
- **Teto de envelope: 904 bytes**, igual ao LoRa. Nada de envelope de 1 KB para cima a 1200 bps.
- **Sem handshake e sem confirmação por pacote no ar** (modelo malha aberta do `rnode.ts`): o recibo cifrado do Piu já confirma a entrega.
- **Prioridade:** a fila já sai por prioridade. Proposta: reservar parte do balde de fichas para `High` e `Critical`, de modo que um alerta nunca espere atrás de repasse de terceiros.
- **Anúncio "PN"** a cada 15 min ou mais (a 1200 bps custa ~1 s de ar).
- **Escutar antes de falar:** o TNC já faz (detecção de portadora, parâmetros KISS `PERSIST` e `SLOTTIME`). O nó só precisa mandar esses parâmetros [H].

### 4.4 O que NÃO deve ir por 1200 bps

- Fotos, áudio, arquivos, chamadas e qualquer sinal ao vivo.
- Sincronização de histórico, pacotes de evidências do gateway, atualização de software.
- Mensagens de grupo grande e troca de chave de grupo com muitos membros (cada uma é um envelope a mais no ar).
- Repasse em massa de envelopes de terceiros: só quando sobrar ficha.
- Texto longo: acima de ~160 bytes o envelope pula para o tamanho de 1024 e já não cabe.

### 4.5 Bateria e antena [H]

| | Portátil FM 5 W | Módulo LoRa 22 dBm |
|---|---|---|
| Consumo transmitindo | ~1,5–2 A a 7,4 V (11–15 W) | ~120 mA a 3,3 V (0,4 W) |
| Média com 10 % no ar | ~1,2–1,5 W só de transmissão | ~0,04 W |
| Antena ¼ de onda | 49 cm (146 MHz), 16,5 cm (433 MHz) | 8 cm (915 MHz) |

Rádio de voz com modem é coisa de **nó fixo** (tomada ou painel solar com bateria, antena externa no alto), não de celular no bolso. Para o usuário comum, o rádio continua sendo a plaquinha LoRa.

---

## 5. Recomendação

### Opção A (indicada, já): tirar mais do UHF livre que o Piu já usa

O que é: nenhuma faixa nova. Melhorar alcance em 902–907,5 / 915–928 MHz: antena externa e altura nos Super Nodes, potência configurável até o teto legal e da placa, mais pontes fixas, e documentar o limite de 8 dBm por 3 kHz.

- **Prós:** legal hoje, com cifra, para qualquer pessoa; hardware barato que já funciona; quase nada de software (a potência já é configurável por `PIU_RNODE_TX_DBM`).
- **Contras:** não é VHF; continua limitado por relevo e vegetação.
- **Piloto:** 2 placas LoRa com antena externa de ganho e cabo curto: ~US$ 80–150 no total [H].
- **Software:** pequeno (dias): revisar teto de potência por região e textos do painel.

### Opção B (indicada, em bancada): adaptador "modem KISS de banda estreita"

O que é: um adaptador novo no `piu-node` (tipo `tnc`, por exemplo `PIU_SERIAL=tnc:/dev/ttyACM0@57600` ou `tnc:tcp://127.0.0.1:8001`), no modelo do `rnode.ts`, que fala com Direwolf ou NinoTNC. O rádio e a faixa ficam por conta de quem tem direito de transmitir: no Brasil, uma entidade com **SLP** em 148–174 ou 400–470 MHz, com rádio homologado.

- **Prós:** é o que de fato responde "VHF"; reaproveita KISS, pedaços "P1", fila e prioridades; independente de fabricante; dá para desenvolver e testar **sem transmitir** (áudio em laço entre dois Direwolf, ou rádios em carga fantasma).
- **Contras:** só serve a parceiros licenciados; canal lento (seção 4.2); exige nó fixo com energia e antena grande; a homologação do conjunto rádio + modem para SLP é incerta [NC].
- **Piloto:** 2 Raspberry Pi (ou os próprios nós) + 2 interfaces de áudio AIOC (~US$ 33 cada) ou 2 NinoTNC (£35–75 cada) + 2 rádios: ~US$ 150–400 [S/H]. Sem contar a licença.
- **Software:** médio (1–2 semanas): `Modem` por TCP, cabeçalho AX.25, tempo no ar por bps, parâmetros KISS, testes com o `RadioSim` adaptado, painel.

### Opção C (não agora): modo aberto para radioamador

O que é: um tipo novo de mensagem **sem cifra e assinada** (como o modo licenciado do Meshtastic), só para conteúdo que já é público, como os alertas da comunidade (regra 11.1), transmitido por operador licenciado, com indicativo, em 2 m.

- **Prós:** alcance grande com rádios que muitos radioamadores já têm; útil em desastre.
- **Contras:** muda o princípio "o Piu só leva conteúdo cifrado"; mexe no protocolo (mobile e nó); exige licença e identificação do operador; a regra de uso pessoal e sem fim comercial pode bater com o modelo de providers e créditos do Piu; repasse automático de mensagens de terceiros precisa de leitura jurídica [NC].
- **Piloto:** mesmo hardware da opção B.
- **Software:** grande (semanas) e com decisão de produto e de segurança antes.

### Ordem indicada

1. **A agora** (baixo custo, sem risco).
2. **Spikes da B em bancada**, sem RF, para saber o custo real e ter o adaptador pronto quando houver um parceiro com licença.
3. **C só se o dono decidir** que alertas públicos em claro fazem parte do produto.

### Riscos

- **Legal:** transmitir envelope cifrado em faixa de radioamador é infração. Nenhum teste no ar em 2 m ou 70 cm com o Piu cifrado.
- **Homologação:** módulos baratos (SA818, Ebyte 170 MHz) provavelmente não são homologados para SLP [H].
- **Expectativa:** "VHF" soa como alcance ilimitado; a 1200 bps o canal leva ~60 recados por hora para todos.
- **Normas mudam:** o Ato 14448 foi alterado em 2025 e as regras de radioamador em 2024 e 2026. Reler antes de cada piloto.
- **Dependência:** o Reticulum/RNode perdeu o autor original; os forks da comunidade precisam ser acompanhados.
- **Leituras não confirmadas [NC]:** SLP para pessoa física, taxas e prazo; dados no PMR446; redação atual do Anexo I da Res. 680.

### Spikes para validar antes de implementar

| # | Experimento | Responde | Transmite no ar? |
|---|---|---|---|
| 1 | Dois Direwolf ligados por áudio em laço (ou cabo de áudio entre duas placas de som), com um script que manda quadros KISS por TCP | O Direwolf aceita carga binária qualquer com cabeçalho AX.25 mínimo? Qual o tamanho máximo real do quadro? | Não |
| 2 | Mesmo teste com dois NinoTNC ligados por cabo, em 1200 e 9600 com IL2P | A serial USB KISS do NinoTNC funciona com o `Modem` atual sem mudança? | Não |
| 3 | Protótipo do adaptador `tnc` no modelo do `rnode.ts`, rodando contra o laço do spike 1; medir tempo de um texto curto e de 4 pedaços | As contas da seção 4.2 batem? O balde de fichas segura o canal? | Não |
| 4 | `RadioSim` com taxa em bps, TXDELAY e colisão; 5 nós, 25 % de perda | Quantos recados por hora o canal aguenta com vários nós? | Não |
| 5 | Dois rádios em carga fantasma (ou com atenuadores, cabo a cabo), 1200 e 9600 bps | Ajuste de nível de áudio, TXDELAY real, taxa de erro | Não (sem antena) |
| 6 | Medir no laboratório a densidade de potência do LoRa 125 kHz a 17, 20 e 22 dBm | A conta dos 8 dBm por 3 kHz (seção 3.1) fecha? | Em câmara ou cabo |
| 7 | Consulta formal à Anatel ou a consultor: SLP para dados cifrados em 148–174 MHz, quem pode pedir, taxas, prazo, rádios homologados | Viabilidade da opção B com um parceiro | Não |
| 8 | (Só se a opção C for aprovada) rascunho do tipo de mensagem "alerta público assinado, sem cifra" e revisão de segurança | Custo e risco da opção C | Não |
| 9 | Placa Ebyte E22-170M30S (SPI) com firmware RNode, em cabo com atenuador | O adaptador `rnode` atual serviria para LoRa em VHF (Europa 169 MHz, ou SLP)? | Não |

---

## Fontes

Consultadas em 2026-11-23.

**Brasil**
- Resolução Anatel 680/2017 (radiação restrita): https://informacoes.anatel.gov.br/legislacao/resolucoes/2017/936-resolucao-680
- Ato 14448/2017, texto consolidado (requisitos técnicos de radiação restrita): https://informacoes.anatel.gov.br/legislacao/atos-de-certificacao-de-produtos/2017/1139-ato-14448
- Datas do Ato 14158/2025 (secundária): https://gma.caict.ac.cn/en/update/45/1063
- Dispensa de autorização e cadastro: https://www.gov.br/anatel/pt-br/regulado/outorga/dispensa-de-autorizacao
- Resolução 777/2025 (RGST): https://informacoes.anatel.gov.br/legislacao/resolucoes/2025/2022-resolucao-777
- Ato 926/2024 (requisitos técnicos do radioamador): https://informacoes.anatel.gov.br/legislacao/atos-de-requisitos-tecnicos-de-gestao-do-espectro/2024/1919-ato-926
- Ato 3448/2026 (operação do radioamador): https://www.gov.br/anatel/pt-br/assuntos/noticias/anatel-simplifica-regras-e-fortalece-o-radioamadorismo-no-brasil/ato-3448-2026.pdf
- Ato 915/2024 (requisitos técnicos do SLP): https://informacoes.anatel.gov.br/legislacao/atos-de-requisitos-tecnicos-de-gestao-do-espectro/2024/1920-ato-915
- Outorga do SLP: https://www.gov.br/anatel/pt-br/regulado/outorga/servico-limitado-privado

**Estados Unidos, Europa, UIT**
- eCFR, Título 47 (Partes 15, 95 e 97): https://www.ecfr.gov/current/title-47
- ERC Recommendation 70-03 (fev/2025): https://docdb.cept.org/download/4635
- PMR446, ECC/DEC/(15)05: https://docdb.cept.org/document/448
- UIT RR 25.2A, transcrito em 71 FR 25982: https://www.govinfo.gov/content/pkg/FR-2006-05-03/pdf/06-4028.pdf

**Tecnologia**
- Direwolf: https://github.com/wb2osz/direwolf · manual: https://dyn.manpages.debian.org/trixie/direwolf/direwolf.1
- NinoTNC: https://tarpn.net/t/nino-tnc/n9600a/n9600a_info.html · https://wiki.oarc.uk/packet:ninotnc · https://www.hamserve.uk/?p=13
- AIOC: https://github.com/tymek/aioc
- VARA FM (guia e apresentação): https://qsl.net/nf4rc/2022/VARA_FM_4.x_2021Nov.pdf
- SA818: https://nicerf.com/walkie-talkie-module/1w-embedded-walkie-talkie-module-sa818s.html
- Ebyte E22-170M30S: https://ebyteiot.com/products/ebyte-e22-170m30s-30dbm-10km-170-125mhz-spi-sx1262-lora-rf-transceiver
- RNode Firmware: https://github.com/markqvist/RNode_Firmware · Reticulum (manual e hardware): https://reticulum.network/manual/ · https://reticulum.network/manual/hardware.html · forks: https://github.com/Reticulum-Community
- Situação do Reticulum (secundária): https://gigazine.net/gsc_news/en/20260120-reticulum-network-stack
- Meshtastic, regiões e presets: https://meshtastic.org/docs/configuration/radio/lora/ · https://meshtastic.org/docs/overview/radio-settings/
- M17, camada física: https://m17-protocol-specification.readthedocs.io/en/latest/physical_layer.html
- NPR-70: https://hackaday.io/project/164092-npr-new-packet-radio
- Wi-Fi HaLow no Brasil (notícia): https://www.mobiletime.com.br/noticias/17/03/2026/wi-fi-halow-morse-micro/

**Repositório (lido em `main`, `bba351f`)**
- `apps/piu-node/src/relay/{engine,serial,kiss,airtime,rnode,meshtastic,radio-sim}.ts`
- `apps/piu-node/src/config.ts`, `src/rnode/regions.ts`, `src/meshtastic/{fragments,budget}.ts`
- `apps/piu-node/src/protocol/{router,fragment,envelope}.ts`
- `apps/piu-node/README.md`, `docs/hardware/placas-lora.md`, `docs/transporte/{piu-sobre-meshtastic,super-node-lora}.md`

---

## Retomada (onde parou em 2026-11-23)

O dono pausou este assunto: **nada do estudo é para implementar agora**. Nada foi publicado (sem push).

**O que existe**

| O quê | Ramo | Commit | Pasta local |
|---|---|---|---|
| Este estudo | `docs/estudo-uhf-vhf` | `18498fd` (estudo) + o commit desta seção | `~/Documents/Projetos_DEV/piu-wt-estudo-uhf-vhf` |
| Rascunho do adaptador de modem KISS (`tnc`), opção B | `feat/piu-node-tnc-kiss` | `c099705` | `~/Documents/Projetos_DEV/piu-wt-tnc-kiss` |

O rascunho traz: `apps/piu-node/src/relay/{ax25,tcpModem,tnc,tncConfig}.ts`, `test/tnc.test.ts`, as variáveis `PIU_TNC_*` no README e a lista de bancada em `docs/hardware/pendencias-radio-vhf-uhf.md`. Vem desligado por padrão e recusa faixa de radioamador. Linhas tocadas em arquivos que outro ramo (`fix/provider-config-didatica`) também mexe: `src/config.ts` (import, campo `tnc` em `LnnpConfig`, duas linhas em `loadLnnpConfig`) e `src/relay/index.ts` (import, campo `tnc` em `RelayHandle` e em `stats()`, um bloco de 12 linhas no laço do `PIU_SERIAL`, e `close`).

**O que foi validado**

- Checagem de tipos do nó e os 12 testes novos, com modem KISS emulado em memória.

**O que NÃO foi validado**

- Nenhum modem nem rádio de verdade (hipóteses H1 a H6 da lista de bancada).
- Na suíte inteira do nó, 154 de 157 passaram. As 3 falhas (cópia de `src/lunes` e dois testes que leem `apps/settlement`) não parecem ligadas ao adaptador, mas **não foram conferidas contra a `main` pura**.
- Os fatos de regulamentação vieram de pesquisa na web em 2026-11-23 e não foram relidos um a um; os itens [NC] seguem em aberto.
- A opção A (mais alcance no UHF livre) ficou só como texto no README; a conta do teto de ~24 dBm é hipótese.

**Primeiro passo da volta**

1. Perguntar ao dono qual opção ele quer (A, B ou C) antes de qualquer código.
2. Se for a B: no ramo `feat/piu-node-tnc-kiss`, rodar a suíte do nó na `main` pura para saber se as 3 falhas já existiam; depois fazer o teste 1 da lista de bancada (dois Direwolf por cabo de áudio, sem transmitir no ar).
3. Antes de juntar na `main`: revisão de código do adaptador e merge deste estudo, para os links do README não ficarem soltos.
