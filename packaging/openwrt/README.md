# piu-node para OpenWrt (.ipk)

Empacota o [`apps/piu-node`](../../apps/piu-node) (painel do provider por HTTPS e motor de retransmissão LNNP v1) como pacote do **opkg** para roteadores OpenWrt com **128 MB de RAM ou mais**, usando o `node` do feed oficial de pacotes como dependência.

O piu-node vira um único arquivo JS (esbuild), sem `node_modules` nem addons nativos, então o pacote é `Architecture: all`: o mesmo `.ipk` serve para qualquer arquitetura em que o pacote `node` exista.

| No roteador | O que é |
|---|---|
| `/usr/lib/piu-node/piu-node.mjs` | o piu-node inteiro num arquivo ESM (+ `piu-node.mjs.LEGAL.txt`, licenças das dependências) |
| `/usr/share/piu-node/panel/` | build do `apps/provider-panel` (somente leitura) |
| `/etc/init.d/piu-node` | init **procd**: respawn, usuário sem privilégios, `no_new_privs` |
| `/etc/config/piu-node` | config **UCI** (conffile: o opkg não sobrescreve suas mudanças) |
| `/etc/piu-node/` | dados (estado, certificado TLS, identidade do nó), criada no primeiro início com `0700` |
| `/lib/upgrade/keep.d/piu-node` | `/etc/piu-node/` entra no backup do `sysupgrade` |

## Requisitos

### Node.js 20.19 ou mais novo: atenção à versão do feed
O piu-node exige Node.js ≥ 20.19 (o mínimo das bibliotecas `@noble`). O CI roda o piu-node e este pacote em Node 20.19 e 22. Versão do pacote `node` no feed `packages` de cada série (lida no `lang/node/Makefile` de cada branch do repositório `openwrt/packages`, em novembro de 2026):

| OpenWrt | `node` no feed | Gerenciador | Este `.ipk` |
|---|---|---|---|
| 23.05 | 18.20.6 | opkg | instala, mas **não inicia** (Node antigo) |
| 24.10 | 20.20.2 | opkg | **instala e inicia** (série recomendada para o `.ipk`) |
| 25.12 | 22.23.4 | **apk** | não instala (`.ipk` é do opkg); use o `Makefile` no SDK 25.12, que gera `.apk` |

Ou seja: **use o OpenWrt 24.10 com o `.ipk`**, ou o 25.12 com o `.apk` gerado pelo `Makefile` no SDK. No 23.05, o pacote só sobe com um `node` ≥ 20.19 vindo de outro lugar. Quando o Node é antigo, o init script não inicia o serviço e registra no log, por exemplo: `precisa do Node.js 20.19 ou mais novo; instalado: v18.20.6`. O Node 20 foi testado no CI com o binário oficial x86_64; o do feed do OpenWrt (outro alvo, outras bibliotecas) ainda é **a confirmar no roteador**.

O `Depends: node` não tem versão de propósito: no 23.05 a versão do pacote é `v18.20.6`, e pela comparação do opkg o prefixo `v` passaria num `node (>= 20.19)`. A conferência fica no init script, que lê `node -v`.

### Arquiteturas
O `Makefile` do pacote `node` só permite compilar em alvos **com FPU** e arquitetura `i386`, `x86_64`, `arm` ou `aarch64` (24.10 e 25.12; o 23.05 também aceitava `mipsel`). Isso é o que o build permite; se os servidores do OpenWrt publicam o binário pronto para o **seu** alvo, **a confirmar no roteador**: `opkg update && opkg info node`.

### Memória e flash
- **RAM**: medido aqui (x86_64, Node 22.23 oficial), o processo ocupa cerca de **81 MiB** de RSS depois de subir e servir o painel, com `--max-old-space-size=48 --max-semi-space-size=1`; com `--lite-mode`, cerca de **72 MiB**. O Node vazio já ocupa uns 42 MiB. Num roteador de 128 MB, com o OpenWrt usando a sua parte, fica apertado: **128 MB é o mínimo; 256 MB é confortável**. O consumo no Node do OpenWrt (bibliotecas compartilhadas, outro alvo) é **a confirmar no roteador** (`top`, ou `cat /proc/$(pidof node)/status`).
- O teto dos envelopes guardados (`memory_mb`) vem em **16 MiB** na config (o padrão do piu-node, 256, não cabe). Os envelopes ficam em RAM nesta versão.
- **Flash**: o `.ipk` tem cerca de 6,1 MiB e instala 8,4 MiB (o painel é 5,9 MiB, dos quais 5,2 MiB são a fonte Material Symbols). Some o `node` e as dependências dele (`libstdcpp`, `libopenssl`, `zlib`, `libnghttp2`, `libcares`, `libatomic`, ICU opcional): tamanho **a confirmar** com `opkg info`. Na prática, é para equipamento com flash folgada ou com [extroot](https://openwrt.org/docs/guide-user/additional-software/extroot_configuration).

## Gerar o pacote
Nesta pasta, com Node 20.19+ e npm:

```bash
npm run deps          # npm ci no apps/piu-node e no apps/provider-panel
npm run build:panel   # build do painel (apps/provider-panel/dist)
npm ci
npm run build         # dist/piu-node_<versão>-<release>_all.ipk
npm test              # gera de novo numa pasta temporária e confere tudo (abaixo)
```

A versão vem do `apps/piu-node/package.json` e o release do `PKG_RELEASE` do `Makefile`. O build é **reprodutível**: com o mesmo código e o mesmo `SOURCE_DATE_EPOCH` (padrão: data do último commit), o `.ipk` sai igual byte a byte. `PIU_PANEL_DIST` aponta outro build do painel; `PIU_IPK_OUT` e `PIU_IPK_BUILD` mudam as pastas de saída e de trabalho.

### Formato do .ipk
Igual ao do `scripts/ipkg-build` do OpenWrt, que gera os pacotes de downloads.openwrt.org: o `.ipk` é um **tar.gz** (não um arquivo `ar`, como o `.deb` e o opkg original) com `./debian-binary` (`2.0`), `./data.tar.gz` e `./control.tar.gz`, nessa ordem. Tars no formato GNU, dono `0:0`, nomes ordenados, gzip sem nome nem data. Conferido no código do opkg do OpenWrt (`opkg-lede`, `libbb/unarchive.c`, `deb_extract`): ele abre o pacote como gzip e procura `control.tar.gz` e `data.tar.gz` dentro do tar; um `.ipk` em `ar` não seria lido.

O `control` traz `Package`, `Version`, `Depends: node`, `License: AGPL-3.0-only`, `Section: net`, `Require-User`, `SourceDateEpoch`, `Maintainer: Lunes Network`, `Architecture: all`, `Installed-Size` e `Description`. O `postinst` e o `prerm` são os mesmos que o OpenWrt gera para qualquer pacote com init script (`include/package-pack.mk`): `default_postinst` cria o usuário pedido em `Require-User`, habilita e inicia o serviço (numa atualização, só inicia, sem mexer no `enable`); `default_prerm` para e desabilita.

## Instalar
O OpenWrt usa o dropbear, sem servidor SFTP: com OpenSSH 9 ou mais novo no computador, use `scp -O`.

```bash
scp -O dist/piu-node_0.1.0-1_all.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
opkg update
opkg install node                        # confira antes: node -v (precisa ser >= 20.19)
opkg install /tmp/piu-node_0.1.0-1_all.ipk
```

O serviço sobe sozinho. Para entrar no painel:

```bash
cat /etc/piu-node/pairing-code             # código de pareamento (só root e o usuário do serviço leem)
logread -e piu-node | grep -A1 'SHA-256'    # impressão digital do certificado
```

Abra `https://<IP do roteador>:8420` (o IP da interface `lan` entra sozinho na lista de nomes aceitos), confira a impressão digital do certificado e digite o código. O código vale 10 min; para um novo, `/etc/init.d/piu-node restart`.

O pacote não anuncia nenhum nome por mDNS, e `piu-node.local` saiu da lista padrão de nomes aceitos: use o IP. (O `umdns` do OpenWrt, quando instalado, anuncia o nome do próprio roteador, não `piu-node.local`; não foi testado com o pacote.)

Remover: `opkg remove piu-node`. A pasta `/etc/piu-node` (identidade do nó, certificado, operadores pareados) fica; apague à mão se quiser começar do zero.

## Configurar (UCI)
Cada opção vira uma variável de ambiente do piu-node ([lista completa](../../apps/piu-node/README.md#configuração)). Opção ausente ou vazia: vale o padrão do piu-node.

```bash
uci set piu-node.lnnp.memory_mb='32'
uci add_list piu-node.lnnp.peer='192.168.1.20:8422'
uci commit piu-node        # o procd reinicia o serviço (reload trigger)
```

| Seção.opção | Variável | Na config |
|---|---|---|
| `main.enabled` | (não inicia com `0`) | `1` |
| `main.user` | usuário do processo | `piu-node` |
| `main.data` | `PIU_NODE_DATA` | `/etc/piu-node` |
| `main.port`, `main.listen` | `PIU_NODE_PORT`, `PIU_NODE_LISTEN` | `8420`, `0.0.0.0` |
| `main.host` (lista) + `main.lan_host` | `PIU_NODE_HOSTS` | `localhost`, `127.0.0.1` + IP da `lan` |
| `main.release_pubkey` | `PIU_RELEASE_PUBKEY` | (comentada) |
| `main.heap_mb`, `main.node_args` | opções do `node` | `48`, `--max-semi-space-size=1` |
| `main.log_stdout` | stdout para o `logread` | `1` |
| `lnnp.enabled`, `lnnp.relay` | `PIU_LNNP`, `PIU_LNNP_RELAY` | `1`, `1` |
| `lnnp.listen`, `lnnp.port`, `lnnp.discovery_port` | `PIU_LNNP_LISTEN`, `PIU_LNNP_PORT`, `PIU_LNNP_DISCOVERY_PORT` | `0.0.0.0`, `8422`, `8423` |
| `lnnp.broadcast`, `lnnp.peer`, `lnnp.allow` (listas) | `PIU_LNNP_BROADCAST`, `PIU_LNNP_PEERS`, `PIU_LNNP_ALLOW` | `255.255.255.255`, —, — |
| `lnnp.memory_mb`, `lnnp.beacon_ms` | `PIU_LNNP_MEMORY_MB`, `PIU_LNNP_BEACON_MS` | `16`, `5000` |
| `serial.device` (lista) | `PIU_SERIAL` (`lora:/dev/ttyUSB0@115200`; experimental) | (seção comentada) |
| `lunes.endpoint` (lista) | `PIU_LUNES_ENDPOINTS` | os 4 de produção (seção comentada) |
| `serial.lora_sf`, `serial.lora_bw_khz`, `serial.lora_cr`, `serial.lora_duty`, `serial.max_envelope` | `PIU_LORA_SF`, `PIU_LORA_BW_KHZ`, `PIU_LORA_CR`, `PIU_LORA_DUTY`, `PIU_LORA_MAX_ENVELOPE` | (seção comentada) |

Listas aceitam `list` do UCI ou uma `option` com valores separados por vírgula.

Descoberta: com mais de uma rede no roteador (ex.: `lan` e uma rede só do Piu), acrescente o broadcast de cada sub-rede a `lnnp.broadcast` (ex.: `uci add_list piu-node.lnnp.broadcast='192.168.50.255'`). O broadcast da sub-rede sai pela interface certa; em teste com contêineres Linux, o anúncio para `255.255.255.255` não formou enlace e o da sub-rede formou (`docs/ajuda/ANALISE.md`, §3 item 7). Num roteador de verdade, a confirmar.

Rádio LoRa (seção `serial`, experimental): `option device 'lora:/dev/ttyUSB0@115200'` (o formato do `PIU_SERIAL`; o teste compila o `parseSerialSpec` do piu-node e confere o exemplo da config). Várias portas: uma `list device` por porta. Para uma variável nova: uma linha em `piu_env_map` no `files/piu-node.init` e a opção comentada em `files/piu-node.config`; o teste confere que toda variável lida em `apps/piu-node/src/config.ts` tem opção UCI e que toda opção da config é usada pelo init.

No Node 20 o init acrescenta `--experimental-websocket` (a leitura da Lunes Mainnet usa WebSocket); no Node 22 ele já vem ligado.

Com 128 MB de RAM, acrescente `--lite-mode` em `node_args` (menos memória; o JS fica mais lento).

## Logs
```bash
logread -e piu-node        # o que já saiu
logread -f -e piu-node     # acompanhando
/etc/init.d/piu-node status
```
O stdout e o stderr do processo vão para o syslog pelo procd (`log_stdout`). O log do syslog do OpenWrt fica em RAM por padrão.

## Escolhas
- **Usuário sem privilégios** (`piu-node`): criado pelo `default_postinst` a partir do `Require-User` (uid e gid livres a partir de 32768, conferido no `/lib/functions.sh` do 23.05 e do 24.10). O piu-node não precisa de root: as portas são altas e ele não mexe na rede do roteador. O usuário também entra no grupo `dialout`, dono das portas `/dev/tty*` no OpenWrt (`hotplug.json` do procd), para o adaptador serial/LoRa; o procd aplica os grupos extras com `initgroups()` (conferido no código atual do procd). Como o uid pode mudar numa reinstalação, o init faz `chown -R` da pasta de dados a cada início. `no_new_privs` ligado.
- **Dados em `/etc/piu-node`**, não em `/srv/piu-node` nem em `/tmp`:
  - `/tmp` é RAM: a cada reinício o nó perderia a identidade LNNP, o certificado TLS (impressão digital nova) e os operadores pareados.
  - `/srv` fica na mesma flash (overlay) que `/etc`, não existe por padrão no OpenWrt e **não** entra no backup do `sysupgrade`; `/etc/piu-node` entra (via `keep.d`).
  - Custo em flash: o estado (`state.json`, poucos KB) é regravado a cada requisição autenticada da API e a cada mudança de configuração, então há escritas pequenas enquanto o painel está aberto; com o painel fechado, quase nenhuma. Os envelopes ficam em RAM. Em uso intenso, aponte `main.data` para um pendrive.
- **Firewall**: nada é aberto pelo pacote. Na config padrão do OpenWrt a zona `lan` aceita entrada e a `wan` recusa, então 8420/TCP, 8422/TCP e 8423/UDP já ficam acessíveis só pela rede local. Não abra essas portas na `wan`.
- **Código de pareamento fora do `logread`**: sem terminal, o nó grava o código em `/etc/piu-node/pairing-code` (0600, do usuário `piu-node`) e o log diz só onde ler. Assim ele não vai para o log remoto (`system.@system[0].log_ip`) nem para quem só lê o syslog.
- **Certificado TLS**: gerado no primeiro início com os nomes de `PIU_NODE_HOSTS` (inclusive o IP da `lan`). Se o IP mudar, apague `/etc/piu-node/tls` e reinicie (a impressão digital muda).

## Feed/SDK do OpenWrt (Makefile)
O `Makefile` desta pasta é um pacote OpenWrt comum (`include $(TOPDIR)/rules.mk` … `$(eval $(call BuildPackage,piu-node))`), com os mesmos arquivos, usuário, dependência e conffiles do `.ipk`. Como o SDK não tem Node nem npm, o bundle e o painel são montados antes, no host:

```bash
npm run deps && npm run build:panel && npm ci
npm run stage                      # build/root/, o mesmo conteúdo do .ipk
# no SDK, com esta pasta num feed (ex.: src-link piu /caminho/do/repo/packaging):
./scripts/feeds update piu && ./scripts/feeds install piu-node
make package/piu-node/compile
```

## OpenWrt 25.12 e apk
Confirmado no repositório do OpenWrt: na branch `openwrt-25.12` o build usa **apk** por padrão (`CONFIG_USE_APK`, `default y` em `config/Config-build.in`); na `openwrt-24.10` o apk ainda está marcado como quebrado e o padrão é o opkg. Impacto:
- O `.ipk` deste script **não instala** no 25.12 nem nos snapshots: não há `opkg` lá.
- O `Makefile` serve sem mudanças: o mesmo `include/package-pack.mk` gera `.apk` quando `CONFIG_USE_APK` está ligado, e trata `USERID` (arquivo `.rusers`), conffiles e os scripts de instalação do lado do apk.
- O feed do 25.12 já tem `node` 22, então é a primeira série em que o pacote funciona só com o feed oficial.
- **A confirmar**: instalar um `.apk` local sem assinatura da sua chave provavelmente pede `apk add --allow-untrusted`; gerar `.apk` sem o SDK (como este script faz com o `.ipk`) fica para depois.

## Testes
`npm test` (também na CI, `.github/workflows/ci-openwrt.yml`, que publica o `.ipk` como artifact):
- gera o `.ipk` numa pasta temporária e confere que sai igual byte a byte a cada build;
- abre com o GNU tar (leitor independente do gerador): ordem e conteúdo do pacote externo, gzip, dono `0:0`, `control` (campos e coerência com o `Makefile` e o `package.json`), `Installed-Size`, `conffiles`, permissões (`init` 0755, config 0600, `postinst`/`prerm` 0755), que o painel é o build do provider-panel e que o bundle só importa módulos `node:*`;
- `sh -n` no init, no `postinst`, no `prerm` e na config UCI (que também é sh válido);
- roda o `start_service` do init com uma imitação do `rc.common`/procd (`test/openwrt-stub.sh`) e confere o comando, o usuário, o respawn e cada variável de ambiente gerada da config UCI, com listas, booleanos, a seção LoRa descomentada, Node antigo e serviço desligado;
- sobe o bundle empacotado com o Node local, com `PIU_NODE_DATA` numa pasta temporária e `PIU_NODE_PANEL` no painel empacotado: responde HTTPS com o certificado cuja impressão digital aparece no console, serve o `index.html` e os assets do painel, a API pede sessão (401), o motor LNNP sobe e a pasta de dados fica com `0700` (chave TLS `0600`).

### Só no roteador
- `opkg install` de verdade (aqui não há opkg: o formato foi conferido contra o código do opkg-lede e o ipkg-build), criação do usuário, `enable`/`start` pelo `default_postinst`.
- `rc.common` e procd reais: respawn, `no_new_privs`, stdout no `logread`, reload ao `uci commit`, IP da `lan` por `network_get_ipaddr`.
- Node ≥ 20.19 no alvo, memória real do processo e espaço em flash do `node`.
- Backup e restauração de `/etc/piu-node` pelo `sysupgrade`.
