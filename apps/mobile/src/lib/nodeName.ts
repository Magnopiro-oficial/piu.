/**
 * Nome curto do nó (`piu-xxxxxx`) anunciado em claro no Bluetooth LE, no Nearby e, cifrado, no
 * `NODE_HINT` da rede local. Auditoria 2026-11-09: um nome gravado para sempre deixava seguir o mesmo
 * aparelho entre lugares e datas, anulando o MAC aleatório e a chave do nó que gira por dia. Agora o
 * nome sai de um segredo local e do dia UTC (o mesmo índice da chave do nó, `nodeDayOf`): dentro do dia
 * é o mesmo em todos os meios (os enlaces do mesmo vizinho continuam agrupados, transport/multi.ts);
 * de um dia para o outro não há como ligar um nome ao seguinte sem o segredo.
 * Sem react-native: roda no app e nos testes.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const LABEL = 'piu/transport/node-name/v1/';
const SECRET = /^[0-9a-f]{64}$/;
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!, h => parseInt(h, 16));

/** Segredo de 32 bytes (hex) de onde saem os nomes; fica só no aparelho e nunca é transmitido. */
export function newNodeNameSecret(random: (b: Uint8Array<ArrayBuffer>) => unknown = b => globalThis.crypto.getRandomValues(b)): string {
  const b = new Uint8Array(32);
  random(b);
  return hex(b);
}

/** Nome do nó no dia UTC `day` (`nodeDayOf`): `piu-` + 6 hex de HMAC-SHA-256(segredo, rótulo + dia). */
export function dailyNodeName(secretHex: string, day: number): string {
  if (!SECRET.test(secretHex)) throw new Error('segredo do nome do nó inválido');
  if (!Number.isSafeInteger(day) || day < 0) throw new Error('dia inválido');
  const mac = hmac(sha256, unhex(secretHex), new TextEncoder().encode(LABEL + day));
  return 'piu-' + hex(mac.subarray(0, 3));
}
