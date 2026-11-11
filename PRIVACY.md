# Piu privacy policy

[Português](PRIVACIDADE.md)

Text last updated: 2026-11-11.

Piu has no server, asks for no account and keeps your data nowhere but on your device. This page says what leaves it, to whom, and what limits the design has.

## Who is responsible
- **You are the one who keeps your data**, on your own device. The Piu project has no server: it does not receive, store or use your messages, your contacts, your keys or your recovery phrase.
- Piu has no account or sign-up, no telemetry and no ads. Communication is end-to-end encrypted.
- Privacy and security contact: lucasmagno.cardeal@gmail.com.
- Children and teenagers: Piu collects no data from anyone, including minors. The app has person-to-person chat and a cryptocurrency wallet.

## What stays on your device
- Chats, contacts, identities, keys and the wallet stay on your phone or computer, encrypted.
- No phone number or e-mail is required.
- On Android the app is excluded from system backup: uninstalling erases the data. On the computer (Piu Desktop), **uninstalling does not erase** the app data folder (`Piu`, inside your user's data folder), which holds the recovery phrase, the key and the history, encrypted by the system keychain. Before uninstalling, or before selling or lending the computer, use **Settings → Erase everything on this computer**.
- Without a backup you made yourself, nothing can be recovered.

## How to erase your data, and your rights
- **On the phone:** Profile → **Erase local data** (hold to confirm). Erases keys, chats and wallet from this device.
- **On the computer:** Settings → **Erase everything on this computer**.
- Piu has no server, so there is no copy on our side to correct, export or erase: you do it on your device. For questions and requests, use the contact above.
- **What cannot be erased:** wallet transactions are public and permanent on the Lunes blockchain. Encrypted messages already on other devices of the mesh expire on their own: each one is valid for up to 7 days, and relays keep third-party envelopes for up to 48 hours.

## What leaves your device
- **Messages and calls** travel end-to-end encrypted to nearby devices (Bluetooth, Wi-Fi Direct, local Wi-Fi, LoRa radio) and, through them, to their destination. Relays see neither sender nor content.
- **Lunes wallet**, when online: the app queries the public Lunes network nodes (`*.lunes.io`) and the `lunes-squid.lunes.io` indexer to show balance and history. The wallet address is sent to these services along with your IP, so whoever operates (or has the logs of) the Lunes infrastructure can link your IP to that address. This happens when you open the Wallet tab, when you pull to refresh, and when you create or check a payment request. You cannot choose another server.
- **Payment request checks:** the app queries the balance of the request's address on the same Lunes nodes.
- **Gateway mode (optional, off by default):** if you turn the device into a gateway (the bridge to the internet), it queries Lunes (finalized block height, every 60 seconds) and submits to the network already-signed transactions from third parties received over the mesh. On Piu Desktop, the gateway is an option of the guardian point; outside it, it only turns on through an advanced setting (`PIU_GATEWAY=1`).
- **New version alerts**, when online. The app checks the releases published on GitHub (`api.github.com`), which sees your IP:
  - **On the Android phone:** on by default. The check happens at most once a day. To turn it off: Settings → new version alerts. On iPhone there is no automatic check.
  - **On Piu Desktop:** on by default. The check happens every time you open Piu. To turn it off: Settings → System → new version alert. If you came from an old version with the "Ask" option, the alert stays off. The update is downloaded from GitHub only when you ask.
- **Piu Desktop internet test (guardian point):** with the gateway off, the Desktop contacts nothing outside your local network; it only checks, on the computer itself, whether there is an outbound route. When you turn the gateway on (or ask for the internet test), it opens and closes a connection to `1.1.1.1` (Cloudflare) and `9.9.9.9` (Quad9) on port 443, sending no Piu data. Those two services see your IP. The screen tells you this beforehand.
- **Local network test (Piu Desktop, guardian point):** opens and closes connections to common home router addresses (such as `192.168.0.1`), sending no data. This does not go out to the internet.
- **Links opened by tap in the browser:** the explorer `blockexplorer.lunes.io` and, for received locations, Apple Maps (iPhone) or OpenStreetMap (Android and others). The site opened sees your IP and the link's coordinates.

## What your contacts and relays receive
- **Your contacts** receive the name and photo of the identity you use with them. Your Lunes wallet address goes, encrypted, to your contacts together with your identity while "Share my Lunes address" is on in Privacy. On a new install this option is off: the address is only sent if you turn it on. If you already used Piu before this change, it stays on; turn it off to stop sending it.
- **Relaying:** your device keeps encrypted envelopes from other people for up to 48 hours to pass them on, and nearby devices do the same with yours. Each envelope has a header readable by relays: type (direct or group), whether it is media or live, priority, expiry, size and a delivery address that changes daily. On first contact, that address is computed from the recipient's public key. Once the conversation is established (you have already received a reply from the contact), it is computed from a secret only the two of you have.
- **Design limits (security has limits):**
  - A relay that knows someone's public key can compute that person's delivery address for the day and see when first-contact envelopes arrive for them, with time, size band and priority. In groups, messages of the same group can be linked and key changes noticed. Sender and content stay hidden. Size padding (Privacy) is on by default; turning it off exposes the real size more.
  - **Limited forward secrecy:** the first messages of a conversation, before the contact's first reply, and group messages do not have forward secrecy. Someone who recorded the traffic and later obtains the recipient's recovery phrase can read those messages. After the first round trip, conversations between two people have forward secrecy.
  - Your IP is visible to the device you connect to (local Wi-Fi, Wi-Fi Direct) and to the services listed above.

## Device permissions and what they are for
| Permission | What it is for |
|---|---|
| Camera | Reading QR codes (contact, payment, pairing) and taking your profile photo, if you want. |
| Microphone | Voice calls. |
| Notifications | Alerting you to messages and calls. Calls may appear full screen. |
| Bluetooth, Wi-Fi and local network | Finding nearby devices and talking to them (the system asks depending on the device version). |
| Biometrics | Unlocking the app, if you turn it on. |
| Photos and files | Sending and saving photos and documents you choose. |

The app also uses local identifiers to be found nearby: a service name on the local network (`piu-` plus part of a tag unrelated to your name) while local Wi-Fi is on.

## Google components on Android
- **Wi-Fi Direct** uses Nearby Connections, from Google Play Services. Turn Wi-Fi Direct off in the Network tab to avoid it.
- **QR scanning** uses Google ML Kit, which may send technical usage data to Google, under Google's terms.

## Third-party services
Lunes (nodes and indexer), GitHub, Cloudflare and Quad9 (Piu Desktop internet test), Google and, for links you open, Apple or OpenStreetMap process your IP under their own policies, and may be outside Brazil and the European Union.

## What Piu does not do
- No ads.
- No account, telemetry, analytics or tracking of its own.
- No selling or sharing of data: the project does not have your data.

## Changes to this policy
Changes are made in this file, with the date at the top. History is in the project repository.

## Contact
Privacy and security: lucasmagno.cardeal@gmail.com. General questions and problems: https://github.com/Magnopiro-oficial/piu./issues (public: do not post personal data there).
