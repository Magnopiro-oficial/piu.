/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromUtf8, utf8 } from '../bytes';
import { envelopeId, MsgType, parseHeader, Priority, sealDirect } from '../envelope';
import { fragment, Reassembler } from '../fragment';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic, type Identity } from '../keys';
import { ContributionLedger } from '../receipts';
import { Router, type TransportClass } from '../router';

const NOW = 1_800_000_000;

function node(name: string, opts: { relay?: boolean; limits?: ConstructorParameters<typeof Router>[0]['limits'] } = {}) {
  const seed = newSeed();
  const id = deriveIdentity(seed, 'public');
  return { name, id, router: new Router({ node: deriveNodeKey(seed), identities: [id], relay: opts.relay ?? true, limits: opts.limits }) };
}
type N = ReturnType<typeof node>;

/** Contato entre dois nós: cada um entrega ao outro o que tem para ele. */
function contact(a: N, b: N, now: number, via: TransportClass = 'ble') {
  const ab = a.router.outgoing(b.name, via, now).map(x => b.router.ingest(x, a.name, now));
  const ba = b.router.outgoing(a.name, via, now).map(x => a.router.ingest(x, b.name, now));
  return [...ab, ...ba];
}

const msg = (from: Identity, to: Identity, text: string, extra: Partial<Parameters<typeof sealDirect>[0]> = {}) =>
  sealDirect({ from: from, to: toPublic(to), type: MsgType.Text, body: utf8(text), now: NOW, ...extra });

test('multihop com store-and-forward: A → R1 → R2 → B, sem A e B se encontrarem (fase 3)', () => {
  const A = node('A'), R1 = node('R1'), R2 = node('R2'), B = node('B');
  const m = msg(A.id, B.id, 'chegou?');
  assert.equal(A.router.send(m.bytes, NOW).status, 'stored');
  contact(A, R1, NOW + 60);            // B está longe: R1 guarda
  assert.ok(R1.router.has(m.id));
  contact(R1, R2, NOW + 3600);         // horas depois, R1 encontra R2
  contact(R2, B, NOW + 7200);          // e R2 encontra B
  assert.equal(B.router.inbox.length, 1);
  assert.equal(fromUtf8(B.router.inbox[0].body), 'chegou?');
  assert.equal(B.router.inbox[0].fromId, A.id.id);
  // Relays não decifram nada.
  assert.equal(R1.router.inbox.length + R2.router.inbox.length, 0);
});

test('TTL: vencida no meio do caminho é apagada sem comando remoto e nunca entregue', () => {
  const A = node('A'), R = node('R'), B = node('B');
  const m = msg(A.id, B.id, 'curta', { ttlSec: 600 });
  A.router.send(m.bytes, NOW);
  contact(A, R, NOW + 10);
  assert.ok(R.router.has(m.id));
  R.router.purge(NOW + 601);
  assert.equal(R.router.has(m.id), false);
  contact(R, B, NOW + 700);
  assert.equal(B.router.inbox.length, 0);
});

test('deduplicação: a mesma mensagem por dois caminhos é entregue uma vez', () => {
  const A = node('A'), R1 = node('R1'), R2 = node('R2'), B = node('B');
  const m = msg(A.id, B.id, 'uma vez');
  A.router.send(m.bytes, NOW);
  contact(A, R1, NOW + 1); contact(A, R2, NOW + 2);
  const first = contact(R1, B, NOW + 3);
  const second = contact(R2, B, NOW + 4);
  assert.ok(first.some(r => r.status === 'delivered'));
  assert.ok(second.some(r => r.status === 'duplicate'));
  assert.equal(B.router.inbox.length, 1);
});

test('sem loops: num anel de nós cada um repassa cada envelope no máximo uma vez por vizinho', () => {
  const ring = ['N0', 'N1', 'N2', 'N3', 'N4'].map(n => node(n));
  const dest = node('longe');
  const m = msg(ring[0].id, dest.id, 'gira?');
  ring[0].router.send(m.bytes, NOW);
  let deliveries = 0;
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < ring.length; i++) {
      deliveries += contact(ring[i], ring[(i + 1) % ring.length], NOW + round * 10 + i).filter(r => r.status === 'stored').length;
    }
  }
  // Cada nó (exceto a origem) guarda a mensagem uma única vez; o resto é duplicata descartada.
  assert.equal(deliveries, ring.length - 1);
  // Depois de rodar o anel, ninguém tem mais o que mandar para os vizinhos.
  assert.equal(ring.reduce((n, x, i) => n + x.router.outgoing(ring[(i + 1) % ring.length].name, 'ble', NOW + 200).length, 0), 0);
});

test('limite de saltos: com 2 saltos a mensagem para depois do segundo relay', () => {
  const chain = ['A', 'R1', 'R2', 'R3'].map(n => node(n));
  const B = node('B');
  const m = msg(chain[0].id, B.id, 'perto', { hops: 2 });
  chain[0].router.send(m.bytes, NOW);
  contact(chain[0], chain[1], NOW + 1);
  contact(chain[1], chain[2], NOW + 2);
  assert.ok(chain[2].router.has(m.id), 'R2 recebeu (2º salto)');
  assert.deepEqual(chain[2].router.outgoing('R3', 'ble', NOW + 3), [], 'sem saltos restantes, não repassa');
  contact(chain[2], chain[3], NOW + 4);
  assert.equal(chain[3].router.has(m.id), false);
});

test('mídia nunca por LoRa; texto passa', () => {
  const A = node('A'), R = node('R'), B = node('B');
  const media = msg(A.id, B.id, 'foto', { bulk: true });
  const text = msg(A.id, B.id, 'texto');
  A.router.send(media.bytes, NOW); A.router.send(text.bytes, NOW);
  const viaLora = A.router.outgoing('R', 'lora', NOW + 1).map(envelopeId);
  assert.deepEqual(viaLora, [text.id]);
  const viaWifi = A.router.outgoing('R', 'direct', NOW + 2).map(envelopeId);
  assert.deepEqual(viaWifi, [media.id]);
  void R; void B;
});

test('sinal ao vivo da chamada nunca por LoRa (nem repassado); pedido de chamada e texto passam', () => {
  const A = node('A'), R = node('R'), B = node('B');
  const live = msg(A.id, B.id, 'oferta', { live: true, ttlSec: 30, priority: Priority.High });
  const text = msg(A.id, B.id, 'pedido de chamada', { ttlSec: 24 * 3600 });
  // Flag no cabeçalho (bit 1): relays leem sem chave; o bit 0 (mídia) continua livre.
  assert.equal(live.bytes[3], 2);
  assert.deepEqual([parseHeader(live.bytes).live, parseHeader(live.bytes).bulk], [true, false]);
  assert.equal(parseHeader(text.bytes).live, false);
  A.router.send(live.bytes, NOW); A.router.send(text.bytes, NOW);
  assert.deepEqual(A.router.outgoing('R', 'lora', NOW + 1).map(envelopeId), [text.id]);
  assert.deepEqual(A.router.outgoing('R', 'ble', NOW + 2).map(envelopeId), [live.id], 'ao vivo vai pelo Bluetooth');
  // O relay que recebeu pelo Bluetooth também não põe no ar pelo LoRa.
  R.router.ingest(A.router.outgoing('R2', 'direct', NOW + 3).find(x => envelopeId(x) === live.id)!, 'A', NOW + 3);
  assert.deepEqual(R.router.outgoing('L', 'lora', NOW + 4).map(envelopeId), []);
  assert.deepEqual(R.router.outgoing('B', 'direct', NOW + 4).map(envelopeId), [live.id]);
  void B;
});

test('Modo nó desligado: não guarda mensagens de terceiros, mas envia as próprias', () => {
  const A = node('A'), R = node('R', { relay: false }), B = node('B');
  const m = msg(A.id, B.id, 'via R?');
  A.router.send(m.bytes, NOW);
  const res = contact(A, R, NOW + 1);
  assert.ok(res.some(r => r.status === 'relay-off'));
  assert.equal(R.router.has(m.id), false);
  const own = msg(R.id, B.id, 'minha');
  R.router.send(own.bytes, NOW + 2);
  contact(R, B, NOW + 3);
  assert.equal(B.router.inbox.length, 1);
});

test('limites do nó: cheio, sai primeiro o de terceiros de menor prioridade', () => {
  const R = node('R', { limits: { maxCount: 2 } });
  const A = node('A'), B = node('B');
  const low = msg(A.id, B.id, 'baixa', { priority: Priority.Low });
  const normal = msg(A.id, B.id, 'normal');
  const critical = msg(A.id, B.id, 'alerta', { priority: Priority.Critical });
  R.router.ingest(low.bytes, 'A', NOW);
  R.router.ingest(normal.bytes, 'A', NOW);
  assert.equal(R.router.ingest(critical.bytes, 'A', NOW).status, 'stored');
  assert.equal(R.router.has(low.id), false);
  assert.ok(R.router.has(normal.id) && R.router.has(critical.id));
  const low2 = msg(A.id, B.id, 'outra baixa', { priority: Priority.Low });
  assert.equal(R.router.ingest(low2.bytes, 'A', NOW).status, 'full');
});

test('limite por vizinho: enxurrada é recusada; o vizinho volta a ser aceito depois', () => {
  const R = node('R', { limits: { peerBurst: 5, peerPerMinute: 60 } });
  const A = node('A'), B = node('B');
  const ms = Array.from({ length: 8 }, (_, i) => msg(A.id, B.id, 'spam ' + i));
  const res = ms.map(m => R.router.ingest(m.bytes, 'A', NOW));
  assert.equal(res.filter(r => r.status === 'stored').length, 5);
  assert.ok(res.slice(5).every(r => r.status === 'rejected' && r.reason === 'limite do vizinho'));
  // Outro vizinho não é afetado; e A volta depois de repor fichas (1 por segundo).
  assert.equal(R.router.ingest(msg(B.id, A.id, 'normal').bytes, 'B', NOW).status, 'stored');
  assert.equal(R.router.ingest(ms[5].bytes, 'A', NOW + 2).status, 'stored');
});

test('TTL acima do máximo e envelope adulterado são recusados pelo relay', () => {
  const A = node('A'), B = node('B'), R = node('R');
  const m = msg(A.id, B.id, 'x');
  const bad = m.bytes.slice(); bad[1] = 7; // suíte desconhecida
  assert.equal(R.router.ingest(bad, 'A', NOW).status, 'rejected');
  const later = m.bytes.slice(); new DataView(later.buffer).setUint32(8, NOW + 30 * 86400);
  assert.equal(R.router.ingest(later, 'A', NOW).status, 'rejected');
});

test('fragmentação: remonta fora de ordem e detecta fragmento corrompido', () => {
  const A = node('A'), B = node('B');
  const m = msg(A.id, B.id, 'x'.repeat(2000));
  const frags = fragment(m.bytes, 180);
  assert.ok(frags.length > 10);
  const r = new Reassembler();
  const shuffled = [...frags].reverse();
  let out: Uint8Array | null = null;
  for (const f of shuffled) out = r.push(f, NOW) ?? out;
  assert.ok(out);
  assert.equal(envelopeId(out), m.id);
  const r2 = new Reassembler();
  const bad = frags.map(f => f.slice()); bad[3][40] ^= 1;
  assert.throws(() => { for (const f of bad) r2.push(f, NOW); }, /não confere/);
});

test('créditos: só com entrega comprovada, sem duplicar, recibo falso rejeitado (seção 11)', () => {
  const A = node('A'), R1 = node('R1'), R2 = node('R2'), B = node('B');
  const m = msg(A.id, B.id, 'pago?');
  A.router.send(m.bytes, NOW);
  contact(A, R1, NOW + 1); contact(R1, R2, NOW + 2); contact(R2, B, NOW + 3);
  const ledger = new ContributionLedger();
  const receipts = [...R1.router.receipts, ...R2.router.receipts];
  assert.equal(receipts.length, 2, 'um recibo por relay; a origem não ganha por mensagem própria');
  assert.deepEqual(receipts.map(r => ledger.submit(r)), ['pendente', 'pendente']);
  assert.equal(ledger.submit(receipts[0]), 'rejeitado', 'recibo repetido não gera crédito');
  const forged = { ...receipts[1], nodePk: deriveNodeKey(newSeed()).pk };
  assert.equal(ledger.submit(forged), 'rejeitado', 'assinatura falsa');
  // O destino comprova a entrega revelando o segredo que só ele decifrou.
  const got = B.router.inbox[0];
  assert.ok(ledger.confirmDelivery(got.id, got.ackSecret, parseHeader(m.bytes).ackHash));
  assert.deepEqual(ledger.summary(R1.router['o'].node.pk), { pendente: 0, validado: 1, rejeitado: 0 });
  assert.equal(ledger.confirmDelivery(got.id, new Uint8Array(16), parseHeader(m.bytes).ackHash), false, 'segredo errado não comprova');
});

test('reinício: envelopes guardados e ids vistos voltam do disco, sem entrega nem recibo duplicados', () => {
  const A = node('A'), B = node('B');
  const seed = newSeed();
  const relay = () => new Router({ node: deriveNodeKey(seed), identities: [], relay: true });
  const R = relay();
  const m = msg(A.id, B.id, 'guardada');
  const curta = msg(A.id, B.id, 'vence logo', { ttlSec: 120 });
  R.ingest(m.bytes, 'A', NOW);
  R.ingest(curta.bytes, 'A', NOW);
  // Uma cópia de cada já saiu para C antes de desligar: gerou o único recibo de cada.
  assert.equal(R.outgoing('C', 'eth', NOW + 1).length, 2);
  assert.equal(R.receipts.length, 2);
  const saved = { stored: R.exportStored(), seen: R.exportSeen() };

  // "Reinicia" depois de a curta vencer.
  const R2 = relay();
  R2.importSeen(saved.seen, NOW + 200);
  assert.equal(R2.importStored(saved.stored, NOW + 200), 1);
  assert.ok(R2.has(m.id) && !R2.has(curta.id));
  // O mesmo envelope chegando de novo é duplicata (não vira segunda entrega).
  assert.equal(R2.ingest(m.bytes, 'A', NOW + 201).status, 'duplicate');
  // Não volta para C (já foi) nem gera recibo novo; segue para B, que recebe uma vez.
  assert.equal(R2.outgoing('C', 'eth', NOW + 202).length, 0);
  for (const x of R2.outgoing('B', 'eth', NOW + 202)) B.router.ingest(x, 'R', NOW + 202);
  assert.equal(R2.receipts.length, 0);
  assert.equal(B.router.inbox.length, 1);
});

test('reinício: a restauração respeita espaço e retenção e descarta lixo', () => {
  const A = node('A'), B = node('B');
  const R = new Router({ node: deriveNodeKey(newSeed()), identities: [], relay: true });
  const ms = [msg(A.id, B.id, 'um'), msg(A.id, B.id, 'dois'), msg(A.id, B.id, 'três', { priority: Priority.Critical })];
  for (const m of ms) R.ingest(m.bytes, 'A', NOW);
  const saved = R.exportStored();
  const lixo = { ...saved[0], bytes: utf8('não é envelope') };
  const R2 = new Router({ node: deriveNodeKey(newSeed()), identities: [], relay: true, limits: { maxCount: 2 } });
  assert.equal(R2.importStored([lixo, ...saved], NOW + 10), 2);
  assert.ok(R2.has(ms[2].id), 'o de prioridade maior fica');
  // A retenção máxima de terceiros conta desde que o envelope chegou, não desde o reinício.
  const R3 = new Router({ node: deriveNodeKey(newSeed()), identities: [], relay: true, limits: { maxRetentionSec: 3600 } });
  assert.equal(R3.importStored(saved, NOW + 3601), 0);
});
