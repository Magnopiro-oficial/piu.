# Testar o rádio do Piu (RNode) com uma placa de verdade

Guia para quem tem uma placa e quer ajudar a testar o **caminho B** (rádio próprio do Piu, `docs/transporte/super-node-lora.md`). As placas que servem estão em `placas-lora.md`.

## O que já foi testado sem placa

O app e o Super Node foram testados contra uma **placa emulada**: um porte, byte a byte, do código que trata os comandos no firmware `markqvist/RNode_Firmware` (commit `56775c5`), em `apps/mobile/src/transport/rnode/emulator.ts`. A faixa de cada modelo vem do `rnodeconf` do Reticulum.

- **Todas as placas RNode da documentação**, em cada versão de faixa (41 perfis), contra as **27 regiões**. Cada combinação sobe no canal certo ou recusa a faixa errada, sem ligar o rádio.
- **Bluetooth** com MTU de 23, 185 e 512 bytes, e notificações picadas em tamanhos aleatórios.
- **Casos do mundo real**:
  - firmware antigo (antes da 1.52);
  - placa sem provisionar;
  - placa em modo TNC;
  - chip de rádio que não liga;
  - aparelho que não responde ou não é RNode;
  - texto solto do firmware na serial;
  - falha de transmissão, que reconfigura e volta;
  - limite de tempo no ar do firmware.
- **Simulação no ar**:
  - alcance pela distância e sensibilidade do SF9;
  - canal por região;
  - colisão com efeito de captura;
  - uma hora de envio sem passar do limite de tempo no ar da região;
  - anúncio de Super Node atravessando o ar.
- **Segurança**:
  - fuzz do KISS e da conferência da placa;
  - placa que mente nos ajustes;
  - dados antes da hora;
  - enxurrada de pedaços e de anúncios falsos;
  - nenhum comando que grave na memória da placa.

Uma revisão de segurança independente encontrou pontos que já foram corrigidos:
- **Pareamento obrigatório:** o app só usa uma placa pareada pelo Bluetooth. Um aparelho que se diz "RNode" sem pedir segurança não recebe nada.
- **Região:** o rádio não transmite antes de a pessoa escolher ou confirmar a região. O idioma do celular só sugere.
- **Pedaço falso:** um pedaço falso mandado por quem ouve o ar não apaga o verdadeiro que chega depois.
- **Falhas seguidas:** reconfigura no máximo 2 vezes por minuto.
- **Teto:** a lista de aparelhos da busca guarda no máximo 32 e a memória de mensagens entregues, 512.
- **Cota de cargas para gateway:** pelo LoRa, todo mundo no ar chega como um vizinho só. Antes, cópias repetidas da mesma carga gastavam a cota, e 10 cargas falsas de quem ouve o ar travavam a de todos. Agora só a carga nova gasta (cópia repetida ou regravada é de graça), e a malha aberta tem o teto de meio compartilhado: 30 de rajada e 120 por hora, no celular e no Super Node. Quem transmite lixo sem parar ainda gasta essa cota: no ar não há como saber quem mandou.

Limites conhecidos:
- **Pareamento sem PIN:** o Android não diz ao app se o pareamento foi com PIN ou só com "Parear?". A placa RNode de verdade sempre mostra um PIN na tela. Se o celular só perguntar "Parear?" sem pedir número, não é uma placa RNode.
- **Placa montada em casa (modelo 0xFE):** sem modelo gravado, o app não sabe a faixa da placa e confia na região escolhida.
- **Japão e Coreia:** a regra local pede ouvir o canal antes de transmitir. O firmware RNode tem esse controle (CSMA), mas ele não foi testado aqui.

O que **só a placa confirma**:
- o pareamento Bluetooth com PIN;
- o tempo de resposta real;
- o alcance de verdade;
- o comportamento de cada modelo com a antena dele.

## Preparar a placa (no computador)

1. Instale o Reticulum, que traz o `rnodeconf`: `pip install rns`.
2. Ligue a placa no USB **com a antena conectada** e rode `rnodeconf --autoinstall`. Escolha o modelo e a faixa que estão escritos na placa (433, 868 ou 915 MHz).
3. Se a placa já foi usada como TNC, com uma configuração salva, rode `rnodeconf --normal`. Em modo TNC o Piu recusa a placa, porque ela não aceita a configuração que o app manda.
4. Confira com `rnodeconf -i`. A versão do firmware precisa ser **1.52 ou mais nova**.

## Testar no celular (Android)

1. Rede → Rádio LoRa → Conectar rádio → **Rádio do Piu**.
2. Escolha a região, se o app pedir. No Brasil, a sugerida é 902–907,5 MHz.
3. Toque na placa na lista ("RNode XXXX") e digite o **PIN que aparece na tela da placa**.
4. Esperado: **"Rádio do Piu conectado"**, com a região e **904,75 MHz** no Brasil.
5. Com dois celulares e duas placas, mande uma mensagem curta de um para o outro, primeiro perto e depois cada vez mais longe.

Se a placa for recusada, a tela diz o motivo e o que fazer:

| Tela | Causa | O que fazer |
|---|---|---|
| Esta placa é de outra faixa de frequência | Placa de 433 MHz numa região de 915, ou o contrário | Use uma placa da faixa da região |
| Firmware RNode antigo | Versão antes da 1.52 | `rnodeconf --update` |
| A placa está em modo TNC | Configuração salva na placa | `rnodeconf --normal` |
| A placa ainda não foi preparada | Falta provisionar | `rnodeconf --autoinstall` |
| O rádio não respondeu | Placa desligada, longe ou sem RNode | Ligar, aproximar, instalar o RNode |
| O rádio informou um erro (0x01) | O chip de rádio não ligou | Conferir antena e placa |

## Testar no Super Node (piu-node)

Com a placa no USB: `PIU_SERIAL=rnode:/dev/ttyUSB0`. Use `PIU_RNODE_REGION=BR_902`, que é o padrão. O log mostra `RNode: rádio … pronto (modelo, região, frequência, potência)` ou o motivo da recusa, e o painel mostra o estado.

## O que relatar

Abra uma issue com:
- **placa e versão de faixa** (ex.: Heltec V3 915 MHz);
- **firmware** (`rnodeconf -i`);
- **celular e versão do Android**;
- **região escolhida**;
- **o que apareceu na tela** (print);
- **distância entre as placas e o tipo de lugar** (cidade, campo, prédio), se testou envio.
