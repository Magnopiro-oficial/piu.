/**
 * Vetores da carteira própria, cópia do essencial de apps/mobile/src/lib/__tests__/walletFixture.ts
 * (gerados fora do app e conferidos contra @polkadot/util-crypto 14.0.3 e @polkadot/types 16.5.6 com a
 * metadata v14 da Lunes Mainnet). Copiados aqui para o piu-node testar sozinho, sem o projeto Expo.
 *
 * A mnemônica é a de desenvolvimento pública do Substrate: NUNCA usar com fundos. Nada aqui vai à rede.
 */
export const DEV_MNEMONIC = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
export const DEV_PUB = '0x46ebddef8cd9bb167dc30878d7113b7e168e6f0646beffd77d69d39bad76b47a';
export const DEV_ADDR_57 = '6iUb9rXg2AiDh1Sq6uRzpqjSvgZ6NPayojzGM6zh33vZ4Gse';
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
export const VALUE = 100_000_000n; // 1 LUNES
export const RANDOM = '0x4242424242424242424242424242424242424242424242424242424242424242';
/** 144 bytes: compact(142) ‖ 0x84 ‖ Id(DEV_PUB) ‖ Sr25519(sig) ‖ extra ‖ transfer_keep_alive(Alice, 1 LUNES). */
export const EXTRINSIC = '0x3902840046ebddef8cd9bb167dc30878d7113b7e168e6f0646beffd77d69d39bad76b47a017eeb4f6013a2c2d607c737bdfd0e285f84c84bec32e5f52d28153772c5bb0673cd86a2f5272a5a42587d03545b698f33e093c06479417c4f0c265ab4dc3d208c75001c00040300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0284d717';
export const EXTRINSIC_HASH = '0x4e089f8f78ff3ca56c36be7ebb78fde9f2ad3e74ca811d24ec16ccf2341271d2';
