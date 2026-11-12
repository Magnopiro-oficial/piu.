import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProbeButton, probeGateway } from '../src/renderer/guardianGateway';

/** Teste de internet controlado pelo teste: resolve quando a gente manda. */
function slowTest() {
  let resolve!: (ok: boolean) => void;
  const p = new Promise<boolean>(r => { resolve = r; });
  return { test: () => p, resolve };
}

function deps(test: () => Promise<boolean>, alive = () => true) {
  const log: string[] = [];
  return { log, d: { test, alive, setProbing: (b: boolean) => log.push(`probing:${b}`), setNoNet: (b: boolean) => log.push(`noNet:${b}`), enable: () => log.push('enable') } };
}

describe('probeGateway (Nível e limites)', () => {
  it('marca "testando" enquanto o teste roda e só liga a ponte com internet confirmada', async () => {
    const s = slowTest();
    const { log, d } = deps(s.test);
    const run = probeGateway(d);
    assert.deepEqual(log, ['probing:true']);
    s.resolve(true);
    await run;
    assert.deepEqual(log, ['probing:true', 'noNet:false', 'enable', 'probing:false']);
  });

  it('sem internet: não liga a ponte e mostra o aviso', async () => {
    const { log, d } = deps(async () => false);
    await probeGateway(d);
    assert.deepEqual(log, ['probing:true', 'noNet:true', 'probing:false']);
  });

  it('erro no teste conta como sem internet', async () => {
    const { log, d } = deps(async () => { throw new Error('x'); });
    await probeGateway(d);
    assert.deepEqual(log, ['probing:true', 'noNet:true', 'probing:false']);
  });

  it('resultado que chega depois de sair da tela não liga a ponte por trás da pessoa', async () => {
    const s = slowTest();
    let alive = true;
    const { log, d } = deps(s.test, () => alive);
    const run = probeGateway(d);
    alive = false;
    s.resolve(true);
    await run;
    assert.deepEqual(log, ['probing:true']);
  });
});

describe('ProbeButton (Salvar/Continuar em "Nível e limites")', () => {
  it('desabilitado e sem efeito enquanto o teste de internet roda (senão gravava gateway:false)', () => {
    let calls = 0;
    const el = ProbeButton({ probing: true, onClick: () => { calls++; }, children: 'Salvar' });
    assert.match(renderToStaticMarkup(el), /<button[^>]* disabled=""/);
    (el.props as { onClick: () => void }).onClick();
    assert.equal(calls, 0);
  });

  it('fora do teste: habilitado e chama a ação', () => {
    let calls = 0;
    const el = ProbeButton({ probing: false, onClick: () => { calls++; }, children: 'Salvar' });
    assert.doesNotMatch(renderToStaticMarkup(el), /disabled/);
    (el.props as { onClick: () => void }).onClick();
    assert.equal(calls, 1);
  });

  it('Salvar (EditLevel) e Continuar (assistente) da tela usam o ProbeButton com o estado "testando"', () => {
    const src = readFileSync(join(import.meta.dirname, '../src/renderer/screens/Guardian.tsx'), 'utf8');
    // Cada tela com o LevelPicker: o botão que avança (Salvar ou Continuar) vem logo antes dele.
    const pickers = [...src.matchAll(/<LevelPicker /g)].map(m => m.index);
    assert.equal(pickers.length, 2);
    for (const at of pickers) {
      const end = Math.max(src.lastIndexOf("t('common.save')", at), src.lastIndexOf("t('common.continue')", at));
      const open = src.lastIndexOf('<ProbeButton', end);
      assert.ok(open > src.lastIndexOf('<button', end), `botão em ${end} fora do ProbeButton`);
      assert.match(src.slice(open, end), /^<ProbeButton probing=\{probing\}/, `botão em ${end} precisa do estado "testando"`);
    }
  });
});
