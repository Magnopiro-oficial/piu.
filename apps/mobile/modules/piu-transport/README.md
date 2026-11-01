# piu-transport

Módulo nativo local (Expo Modules) para o transporte P2P do Piu: descobre aparelhos por perto e troca **envelopes** (bytes já cifrados pelo app), sem internet e sem servidor.

| Plataforma | Implementação | Arquivo |
|---|---|---|
| Android | [Nearby Connections](https://developers.google.com/nearby/connections/overview), estratégia `P2P_CLUSTER` (Bluetooth, BLE e Wi-Fi Direct) | `android/src/main/java/expo/modules/piutransport/PiuTransportModule.kt` |
| iPhone | Bluetooth LE nos dois papéis (central e periférico) | `ios/PiuTransportModule.swift` |
| Web / Expo Go | sem módulo: o app usa o transporte simulado | `src/transport/simulated.ts` |

> **Estado:** o código nativo foi escrito, mas **ainda não foi compilado nem testado em aparelhos**. O ambiente onde foi escrito não tinha Android SDK nem Xcode. O primeiro passo é gerar um development build e corrigir o que o compilador apontar.

## API (TypeScript)

O app não usa o módulo direto; usa `src/transport` (`getTransport()`), que escolhe o nativo quando existe.

```ts
kind(): 'nearby' | 'ble'
start(name: string, serviceId: string): Promise<void>   // anuncia e procura
stop(): Promise<void>
send(peerId: string, base64: string): Promise<void>     // até 32 KB por envelope
// eventos: onState, onPeerFound, onPeerLost, onConnected, onDisconnected, onEnvelope
```

## Protocolo Bluetooth LE (comum às plataformas)

| | UUID |
|---|---|
| Serviço | `02999473-3C58-4C4C-A014-DDA62869CFCE` |
| `inbox` (central → periférico, escrita com resposta) | `7B41CD1F-85C3-400F-A6F9-5B89DD6B0915` |
| `outbox` (periférico → central, notificação) | `E7D5F504-1483-497F-B64E-9DB52C4D3240` |

Cada envelope é dividido em blocos do tamanho do MTU. Cada bloco tem um cabeçalho de 8 bytes (big-endian):

| bytes | campo |
|---|---|
| 0–3 | id da mensagem (`UInt32`, por remetente) |
| 4–5 | índice do bloco (`UInt16`) |
| 6–7 | total de blocos (`UInt16`) |

O receptor junta os blocos por `remetente + id` e entrega o envelope inteiro.

## Limitações conhecidas (próximos passos)

1. **Android ↔ iPhone:** hoje os Androids conversam entre si pelo Nearby Connections, e os iPhones entre si pelo Bluetooth LE. Para os dois se falarem, o Android precisa implementar o mesmo serviço BLE (UUIDs e blocos acima), ao lado do Nearby.
2. **Identidade do vizinho:** no iPhone, o mesmo aparelho pode aparecer com dois ids (um como central, outro como periférico). A deduplicação vem com a troca de chaves do protocolo LNNP, na camada de cima.
3. **Confiança:** as conexões são aceitas no transporte; quem confirma quem é quem é a verificação de chaves do Piu (código de segurança), não o Bluetooth.
4. **Segundo plano:** no iPhone, só com o app aberto (sem `UIBackgroundModes`), como o design promete. No Android, retransmitir em segundo plano exige um serviço em primeiro plano com aviso fixo (ainda não feito).
5. **Versão do Nearby:** `play-services-nearby:19.3.0`. Confira se há uma mais nova.

## Como testar em aparelhos

Precisa de um development build (o Expo Go não carrega módulos nativos próprios) e de **dois ou mais celulares**.

1. Defina `ios.bundleIdentifier` e `android.package` em `app.json`.
2. Android: `npx expo run:android --device` (com Android Studio/SDK instalado), ou `npx eas-cli@latest build --profile development --platform android`.
3. iPhone: `npx expo run:ios --device` (Mac com Xcode), ou EAS Build.
4. Abra o app nos dois aparelhos e conclua o onboarding. Em **Rede → Diagnóstico local → Transporte neste aparelho**, os dois devem aparecer como conectados.
