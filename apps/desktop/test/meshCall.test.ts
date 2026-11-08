import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AudioEngine } from '../../mobile/src/calls/callService';
import type { CallRecord } from '../../mobile/src/calls/callMachine';
import type { Codec } from '../../mobile/src/calls/callMedia';
import { createIdentity } from '../src/main/identity';
import { MeshNode } from '../src/main/mesh';
import { LnnpLanTransport } from '../src/transport/lnnpLan';

/**
 * Dois Desktops de verdade (nó, mensageiro, sessão cifrada e LAN em 127.0.0.1) fazendo uma chamada.
 * Só o motor de áudio é de teste: em vez do microfone, o teste "fala" um pedaço de bytes.
 */
class TestAudio implements AudioEngine {
  played: number[] = []; on = false;
  private emit?: (c: Codec, p: Uint8Array) => void;
  async start(f: (c: Codec, p: Uint8Array) => void) { this.on = true; this.emit = f; }
  stop() { this.on = false; this.emit = undefined; }
  play(_c: Codec, p: Uint8Array) { this.played.push(p.length); }
  setMuted() {}
  levels() { return { mine: 0, theirs: 0 }; }
  speak(n: number) { this.emit?.('opus', new Uint8Array(n)); }
}

async function until(cond: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

const cleanup: (() => Promise<unknown>)[] = [];
let n = 0;
async function person(name: string, peers: string[]) {
  const { keys } = createIdentity();
  const audio = new TestAudio();
  const records: CallRecord[] = [];
  const lan = new LnnpLanTransport({ node: keys.node, listen: '127.0.0.1', port: 0, discoveryPort: null, broadcast: [], peers, beaconMs: 150, handshakeTimeoutMs: 2000 });
  const texts: string[] = [];
  const mesh = new MeshNode({
    keys, transports: [lan], relay: true, displayName: name,
    events: { message: (_f, m) => texts.push(m.text) },
    call: { audio, record: r => records.push(r), requestUpdate: () => {}, newId: () => `call-${name}-${String(++n).padStart(8, '0')}` },
  });
  await mesh.start(100);
  cleanup.push(() => mesh.stop().catch(() => {}));
  return { mesh, lan, audio, records, texts };
}

test('desktop ↔ desktop pela LAN: toca, atende, voz cifrada nos dois sentidos, mesmas palavras, desliga e registra', async t => {
  t.after(async () => { await Promise.all(cleanup.splice(0).map(f => f())); });
  const B = await person('Bia', []);
  const A = await person('Ana', [`127.0.0.1:${B.lan.port}`]);
  await until(() => A.lan.linkCount === 1 && B.lan.linkCount === 1, 'enlace');
  const bia = A.mesh.addContactByCard(B.mesh.myCard('public').card);
  A.mesh.sendText(bia.id, 'oi');
  await until(() => B.texts.length === 1, 'sessão aberta');
  const ana = B.mesh.listContacts()[0]!.id;
  B.mesh.sendText(ana, 'oi!');
  await until(() => A.texts.length === 1, 'resposta (contato aceito)');

  const a = A.mesh.call!, b = B.mesh.call!;
  a.open(bia.id);
  a.controller.dial();
  await until(() => b.state.phase === 'ringing', 'tocar na Bia');
  await until(() => a.state.stage === 'ringing', 'Ana saber que está tocando');
  b.controller.answer();
  await until(() => a.state.phase === 'active' && b.state.phase === 'active', 'chamada ativa');
  assert.ok(a.words?.length === 4);
  assert.deepEqual(a.words, b.words);
  await until(() => A.audio.on && B.audio.on, 'microfones abertos');

  A.audio.speak(40);
  B.audio.speak(33);
  await until(() => B.audio.played.includes(40) && A.audio.played.includes(33), 'voz nos dois sentidos');
  await until(() => a.state.route === 'direct' && b.state.route === 'direct', 'caminho direto pela LAN');

  a.controller.hangup();
  await until(() => B.records.length === 1, 'Bia registrar');
  assert.equal(A.records[0]!.outcome, 'done');
  assert.equal(A.records[0]!.dir, 'out');
  assert.equal(B.records[0]!.outcome, 'done');
  assert.equal(B.records[0]!.dir, 'in');
  assert.ok(!A.audio.on && !B.audio.on, 'microfone fechado no fim');
  assert.equal(A.texts.length + B.texts.length, 2, 'voz e sinais não viram mensagens na conversa');
});
