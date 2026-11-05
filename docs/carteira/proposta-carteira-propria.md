# Proposta: carteira própria no Piu (criar conta Lunes e assinar transferências no celular)

Pesquisa de 2026-11-04. Nada foi implementado no app. Scripts de prova em
`/private/tmp/claude-501/-Users-lucas/5f6a9b6d-8f6a-4098-b195-0e413cd094cf/scratchpad/wallet-spike/`
(`rpc.mjs`, `meta2.mjs`, `meta3.mjs`, `vec.mjs`, `alice.mjs`, `tx.mjs`, `validate.mjs`). Nenhuma transação foi enviada; a conta de teste é a mnemônica pública de desenvolvimento do Substrate, sem fundos.

Regras atendidas: 7.1 (chave/endereço próprios, separados das identidades), 7.2 (transação assinada no aparelho) e base para 7.3 (`docs/regras/mapa-regras-negocio.md:115-117`).

## 1. Parâmetros da Lunes Mainnet (confirmados ao vivo em `wss://ws.lunes.io`, 2026-11-04)

| Item | Valor | Fonte |
|---|---|---|
| Rede | `system_chain` = "Lunes Nigthly" (sic), nó `Lunes Nightly 4.0.0-dev-d6be0eed3b3` | `rpc.mjs` |
| `system_properties` | `ss58Format: 57`, `tokenDecimals: 8`, `tokenSymbol: LUNES` | idem |
| `chain_getRuntimeVersion` | `specName: lunes-nightly`, **specVersion 107**, **transactionVersion 2**, stateVersion 2 | idem |
| Genesis hash | `0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac` | `chain_getBlockHash(0)` |
| Metadata | **v14**, 279 237 bytes, extrinsic **v4** | `state_getMetadata` |
| Tipo de chave | `MultiSignature` com Ed25519(0), **Sr25519(1)**, Ecdsa(2) — os três são aceitos; `MultiAddress` com `Id(0)` = chave pública de 32 bytes | `meta2.mjs` |
| Signed extensions (ordem exata) | CheckNonZeroSender, CheckSpecVersion, CheckTxVersion, CheckGenesis, **CheckMortality**, **CheckNonce**, CheckWeight, **RestrictAssetMint** (custom da Lunes, struct vazio: 0 bytes), **ChargeTransactionPayment** (compact tip). **Não há** CheckMetadataHash nem AssetTxPayment | `meta2.mjs`, `meta3.mjs` |
| Bytes do `extra` | `era ‖ compact(nonce) ‖ compact(tip)`; `additional` = `u32 specVersion ‖ u32 txVersion ‖ genesis ‖ blockHash da era` | idem |
| Transferência | Pallet **Balances = índice 4**; chamadas `0 transfer`, `3 transfer_keep_alive(dest: MultiAddress, value: compact u128)`, `4 transfer_all`. Runtime antigo: **não existe `transferAllowDeath`** (é `transfer`) | `meta2.mjs` |
| Existential deposit | **500 planck** (0,000005 LUNES) — bate com `LUNES_EXISTENTIAL_DEPOSIT` em `apps/mobile/src/lib/lunesRpc.ts:31` | constante `Balances.ExistentialDeposit` |
| Taxa | `transfer_keep_alive` assinado (144 bytes): `payment_queryInfo.partialFee = 144000 planck` = **0,00144 LUNES**; `payment_queryFeeDetails`: baseFee 0, weightFee 0, só `lenFee` (1 000 planck/byte, como `EXPECTED.byteFee` em `apps/settlement/src/chain.ts:57`) | `tx.mjs` |
| Pallets úteis | 8 Utility (batch), 26 Assets, 24 Contracts | `meta2.mjs` |

Observação: o prefixo 57 vem do `system_properties`; o explorador exibe 42. O app já aceita os dois (`src/lib/ss58.ts:15-17`). Não confirmado: política de atualização do runtime (quem avisa quando `specVersion` muda) — o app deve ler `chain_getRuntimeVersion` antes de cada assinatura e nunca fixar 107/2 no código.

## 2. Biblioteca de assinatura e codificação viáveis no Hermes

**Recomendação: `@scure/sr25519` 2.4.0 + SCALE escrito à mão (~150 linhas).**

- `@scure/sr25519` (paulmillr): JS puro, só `@noble/curves` 2.4.0 e `@noble/hashes` 2.4.0 — **exatamente as versões já no app** (`apps/mobile/package.json:10-11`); 28 KB de código (74 KB empacotado), zero WebAssembly (única menção é um comentário). Usa BigInt via noble, igual ao `ed25519` que o app já roda no Hermes (`src/protocol/suite.ts`). Último publish 2026-08-29. Maturidade: auditoria **autodeclarada** ("self-audited" em 2.2.0, abr/2026) — não é auditoria independente; **marcar como risco** e mitigar com vetores cruzados contra `@polkadot/util-crypto` (feito no spike) e limites de valor.
- Provas (`vec.mjs`, `alice.mjs`, `tx.mjs`, `validate.mjs`): mini-secret substrate-bip39 e chave pública sr25519 **idênticos** aos de `@polkadot/util-crypto` 14.0.3; derivação dura `//Alice` reproduz `0xd43593c7…da27d` (vetor canônico do Substrate); assinatura verificada por `sr25519Verify` do polkadot; extrinsic montado à mão decodificado por `@polkadot/types` 16.5.6 como `balances.transferKeepAlive`; e o próprio runtime da Lunes validou via `state_call TaggedTransactionQueue_validate_transaction`: assinatura correta → `0x010001` (**Invalid::Payment**, só faltou saldo); assinatura corrompida → `0x010004` (**BadProof**). Ou seja, bytes e assinatura são aceitos pelo nó real, sem enviar nada.
- Alternativas descartadas: `@polkadot/util-crypto` (7,8 MB; sr25519 exige WASM ou fallback asm.js de 1,6 MB, pesado e lento no Hermes); `@polkadot/types` (8,6 MB, pensado para Node/browser); `@noble/curves` ed25519 puro funcionaria (a Lunes aceita Ed25519), mas a conta não seria importável em Polkadot.js/SubWallet, que derivam sr25519 por padrão; `@polkadot-api/substrate-bindings` 0.21.2 (440 KB) é razoável para SCALE, mas desnecessário para uma chamada fixa. Não confirmado: comportamento de `polkadot-api` completo no Hermes (não testado).
- Codificação mínima: compact u128, era mortal (período 64, como `apps/settlement/src/polkadot.ts:26`), payload = `call ‖ extra ‖ additional` (blake2b-256 se > 256 bytes), extrinsic = `compact(len) ‖ 0x84 ‖ MultiAddress::Id(pk) ‖ 0x01 ‖ sig ‖ extra ‖ call`. Já existem no app `blake2b`, `twox128`, `decodeSs58` e o cliente WS com failover (`lunesRpc.ts`); faltam `encodeSs58` (há em `ss58.ts:76`), `system_accountNextIndex`, `payment_queryInfo`, `author_submitExtrinsic` e `chain_getBlock`/`state_getStorage` para confirmar inclusão.

## 3. Derivação da chave

| Opção | Como | Importável em outras carteiras | Separação REQ §11.1 |
|---|---|---|---|
| (a) substrate-bip39 padrão | `mini = PBKDF2-HMAC-SHA512(entropia BIP39, "mnemonic", 2048)[0..32]` → `sr25519.secretFromSeed` | **Sim**: mesma frase de 12 palavras importada em Polkadot.js/SubWallet/Talisman dá o mesmo endereço (provado em `vec.mjs`) | A chave da carteira sai de um KDF diferente (`PBKDF2`) do da identidade (`HKDF(entropia, "piu/v0/root", "phrase/seed")` em `src/protocol/phrase.ts:26`): mesmas 12 palavras, chaves criptograficamente independentes. Separação lógica cumprida |
| (b) `deriveWalletSeed` (`src/protocol/keys.ts:54`) | `HKDF(seedPiu, root, "wallet/0/seed")` → sr25519 | **Não**: ninguém fora do Piu reproduz | Idem, mas sem interoperabilidade |
| (c) derivação dura `//piu` sobre (a) | `HDKD.secretHard(mini, SCALE("piu"))` | Sim, se a pessoa digitar `frase//piu` na outra carteira (suportado por Polkadot.js) | Idem |

**Recomendo (a)**: uma frase, duas árvores de chaves independentes, conta exportável. Custo: ~2 048 iterações PBKDF2-SHA512 (feito só ao derivar, cache em memória). A frase atual continua a mesma, logo o backup existente (`backup.tsx`, `backupFile.ts`) e a restauração (`restore.tsx`) **já cobrem a carteira** sem mudar o formato. Remover `deriveWalletSeed` ou renomear para evitar uso acidental. Aviso obrigatório no onboarding: "quem tem a frase tem as conversas **e** o dinheiro".

## 4. Segurança no aparelho

- Hoje: frase no Keychain/Keystore (`src/lib/vault.ts`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, fora de backup em nuvem); dados do app cifrados em AES-256-GCM com chave no cofre (`src/lib/persist.ts`); biometria disponível em `src/lib/deviceAuth.ts` (`expo-local-authentication` 58). Web não tem cofre (`vaultIsSecure=false`) → **carteira desabilitada na web**.
- Proposta: não guardar a chave sr25519 derivada em disco; derivar da frase no momento de assinar e zerar (`fill(0)`) após o uso. Guardar no `persist` só o endereço público e o cache de nonce/saldo. Cada assinatura exige `confirmDevice()` (biometria ou PIN); se `unavailable`, exigir que a pessoa crie um bloqueio antes de habilitar envios. Limite diário configurável (padrão sugerido 100 LUNES) e teto absoluto por operação sem segunda confirmação; valor + taxa + destino mostrados em LUNES e planck; recusar envio que leve o saldo abaixo do ED (usar sempre `transfer_keep_alive`). Mostrar hash e link do explorador (`LUNES_EXPLORER`).
- Nonce: ler `system_accountNextIndex` antes de assinar; guardar a transação assinada localmente até confirmar inclusão (reenviar os mesmos bytes é seguro, como já faz `apps/settlement`). Era de 64 blocos (~6,4 min): offline, a transação expira — para 7.3 (pagamento sem internet via malha) será preciso era maior ou imortal, decisão separada.
- Backup/restauração: nada muda no arquivo `.piu`; adicionar no restore a tela "sua carteira voltou: endereço X" e, no backup, a frase de aviso sobre fundos. Não confirmado: se o Keystore Android de todos os aparelhos-alvo garante StrongBox; tratar como "melhor esforço".

## 5. Plano em etapas pequenas (cada uma com teste `node:test`, como o resto do app)

1. **Vetores e derivação** (lib pura, sem UI): `walletKey.ts` com substrate-bip39 → sr25519 → SS58(57). Testes: mnemônica dev → mini `0xfac7959d…479e`, pub `0x46ebddef…b47a`, endereço 57 `6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse`, endereço 42 `5DfhGyQd…qRzV`; `//Alice` → `0xd43593c7…da27d`. Verificar que o endereço gerado difere de `identityId`.
2. **SCALE e payload**: `extrinsic.ts` (compact, era mortal, payload, extrinsic v4). Teste: bytes idênticos aos de `@polkadot/types` para o mesmo call/extra (fixture gravada do spike: payload 115 bytes, extrinsic 144 bytes), decodificação do próprio call.
3. **RPC de escrita em `lunesRpc.ts`**: `accountNextIndex`, `paymentQueryInfo`, `validateTransaction` (state_call, para testes sem gastar), `submitExtrinsic`, `findInBlock`. Testes com WS falso (padrão já existente em `__tests__`).
4. **Estado e tela**: substituir endereço fixo (`data/wallet.ts:6`) pelo derivado; QR real em `WalletSheets.tsx`; sheet Enviar com destino SS58 validado (`decodeSs58`), taxa estimada, biometria, resultado com hash. Atualizar textos das regras 7.1/7.2.
5. **Mainnet pelo dono, valores pequenos**: (i) enviar 0,01 LUNES de uma carteira existente ao endereço gerado pelo Piu e ver o saldo chegar; (ii) do Piu, `validateTransaction` deve dar `Ok` antes de enviar; (iii) enviar 0,001 LUNES de volta, conferir no explorador taxa 0,00144 e inclusão; (iv) importar a frase do Piu no Polkadot.js e confirmar mesmo endereço; (v) restaurar o backup em outro aparelho e repetir (iii).

Tamanho estimado no bundle: `@scure/sr25519` ~28 KB + `@scure/base` (base58, já transitivo de `@scure/bip39`) + ~5 KB de SCALE/RPC próprios; sem WASM, sem novas dependências nativas. Risco principal: ausência de auditoria independente do `@scure/sr25519` e runtime antigo da Lunes (metadata v14, sem `transferAllowDeath`) — qualquer upgrade do runtime exige repetir a etapa 2 contra a nova metadata.
