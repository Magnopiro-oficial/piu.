import { describe, expect, it } from 'vitest';
import { nextStep, setupProgress, setupSteps, type SetupSignals } from './guide';

const fresh: SetupSignals = { keyBackedUp: false, payoutAddress: false, phoneConfirmed: false, neighbors: 0, otherDevices: 0 };
const ids = (s: SetupSignals) => setupSteps(s).map(x => [x.id, x.done]);

describe('primeiros passos', () => {
  it('nó recém-pareado: só o pareamento está feito', () => {
    expect(ids(fresh)).toEqual([['pair', true], ['backup', false], ['payout', false], ['phone', false], ['neighbor', false], ['device', false]]);
    expect(setupProgress(setupSteps(fresh))).toEqual({ done: 1, total: 5, complete: false });
  });

  it('o equipamento extra é opcional: sem ele o guia termina', () => {
    const steps = setupSteps({ keyBackedUp: true, payoutAddress: true, phoneConfirmed: true, neighbors: 2, otherDevices: 0 });
    expect(steps.find(s => s.id === 'device')?.optional).toBe(true);
    expect(setupProgress(steps)).toEqual({ done: 5, total: 5, complete: true });
    expect(nextStep(steps)).toBeNull();
  });

  it('sinal ainda não lido do nó fica pendente, sem contar como feito nem como falta', () => {
    const steps = setupSteps({ keyBackedUp: null, payoutAddress: null, phoneConfirmed: null, neighbors: null, otherDevices: 0 });
    expect(steps.filter(s => s.id !== 'pair').every(s => s.done === null || s.id === 'device')).toBe(true);
    expect(setupProgress(steps).complete).toBe(false);
    expect(nextStep(steps)).toBeNull();
  });

  it('o próximo passo é o primeiro obrigatório que falta, na ordem de importância', () => {
    expect(nextStep(setupSteps(fresh))?.id).toBe('backup');
    expect(nextStep(setupSteps({ ...fresh, keyBackedUp: true }))?.id).toBe('payout');
    expect(nextStep(setupSteps({ ...fresh, keyBackedUp: true, payoutAddress: true, phoneConfirmed: true }))?.id).toBe('neighbor');
  });

  it('um vizinho conectado e um equipamento adicionado contam', () => {
    const steps = setupSteps({ ...fresh, neighbors: 1, otherDevices: 1 });
    expect(steps.find(s => s.id === 'neighbor')?.done).toBe(true);
    expect(steps.find(s => s.id === 'device')?.done).toBe(true);
  });

  it('cada passo leva ao lugar certo do painel', () => {
    const go = Object.fromEntries(setupSteps(fresh).map(s => [s.id, s.go]));
    expect(go.backup).toEqual({ page: 'settings', anchor: 'cfg-key' });
    expect(go.payout).toEqual({ page: 'wallet' });
    expect(go.phone).toEqual({ page: 'settings', anchor: 'cfg-phones' });
    expect(go.neighbor).toEqual({ page: 'mesh' });
    expect(go.device).toEqual({ wizard: true });
  });

  it('todo passo explica em palavras simples por que importa', () => {
    for (const s of setupSteps(fresh)) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.why.length).toBeGreaterThan(20);
      expect(s.why).not.toMatch(/LNNP|SS58|step-up|hash/i);
    }
  });
});
