import assert from 'node:assert/strict';
import { test } from 'node:test';
import { externalUrl } from '../src/external.ts';

test('links externos: só https para os hosts da lista (explorer da Lunes)', () => {
  assert.equal(externalUrl('https://blockexplorer.lunes.io/'), 'https://blockexplorer.lunes.io/');
  assert.equal(externalUrl('https://blockexplorer.lunes.io/account/5Grw'), 'https://blockexplorer.lunes.io/account/5Grw');
  for (const bad of [
    'https://phishing.example/piu-backup', 'http://blockexplorer.lunes.io/', 'https://blockexplorer.lunes.io.evil.com/',
    'https://evil.com/?https://blockexplorer.lunes.io/', 'https://user@evil.com/', 'https://blockexplorer.lunes.io@evil.com/',
    'file:///etc/passwd', 'smb://blockexplorer.lunes.io/x', 'javascript:alert(1)', 'nao é url', '',
    'https://blockexplorer.lunes.io:8443/', 'https://sub.blockexplorer.lunes.io/',
  ]) assert.equal(externalUrl(bad), null, bad);
});
