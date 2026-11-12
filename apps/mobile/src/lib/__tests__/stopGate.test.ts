/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveNodeKey, newSeed } from '../../protocol/keys';
import { createLanController } from '../../transport/lan/controller';
import { FakeLan } from '../../transport/__tests__/lanFake';
import { createStopGate } from '../stopGate';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Nativo de mentira com as mesmas guardas do módulo real: `start` ligado é ignorado; `stop` desliga. */
function fakeNative() {
  const st = { running: false, name: '' };
  return {
    st,
    start: async (name: string) => { if (st.running) return; st.running = true; st.name = name; },
    // Como em transport/native.ts: uma ida e volta ao nativo (setBackground) antes do stop de verdade.
    stop: async () => { await tick(5); st.running = false; },
  };
}

test('religar: o start espera o stop anterior terminar (troca do nome na virada do dia)', async () => {
  const n = fakeNative();
  const gate = createStopGate();
  await n.start('piu-aaaaaa');
  gate.stop(() => n.stop());
  await gate.idle();
  await n.start('piu-bbbbbb');
  await tick(20);
  assert.deepEqual(n.st, { running: true, name: 'piu-bbbbbb' });
});

test('religar: sem stop pendente, idle() resolve na hora; stop que falha não trava o próximo start', async () => {
  const gate = createStopGate();
  await gate.idle();
  gate.stop(() => Promise.reject(new Error('falhou')));
  gate.stop(() => { throw new Error('falhou na hora'); });
  await gate.idle();
});

test('religar: idle() espera todos os stops pendentes, não só o último', async () => {
  const gate = createStopGate();
  let slow = false;
  gate.stop(async () => { await tick(30); slow = true; });
  gate.stop(async () => {});
  await gate.idle();
  assert.equal(slow, true);
});

test('religar: a rede local volta a rodar com o nome novo depois de stop seguido de start', async t => {
  const lan = new FakeLan();
  const A = createLanController(lan.add('192.168.1.10'), { beaconMs: 50, hintWaitMs: 20 });
  t.after(async () => { await A.stop(); });
  const node = deriveNodeKey(newSeed());
  await A.start({ node, name: 'piu-aaaaaa', relay: true });
  const gate = createStopGate();
  gate.stop(() => A.stop());
  void gate.idle().then(() => A.start({ node, name: 'piu-bbbbbb', relay: true }));
  await tick(500);
  assert.equal(A.status().state, 'running');
});
