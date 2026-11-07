/**
 * B-01 (auditoria 2026-11-06): frase atrás da biometria do sistema, sem perder a frase de ninguém.
 * Regras em lib/phraseVault.ts; desenho e tradeoffs em docs/seguranca/biometria-cofre.md.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthResult } from '../deviceAuth';
import {
  BIO_KEY, bootVault, classifyAuthError, KEYS_KEY, LEGACY_KEY, MIGRATE_RETRY_MS, recoverPhrase, storePhrase, unlockPhrase, wipeVault,
  type VaultDeps,
} from '../phraseVault';

const A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const B = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');

type Mode = 'ok' | 'cancel' | 'noBio' | 'lockout';
/** Cofre falso: itens com biometria pedem "autenticação" (contada) e podem ser invalidados como no Android. */
function fake(o: { strong?: boolean; device?: AuthResult } = {}) {
  const items = new Map<string, { v: string; auth: boolean }>();
  const prompts: string[] = [];
  const log: string[] = [];
  let mode: { get: Mode; set: Mode } = { get: 'ok', set: 'ok' };
  let invalid = false;
  let failSetKeys = false;
  let clock = 1_000_000;
  const authStep = (m: Mode, prompt: string) => {
    prompts.push(prompt);
    if (m === 'cancel') throw new Error('User canceled the authentication. Cancel');
    if (m === 'noBio') throw new Error('No biometrics are currently enrolled');
    if (m === 'lockout') throw new Error('Lockout. Too many attempts');
  };
  const deps: VaultDeps = {
    store: {
      async get(k, auth) {
        const it = items.get(k);
        if (!it) return null;
        if (it.auth) {
          if (!auth) throw new Error('item com biometria lido sem pedido');
          if (invalid) return null; // KeyPermanentlyInvalidatedException → null
          authStep(mode.get, auth.prompt);
        }
        return it.v;
      },
      async set(k, v, auth) {
        if (k === KEYS_KEY && failSetKeys) throw new Error('disco cheio');
        if (auth) authStep(mode.set, auth.prompt);
        items.set(k, { v, auth: !!auth });
        log.push(`set ${k}`);
      },
      async del(k) { items.delete(k); log.push(`del ${k}`); },
    },
    seedOf: w => `seed:${w.join('-')}`,
    walletOf: w => `addr:${w[0]}${w[11]}`,
    isValid: w => w.length === 12,
    strongBiometrics: async () => o.strong ?? true,
    confirmDevice: async p => { prompts.push(`device:${p}`); return o.device ?? 'ok'; },
    now: () => clock,
  };
  return {
    deps, items, prompts, log,
    setMode: (m: Partial<typeof mode>) => { mode = { ...mode, ...m }; },
    invalidate: () => { invalid = true; },
    failKeys: (v: boolean) => { failSetKeys = v; },
    tick: (ms: number) => { clock += ms; },
    keys: () => JSON.parse(items.get(KEYS_KEY)?.v ?? 'null'),
  };
}

const P = { prompt: 'Mostrar a frase', protectPrompt: 'Proteger a frase' };

/** Instalação da versão anterior: só o item antigo, sem autenticação. */
function oldInstall(o?: Parameters<typeof fake>[0]) {
  const f = fake(o);
  f.items.set(LEGACY_KEY, { v: A.join(' '), auth: false });
  return f;
}

test('abertura de instalação antiga: cria as chaves do dia sem pedir nada e mantém o item antigo', async () => {
  const f = oldInstall();
  const k = await bootVault(f.deps);
  assert.deepEqual(k, { v: 2, seed: `seed:${A.join('-')}`, wallet: 'addr:abandonabout', at: 'legacy' });
  assert.deepEqual(f.prompts, [], 'nenhum pedido de biometria na abertura');
  assert.ok(f.items.has(LEGACY_KEY), 'a frase antiga não é apagada na abertura');
  assert.deepEqual(f.keys(), k, 'gravadas para a próxima abertura');
  // Segunda abertura: só lê as chaves do dia (a frase não precisa nem ser lida).
  f.items.delete(LEGACY_KEY);
  assert.deepEqual(await bootVault(f.deps), k);
});

test('aparelho sem identidade: abertura devolve null', async () => {
  assert.equal(await bootVault(fake().deps), null);
});

test('abertura não quebra se gravar as chaves do dia falhar: segue com elas na memória', async () => {
  const f = oldInstall();
  f.failKeys(true);
  const k = await bootVault(f.deps);
  assert.equal(k?.seed, `seed:${A.join('-')}`);
  assert.ok(f.items.has(LEGACY_KEY));
});

test('sem backup feito: a frase continua no item antigo (não arrisca perder) e o pedido é o de sempre', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  const r = await unlockPhrase(f.deps, { ...P, backedUp: false });
  assert.deepEqual(r, { status: 'ok', words: A });
  assert.deepEqual(f.prompts, ['device:Mostrar a frase']);
  assert.ok(f.items.has(LEGACY_KEY) && !f.items.has(BIO_KEY));
});

test('migração no primeiro uso sensível depois do backup: grava, lê de volta, só então apaga o antigo', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  const r = await unlockPhrase(f.deps, { ...P, backedUp: true });
  assert.deepEqual(r, { status: 'ok', words: A });
  assert.deepEqual(f.prompts, ['Proteger a frase', 'Mostrar a frase'], 'gravar (Android) e ler de volta; sem confirmDevice a mais');
  assert.equal(f.items.get(BIO_KEY)?.auth, true);
  assert.ok(!f.items.has(LEGACY_KEY), 'antigo apagado depois de conferir');
  assert.equal(f.keys().at, 'bio');
  const order = f.log.filter(l => !l.startsWith('del piu.phrase.bio'));
  assert.ok(order.indexOf(`set ${BIO_KEY}`) < order.lastIndexOf(`set ${KEYS_KEY}`) && order.lastIndexOf(`set ${KEYS_KEY}`) < order.indexOf(`del ${LEGACY_KEY}`), 'ordem: item novo → marca bio → apaga antigo');
  // Depois: só o pedido do sistema, ao ler o item com biometria.
  f.prompts.length = 0;
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'ok', words: A });
  assert.deepEqual(f.prompts, ['Mostrar a frase']);
});

test('restaurado pela frase/arquivo (known) também migra, mesmo sem o backup marcado', async () => {
  const f = fake();
  await storePhrase(f.deps, A, { known: true });
  const r = await unlockPhrase(f.deps, { ...P, backedUp: false });
  assert.equal(r.status, 'ok');
  assert.equal(f.keys().at, 'bio');
});

test('sem biometria forte (só PIN, ou sem bloqueio): fica como antes e as recusas continuam', async () => {
  const f = oldInstall({ strong: false });
  await bootVault(f.deps);
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'ok', words: A });
  assert.ok(f.items.has(LEGACY_KEY) && !f.items.has(BIO_KEY));
  const none = oldInstall({ strong: false, device: 'unavailable' });
  await bootVault(none.deps);
  assert.deepEqual(await unlockPhrase(none.deps, { ...P, backedUp: true }), { status: 'unavailable' }, 'sem bloqueio: quem chama recusa (M-01)');
  assert.deepEqual(await unlockPhrase(none.deps, { ...P, backedUp: true, allowWithoutLock: true }), { status: 'ok', words: A }, 'web (demonstração)');
  const denied = oldInstall({ strong: false, device: 'denied' });
  await bootVault(denied.deps);
  assert.deepEqual(await unlockPhrase(denied.deps, { ...P, backedUp: true }), { status: 'denied' });
});

test('cancelar o pedido da migração cancela a operação e mantém tudo como estava', async () => {
  for (const step of ['set', 'get'] as const) {
    const f = oldInstall();
    await bootVault(f.deps);
    f.setMode({ [step]: 'cancel' });
    assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'denied' }, step);
    assert.ok(f.items.has(LEGACY_KEY), `${step}: frase antiga intacta`);
    assert.ok(!f.items.has(BIO_KEY), `${step}: item novo desfeito`);
    assert.equal(f.keys().at, 'legacy');
    assert.equal(f.keys().retryAt, undefined, 'cancelar não adia a próxima tentativa');
    f.setMode({ [step]: 'ok' });
    assert.equal((await unlockPhrase(f.deps, { ...P, backedUp: true })).status, 'ok');
    assert.equal(f.keys().at, 'bio', `${step}: migra na próxima vez`);
  }
});

test('falha na migração (sem biometria, leitura diferente): segue pelo caminho antigo e tenta de novo em 24 h', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  f.setMode({ set: 'noBio' });
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'ok', words: A });
  assert.deepEqual(f.prompts, ['Proteger a frase', 'device:Mostrar a frase']);
  assert.ok(f.items.has(LEGACY_KEY) && !f.items.has(BIO_KEY));
  assert.equal(f.keys().retryAt, 1_000_000 + MIGRATE_RETRY_MS);
  f.setMode({ set: 'ok' });
  f.prompts.length = 0;
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  assert.deepEqual(f.prompts, ['device:Mostrar a frase'], 'dentro das 24 h, nem tenta');
  f.tick(MIGRATE_RETRY_MS + 1);
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  assert.equal(f.keys().at, 'bio');
  assert.equal(f.keys().retryAt, undefined);
});

test('leitura de volta diferente do gravado: desfaz e mantém o antigo', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  const realSet = f.deps.store.set;
  f.deps.store.set = async (k, v, auth) => realSet(k, k === BIO_KEY ? B.join(' ') : v, auth);
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'ok', words: A });
  assert.ok(f.items.has(LEGACY_KEY) && !f.items.has(BIO_KEY));
  assert.equal(f.keys().at, 'legacy');
});

test('marcar "bio" falhou: o item novo é desfeito e o antigo fica', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  f.failKeys(true);
  assert.equal((await unlockPhrase(f.deps, { ...P, backedUp: true })).status, 'ok');
  assert.ok(f.items.has(LEGACY_KEY) && !f.items.has(BIO_KEY));
});

test('travou entre marcar "bio" e apagar o antigo: a próxima leitura com biometria termina a limpeza', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  f.items.set(LEGACY_KEY, { v: A.join(' '), auth: false }); // o apagar não chegou a acontecer
  assert.equal((await unlockPhrase(f.deps, { ...P, backedUp: true })).status, 'ok');
  assert.ok(!f.items.has(LEGACY_KEY));
});

test('biometria trocada (chave invalidada): pede a frase de novo; conversas seguem (chaves do dia intactas)', async () => {
  const f = oldInstall();
  const boot = await bootVault(f.deps);
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  f.invalidate();
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'recover', reason: 'invalidated' });
  assert.deepEqual(await bootVault(f.deps), { ...boot, at: 'bio' }, 'a abertura (mensagens, segundo plano) não depende da biometria');
  assert.equal(await recoverPhrase(f.deps, B), false, 'frase de outra identidade é recusada');
  assert.equal(await recoverPhrase(f.deps, A), true);
  assert.equal(f.keys().at, 'legacy');
  assert.equal(f.keys().known, true);
  assert.equal(f.items.get(LEGACY_KEY)?.v, A.join(' '));
  assert.ok(!f.items.has(BIO_KEY), 'item invalidado removido');
});

test('biometria removida do aparelho: pede a frase de novo; cancelar/bloqueio só cancelam', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  f.setMode({ get: 'noBio' });
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'recover', reason: 'noBiometrics' });
  f.setMode({ get: 'cancel' });
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'denied' });
  f.setMode({ get: 'lockout' });
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'denied' });
  assert.equal(f.items.get(BIO_KEY)?.auth, true, 'cancelar nunca apaga a frase');
});

test('item com biometria sumiu mas o antigo ainda existe: usa o antigo e volta para "legacy"', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  await unlockPhrase(f.deps, { ...P, backedUp: false });
  f.items.set(KEYS_KEY, { v: JSON.stringify({ ...f.keys(), at: 'bio' }), auth: false });
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: false }), { status: 'ok', words: A });
  assert.equal(f.keys().at, 'legacy');
});

test('criar/restaurar: grava o antigo + chaves do dia e apaga o item com biometria de antes', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  const k = await storePhrase(f.deps, B);
  assert.deepEqual(k, { v: 2, seed: `seed:${B.join('-')}`, wallet: 'addr:legalyellow', at: 'legacy', known: false });
  assert.equal(f.items.get(LEGACY_KEY)?.v, B.join(' '));
  assert.ok(!f.items.has(BIO_KEY));
  assert.deepEqual(f.prompts.slice(2), [], 'gravar a frase nova não pede biometria');
});

test('apagar dados locais: some tudo', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  await unlockPhrase(f.deps, { ...P, backedUp: true });
  await storePhrase(f.deps, A);
  await wipeVault(f.deps);
  assert.equal(f.items.size, 0);
  assert.equal(await bootVault(f.deps), null);
});

test('frase lida que não bate com a semente guardada nunca é entregue', async () => {
  const f = oldInstall();
  await bootVault(f.deps);
  f.items.set(LEGACY_KEY, { v: B.join(' '), auth: false });
  assert.deepEqual(await unlockPhrase(f.deps, { ...P, backedUp: true }), { status: 'recover', reason: 'missing' });
  assert.ok(f.items.has(LEGACY_KEY), 'não apaga nada');
});

test('erros do pedido do sistema (Android e iPhone) viram cancelar, sem biometria ou outro', () => {
  assert.equal(classifyAuthError(new Error('User canceled the authentication. Cancel')), 'cancel');
  assert.equal(classifyAuthError(new Error('User canceled the operation.')), 'cancel');
  assert.equal(classifyAuthError(new Error('No biometrics are currently enrolled')), 'noBiometrics');
  assert.equal(classifyAuthError(new Error('No biometrics enrolled. x')), 'noBiometrics');
  assert.equal(classifyAuthError(new Error('No hardware available for biometric authentication.')), 'noBiometrics');
  assert.equal(classifyAuthError(new Error('Lockout. Too many attempts')), 'other');
  assert.equal(classifyAuthError('???'), 'other');
});
