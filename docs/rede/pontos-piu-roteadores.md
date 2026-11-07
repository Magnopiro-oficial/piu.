# Pontos Piu com roteadores Wi-Fi — análise técnica (06/11/2026)

> Estudo para validação. **Nada foi implementado.** Complementa — não substitui — a comunicação direta entre celulares
> (Bluetooth / Nearby / Wi-Fi Direct), que continua exatamente como está. Incorpora a proposta anterior do assistente
> "Criar ponto Piu" como o nível **guardião**.

## 0. Ponto de partida (o que o código faz hoje)

| Aparelho | Transportes hoje |
|---|---|
| Celular | Bluetooth LE e Nearby Connections (Bluetooth que sobe para Wi-Fi Direct/hotspot). **Não fala LNNP pela rede Wi-Fi em que está conectado.** |
| Piu Desktop | LNNP pela rede local: anúncio UDP de 18 bytes (broadcast) + enlace TCP autenticado (`apps/desktop/src/transport/lnnpLan.ts`). |
| Piu Node | O mesmo LNNP de rede local; roda em Linux/Raspberry e em roteadores OpenWrt (`packaging/openwrt`). |

Ou seja: um roteador comum **já** liga Desktops e Piu Nodes sem internet. Falta o celular entrar nessa camada.

## 1. Respostas às 8 perguntas

### 1.1 Um roteador convencional retransmite um protocolo próprio sem internet?
**Sim, desde que o protocolo ande sobre IP (UDP/TCP).** O roteador doméstico é um ponto de acesso + switch: entrega pacotes IP entre
os aparelhos conectados nele sem olhar o conteúdo e sem precisar de internet (a internet é só mais uma "porta" dele, a WAN).
O LNNP já é UDP (descoberta) + TCP (enlace), cifrado e autenticado de ponta a ponta — o roteador só vê bytes opacos.

O que **não** dá sem trocar o firmware: fazer o roteador *executar* lógica do Piu (guardar, decidir rota, anunciar algo próprio
no ar). Usar o rádio do roteador como "antena do protocolo" no sentido de quadros Wi-Fi próprios (beacons ou elementos de fabricante)
exige firmware. Quadros Ethernet crus com tipo próprio até passariam pelo switch, mas o Android não deixa um app enviá-los sem root —
por isso IP é o caminho.

### 1.2 Dá para usar o roteador só como ponto de comunicação, sem instalar nada nele?
**Sim — é o "ponto multiplicador".** Basta os aparelhos com Piu estarem na mesma rede Wi-Fi. Condições:
- a rede não pode isolar os clientes entre si (ver 1.4);
- a descoberta precisa atravessar a rede (broadcast/multicast, com plano B — ver 3.2).

O roteador não guarda nada: se o destinatário não está na rede naquele momento, a mensagem só fica guardada se houver um **guardião**
(celular, computador ou Piu Node) conectado ali.

### 1.3 Os celulares podem usar roteadores como intermediários entre áreas diferentes?
Sim, de quatro formas, que se somam:
1. **Celular-ponte (sem nada novo nos roteadores):** um celular conectado ao Wi-Fi do ponto continua com Bluetooth ligado (Wi-Fi
   cliente + Bluetooth funcionam juntos em praticamente todo Android). Ele liga quem está no Wi-Fi a quem está só por perto pelo
   Bluetooth. Muitos celulares também mantêm Wi-Fi Direct junto com o Wi-Fi cliente.
2. **Mobilidade (store-and-forward):** o guardião do ponto A guarda; alguém passa pelo ponto A e depois pelo ponto B levando a
   mensagem cifrada. É o que o Piu já faz entre celulares, agora com "paradas" fixas.
3. **Ponte entre roteadores sem trocar firmware:** repetidor/mesh do próprio fabricante (EasyMesh, Deco, Intelbras Twibi), ou um
   **enlace ponto a ponto externo** (par de CPEs de 5 GHz, a partir de uns R$ 300) que une duas redes a 1–5 km. Para o Piu é tudo uma
   rede só. Exige configuração do dono e confiança entre as duas pontas.
4. **Malha entre roteadores OpenWrt (802.11s / batman-adv):** roteadores vizinhos com OpenWrt formam uma espinha dorsal sem fio entre
   si, cada um rodando o Piu Node. É o caminho de maior alcance e o único que não depende de cada dono configurar pontes à mão.

Limitação importante: **um celular só fica conectado a uma rede Wi-Fi por vez.** Entrar no ponto Piu significa sair da rede de casa
enquanto estiver lá (no Android 10+ o app pode pedir uma conexão "só local" com `WifiNetworkSpecifier`, sem trocar a internet do
celular em vários aparelhos; o sistema marca a rede como "sem internet" e o app prende os sockets nela com `Network.bindSocket`).

### 1.4 Limitações dos roteadores domésticos
| Limitação | Efeito | Como lidar |
|---|---|---|
| **Isolamento de clientes** (comum em rede de visitante e em roteador de operadora) | Aparelhos não se enxergam: o ponto não funciona | Teste automático no assistente; orientar a desligar, ou usar rede/roteador dedicado |
| Filtro de broadcast/multicast, ou conversão de multicast | Descoberta falha | Descoberta em camadas (3.2) |
| Poucos clientes simultâneos (20–60 em roteador barato) e DHCP pequeno | Ponto lota | Limite e aviso no painel; guardião prioriza tráfego Piu leve |
| Alcance (20–50 m dentro, mais fora) e paredes | Cobertura pequena | Repetidor, CPE externa, posicionamento |
| Roteador de operadora travado | Dono não muda nada | Roteador dedicado barato ou ponto por celular (hotspot) |
| Energia: queda de luz desliga o ponto | Ponto some | Guardião com bateria (celular velho) segue como nó Bluetooth |
| Android economizando energia | Celular para de ouvir a rede | `MulticastLock` só no ponto, serviço em primeiro plano que já existe |
| Rede aberta com internet | Estranhos usando a internet do dono | Ponto Piu **sem internet** por padrão |

### 1.5 Uma solução compatível com a maioria dos roteadores?
Sim, se o Piu oferecer **três formas de montar o ponto**, da mais compatível para a mais completa:

| Forma | Precisa de | Compatibilidade |
|---|---|---|
| **A. Rede dedicada ao Piu** | Rede de visitante sem isolamento entre visitantes, **ou** um roteador barato só para o Piu, sem cabo na rede de casa | Quase todos |
| **B. Ponto por celular (hotspot local)** | Um celular velho na tomada criando a própria rede "Piu · <nome>" (`LocalOnlyHotspot` do Android, sem internet) | Qualquer Android 8+, ~5–10 aparelhos |
| **C. Roteador OpenWrt com Piu Node** | Roteador compatível com OpenWrt e memória suficiente para o Node.js (128 MB de RAM ou mais) | Parte dos modelos; ganha isolamento por firewall e malha entre vizinhos |

A forma A é a que atinge "qualquer pessoa com o roteador que já tem". A B não exige roteador nenhum. A C é para quem quer ir além.

### 1.6 Como garantir o isolamento da rede privada do dono?
Princípio: **a rede Piu nunca é a rede de casa.** Em ordem de segurança:
1. **Separação física** — roteador próprio do ponto, sem cabo para a rede de casa (forma A dedicada, ou B). Nada a configurar, nada a vazar.
2. **Rede de visitante** com isolamento visitante→rede principal ligado e visitante↔visitante liberado. Muitos modelos têm as duas
   opções separadas; alguns juntam as duas numa chave só (aí não serve: ou isola tudo, ou expõe a rede de casa). O assistente detecta.
3. **OpenWrt** — zona de firewall própria (VLAN), sem rota para a LAN principal, só as portas do Piu.

O teste do assistente roda **do lado da rede Piu** e confere: (a) aparelhos Piu se enxergam; (b) **não** alcança endereços típicos da
rede de casa nem a página de administração do roteador quando a separação está ligada; (c) há ou não internet. Se (b) falhar,
o ponto não é ativado, com explicação.

Além da rede:
- **Tudo cifrado de ponta a ponta** (já é): o dono do ponto, o guardião e o roteador não leem mensagens.
- **Senha do Wi-Fi de casa nunca é pedida nem compartilhada.** O QR do ponto carrega só a rede Piu (aberta ou com senha própria do ponto).
- **Guardião não expõe nada além do LNNP** naquela rede: o Desktop e o celular escutam só na interface da rede Piu, com os limites que a
  auditoria já colocou (handshakes por IP, discagens limitadas, tamanho máximo).
- **Identidade do ponto separada da pessoa:** chave própria do ponto, derivada com rótulo próprio, como a chave de operador do celular — não liga às conversas do dono.
- **Controle do dono:** ativar, pausar, encerrar a qualquer momento; encerrar apaga a chave do ponto e o que estiver guardado de terceiros.

### 1.7 Monetização sem incentivar tráfego falso
O roteador sozinho não tem chave nem software: **não consegue provar nada**, logo não pode ser pago diretamente. Quem prova é o
**guardião** (ou o Piu Node no roteador OpenWrt). A recompensa segue as regras já endurecidas (prova de entrega v2 + modo nó):

| Critério pedido | Como medir sem permitir fraude | Peso sugerido |
|---|---|---|
| Volume de mensagens retransmitidas | **Só entregas comprovadas** (prova v2 assinada pelo destino) que passaram pelo guardião | Principal |
| Dispositivos atendidos | Número de **destinos distintos** (pseudônimos) em entregas comprovadas, com teto — nunca "aparelhos conectados", que se forja | Pequeno |
| Disponibilidade | **Testemunhos cruzados**: outros nós registrados assinam "vi o ponto P na hora H"; teto por testemunha e por raiz, como os avais | Pequeno |
| Expansão de cobertura | Bônus quando o ponto liga **raízes de confiança diferentes** que não tinham outro caminho comprovado no período | Pequeno, depois de medir |
| Tempo de participação e qualidade | Antiguidade da caução + taxa de entrega/tempo de entrega das provas | Multiplicador limitado |

Antifraude herdado: caução + avais + teto por raiz + teto ≤ caução/4 por período (modo nó do celular). Um "ponto" que só encosta
celulares falsos uns nos outros não gera prova de destino real e não rende. Pontos sem guardião contam como **infraestrutura
voluntária** (aparecem no mapa da comunidade, sem pagamento).

### 1.8 Arquitetura recomendada

```
Camada 0  Direto            celular ↔ celular: Bluetooth / Nearby / Wi-Fi Direct   (sem mudança)
Camada 1  Rede local        LNNP sobre UDP/TCP em qualquer Wi-Fi: casa, ponto Piu, hotspot   (NOVO no celular)
Camada 2  Pontos            multiplicador (roteador comum) · guardião (celular/PC/Node guardando) · Piu Node no roteador
Camada 3  Espinha dorsal    malha OpenWrt 802.11s · enlaces ponto a ponto · LoRa (Super Node) · pessoas em movimento
Camada 4  Gateways          (opcional) quem tem internet publica transações e provas na Lunes
```

O celular escolhe sozinho: no ponto, usa a rede local (mais banda, entrega para muitos de uma vez); fora dele, Bluetooth/Nearby como
hoje; **no ponto e com Bluetooth ligado, faz a ponte entre os dois**. Nenhum servidor central: a descoberta é local e a confiança vem das
chaves.

## 2. Assistente "Criar ponto Piu" (celular e Desktop)

1. **Criar ponto Piu.**
2. **Rede:** escolher a rede Wi-Fi (ou "criar a rede neste celular" — forma B).
3. **Teste automático:** aparelhos se enxergam? Rede de casa está protegida? Tem internet? Quantos aparelhos cabem? → verde / amarelo com instrução / vermelho com alternativa.
4. **Nível de compartilhamento:**
   - *Multiplicador* — só a rede; este aparelho não guarda nada de terceiros;
   - *Guardião* — guarda e repassa (limite de espaço e dias, como o modo nó);
   - *Guardião + distribuição do app* — serve a página local com o APK e o SHA-256 (a mesma do envio por Wi-Fi Direct);
   - *Gateway* — se houver internet, publica transações e provas (desligado por padrão).
5. **Ativar.**
6. **QR do ponto:** QR de Wi-Fi padrão (a câmera de qualquer celular entende) + identificação do ponto; cartaz para imprimir.

**Painel:** atividade, aparelhos atendidos (contagem, sem identificar ninguém), mensagens guardadas e repassadas, entregas comprovadas,
espaço e dados usados, estado das recompensas (desligadas até o programa abrir), pausar / encerrar.

**Celular visitante:** o Piu reconhece redes "Piu · …" (ou o QR) e oferece entrar no ponto com um toque; ao sair do alcance, volta ao normal.

## 3. Detalhes técnicos que precisam de decisão ou teste

### 3.1 Transporte de rede local no celular
Módulo nativo Android (Kotlin) com UDP + TCP, o mesmo LNNP do Desktop (`lnnpLan.ts` como referência), integrado ao seletor de
transportes (`src/transport/select.ts`) como mais um meio, sem alterar Bluetooth/Nearby.

### 3.2 Descoberta em camadas
1. Anúncio UDP broadcast (o do Desktop, compatível).
2. mDNS/DNS-SD (`_piu._udp`, `NsdManager` no Android) — passa em redes que filtram broadcast mas deixam mDNS.
3. Varredura leve da sub-rede numa porta fixa, com limite de taxa — último recurso quando os dois acima são filtrados.
4. QR do ponto com o endereço do guardião (quando houver um fixo).

### 3.3 Riscos de segurança e mitigação
| Risco | Mitigação |
|---|---|
| Visitante malicioso varre ou ataca aparelhos na rede Piu | Rede Piu separada da casa; guardião só expõe LNNP; limites por IP; handshake autenticado |
| Inundação/DoS no ponto | Limites já aplicados (discagens, handshakes, tamanho, taxa por enlace); o ponto pode pausar sozinho |
| Ponto falso para observar quem passa | Mensagens cifradas e remetente selado; o ponto vê só que um aparelho Piu esteve ali (como hoje no Bluetooth) |
| Rastreamento de presença pelo ponto | Chaves de rede do dia (já giram); o painel mostra só contagens |
| Dono responsabilizado por uso da internet | Ponto sem internet por padrão; gateway é opt-in explícito |
| Rede aberta atraindo uso indevido | Sem internet não há o que usar além do Piu; opção de senha própria do ponto |

### 3.4 Plano de validação antes de codar (proposto)
1. **Matriz de roteadores reais:** TP-Link (Archer C6/C50/C20), Intelbras (Action/Twibi), Multilaser, Mercusys e roteadores de
   operadora (Huawei, ZTE, Nokia). Para cada um: isolamento de visitante, broadcast, mDNS, máximo de clientes, opção de visitante↔visitante.
2. **Prova de conceito:** dois celulares + Desktop num roteador sem internet, LNNP por UDP/TCP, medindo entrega, bateria e alcance.
3. **Hotspot local (forma B)** num Android antigo: quantos clientes, estabilidade 24 h na tomada.
4. **OpenWrt + 802.11s** em dois roteadores compatíveis com o Piu Node.

## 4. Fases sugeridas (depois da validação)

| Fase | Entrega | Telas |
|---|---|---|
| 1 | Transporte de rede local no celular + descoberta em camadas + teste de compatibilidade | Não (só ajustes de Rede já existentes) |
| 2 | Assistente "Criar ponto Piu" (A e B), níveis, QR, painel; entrar em ponto como visitante | Sim — desenhar antes |
| 3 | Página local de distribuição do app no guardião | Reaproveita a do Wi-Fi Direct |
| 4 | OpenWrt: zona de firewall, malha 802.11s entre vizinhos, painel do Piu Node | Painel do Node |
| 5 | Recompensas de ponto (testemunhos cruzados, cobertura) sobre a prova v2 | Painel do ponto |

## 5. O que não fazer
- Não pedir nem guardar a senha da rede de casa.
- Não ativar ponto quando o teste de isolamento falha.
- Não pagar por "aparelhos conectados" ou "tempo ligado" sem testemunho cruzado com teto.
- Não depender de servidor central para descoberta ou para funcionar.
