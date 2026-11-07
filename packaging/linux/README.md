# piu-node para Debian, Ubuntu e Raspberry Pi OS (.deb)

`piu-node_<versão>-<revisão>_all.deb`: o nó de referência do Piu (`apps/piu-node`) como serviço do systemd, com o painel do provider (`apps/provider-panel`).

## Por que `all` e não amd64/arm64

O programa é o **mesmo bundle JavaScript do `.ipk` do OpenWrt** (`packaging/openwrt/build-ipk.mjs --stage-only`): um arquivo ESM gerado pelo esbuild, sem `node_modules` e sem addon nativo (o teste confere que só há `import` de `node:*`). Nada no pacote depende da arquitetura; quem é por arquitetura é o Node.js do sistema. Por isso o pacote é `Architecture: all` com `Depends: nodejs (>= 20.19)`, como o `.ipk` (`Architecture: all`, `Depends: node`). Um `.deb` por arquitetura teria bytes idênticos com rótulos diferentes.

O mínimo 20.19 vem de `apps/piu-node/package.json` (`engines`; bibliotecas `@noble`).

| Sistema | `nodejs` no apt | O pacote instala? |
|---|---|---|
| Debian 13 (trixie), amd64 | 20.19.2 | sim (testado: `test/docker-e2e.sh`) |
| Debian 13 (trixie), arm64 (Raspberry Pi 64 bits) | 20.19.2 | instala e o bundle roda (emulado); o serviço falta conferir num Pi real ("Como foi provado") |
| Debian 12, Ubuntu 24.04, Raspberry Pi OS baseado no Debian 12 | 18.x | não com o Node do sistema: instale antes o Node.js 22 da NodeSource (pacote `nodejs` ≥ 22, satisfaz o `Depends`) |

Node instalado por `nvm` ou binário solto não satisfaz o `Depends` do dpkg; nesse caso rode a partir do código (abaixo).

## O que o pacote instala

| Caminho | O quê |
|---|---|
| `/usr/lib/piu-node/piu-node.mjs` (+ `.LEGAL.txt`) | o bundle do piu-node |
| `/usr/lib/piu-node/piu-node-start` | lançador: confere o Node (≥ 20.19, senão sai com 78), liga `--experimental-websocket` no Node 20 e monta `PIU_NODE_HOSTS` se estiver vazio |
| `/usr/share/piu-node/panel/` | o painel (somente leitura) |
| `/usr/lib/systemd/system/piu-node.service` | a unidade (endurecida, abaixo) |
| `/usr/lib/sysusers.d/piu-node.conf` | usuário `piu-node` (sem login), no grupo `dialout` |
| `/etc/default/piu-node` | variáveis `PIU_*` (conffile: atualização não sobrescreve o que você mudou) |
| `/var/lib/piu-node/` (criada) | estado, certificado TLS, identidade do nó, `pairing-code`; 0700, do usuário `piu-node` |

## Instalar e parear

```bash
node -v                                   # precisa ser >= 20.19
sudo apt install ./piu-node_0.1.0-1_all.deb
systemctl status piu-node
sudo cat /var/lib/piu-node/pairing-code   # código de 8 dígitos, 10 min, uso único (arquivo 0600)
journalctl -u piu-node | grep -A1 'SHA-256'   # impressão digital do certificado
```

Abra `https://<IP do computador>:8420`, confira a impressão digital e digite o código. Sem `PIU_NODE_HOSTS` em `/etc/default/piu-node`, o lançador aceita `localhost`, `127.0.0.1`, `<nome>.local` e os IPs de `hostname -I` na hora de subir (`<nome>.local` só abre se o sistema anunciar por mDNS, como o `avahi-daemon` do Raspberry Pi OS). Código vencido: `sudo systemctl restart piu-node`.

Ajustes: edite `/etc/default/piu-node` e `sudo systemctl restart piu-node`. Libere no firewall só para a rede local: 8420/TCP (painel), 8422/TCP (enlace LNNP), 8423/UDP (descoberta).

Remover: `sudo apt remove piu-node` (o serviço sai; `/var/lib/piu-node` fica). `sudo apt purge piu-node` apaga também `/var/lib/piu-node` (identidade do nó, operadores pareados). O usuário `piu-node` fica, como manda a política do Debian.

## Endurecimento da unidade

Usuário próprio (`User=piu-node`), `NoNewPrivileges`, sem capacidades (`CapabilityBoundingSet=`), `ProtectSystem=strict` (só `/var/lib/piu-node` gravável, por `StateDirectory`), `ProtectHome`, `PrivateTmp`, `UMask=0077`, `ProtectKernel*`, `ProtectControlGroups`, `ProtectClock`, `ProtectHostname`, `ProtectProc=invisible`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK`, `RestrictNamespaces`, `RestrictRealtime`, `RestrictSUIDSGID`, `LockPersonality`, `RemoveIPC`, `SystemCallFilter=@system-service` sem `@privileged` e afins, `SystemCallArchitectures=native`.

De propósito, sem:
- `MemoryDenyWriteExecute`: o JIT do V8 precisa de memória gravável e executável;
- `PrivateDevices`: esconderia as portas do rádio. Em vez disso, `DevicePolicy=closed` com `DeviceAllow=char-ttyUSB rw` e `char-ttyACM rw` (LoRa/cabo USB, experimental).

`Restart=on-failure`: o reinício pelo painel sai com 75 e volta; `RestartPreventExitStatus=78` evita laço quando o Node é antigo. `systemd-analyze security piu-node.service` no Debian 13: **1.6 OK**.

## Gerar o pacote

Não precisa de `dpkg-deb`: `lib/deb.mjs` monta o `ar` (deb(5)) com os mesmos tars determinísticos do `.ipk`. Roda no macOS e no Linux, e sai igual byte a byte com o mesmo `SOURCE_DATE_EPOCH`.

```bash
cd packaging/linux
npm run deps && npm run build:panel   # uma vez: piu-node, painel e o empacotador do OpenWrt (esbuild)
npm run build                         # dist/piu-node_<versão>-<revisão>_all.deb
npm test                              # estrutura (ar + tar do sistema), control, md5sums, unidade, lançador, bundle subindo
sh test/docker-e2e.sh                 # instala num Debian 13 com systemd de verdade (precisa de Docker)
PIU_E2E_PLATFORM=linux/arm64 sh test/docker-e2e.sh   # o mesmo em arm64 (emulado no x86)
```

A versão é a de `apps/piu-node/package.json`; a revisão, `debRevision` em `package.json` desta pasta (suba quando só o empacotamento mudar). O release sai pelo workflow `release-node.yml` (tag `node-v<versão>`), junto com o `.ipk`.

## Rodar a partir do código (sem o pacote)

```bash
cd apps/provider-panel && npm ci && npm run build
cd ../piu-node && npm ci && npm run build
PIU_NODE_HOSTS=localhost,127.0.0.1,192.168.1.50 PIU_NODE_DATA=$HOME/.piu-node node dist/main.js
```

## Como foi provado

- `npm test` (macOS, sem dpkg-deb): 16 testes; o bloco do `dpkg-deb` é pulado e diz por quê. No CI (Ubuntu) ele roda.
- `test/docker-e2e.sh` em `debian:trixie` amd64 com systemd como PID 1: `apt install` resolve `nodejs (>= 20.19)` com o 20.19.2 do Debian; usuário `piu-node` criado pelo `systemd-sysusers`, no grupo `dialout`; serviço `enabled` e `active`, processo como `piu-node`; `/var/lib/piu-node` 0700 e `pairing-code` 0600 com 8 dígitos, que não aparece no journal; painel 200 e `/api/session` 401; `systemd-analyze verify` sem erro; volta depois de `SIGKILL`; `remove` mantém os dados, `purge` apaga.
- O mesmo script com `PIU_E2E_PLATFORM=linux/arm64` (Debian 13 arm64 emulado por qemu num Mac Intel): o `apt` instala com o `nodejs` 20.19.2 arm64 e cria o usuário; o bundle roda em aarch64 como `piu-node` (painel 200, código 0600). A unidade não subiu sob a emulação (`Result: resources`, antes de executar o programa, mesmo sem o filtro de syscalls), enquanto o mesmo `.deb` sobe no amd64 nativo: causa provável é o systemd sob qemu-user. Falta conferir num Raspberry Pi de verdade.
- `lintian` (Debian 13): avisos `maintainer-script-calls-systemctl` e dois erros de forma, `malformed-contact` e `no-changelog`, porque o projeto não tem e-mail publicado para o campo `Maintainer` (não inventamos um).
