<p align="center">
  <img src="design/brand/icon-1024.png" width="120" alt="Logo do piu.">
  &nbsp;&nbsp;
  <img src="design/brand/icon-light-1024.png" width="120" alt="Logo do piu.">
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6_%C2%B7_7-3178C6?logo=typescript&logoColor=white"></a>
  <a href="https://reactnative.dev/"><img alt="React Native" src="https://img.shields.io/badge/React_Native-0.88-61DAFB?logo=react&logoColor=white"></a>
  <a href="https://expo.dev/"><img alt="Expo" src="https://img.shields.io/badge/Expo-SDK_58-000020?logo=expo&logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"></a>
  <a href="https://vite.dev/"><img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white"></a>
  <a href="https://nodejs.org/"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-20.19_%C2%B7_22-5FA04E?logo=nodedotjs&logoColor=white"></a>
  <a href="https://fastify.dev/"><img alt="Fastify" src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white"></a>
  <a href="https://www.electronjs.org/"><img alt="Electron" src="https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white"></a>
  <a href="https://astro.build/"><img alt="Astro" src="https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white"></a>
  <a href="https://openwrt.org/"><img alt="OpenWrt" src="https://img.shields.io/badge/OpenWrt-.ipk-00B5E2?logo=openwrt&logoColor=white"></a>
  <a href="https://polkadot.js.org/"><img alt="Substrate" src="https://img.shields.io/badge/Substrate-Lunes_Network-282828?logo=polkadot&logoColor=white"></a>
  <a href="https://www.bluetooth.com/"><img alt="Bluetooth LE" src="https://img.shields.io/badge/Bluetooth_LE-mesh-0082FC?logo=bluetooth&logoColor=white"></a>
  <a href="https://www.semtech.com/lora"><img alt="LoRa" src="https://img.shields.io/badge/LoRa-radio-1A1A1A?logo=semtech&logoColor=white"></a>
  <a href="https://paulmillr.com/noble/"><img alt="Crypto" src="https://img.shields.io/badge/Crypto-X25519_%C2%B7_Ed25519_%C2%B7_XChaCha20-222222?logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-AGPL--3.0-A42E2B?logo=gnu&logoColor=white"></a>
</p>

# piu.

[English](README.md) · **Português**

Mensageiro **descentralizado e offline-first** da Lunes Network. As mensagens viajam de aparelho em aparelho (Bluetooth LE, Wi-Fi Direct, Wi-Fi Mesh, LoRa, USB/Ethernet), sem internet nem servidor central, com criptografia ponta a ponta e store-and-forward.

**Leia o [Manifesto](MANIFESTO.md)** ([English](MANIFESTO.en.md)): liberdade, segurança e independência na internet.

## Baixar

**Android** (7 ou superior, celulares de 64 bits, `arm64-v8a`):

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22net.piu.app%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2FMagnopiro-oficial%2Fpiu.%22%2C%22author%22%3A%22Magnopiro-oficial%22%2C%22name%22%3A%22Piu%22%2C%22additionalSettings%22%3A%22%7B%5C%22includePrereleases%5C%22%3Afalse%2C%5C%22fallbackToOlderReleases%5C%22%3Atrue%2C%5C%22filterReleaseTitlesByRegEx%5C%22%3A%5C%22Android%5C%22%2C%5C%22sortMethodChoice%5C%22%3A%5C%22date%5C%22%2C%5C%22apkFilterRegEx%5C%22%3A%5C%22%5EPiu-%5B0-9%5D%2B%5C%5C%5C%5C.%5B0-9%5D%2B%5C%5C%5C%5C.%5B0-9%5D%2B%5C%5C%5C%5C.apk%24%5C%22%2C%5C%22allowedSigningCertHashes%5C%22%3A%5C%2259%3A5B%3ADC%3A6A%3A2D%3A57%3A4F%3AEC%3A59%3AF0%3AF7%3A81%3AEB%3A9D%3A8D%3A47%3A9A%3A84%3AF4%3A90%3A7D%3A70%3A40%3A5F%3A83%3AB4%3AB1%3AE5%3A78%3AB7%3AFF%3A31%5C%22%7D%22%7D"><img src="apps/site/public/badge-obtainium.png" alt="Baixar pelo Obtainium" height="48"></a>

- **APK:** `Piu-X.Y.Z.apk` nos [releases `android-v*`](https://github.com/Magnopiro-oficial/piu./releases?q=android&expanded=true). Cada release traz o SHA-256 do arquivo.
- **Obtainium:** o selo acima adiciona o Piu já configurado: ele só acompanha os releases `android-v*` e o arquivo `Piu-X.Y.Z.apk` (nunca os pacotes do Desktop, do Node ou do Provider, que ficam no mesmo repositório) e só instala APK assinado com o certificado oficial. Sem o Obtainium instalado, o link mostra onde baixá-lo.
- **De um amigo:** quem já tem o Piu envia o app por Bluetooth ou Wi-Fi Direct, sem internet.

Certificado de assinatura (SHA-256), o mesmo em todos os canais: `59:5B:DC:6A:2D:57:4F:EC:59:F0:F7:81:EB:9D:8D:47:9A:84:F4:90:7D:70:40:5F:83:B4:B1:E5:78:B7:FF:31`. Confira com `apksigner verify --print-certs Piu-X.Y.Z.apk`.

## Estrutura

Cada pasta em `apps/` é um projeto independente: tem o próprio `package.json`, `package-lock.json`, README e CI (que só roda quando a pasta muda). Instale e rode cada um dentro da sua pasta. A única ligação é o site, que embute o build do painel.

| Pasta | Conteúdo |
|---|---|
| [`apps/provider-panel`](apps/provider-panel) | Painel local do provider (Vite + React + TypeScript), servido pelo `piu-node` em `piu-node.local:8420` |
| [`apps/site`](apps/site) | Site do projeto em PT e EN (Astro), com o painel embutido |
| [`apps/mobile`](apps/mobile) | App Piu para Android e iOS (Expo + React Native), em construção por etapas |
| [`design/brand/`](design/brand) | Identidade do piu.: ícone (claro e escuro), marca, favicons e manifest web |
| [`design/`](design) | Protótipos de referência em HTML (Claude Design): app mobile, painel do provider e site em PT/EN |
| [`docs/design-spec.md`](docs/design-spec.md) | Especificação de design: tokens, tipografia, movimento, telas e regras de produto |
| [`docs/requisitos/`](docs/requisitos) | Documento de requisitos da Lunes Network (IDs FUN, INF e NFR) |
| [`docs/historico-do-design.md`](docs/historico-do-design.md) | Conversa de design com as decisões tomadas |
| [`docs/seguranca/`](docs/seguranca) | Auditoria interna, [pacote para a auditoria independente](docs/seguranca/pacote-auditoria.md) e [guia da chave de release](docs/seguranca/chave-de-release.md) |
| [`docs/economia/`](docs/economia) | [Proposta de modelo econômico](docs/economia/proposta-modelo-economico.md) da carteira LUNES (para decisão) |

## Painel do provider

```bash
cd apps/provider-panel
npm install
npm run dev      # http://localhost:8420
npm run build    # gera dist/
```

Detalhes em [`apps/provider-panel/README.md`](apps/provider-panel/README.md).

## Site

```bash
cd apps/site
npm install
npm run dev      # http://localhost:4321
```

Detalhes em [`apps/site/README.md`](apps/site/README.md).

## App mobile

```bash
cd apps/mobile
npm install
npm start        # Android, iOS ou web
```

Detalhes em [`apps/mobile/README.md`](apps/mobile/README.md).

## Protótipos

Abra qualquer `design/*.dc.html` no navegador (o `support.js` precisa estar na mesma pasta). O índice é `design/Piu.dc.html`. Eles são **referência visual**, não código de produção.

## Roadmap

- [x] Painel do provider para computador, com pareamento ao `piu-node`
- [x] Site do projeto (PT e EN)
- [x] App mobile: todas as telas do design (5 etapas), dados cifrados no aparelho, chaves reais e mensagens reais pelo protocolo
- [x] Protocolo de mensagens (protótipo v0) e auditoria interna de segurança
- [ ] Transporte nativo testado em celulares (Android ↔ Android, iPhone ↔ iPhone, depois Android ↔ iPhone)
- [ ] Grupos, arquivos e canais reais
- [ ] Auditoria de segurança independente ([pacote](docs/seguranca/pacote-auditoria.md))
- [ ] Modelo econômico decidido ([proposta](docs/economia/proposta-modelo-economico.md)), simulação de ataques e liquidação na Lunes Mainnet
- [ ] Chave de release gerada pela Lunes ([guia](docs/seguranca/chave-de-release.md))

## Licença

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Quem distribuir o Piu, ou oferecer uma versão modificada a outras pessoas pela rede (por exemplo, o painel do `piu-node`), precisa disponibilizar o código-fonte correspondente sob a mesma licença.
