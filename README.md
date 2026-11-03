<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/icon-1024.png">
    <img src="design/brand/icon-light-1024.png" width="128" alt="piu. logo">
  </picture>
</p>

<h1 align="center">piu.</h1>

<p align="center">
  <strong>A decentralized, offline-first messenger. No servers. No permission. No surveillance.</strong>
</p>

<p align="center">
  <a href="MANIFESTO.en.md"><strong>Manifesto</strong></a> ·
  <a href="MANIFESTO.md">Manifesto (PT)</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="docs/lnnp/especificacao-v1.md">Protocol (LNNP)</a> ·
  <a href="LICENSE">AGPL-3.0</a>
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

---

**piu.** is a messenger where messages travel **from device to device**, end-to-end encrypted, with no central server and **no need for the internet**. Phones, routers and small computers form a mesh over Bluetooth LE, Wi-Fi Direct, local networks and radio, and each one carries encrypted envelopes a little further until they reach their destination (store-and-forward).

Nobody in the middle can read, filter or switch off a conversation, because there is no middle. Communication infrastructure should not depend on permission: it can be built by people themselves.

## Why

> We are entering a surveillance state that has already destroyed much of our privacy. Messages, contacts, location and habits have become a permanent record, collected by default and kept indefinitely. piu. is an answer to that.
>
> Privacy is not for committing crimes. It protects journalists and their sources, people facing violence, those living under authoritarian governments, anyone who simply wants to talk without being watched. Tools should not be punished because of bad users.
>
> — **Lucas Cardeal**, creator of piu. · read the full [**Manifesto**](MANIFESTO.en.md)

## Principles

1. **Communication is a right**, not a granted service.
2. **Privacy by default.** Your data stays on your device, encrypted. Minimal collection is the rule.
3. **No central point of control.** If one part of the mesh goes down, the rest keeps going.
4. **Independence from the internet.** A message finds its way even when the connection is cut.
5. **Verifiable security.** Open code, open protocol, open audits.
6. **The infrastructure belongs to those who build it.** People who share bandwidth, power and storage with the mesh are recognized for it.

## How it works

- **End-to-end encryption.** X25519 / Ed25519 identities, Double Ratchet sessions, sealed envelopes with padding: relays see neither sender, content nor group.
- **Mesh transport.** Bluetooth LE and Wi-Fi Direct between phones; LAN (Ethernet/Wi-Fi) and LoRa radio between nodes. The app picks the best link per message and falls back when one fails.
- **Store-and-forward.** Envelopes wait in the mesh for up to 48 h until a route appears. Duplicates and loops are dropped.
- **Two identities.** A public one for people you know and an anonymous one for strangers, with separate keys. No phone number, no e-mail.
- **Communities.** Groups, channels and communities, plus **community alerts** that any member can publish and the community itself classifies.
- **Providers.** Anyone can run a **piu-node** on a router, Raspberry Pi or computer to relay traffic for the mesh, with signed delivery receipts as proof of work.

## Repository

Each folder is an independent project with its own `package.json`, README and CI.

| Folder | What it is |
|---|---|
| [`apps/mobile`](apps/mobile) | piu. app for Android and iOS (Expo + React Native) |
| [`apps/piu-node`](apps/piu-node) | Relay node: LNNP mesh engine and the provider's local panel (Node.js + Fastify) |
| [`apps/provider-panel`](apps/provider-panel) | Provider dashboard (Vite + React), served by `piu-node` |
| [`apps/provider-desktop`](apps/provider-desktop) | Desktop app that runs a node on your computer (Electron) |
| [`apps/settlement`](apps/settlement) | Receipt validator and settlement on the Lunes Network |
| [`apps/site`](apps/site) | Project website in PT and EN (Astro) |
| [`packaging/openwrt`](packaging/openwrt) | `.ipk` package to run `piu-node` on OpenWrt routers |
| [`docs/lnnp`](docs/lnnp/especificacao-v1.md) | Network protocol specification (LNNP v1) |
| [`docs/seguranca`](docs/seguranca) | Internal security audit and package for an independent audit |
| [`design/`](design) · [`design/brand/`](design/brand) | Design prototypes and brand identity (icon, mark, favicons) |

## Quick start

```bash
# Mobile app (Android, iOS or web)
cd apps/mobile && npm install && npm start

# Relay node + provider panel (https://localhost:8420)
cd apps/piu-node && npm install && npm run dev
```

Native transports (Bluetooth LE, Wi-Fi Direct) need a development build: see [`apps/mobile/README.md`](apps/mobile/README.md). Device test plan: [`docs/testes/roteiro-aparelhos.md`](docs/testes/roteiro-aparelhos.md).

## Get involved

piu. moves forward with whoever joins:

- **Contribute** code, tests, docs, translations and design. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Fork it** and adapt it to your community or country.
- **Create and improve protocols:** new transports, extensions to LNNP, security improvements.
- **Run a node** and take the mesh where it does not reach yet.
- **Audit it.** Found a flaw? Report it so everyone is safer.

Any proposal is welcome **as long as it does not violate the principles of freedom and privacy**: no backdoors, no master keys, no data collection beyond the minimum, no central point of control, no identifying people without their consent.

## Status

Under active development. The app, the node, the mesh protocol and the provider panel work end to end in tests; native transports still need to be validated on real devices, and an independent security audit is pending. Do not rely on piu. for life-critical communication yet.

## License

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Anyone who distributes piu., or offers a modified version to others over a network (for example, the `piu-node` panel), must make the corresponding source code available under the same license.

<p align="center"><em>piu. · Communication belongs to those who talk.</em></p>
