/**
 * Ponte entre o renderer (React, em sandbox, sem Node) e o processo principal.
 * Só o que está em `PiuApi` passa; cada chamada vira um `ipcRenderer.invoke` e cada evento, um canal.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { PiuApi, PiuEventName } from '../shared/types';

const call = <T>(method: string, ...args: unknown[]) => ipcRenderer.invoke('piu', method, ...args) as Promise<T>;

const api: PiuApi = {
  getSession: () => call('getSession'),
  createIdentity: o => call('createIdentity', o),
  restoreIdentity: o => call('restoreIdentity', o),
  revealPhrase: () => call('revealPhrase'),
  exportIdentityBackup: password => call('exportIdentityBackup', password),
  suggestWords: p => call('suggestWords', p),
  eraseAll: () => call('eraseAll'),
  myCard: (kind, fresh) => call('myCard', kind, fresh),
  addContactByCard: text => call('addContactByCard', text),
  listConversations: () => call('listConversations'),
  listGroupCandidates: () => call('listGroupCandidates'),
  createGroup: options => call('createGroup', options),
  getMessages: id => call('getMessages', id),
  sendText: (id, text) => call('sendText', id, text),
  markRead: id => call('markRead', id),
  removeContact: id => call('removeContact', id),
  safetyCode: id => call('safetyCode', id),
  networkStatus: () => call('networkStatus'),
  addPeer: a => call('addPeer', a),
  removePeer: a => call('removePeer', a),
  wallet: () => call('wallet'),
  walletPayment: () => call('walletPayment'),
  requestWalletPayment: input => call('requestWalletPayment', input),
  setWalletAddress: a => call('setWalletAddress', a),
  refreshWallet: () => call('refreshWallet'),
  getPrefs: () => call('getPrefs'),
  setPrefs: p => call('setPrefs', p),
  openExternal: url => call('openExternal', url),
  copy: text => call('copy', text),
  testNotification: () => call('testNotification'),
  setConversationOpen: open => call('setConversationOpen', !!open),
  linkStart: () => call('linkStart'),
  linkConfirm: () => call('linkConfirm'),
  linkCancel: () => call('linkCancel'),
  linkStatus: () => call('linkStatus'),
  on: (event: PiuEventName, cb) => {
    const channel = `piu:${event}`;
    const listener = (_e: unknown, payload: unknown) => cb(payload as never);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
};

contextBridge.exposeInMainWorld('piu', api);
