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

export async function loadSigner(env = process.env, ss58 = 42): Promise<KeyringPair> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: ss58 });
  if (env.PIU_SETTLEMENT_KEYSTORE) {
    const pwFile = env.PIU_SETTLEMENT_PASSWORD_FILE;
    if (!pwFile) throw new Error('PIU_SETTLEMENT_PASSWORD_FILE: informe o arquivo com a senha do keystore.');
    if ((statSync(pwFile).mode & 0o077) !== 0) throw new Error(`${pwFile}: permissão aberta demais; use chmod 600.`);
    const pair = keyring.addFromJson(JSON.parse(readFileSync(env.PIU_SETTLEMENT_KEYSTORE, 'utf8')));
    pair.decodePkcs8(readFileSync(pwFile, 'utf8').trim());
    return pair;
  }
  if (env.PIU_SETTLEMENT_SEED) return keyring.addFromUri(env.PIU_SETTLEMENT_SEED.trim());
  throw new Error('Sem conta pagadora: defina PIU_SETTLEMENT_KEYSTORE e PIU_SETTLEMENT_PASSWORD_FILE.');
}
