import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CallRecord } from '../../mobile/src/calls/callMachine';
import { PiuCore } from '../src/main/core';
import type { CallSnapshot } from '../src/shared/callBridge';

/**
 * Chamada recebida vista pelo processo principal, com dois PiuCore de verdade (cofre, estado, LAN em 127.0.0.1):
 * o pedido do microfone antes da caixa "pre", o toque (`ring`) com Não perturbe e conversa silenciada, o
 * registro da chamada perdida (aviso ao desbloquear) e o rascunho de "Recusar → Mensagem".
 */
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};
const until = async (fn: () => boolean, what: string, ms = 10000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`Tempo esgotado: ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
};

test('PiuCore: microfone pedido antes da caixa "pre"; toque calado por Não perturbe e conversa silenciada; perdida e rascunho', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'piu-core-ring-'));
  const asked: string[] = [];
  let grant: () => void = () => {}, hold = true;
  const opts = (name: string) => ({ userData: join(dir, name), safeStorage, platform: 'test', version: 'test', hostname: name,
    lan: { port: 0, discoveryPort: null, listen: '127.0.0.1', broadcast: [] },
    walletBalance: async () => { throw new Error('sem rede nos testes'); } });
  // A Ana tem o pedido do microfone do macOS (main.ts `micAccess`): a primeira resposta espera o teste deixar.
  const a = new PiuCore({ ...opts('ana'), micAccess: () => { asked.push(a.callSnapshot()?.state.phase ?? 'none'); return hold ? new Promise<void>(r => { grant = r; }) : Promise.resolve(); } });
  const b = new PiuCore(opts('bia'));
  t.after(async () => { await Promise.all([a.close(), b.close()]); rmSync(dir, { recursive: true, force: true }); });
  const snaps: (CallSnapshot | null)[] = [], records: CallRecord[] = [], drafts: string[] = [];
  b.events.on('call', s => snaps.push(s));
  b.events.on('callRecord', r => records.push(r));
  b.events.on('callDraft', d => drafts.push(d.peer));
  await a.open(); await b.open();
  await a.createIdentity({ kind: 'public', name: 'Ana' });
  await b.createIdentity({ kind: 'public', name: 'Bia' });
  a.addPeer(`127.0.0.1:${b.networkStatus().lan.port}`);
  await until(() => a.networkStatus().lan.links > 0 && b.networkStatus().lan.links > 0, 'conexão local');
  const bia = a.addContactByCard(b.myCard('public').card);
  a.sendText(bia.id, 'oi');
  await until(() => b.listConversations().some(c => c.contact.request), 'pedido de conversa');
  const ana = b.listConversations().find(c => c.contact.request)!.contact;
  b.sendText(ana.id, 'oi!');
  await until(() => a.getMessages(bia.id).some(m => m.text === 'oi!'), 'resposta');

  // 1) macOS: o sistema pergunta pelo microfone ANTES da caixa "pre" abrir o medidor.
  const opened = a.callAct({ a: 'open', peer: bia.id });
  assert.deepEqual(asked, ['idle'], 'pediu o microfone com a caixa ainda fechada');
  assert.equal(a.callSnapshot()?.state.phase, 'idle');
  hold = false; grant();
  await opened;
  assert.equal(a.callSnapshot()?.state.phase, 'pre');

  // 2) Toca na Bia: o toque soa; silenciar a conversa ou ligar Não perturbe cala na hora (e volta).
  a.callAct({ a: 'dial' });
  await until(() => b.callSnapshot()?.state.phase === 'ringing', 'tocar na Bia');
  assert.equal(b.callSnapshot()?.ring, true);
  b.setMuted(ana.id, true);
  assert.equal(snaps.at(-1)?.ring, false, 'conversa silenciada: avisa a janela para parar o toque');
  b.setMuted(ana.id, false);
  assert.equal(snaps.at(-1)?.ring, true);
  b.setPrefs({ dnd: true });
  assert.equal(snaps.at(-1)?.ring, false, 'Não perturbe');
  b.setPrefs({ dnd: false });
  assert.equal(snaps.at(-1)?.ring, true);

  // 3) A Ana desiste antes de a Bia atender: chamada perdida na Bia (o main.ts guarda para o aviso ao desbloquear).
  a.callAct({ a: 'hangup' });
  await until(() => records.some(r => r.outcome === 'missed'), 'registro da perdida na Bia');
  const missed = records.find(r => r.outcome === 'missed')!;
  assert.equal(missed.peer, ana.id); assert.equal(missed.dir, 'in');
  assert.equal(b.callSnapshot()?.ring, false, 'parou de tocar');

  // 4) Recusar → Mensagem: a janela recebe o pedido de abrir a conversa com o rascunho.
  await until(() => a.callSnapshot()?.state.phase === 'idle', 'fim da tela de encerramento na Ana', 5000);
  await a.callAct({ a: 'open', peer: bia.id });
  a.callAct({ a: 'dial' });
  await until(() => b.callSnapshot()?.state.phase === 'ringing', 'tocar de novo na Bia');
  b.callAct({ a: 'decline', how: 'message' });
  assert.deepEqual(drafts, [ana.id]);
  assert.equal(b.callSnapshot()?.ring, false);
});
