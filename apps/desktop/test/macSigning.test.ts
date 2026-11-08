import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

/**
 * Assinatura do macOS (electron-builder.signing.cjs): com Developer ID o hardened runtime liga, e sem o
 * entitlement de áudio o macOS entrega o microfone mudo (a chamada sai sem voz, sem erro nenhum).
 */
const req = createRequire(import.meta.url);
const root = join(dirname(new URL(import.meta.url).pathname), '..');
const { desktopSigning } = req(join(root, 'electron-builder.signing.cjs')) as {
  desktopSigning(env: Record<string, string>, o?: { log?: boolean; platform?: string }): { mac: Record<string, unknown>; win: Record<string, unknown> };
};
const keys = (plist: string) => [...plist.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map(m => m[1]);

test('macOS com Developer ID: hardened runtime com microfone liberado no app e nos helpers', () => {
  const { mac } = desktopSigning({ CSC_NAME: 'Developer ID Application: Lunes (TEAM)' }, { log: false });
  assert.equal(mac.hardenedRuntime, true);
  for (const k of ['entitlements', 'entitlementsInherit'] as const) {
    const file = mac[k] as string;
    assert.ok(file.startsWith(root), `${k} do próprio Piu Desktop (o Provider não usa microfone): ${file}`);
    const on = keys(readFileSync(file, 'utf8'));
    assert.ok(on.includes('com.apple.security.device.audio-input'), `${k}: microfone`);
    assert.ok(on.includes('com.apple.security.cs.allow-jit'), `${k}: JIT do V8`);
    assert.ok(!on.includes('com.apple.security.device.camera'), `${k}: câmera continua fora`);
  }
});

test('macOS sem certificado: ad-hoc, sem hardened runtime nem entitlements (como antes)', () => {
  const { mac } = desktopSigning({}, { log: false });
  assert.equal(mac.identity, '-');
  assert.equal(mac.hardenedRuntime, false);
  assert.equal(mac.entitlements, undefined);
});

test('Info.plist: o texto do pedido de microfone vai no app (sem ele o macOS nega o microfone em silêncio)', () => {
  const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
  assert.match(yml, /\n {2}extendInfo:\n(?: {4}.*\n)*? {4}NSMicrophoneUsageDescription: \S/);
});
