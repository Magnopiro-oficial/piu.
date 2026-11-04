# piu-transport

Módulo nativo local (Expo Modules) para o transporte P2P do Piu: descobre aparelhos por perto e troca **envelopes** (bytes já cifrados pelo app), sem internet e sem servidor.

| Plataforma | Meios | Arquivos |
|---|---|---|
| Android | [Nearby Connections](https://developers.google.com/nearby/connections/overview) (`P2P_CLUSTER`: Bluetooth + Wi-Fi Direct) **e** Bluetooth LE GATT, ao mesmo tempo | `android/.../PiuTransportModule.kt`, `BleEngine.kt`, `BleFrames.kt`, `PiuRelayService.kt` |
| iPhone | Bluetooth LE GATT nos dois papéis (central e periférico) | `ios/PiuTransportModule.swift` |
| Web / Expo Go | sem módulo: o app usa o transporte simulado | `src/transport/simulated.ts` |

Com isso, **Android ↔ Android** conversam por Nearby e/ou BLE, e **Android ↔ iPhone** e **iPhone ↔ iPhone** por BLE.

> **Estado:** o código nativo (este módulo e `modules/piu-node-link`) foi escrito com base nas APIs oficiais e passou por uma **revisão estática** contra as fontes do `expo-modules-core` 58 instaladas em `node_modules` (DSL `Module`/`ModuleDefinition`, `AsyncFunction` com `Promise`, `sendEvent`, exceções), as assinaturas do Android (compileSdk 36/37 do RN 0.88) e do CoreBluetooth. Mesmo assim, **nunca foi compilado nem testado em aparelhos**: o ambiente onde foi escrito e revisado não tinha Android SDK, Kotlin nem Xcode, e sem rede não dava para baixar as dependências do Gradle/CocoaPods. O primeiro passo é gerar um development build (abaixo) e corrigir o que o compilador apontar. A lógica em TypeScript (seleção de meio, troca em caso de falha, blocos e remontagem) tem testes em `src/transport/__tests__`.

## API nativa (TypeScript)

O app não usa o módulo direto; usa `src/transport` (`getTransport()`), que junta os meios.

```ts
kind(): 'nearby' | 'ble'                       // meio principal (compatibilidade)
media?(): ('nearby' | 'ble')[]                 // Android: ['nearby', 'ble']; iPhone: ['ble']
start(name: string, serviceId: string): Promise<void>   // anuncia e procura em todos os meios
stop(): Promise<void>
send(peerId: string, base64: string): Promise<void>     // até 32 KB; primeiro meio que conhece o id
sendVia?(medium, peerId, base64): Promise<void>         // por um meio específico
setBackground?(on, title, text): Promise<void>          // Android: serviço em primeiro plano; iPhone: nada
setDiscoveryInterval?(seconds: number): void            // "Procurar vizinhos" (NFR-004): 60 / 20 / 5 s
// eventos: onState, onPeerFound, onPeerLost, onConnected, onDisconnected, onEnvelope — todos com `via`
```

`id` é o id do **enlace** dentro do meio (`via`): endpoint do Nearby, endereço Bluetooth (Android) ou UUID (iPhone). O estado `running` vale se ao menos um meio subiu; `unavailable` só se todos falharem (o motivo junta os dois).

## Seleção e troca de meio (FUN-013/014, INF-005) — `src/transport`

| arquivo | papel |
|---|---|
| `types.ts` | `Transport` declara `media: MediumCaps[]` (tamanho máximo, MTU, banda aproximada, custo de energia). Eventos `connected` e `envelope` ganharam `via?` opcional. Métodos opcionais `setPowerHint`, `setMediaEnabled`, `setBackgroundRelay`. |
| `select.ts` | `MEDIA` (características) e `rankLinks`: ordena os enlaces de um vizinho para cada envio. |
| `multi.ts` | junta enlaces de vários meios num **vizinho lógico** (pelo nome curto do nó) e faz o envio com troca de meio. |
| `frames.ts` | referência em TS dos blocos BLE (mesmo formato do Kotlin e do Swift) e da remontagem. |
| `power.ts` | bateria baixa (< 30 % fora da tomada, ou economia de energia do sistema) via `expo-battery`. |

Regras de `rankLinks`:

1. Só enlaces conectados, de meios ligados (`setMediaEnabled`) e que aceitam o tamanho do envelope.
2. **Bateria baixa** ou envelope **pequeno** (≤ 2 KB) → menor custo de energia primeiro (**BLE**).
3. Envelope **grande** → maior banda primeiro (**Nearby / Wi-Fi Direct**).
4. Enlace que falhou há pouco vai para o fim (15 s, dobrando a cada falha seguida, até 5 min).

Se o envio pelo primeiro falhar, tenta o próximo; se todos falharem, `send` rejeita (o mensageiro mantém na fila).

**Vizinho lógico:** o nome curto (`piu-xxxxxx`) viaja no anúncio do Nearby, no anúncio BLE e no bloco `hello`. O id público do vizinho passa a ser `n:<nome>` (ou `l:<meio>:<id>` enquanto o nome não chegou; quando chega, o vizinho provisório some e o enlace entra no vizinho certo). O nome **não é identidade** e pode colidir/ser imitado: quem confirma quem é quem são as chaves do Piu (LNNP), na camada de cima.

## Protocolo Bluetooth LE (comum às plataformas)

| | UUID |
|---|---|
| Serviço | `02999473-3C58-4C4C-A014-DDA62869CFCE` |
| `inbox` (central → periférico, escrita com resposta) | `7B41CD1F-85C3-400F-A6F9-5B89DD6B0915` |
| `outbox` (periférico → central, notificação; CCCD `0x2902`) | `E7D5F504-1483-497F-B64E-9DB52C4D3240` |

**Anúncio:** UUID do serviço no pacote principal. iPhone põe o nome do nó em *local name*; Android põe o nome (até 13 bytes) em *service data* do UUID do serviço, na resposta de varredura (o Android não deixa escolher o *local name*). Quem procura lê os dois.

**Blocos:** cada envelope é dividido em blocos de `min(MTU − 3, 512)` bytes. O Android pede MTU 517. Cada bloco tem um cabeçalho de 8 bytes (big-endian):

| bytes | campo |
|---|---|
| 0–3 | id da mensagem (`UInt32`, por remetente; **0 é reservado ao `hello`**) |
| 4–5 | índice do bloco (`UInt16`) |
| 6–7 | total de blocos (`UInt16`) |

**`hello` (novo):** bloco único com id 0 e o nome do nó em UTF-8 (até 64 bytes). Cada lado manda o seu logo que o enlace fica pronto (central: depois de ligar a notificação; periférico: quando a central se inscreve). Serve para o periférico saber quem conectou nele. Binários antigos sem `hello` entregariam esse bloco como envelope, que a camada de cima descarta por não decifrar.

**Remontagem** por `remetente + id`, com teto de memória: envelope até 32 KB (recusado cedo pelo tamanho dos blocos), no máximo 64 remontagens abertas (descarta a mais antiga), 60 s de prazo, total de blocos coerente.

**Android:** um único fio (`piu-ble`) guarda o estado; operações GATT em fila (uma por vez por conexão, prazo de 10 s); notificações uma por vez (`onNotificationSent`); até 6 conexões como central; nova tentativa no mesmo aparelho só após 10 s. Usa as APIs novas do Android 13 (`writeCharacteristic(ch, value, type)`, `notifyCharacteristicChanged(..., value)`) e as antigas abaixo disso.

## Segundo plano (NFR-009)

- **Android:** `PiuRelayService`, serviço em primeiro plano do tipo `connectedDevice`, com aviso fixo **"Piu retransmitindo mensagens"** (canal "Modo nó", importância baixa). Liga com `transport.setBackgroundRelay(true)` e desliga com `false` ou ao parar o transporte. O transporte continua no módulo; o serviço só mantém o processo vivo. `START_NOT_STICKY`: se o sistema matar o processo, não volta sozinho. Permissões no manifesto do módulo: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS` (pedida no Android 13+ ao ligar; se negada, o serviço roda sem aviso visível na gaveta).
- **iPhone:** só com o app aberto (sem `UIBackgroundModes`), por decisão de design — nunca prometer 24 h. `setBackground` não faz nada.

## Limitações conhecidas

1. **Não compilado** (ver acima). Pontos que merecem atenção na primeira compilação: assinaturas de `BluetoothGattCallback`/`BluetoothGattServerCallback` com `ByteArray?`, a fusão do manifesto com o do `play-services-nearby` (flags `neverForLocation`/`maxSdkVersion` das permissões), avisos de `Sendable` no Swift 6 (os pods usam `swift_version` 5.9, então devem ser só avisos) e a versão do `play-services-nearby`.
2. **Bluetooth ligado depois:** se o Bluetooth estiver desligado no `start`, o BLE fica fora até o transporte reiniciar (o Nearby segue). Falta ouvir `ACTION_STATE_CHANGED`.
3. **Enlaces duplicados:** dois aparelhos podem se conectar nos dois papéis ao mesmo tempo (dois enlaces BLE). A camada TS junta pelo nome; custa um pouco mais de bateria.
4. **Confiança:** as conexões são aceitas no transporte; a verificação de chaves do Piu (código de segurança) é que confirma quem é quem.
5. **Versão do Nearby:** `play-services-nearby:19.3.0`. Confira se há uma mais nova.
6. **Intervalo de descoberta (`setDiscoveryInterval`):** o Bluetooth LE varre 4 s a cada intervalo (Android e iPhone); o Nearby descobre 10 s a cada intervalo. Com intervalo curto (Rápida, 5 s) a varredura fica contínua, o que também evita o limite do Android de 5 inícios de varredura a cada 30 s. Enlaces já conectados não são afetados; o anúncio (advertising) continua ligado. No iPhone, o sistema limita a varredura em segundo plano de qualquer jeito.

## Como gerar o development build

O Expo Go não carrega módulos nativos próprios: é preciso um *development build*. Os módulos de `modules/` entram sozinhos pelo autolinking do Expo (pasta padrão `./modules`; cada um tem `expo-module.config.json`, `android/build.gradle` e `ios/*.podspec`). As pastas `ios/` e `android/` do app são geradas (estão no `.gitignore`); não edite à mão — configure em `app.json`.

Antes de tudo (uma vez), em `apps/mobile`:

1. Defina `ios.bundleIdentifier` e `android.package` em `app.json` (ex.: o domínio de vocês ao contrário). Sem isso o `prebuild` pergunta ou falha.
2. `npm install`

**Local (Mac com Xcode para o iPhone; Android Studio/SDK para o Android):**

```bash
npx expo prebuild --clean          # gera ios/ e android/ a partir do app.json (repita depois de mudar app.json ou modules/)
npx expo run:ios --device          # escolhe o iPhone conectado por cabo; assine com o seu time no Xcode se pedir
npx expo run:android               # aparelho com depuração USB ligada (ou --device para escolher)
```

O `run:*` compila o código nativo; os erros de Kotlin/Swift aparecem aqui (no iPhone, abra `ios/Piu.xcworkspace` no Xcode para ver os erros com contexto). Depois do primeiro build, `npx expo start` basta enquanto só o TypeScript mudar.

**Na nuvem (EAS):** há um `eas.json` com o perfil `development` (cliente de desenvolvimento, distribuição interna, APK no Android). Ele usa o `expo-dev-client`, que ainda não está nas dependências:

```bash
npx expo install expo-dev-client
npx eas-cli@latest login
npx eas-cli@latest init                # cria o projeto no EAS e grava o projectId no app.json (não inventamos um)
npx eas-cli@latest device:create       # iPhone: registra o aparelho para a distribuição interna (conta Apple Developer paga)
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile development --platform ios
npx expo start --dev-client            # depois de instalar o build no aparelho
```

## Checklist no aparelho

Precisa de **dois ou mais celulares** — de preferência dois Androids e um iPhone. Ferramentas úteis: nRF Connect (ver o serviço `02999473…`, as características e o MTU), `adb logcat -s PiuTransport` e o Console do macOS (filtrando pelo processo do app).

**Compilação e carga**

- [ ] `npx expo run:android` e `npx expo run:ios --device` terminam sem erro de compilação.
- [ ] O app usa o transporte nativo: na tela de diagnóstico (`src/app/diagnostics.tsx`), o cartão do transporte mostra "Nearby Connections · Bluetooth e Wi-Fi Direct" no Android e "Bluetooth LE" no iPhone. "Simulado · sem módulo nativo" quer dizer que o módulo não foi carregado (`requireOptionalNativeModule('PiuTransport')` devolveu `null`): confira se o build é mesmo o development build e se o `prebuild` rodou depois de mexer em `modules/`.

**Permissões**

- [ ] Android 13+: pede Bluetooth (procurar, anunciar, conectar) e dispositivos Wi-Fi por perto; **não** pede localização.
- [ ] Android 12: pede Bluetooth + localização precisa. Android ≤ 11: localização precisa.
- [ ] iPhone: aparece o texto de `NSBluetoothAlwaysUsageDescription` ao ligar o transporte.
- [ ] Negar a permissão: o estado fica `unavailable` com motivo, sem travar o app.

**Descoberta e conexão**

- [ ] Android ↔ Android: o vizinho aparece uma vez só (Nearby + BLE juntos) e conecta.
- [ ] Android ↔ iPhone: aparece por Bluetooth LE nos dois lados, com o nome curto do nó (`piu-…`), e conecta (`onConnected`).
- [ ] iPhone ↔ iPhone: idem.
- [ ] Bluetooth desligado no `start`: estado com o motivo "Bluetooth desligado." (no Android o Nearby pode seguir).

**Troca de envelopes**

- [ ] Mensagem curta nos dois sentidos em cada par (Android↔Android, Android↔iPhone, iPhone↔iPhone).
- [ ] Envelope grande (perto de 32 KB, ex.: foto pequena) Android ↔ iPhone nos dois sentidos: chega inteiro (testa a divisão em blocos pelo MTU e a remontagem).
- [ ] Troca de meio entre dois Androids: curta sai por BLE, grande por Nearby; desligando o Wi-Fi de um, o envio cai para o BLE.
- [ ] Afastar um aparelho até cair: aparece `onDisconnected`/`onPeerLost` e, ao voltar, reconecta (no Android, nova tentativa só depois de 10 s).
- [ ] "Procurar vizinhos" (Econômica/Normal/Rápida) muda o intervalo sem derrubar conexões abertas.

**Segundo plano (Android)**

- [ ] Com o Modo nó ligado, mande o app para o fundo: o aviso "Piu retransmitindo mensagens" aparece e as mensagens de um terceiro aparelho continuam passando.
- [ ] Desligue o Modo nó: o aviso some. Android 14+: o serviço sobe sem `SecurityException` no logcat (tipo `connectedDevice`).

**Piu Node (módulo `piu-node-link`)**

- [ ] Parear com um piu-node na mesma rede: no iPhone aparece o pedido de rede local (`NSLocalNetworkUsageDescription`); a requisição HTTPS funciona com a impressão digital certa.
- [ ] Com uma impressão digital errada, a requisição é recusada ("A impressão digital do certificado não confere.").
