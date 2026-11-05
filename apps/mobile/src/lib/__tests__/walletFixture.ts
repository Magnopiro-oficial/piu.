/**
 * Vetores da carteira própria (docs/carteira/proposta-carteira-propria.md, seção 5, etapas 1 e 2).
 *
 * Gerados por `scratchpad/wallet-spike/fixture.mjs` com valores FIXOS (sem rede) e conferidos contra
 * @polkadot/util-crypto 14.0.3 (`mnemonicToMiniSecret`, `sr25519PairFromSeed`, `encodeAddress`,
 * `sr25519Verify`) e @polkadot/types 16.5.6 com a metadata v14 da Lunes Mainnet (`ExtrinsicPayload`,
 * `ExtrinsicEra`, `Compact<u128>`, decodificação do `Extrinsic` como `balances.transferKeepAlive`).
 *
 * A mnemônica é a de desenvolvimento pública do Substrate: NUNCA usar com fundos.
 * A assinatura sr25519 é aleatória por natureza; para a fixture ser determinística, `random` é fixo.
 */
export const DEV_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
/** substrate-bip39: PBKDF2-HMAC-SHA512(entropia, "mnemonic", 2048)[0..32]. */
export const DEV_MINI = '0xfac7959dbfe72f052e5a0c3c8d6530f202b02fd8f9f5ca3580ec8deb7797479e';
export const DEV_PUB = '0x46ebddef8cd9bb167dc30878d7113b7e168e6f0646beffd77d69d39bad76b47a';
export const DEV_ADDR_57 = '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse';
export const DEV_ADDR_42 = '5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV';
/** `//Alice` (derivação dura sobre a mnemônica dev): vetor canônico do Substrate. */
export const ALICE_PUB = '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d';

/** Contexto de assinatura fixo (specVersion/txVersion e gênese são os da Mainnet em 2026-11-04). */
export const CTX = {
  specVersion: 107,
  transactionVersion: 2,
  genesisHash: '0xb9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac',
  blockHash: '0x3bf31d39e7c6f6e25e8374d62bdd4a28f428dd636f8ead24ba1a24c22abcb7de',
  blockNumber: 1234567,
  period: 64,
  nonce: 7,
  tip: 0n,
};
export const DEST = ALICE_PUB;
export const VALUE = 100_000_000n; // 1 LUNES

export const ERA = '0x7500';
export const CALL = '0x040300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0284d717';
export const EXTRA = '0x75001c00';
export const ADDITIONAL = '0x6b00000002000000b9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac3bf31d39e7c6f6e25e8374d62bdd4a28f428dd636f8ead24ba1a24c22abcb7de';
/** 115 bytes: call ‖ extra ‖ additional (menor que 256, então não é hasheado). */
export const PAYLOAD = '0x040300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0284d71775001c006b00000002000000b9926ab2c88b882cad89f1393fcf74ee90d40ef98ae99080b08289036c61efac3bf31d39e7c6f6e25e8374d62bdd4a28f428dd636f8ead24ba1a24c22abcb7de';
export const RANDOM = '0x4242424242424242424242424242424242424242424242424242424242424242';
export const SIG = '0x7eeb4f6013a2c2d607c737bdfd0e285f84c84bec32e5f52d28153772c5bb0673cd86a2f5272a5a42587d03545b698f33e093c06479417c4f0c265ab4dc3d208c';
/** 144 bytes: compact(142) ‖ 0x84 ‖ Id(pub) ‖ Sr25519(sig) ‖ extra ‖ call. */
export const EXTRINSIC = '0x3902840046ebddef8cd9bb167dc30878d7113b7e168e6f0646beffd77d69d39bad76b47a017eeb4f6013a2c2d607c737bdfd0e285f84c84bec32e5f52d28153772c5bb0673cd86a2f5272a5a42587d03545b698f33e093c06479417c4f0c265ab4dc3d208c75001c00040300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0284d717';
export const EXTRINSIC_HASH = '0x4e089f8f78ff3ca56c36be7ebb78fde9f2ad3e74ca811d24ec16ccf2341271d2';

/** Call de 304 bytes (system.remark com 300 bytes): o payload bruto tem 380 bytes e é hasheado (blake2b-256). */
export const BIG_CALL = '0x0000b104' + 'ab'.repeat(300);
export const BIG_PAYLOAD_HASH = '0xf42ed5ee0610f2bf7c790a5b4e3b8d1de1199bcd12d73244bf457977b67e718b';

/** [bloco atual, período pedido, era codificada pelo @polkadot/types]. */
export const ERAS: [number, number, string][] = [
  [0, 64, '0x0500'], [63, 64, '0xf503'], [64, 64, '0x0500'], [1234567, 64, '0x7500'], [1234567, 128, '0x7600'],
  [5, 4, '0x1100'], [100000, 65536, '0xaf86'], [777, 50, '0x9500'],
];
/** [valor, Compact<u128> pelo @polkadot/types]. */
export const COMPACTS: [string, string][] = [
  ['0', '0x00'], ['1', '0x04'], ['63', '0xfc'], ['64', '0x0101'], ['16383', '0xfdff'], ['16384', '0x02000100'],
  ['1073741823', '0xfeffffff'], ['1073741824', '0x0300000040'], ['100000000', '0x0284d717'],
  ['18446744073709551615', '0x13ffffffffffffffff'], ['340282366920938463463374607431768211455', '0x33ffffffffffffffffffffffffffffffff'],
];
