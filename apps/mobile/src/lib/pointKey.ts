/**
 * Chave do ponto Piu (docs/rede/pontos-piu-roteadores.md §1.6): "chave própria do ponto, derivada com
 * rótulo próprio". Sai de um segredo aleatório de 32 bytes do PRÓPRIO ponto (guardado no cofre do
 * aparelho, lib/pointSecret.ts), não da frase de recuperação: assim não há nenhuma ligação matemática com
 * as identidades, o nó do dia, a chave de operador do celular (`phone-node/operator/0/sign`) ou a
 * carteira, e "encerrar o ponto apaga a chave" é de verdade: sem o segredo, a chave não volta nem com a frase.
 */
import { toHex } from '../protocol/bytes';
import type { KeyPair } from '../protocol/keys';
import { hash, kdf, random, sign } from '../protocol/suite';
import { utf8 } from '../protocol/bytes';

/** Rótulo da chave do ponto (nunca reutilizar outro). */
export const POINT_KEY_LABEL = 'piu/point/v1/sign';
const POINT_SALT = utf8('piu/v1/point');

export const newPointSecret = () => random(32);

export function derivePointKey(secret: Uint8Array): KeyPair {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new Error('Segredo do ponto inválido.');
  const sk = kdf(secret, POINT_SALT, POINT_KEY_LABEL);
  return { sk, pk: sign.publicKey(sk) };
}

/** Id público do ponto: 16 hex do hash da chave pública. */
export const pointIdOf = (pk: Uint8Array) => toHex(hash(pk)).slice(0, 16);
