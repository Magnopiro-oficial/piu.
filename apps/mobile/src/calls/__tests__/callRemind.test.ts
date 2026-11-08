import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CallReminders, type RemindPorts } from '../callRemind';

/** Relógio e notificações de teste: grava o que foi agendado, cancelado e mostrado no app. */
function world() {
  const timers: { fn: () => void; ms: number; dead?: boolean }[] = [];
  const log = { scheduled: [] as [string, number][], cancelled: [] as string[], shown: [] as string[] };
  let active = true, n = 0, refuse = false;
  const ports: RemindPorts = {
    schedule: async (peer, sec) => { if (refuse) return null; log.scheduled.push([peer, sec]); return `n${++n}`; },
    cancel: id => log.cancelled.push(id),
    active: () => active,
    show: peer => log.shown.push(peer),
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    clearTimer: h => { (h as { dead?: boolean }).dead = true; },
  };
  const fire = async () => { const t = timers.find(x => !x.dead); assert.ok(t); t!.dead = true; t!.fn(); await new Promise(r => setTimeout(r, 0)); };
  const live = () => timers.filter(x => !x.dead).length;
  return { r: new CallReminders(ports), log, fire, live, setActive: (a: boolean) => { active = a; }, refuse: () => { refuse = true; } };
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('lembrete de 10 min: agenda a notificação do sistema (chega com o app fechado)', async () => {
  const w = world();
  w.r.add('marina', 10 * 60_000);
  await settle();
  assert.deepEqual(w.log.scheduled, [['marina', 600]]);
  assert.equal(w.live(), 1);
});

test('app aberto na hora: aviso dentro do app no lugar da notificação (que é tirada)', async () => {
  const w = world();
  w.r.add('marina', 600_000);
  await w.fire();
  assert.deepEqual(w.log.shown, ['marina']);
  assert.deepEqual(w.log.cancelled, ['n1']);
  assert.equal(w.r.has('marina'), false);
});

test('app fora de primeiro plano na hora: quem avisa é a notificação do sistema (sem repetir)', async () => {
  const w = world();
  w.r.add('marina', 600_000);
  w.setActive(false);
  await w.fire();
  assert.deepEqual(w.log.shown, []);
  assert.deepEqual(w.log.cancelled, []);
});

test('um lembrete por contato: recusar de novo troca o anterior; cancelar tira os dois lados', async () => {
  const w = world();
  w.r.add('marina', 600_000);
  w.r.add('marina', 600_000);
  await settle();
  assert.deepEqual(w.log.cancelled, ['n1']);
  assert.equal(w.live(), 1);
  w.r.cancel('marina');
  await settle();
  assert.deepEqual(w.log.cancelled, ['n1', 'n2']);
  assert.equal(w.live(), 0);
  w.r.cancel('ninguem');
});

test('notificação recusada (permissão ou ajustes): com o app aberto o aviso ainda aparece', async () => {
  const w = world();
  w.refuse();
  w.r.add('marina', 600_000);
  await w.fire();
  assert.deepEqual(w.log.shown, ['marina']);
  assert.deepEqual(w.log.cancelled, []);
});

test('fechar o serviço solta os timers, mas a notificação do sistema já agendada continua', async () => {
  const w = world();
  w.r.add('marina', 600_000);
  await settle();
  w.r.dispose();
  assert.equal(w.live(), 0);
  assert.deepEqual(w.log.cancelled, []);
});
