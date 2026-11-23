/**
 * Menus padrão (app, Editar, Exibir, Janela) com o texto do app. O Electron monta esses menus sozinho
 * a partir do `role`, mas os rótulos dele não seguem o idioma do app: saíam "Edit", "Services",
 * "Hide Piu Provider" em inglês no meio de um app em português. Aqui cada item leva o `role` (a
 * função continua sendo a nativa) e o rótulo traduzido.
 */
import type { MenuItemConstructorOptions } from 'electron';
import type { Key } from './i18n';

export type MenuItem = MenuItemConstructorOptions;
type T = (key: Key, vars?: Record<string, string | number>) => string;

const sep: MenuItem = { type: 'separator' };

export function standardMenus(t: T, o: { mac: boolean; packaged: boolean; name: string }): { app: MenuItem | null; edit: MenuItem; view: MenuItem; window: MenuItem } {
  const item = (role: NonNullable<MenuItem['role']>, key: Key, vars?: Record<string, string>): MenuItem => ({ role, label: t(key, vars) });
  const name = { name: o.name };
  return {
    app: o.mac ? {
      label: o.name,
      submenu: [
        item('about', 'menu.about', name), sep,
        item('services', 'menu.services'), sep,
        item('hide', 'menu.hide', name), item('hideOthers', 'menu.hideOthers'), item('unhide', 'menu.showAll'), sep,
        item('quit', 'menu.quitApp', name),
      ],
    } : null,
    edit: {
      label: t('menu.edit'),
      submenu: [
        item('undo', 'menu.undo'), item('redo', 'menu.redo'), sep,
        item('cut', 'menu.cut'), item('copy', 'menu.copy'), item('paste', 'menu.paste'), item('selectAll', 'menu.selectAll'),
      ],
    },
    view: {
      label: t('menu.view'),
      submenu: [
        item('reload', 'menu.reload'), ...(o.packaged ? [] : [item('toggleDevTools', 'menu.devTools')]), sep,
        item('resetZoom', 'menu.resetZoom'), item('zoomIn', 'menu.zoomIn'), item('zoomOut', 'menu.zoomOut'), sep,
        item('togglefullscreen', 'menu.fullscreen'),
      ],
    },
    window: {
      label: t('menu.window'), role: 'window',
      submenu: o.mac
        ? [item('minimize', 'menu.minimize'), item('zoom', 'menu.zoom'), sep, item('front', 'menu.front')]
        : [item('minimize', 'menu.minimize'), item('close', 'menu.close')],
    },
  };
}
