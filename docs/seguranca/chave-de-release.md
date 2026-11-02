# Chave de release da Lunes: como gerar e guardar

A chave de release assina os **pacotes do instalador** (`piu-node` para OpenWrt, Linux, mini-PC). O `piu-node` só oferece um pacote quando o manifesto foi assinado por essa chave, e o equipamento novo confere a assinatura de novo antes de instalar. **Quem tem a chave privada consegue publicar software que todos os nós aceitam.** Por isso, ela é gerada e guardada pela Lunes, nunca por um agente, por um servidor de CI ou dentro do repositório.

> Esta chave **não** é a mesma que assina o app Android (APK/AAB) nem o certificado da Apple. Essas são outras chaves, geridas pela Play Console e pelo Apple Developer.

## 1. O que você precisa

- Um computador **sem rede** durante a geração (de preferência só para isso, ou iniciado por um Linux "live" num pendrive).
- Node.js 22 ou mais novo e a pasta `apps/piu-node` pronta. Rode `npm ci` nela num computador com internet e copie a pasta inteira (com `node_modules`) por pendrive. A criptografia usa só o `node:crypto` do próprio Node; as dependências servem para rodar o script em TypeScript.
- Dois pendrives novos para as cópias de reserva.
- `age` ou `gpg` para cifrar as cópias com uma senha forte (frase de 6 ou mais palavras aleatórias).
- Duas pessoas da Lunes presentes (princípio dos quatro olhos).

Se a Lunes tiver um **HSM** ou um cofre de chaves com suporte a Ed25519 (YubiHSM 2, Nitrokey HSM, AWS/GCP KMS), prefira gerar a chave lá dentro, sem que ela saia do equipamento. O script atual assina com um arquivo PEM; adaptar para HSM é um próximo passo (seção 6).

## 2. Gerar

No computador sem rede:

```bash
cd apps/piu-node
npm run release:keygen -- /caminho/seguro/release-keys
```

O comando cria:

| Arquivo | Conteúdo | Destino |
|---|---|---|
| `release-private.pem` | chave privada Ed25519 (permissão `0600`) | **só nas cópias cifradas** (seção 3) |
| `release-public.txt` | chave pública (SPKI DER em base64) | pode ser publicada |

Anote a chave pública e um resumo dela, em papel e no registro da cerimônia:

```bash
sha256sum release-keys/release-public.txt
```

## 3. Guardar

1. Cifre a privada com senha: `age -p -o release-private.pem.age release-private.pem`.
2. Grave o arquivo `.age` nos **dois pendrives** e confira que cada cópia abre (`age -d`).
3. Guarde os pendrives em **dois lugares físicos diferentes** (por exemplo, cofre da empresa e cofre bancário).
4. Guarde a senha **separada** dos pendrives: com duas pessoas, ou dividida (Shamir 2 de 3).
5. **Apague** a privada em claro do computador (`shred -u release-private.pem`) e desligue-o.
6. Registre numa ata: data, pessoas presentes, resumo da chave pública e onde estão as cópias.

**Nunca:** colocar a privada no Git, em secret de CI, em e-mail, em chat ou em nuvem sem cifra.

## 4. Publicar a chave pública

A chave pública é **fixada** no software, para que ninguém consiga trocá-la pelo caminho:

- `piu-node`: variável `PIU_RELEASE_PUBKEY` (ver o README do `piu-node`). Sem ela, nenhum pacote é oferecido.
- Instalador e `verify-package.mjs`: a mesma chave.
- App: a tela "Compartilhar o app" mostra a impressão digital da assinatura (hoje um valor de exemplo, `4C9A…E1F0`), que deve passar a mostrar o resumo real.
- Site: publique a chave e o resumo numa página de segurança, para conferência independente.

Mande a chave pública para a equipe de desenvolvimento por **dois canais diferentes** (por exemplo, o PR e uma mensagem assinada) e confira o resumo nos dois.

## 5. Assinar uma versão

Para cada versão, também no computador sem rede:

```bash
age -d -o /tmp/k.pem release-private.pem.age
npm run release:sign -- /tmp/k.pem piu-node_0.4.3_aarch64.ipk piu-node-openwrt 0.4.3
shred -u /tmp/k.pem
```

Leve o pacote e o `.manifest.json` de volta ao ambiente de publicação e confira com:

```bash
PIU_RELEASE_PUBKEY=<chave pública> node scripts/verify-package.mjs piu-node_0.4.3_aarch64.ipk piu-node_0.4.3_aarch64.ipk.manifest.json
```

Publique a versão só se a saída for `OK:`.

## 6. Plano para perda ou vazamento

| Situação | O que fazer |
|---|---|
| Perdeu uma cópia, a outra está boa | gere nova cópia a partir da boa; troque a senha se houver dúvida |
| Perdeu as duas | gere uma chave nova e publique uma versão (assinada pela nova) que troca `PIU_RELEASE_PUBKEY`; nós antigos precisam de atualização manual |
| Suspeita de vazamento | pare as publicações; gere uma chave nova; avise os providers; publique a lista de versões legítimas e a nova chave por todos os canais |

**Próximos passos técnicos (recomendados antes de produção):**

1. Aceitar **duas chaves** no `piu-node` (atual e próxima), para trocar de chave sem atualização manual.
2. Lista de **revogação** de versões assinada (o design já mostra "revogação · lista de 2 h").
3. Suporte a **HSM** no script de assinatura.
4. Exigir **duas assinaturas** (2 de 3 chaves) por versão, para que nenhuma pessoa sozinha consiga publicar.
