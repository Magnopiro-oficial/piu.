import { concat, utf8 } from '../protocol/bytes.js';
import { compareBytes } from '../protocol/lnnp.js';
import { hash } from '../protocol/suite.js';

const LABEL = utf8('piu/lnnp/v1/confirm');

/**
 * Código de confirmação de um enlace LNNP: 6 dígitos derivados do transcript do handshake (os dois
 * HELLO, já em ordem canônica, com as chaves efêmeras e os desafios desta sessão) e das chaves de nó
 * das duas pontas, também em ordem canônica (a menor primeiro). Os dois nós calculam o mesmo código;
 * alguém no meio do caminho teria dois handshakes, com transcripts e códigos diferentes. Muda a cada
 * conexão nova (outras chaves efêmeras): vale o que os dois painéis mostram ao mesmo tempo.
 *
 * Não é segredo e não autentica sozinho: serve para o operador conferir, olhando os dois painéis,
 * que o vizinho escolhido é o equipamento que ele tem na mão.
 */
export function confirmCode(transcript: Uint8Array, myPk: Uint8Array, peerPk: Uint8Array): string {
  const [lo, hi] = compareBytes(myPk, peerPk) < 0 ? [myPk, peerPk] : [peerPk, myPk];
  const h = hash(concat(LABEL, lo, hi, transcript));
  // 8 bytes (64 bits) módulo 10^6: viés desprezível.
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(h[i] ?? 0);
  return (n % 1_000_000n).toString().padStart(6, '0');
}
