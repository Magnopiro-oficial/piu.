/**
 * Conta pagadora dos lotes (tesouraria de recompensas). A chave NUNCA fica no código nem no diário:
 * - `PIU_SETTLEMENT_KEYSTORE` (JSON exportado pela extensão/app polkadot-js, cifrado) +
 *   `PIU_SETTLEMENT_PASSWORD_FILE` (arquivo com a senha, permissão 0600); ou
 * - `PIU_SETTLEMENT_SEED` (frase ou URI), só para testes e redes de desenvolvimento.
 * Quem guarda essa conta (custódia) é decisão de operação, fora deste código.
 */
import { readFileSync, statSync } from 'node:fs';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { EXPECTED } from './chain.js';

/** Arquivo de segredo legível por outros usuários: recusado (`chmod 600`). */
function privateFile(path: string) {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${path}: permissão aberta demais; use chmod 600.`);
}

/**
 * `genesisHash`: a rede em que a conta vai assinar. Na Lunes Mainnet a semente em texto claro
 * (`PIU_SETTLEMENT_SEED`) é recusada; só o keystore cifrado (auditoria final, B-07).
 */
export async function loadSigner(env = process.env, ss58 = 42, genesisHash: string = EXPECTED.genesisHash): Promise<KeyringPair> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: ss58 });
  if (env.PIU_SETTLEMENT_KEYSTORE) {
    const pwFile = env.PIU_SETTLEMENT_PASSWORD_FILE;
    if (!pwFile) throw new Error('PIU_SETTLEMENT_PASSWORD_FILE: informe o arquivo com a senha do keystore.');
    privateFile(pwFile);
    privateFile(env.PIU_SETTLEMENT_KEYSTORE);
    const pair = keyring.addFromJson(JSON.parse(readFileSync(env.PIU_SETTLEMENT_KEYSTORE, 'utf8')));
    pair.decodePkcs8(readFileSync(pwFile, 'utf8').trim());
    return pair;
  }
  if (env.PIU_SETTLEMENT_SEED) {
    if (genesisHash.toLowerCase() === EXPECTED.genesisHash) throw new Error('PIU_SETTLEMENT_SEED (semente em texto claro) não vale na Lunes Mainnet: use PIU_SETTLEMENT_KEYSTORE + PIU_SETTLEMENT_PASSWORD_FILE.');
    return keyring.addFromUri(env.PIU_SETTLEMENT_SEED.trim());
  }
  throw new Error('Sem conta pagadora: defina PIU_SETTLEMENT_KEYSTORE e PIU_SETTLEMENT_PASSWORD_FILE.');
}
