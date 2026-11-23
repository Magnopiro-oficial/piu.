import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, translator } from '../src/i18n.ts';
import { standardMenus, type MenuItem } from '../src/menu.ts';

/** Todos os itens de um menu, com os dos submenus. */
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap(i => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu as MenuItem[]) : [])]);
const roles = (m: MenuItem) => flat(m.submenu as MenuItem[]).map(i => i.role).filter(Boolean);

test('menus padrão: todo item tem texto do app (o Electron sozinho mostra "Edit", "Hide", "Services" em inglês)', () => {
  for (const lang of LANGS) {
    for (const mac of [true, false]) {
      const m = standardMenus(translator(lang), { mac, packaged: true, name: 'Piu Provider' });
      for (const i of flat([...(m.app ? [m.app] : []), m.edit, m.view, m.window])) {
        if (i.type === 'separator') continue;
        assert.ok(typeof i.label === 'string' && i.label.trim().length > 0, `${lang}: item ${i.role} sem texto`);
      }
    }
  }
});

test('menus padrão em pt-BR: Editar, Exibir e Janela em português, com as mesmas funções de antes', () => {
  const m = standardMenus(translator('pt-BR'), { mac: true, packaged: true, name: 'Piu Provider' });
  assert.equal(m.edit.label, 'Editar');
  assert.deepEqual(roles(m.edit), ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  assert.equal(m.view.label, 'Exibir');
  assert.deepEqual(roles(m.view), ['reload', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']);
  assert.equal(m.window.label, 'Janela');
  assert.deepEqual(roles(m.window), ['minimize', 'zoom', 'front']);
  // Menu do app (macOS): o nome do app entra no texto.
  assert.deepEqual(roles(m.app!), ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']);
  const labels = flat([m.app!]).map(i => i.label);
  assert.ok(labels.includes('Sobre o Piu Provider'));
  assert.ok(labels.includes('Ocultar o Piu Provider'));
  assert.ok(labels.includes('Encerrar o Piu Provider'));
});

test('menus padrão: fora do macOS não há menu do app, a janela fecha pelo menu, e as ferramentas de desenvolvedor só aparecem fora do pacote', () => {
  const win = standardMenus(translator('en'), { mac: false, packaged: true, name: 'Piu Provider' });
  assert.equal(win.app, null);
  assert.deepEqual(roles(win.window), ['minimize', 'close']);
  const dev = standardMenus(translator('en'), { mac: false, packaged: false, name: 'Piu Provider' });
  assert.ok(roles(dev.view).includes('toggleDevTools'));
  assert.ok(!roles(win.view).includes('toggleDevTools'));
});
