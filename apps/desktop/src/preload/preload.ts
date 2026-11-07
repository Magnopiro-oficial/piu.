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
  retryVault: () => call('retryVault'),
  exportIdentityBackup: password => call('exportIdentityBackup', password),
  suggestWords: p => call('suggestWords', p),
  eraseAll: () => call('eraseAll'),
  myCard: (kind, fresh) => call('myCard', kind, fresh),
  addContactByCard: text => call('addContactByCard', text),
  listConversations: () => call('listConversations'),
  listGroupCandidates: () => call('listGroupCandidates'),
  createGroup: options => call('createGroup', options),
  groupInviteCandidates: id => call('groupInviteCandidates', id),
  addGroupMembers: (id, ids) => call('addGroupMembers', id, ids),
  leaveGroup: id => call('leaveGroup', id),
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
  copy: text => call('copy', text),
  testNotification: () => call('testNotification'),
  setConversationOpen: open => call('setConversationOpen', !!open),
  setSecretVisible: (screen, visible) => call('setSecretVisible', screen, !!visible),
  linkStart: () => call('linkStart'),
  linkConfirm: word => call('linkConfirm', word),
  linkCancel: () => call('linkCancel'),
  linkStatus: () => call('linkStatus'),
  setMuted: (id, muted) => call('setMuted', id, !!muted),
  listBlocked: () => call('listBlocked'),
  blockContact: id => call('blockContact', id),
  unblockContact: id => call('unblockContact', id),
  setTemp: (id, mode) => call('setTemp', id, mode),
  typing: id => call('typing', id),
  storageUsage: () => call('storageUsage'),
  storageDetail: () => call('storageDetail'),
  clearConversation: id => call('clearConversation', id),
  clearRelayQueue: () => call('clearRelayQueue'),
  checkForUpdates: () => call('checkForUpdates'),
  openReleasePage: url => call('openReleasePage', url),
  appLockState: () => call('appLockState'),
  lockApp: () => call('lockApp'),
  unlockApp: password => call('unlockApp', password),
  setLockPassword: (current, next) => call('setLockPassword', current, next),
  removeLockPassword: current => call('removeLockPassword', current),
  updateState: () => call('updateState'),
  checkUpdate: () => call('checkUpdate'),
  downloadUpdate: () => call('downloadUpdate'),
  installUpdate: () => call('installUpdate'),
  dismissUpdate: () => call('dismissUpdate'),
  guardianState: () => call('guardianState'),
  guardianNetwork: () => call('guardianNetwork'),
  guardianTest: () => call('guardianTest'),
  guardianActivate: c => call('guardianActivate', c),
  guardianUpdate: p => call('guardianUpdate', p),
  guardianPause: paused => call('guardianPause', paused),
  guardianAdoptNetwork: () => call('guardianAdoptNetwork'),
  guardianSetWifi: w => call('guardianSetWifi', w),
  guardianEnd: () => call('guardianEnd'),
  copyImage: d => call('copyImage', d),
  on: (event: PiuEventName, cb) => {
    const channel = `piu:${event}`;
    const listener = (_e: unknown, payload: unknown) => cb(payload as never);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
};

contextBridge.exposeInMainWorld('piu', api);
