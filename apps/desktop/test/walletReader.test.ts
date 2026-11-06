import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { emptyWallet, WalletReader } from '../src/main/wallet';
import type { accountBalance } from '../../mobile/src/lib/lunesRpc';

test('leituras concorrentes usam a conta certa e preservam a privacidade', async () => {
  const calls: string[] = [];
  const resolve = new Map<string, (b: Awaited<ReturnType<typeof accountBalance>>) => void>();
  const read: typeof accountBalance = async (_rpc, address) => { calls.push(address); return new Promise(r => resolve.set(address, r)); };
  const r = new WalletReader(read);
  const a = r.read(emptyWallet('A', false)), aHidden = r.read(emptyWallet('A', true)), b = r.read(emptyWallet('B', false));
  assert.deepEqual(calls, ['A', 'B']);
  const value = (address: string, free: bigint): Awaited<ReturnType<typeof accountBalance>> => ({ address, free, exists: true, reserved: 0n, frozen: 0n, nonce: 0, block: 1, blockHash: '', endpoint: '' });
  resolve.get('B')!(value('B', 2n)); resolve.get('A')!(value('A', 1n));
  assert.equal((await b).free, '2');
  assert.equal((await a).free, '1');
  assert.equal((await aHidden).hidden, true);
  const again = r.read(emptyWallet('A', false));
  assert.deepEqual(calls, ['A', 'B', 'A']); resolve.get('A')!(value('A', 3n)); assert.equal((await again).free, '3');
});
