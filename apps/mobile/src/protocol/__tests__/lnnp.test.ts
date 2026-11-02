/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equal, utf8, Writer } from '../bytes';
import { MsgType, sealDirect } from '../envelope';
import { deriveIdentity, deriveNodeKey, newSeed, toPublic } from '../keys';
import {
  decodeBeacon, decodeCaps, decodeHello, decodeReceipt, defaultCapabilities, encodeBeacon, encodeCaps, encodeHello, encodeReceipt,
  errorFrame, Feature, FrameType, Handshake, type HandshakeOptions, LNNP_VERSION, LnnpError, LnnpErrorCode, Medium, negotiate,
  nodeTag, ReplayGuard,
} from '../lnnp';
import { makeRelayReceipt } from '../receipts';
import { Router } from '../router';

const NOW = 1_800_000_000;

function side(o: Partial<HandshakeOptions> = {}) {
  const node = deriveNodeKey(newSeed());
  return { node, hs: new Handshake({ node, caps: defaultCapabilities({ media: Medium.Eth }), now: NOW, replay: new ReplayGuard(), ...o }) };
}

/** Os dois lados trocam HELLO e AUTH (simétrico). */
function handshake(a: Handshake, b: Handshake) {
  const authA = a.receiveHello(b.hello);
  const authB = b.receiveHello(a.hello);
  return { la: a.receiveAuth(authB), lb: b.receiveAuth(authA) };
}

const code = (wire: LnnpErrorCode) => (e: unknown) => e instanceof LnnpError && e.wire === wire;

test('LNNP: handshake autenticado, versão negociada e quadros cifrados nos dois sentidos', () => {
  const A = side(), B = side();
  const { la, lb } = handshake(A.hs, B.hs);
  assert.equal(la.version, LNNP_VERSION);
  assert.ok(equal(la.peerPk, B.node.pk) && equal(lb.peerPk, A.node.pk));
  assert.equal(la.peerCaps.media, Medium.Eth);
  // Quadro de A para B, e de B para A.
  const rec = la.seal(FrameType.Envelope, utf8('envelope cifrado'));
  const f = lb.open(rec);
  assert.equal(f.type, FrameType.Envelope);
  assert.deepEqual(f.body, utf8('envelope cifrado'));
  assert.deepEqual(la.open(lb.seal(FrameType.Ping, Uint8Array.of(7))).body, Uint8Array.of(7));
  // O conteúdo do quadro não aparece em claro no fio.
  assert.equal(Buffer.from(rec).includes(Buffer.from('envelope cifrado')), false);
  // Registro repetido ou adulterado é recusado.
  assert.throws(() => lb.open(rec), code(LnnpErrorCode.Replay));
  const bad = la.seal(FrameType.Envelope, utf8('x')); bad[bad.length - 1] ^= 1;
  assert.throws(() => lb.open(bad), code(LnnpErrorCode.BadSignature));
});

test('LNNP: o enlace não revela identidade social, só a chave técnica do nó', () => {
  const seed = newSeed();
  const social = deriveIdentity(seed, 'public');
  const node = deriveNodeKey(seed);
  const hs = new Handshake({ node, caps: defaultCapabilities(), now: NOW });
  const wire = Buffer.from(hs.hello);
  for (const k of [social.signPk, social.agreePk]) assert.equal(wire.includes(Buffer.from(k)), false);
  assert.ok(wire.includes(Buffer.from(node.pk)));
});

test('LNNP: assinatura errada no AUTH é recusada', () => {
  const A = side(), B = side();
  const authB = B.hs.receiveHello(A.hs.hello);
  A.hs.receiveHello(B.hs.hello);
  const forged = authB.slice(); forged[10] ^= 0xff;
  assert.throws(() => A.hs.receiveAuth(forged), code(LnnpErrorCode.BadSignature));
  // Um terceiro (M) que se passa por B: manda o HELLO de B mas assina com a própria chave.
  const C = side(), M = side(), B2 = side();
  C.hs.receiveHello(B2.hs.hello);
  const sigByM = new Handshake({ node: M.node, caps: defaultCapabilities(), now: NOW }).receiveHello(C.hs.hello);
  assert.throws(() => C.hs.receiveAuth(sigByM), code(LnnpErrorCode.BadSignature));
});

test('LNNP: replay do desafio é recusado (HELLO repetido e AUTH de outra sessão)', () => {
  const guard = new ReplayGuard();
  const B = side();
  const A1 = side({ replay: guard });
  const authB1 = B.hs.receiveHello(A1.hs.hello);
  A1.hs.receiveHello(B.hs.hello);
  A1.hs.receiveAuth(authB1);
  // Atacante grava o HELLO e o AUTH de B e repete numa sessão nova com o mesmo nó A.
  const A2 = new Handshake({ node: A1.node, caps: defaultCapabilities(), now: NOW + 10, replay: guard });
  assert.throws(() => A2.receiveHello(B.hs.hello), code(LnnpErrorCode.Replay));
  // Mesmo sem o guarda (ex.: depois de reiniciar), o AUTH antigo não vale: assinou o desafio antigo de A.
  const A3 = new Handshake({ node: A1.node, caps: defaultCapabilities(), now: NOW + 20 });
  A3.receiveHello(B.hs.hello);
  assert.throws(() => A3.receiveAuth(authB1), code(LnnpErrorCode.BadSignature));
  // O próprio HELLO refletido de volta também é recusado.
  const A4 = side();
  assert.throws(() => A4.hs.receiveHello(A4.hs.hello), code(LnnpErrorCode.Self));
  // HELLO com horário fora da tolerância (gravado há muito tempo).
  const old = side({ now: NOW - 3600 });
  assert.throws(() => side().hs.receiveHello(old.hs.hello), code(LnnpErrorCode.Clock));
});

test('LNNP: negociação entre versões diferentes usa a maior comum; sem interseção, erro claro', () => {
  const v13 = side({ versions: { min: 1, max: 3 } });
  const v11 = side({ versions: { min: 1, max: 1 } });
  const { la, lb } = handshake(v13.hs, v11.hs);
  assert.equal(la.version, 1);
  assert.equal(lb.version, 1);
  const v24 = side({ versions: { min: 2, max: 4 } }), v35 = side({ versions: { min: 3, max: 5 } });
  assert.equal(handshake(v24.hs, v35.hs).la.version, 4);
  // Sem versão comum: nenhum dos lados aceita, e o erro vai no fio com código próprio.
  const v23 = side({ versions: { min: 2, max: 3 } }), v1 = side({ versions: { min: 1, max: 1 } });
  let wire: Uint8Array | null = null;
  try { v1.hs.receiveHello(v23.hs.hello); } catch (e) { assert.ok(code(LnnpErrorCode.NoCommonVersion)(e)); wire = errorFrame((e as LnnpError).wire, (e as Error).message); }
  assert.ok(wire);
  // O outro lado recebe o ERROR no lugar do HELLO/AUTH e entende o motivo.
  assert.throws(() => v23.hs.receiveHello(wire!), (e: unknown) => code(LnnpErrorCode.NoCommonVersion)(e) && (e as LnnpError).fromPeer);
});

test('LNNP: capacidades desconhecidas são ignoradas; obrigatória ausente recusa; opcional ausente usa padrão', () => {
  // Capacidade nova (tag 200) de uma versão futura: ignorada, enlace sobe.
  const future = side({ caps: { ...defaultCapabilities(), unknown: [{ tag: 200, value: utf8('coisa nova') }] } });
  const now = side();
  const { lb } = handshake(future.hs, now.hs);
  assert.deepEqual(lb.peerCaps.unknown?.map(u => u.tag), [200]);
  // Só SUITES e ENVELOPE_VERSIONS: o resto vem do padrão (MTU conservadora, sem relay).
  const minimal = new Writer().u8(5).u16(1).u8(1).u8(6).u16(1).u8(0).done();
  const c = decodeCaps(minimal);
  assert.equal(c.mtu, 512);
  assert.equal(c.relay, false);
  assert.equal(c.features, 0);
  // Sem SUITES: recusa com MISSING_CAPABILITY.
  const noSuites = new Writer().u8(6).u16(1).u8(0).done();
  assert.throws(() => decodeCaps(noSuites), code(LnnpErrorCode.MissingCapability));
  const A = side();
  const hello = encodeHello({ minVersion: 1, maxVersion: 1, time: NOW, nodePk: deriveNodeKey(newSeed()).pk, ephPk: new Uint8Array(32).fill(9), nonce: new Uint8Array(32).fill(3), caps: noSuites });
  assert.throws(() => A.hs.receiveHello(hello), code(LnnpErrorCode.MissingCapability));
  // Suíte sem interseção: NO_COMMON_SUITE; formato de envelope sem interseção: NO_COMMON_FORMAT.
  const base = { minVersion: 1, maxVersion: 1, caps: defaultCapabilities() };
  assert.throws(() => negotiate(base, { ...base, caps: defaultCapabilities({ suites: [99] }) }), code(LnnpErrorCode.NoCommonSuite));
  assert.throws(() => negotiate(base, { ...base, caps: defaultCapabilities({ envelopeVersions: [7] }) }), code(LnnpErrorCode.NoCommonFormat));
  // MTU e recursos efetivos: o menor e o E lógico.
  const n = negotiate(base, { ...base, caps: defaultCapabilities({ mtu: 244, features: Feature.Fragments }) });
  assert.equal(n.mtu, 244);
  assert.equal(n.features, Feature.Fragments);
  // Capacidade repetida ou com tamanho errado: malformado.
  assert.throws(() => decodeCaps(new Writer().u8(1).u16(2).u16(9).done()), code(LnnpErrorCode.Malformed));
  assert.throws(() => decodeCaps(new Writer().bytes(encodeCaps(defaultCapabilities())).u8(1).u16(4).u32(1).done()), code(LnnpErrorCode.Malformed));
});

test('LNNP: autorização recusa nó fora da lista (revogação)', () => {
  const B = side();
  const A = side({ authorize: pk => !equal(pk, B.node.pk) });
  assert.throws(() => A.hs.receiveHello(B.hs.hello), code(LnnpErrorCode.Unauthorized));
});

test('LNNP: HELLO adulterado no caminho (downgrade de versão) derruba o handshake', () => {
  const A = side({ versions: { min: 1, max: 2 } }), B = side({ versions: { min: 1, max: 2 } });
  // O atacante reduz a versão máxima anunciada por A.
  const tampered = A.hs.hello.slice(); tampered[6] = 1;
  assert.equal(decodeHello(tampered).maxVersion, 1);
  const authB = B.hs.receiveHello(tampered);
  A.hs.receiveHello(B.hs.hello);
  assert.throws(() => A.hs.receiveAuth(authB), code(LnnpErrorCode.BadSignature));
});

test('LNNP: CAPS_UPDATE muda as capacidades do vizinho sem refazer o enlace; tipo desconhecido não derruba', () => {
  const A = side(), B = side();
  const { la, lb } = handshake(A.hs, B.hs);
  assert.equal(lb.peerCaps.relay, true);
  lb.open(la.seal(FrameType.CapsUpdate, encodeCaps(defaultCapabilities({ relay: false }))));
  assert.equal(lb.peerCaps.relay, false);
  const f = lb.open(la.seal(0x55, utf8('quadro do futuro')));
  assert.equal(f.type, 0x55);
  assert.deepEqual(lb.open(la.seal(FrameType.Ping)).body, new Uint8Array(0));
});

test('LNNP: recibo de retransmissão e anúncio de descoberta (ida e volta)', () => {
  const seed = newSeed();
  const node = deriveNodeKey(seed);
  const a = deriveIdentity(newSeed(), 'public'), b = deriveIdentity(newSeed(), 'public');
  const env = sealDirect({ from: a, to: toPublic(b), type: MsgType.Text, body: utf8('oi'), now: NOW });
  const R = new Router({ node, identities: [], relay: true });
  R.ingest(env.bytes, 'x', NOW);
  R.outgoing('y', 'eth', NOW);
  const r = R.receipts[0]!;
  assert.deepEqual(decodeReceipt(encodeReceipt(r)), r);
  assert.deepEqual(decodeReceipt(encodeReceipt(makeRelayReceipt(node, env.id, r.ackHash, NOW))).envelopeId, env.id);
  const tag = nodeTag(node.pk);
  const beacon = decodeBeacon(encodeBeacon({ minVersion: 1, maxVersion: 1, port: 8422, tag, relay: true }));
  assert.ok(beacon && beacon.port === 8422 && beacon.relay && equal(beacon.tag, tag));
  assert.equal(decodeBeacon(utf8('M-SEARCH * HTTP/1.1')), null);
});
