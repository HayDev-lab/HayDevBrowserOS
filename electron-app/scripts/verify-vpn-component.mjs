import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../resources/vpn/', import.meta.url));
const lock = JSON.parse(readFileSync(path.join(root, 'source-lock.json'), 'utf8'));
assert.equal(lock.binary, 'arman-vpn-core.exe');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = path.join(root, lock.binary);
if (!existsSync(binary)) {
  const cache = path.resolve(root, '../../.cache/runtime-archives');
  mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `arman-vpn-${lock.version}-windows-x64.zip`);
  if (!existsSync(archive)) {
    const response = await fetch(lock.archive.url, { signal: AbortSignal.timeout(120_000) });
    assert.ok(response.ok, `VPN archive download failed with HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(bytes), lock.archive.sha256, 'VPN archive checksum mismatch');
    writeFileSync(archive, bytes, { flag: 'wx' });
  }
  assert.equal(sha256(readFileSync(archive)), lock.archive.sha256, 'VPN archive checksum mismatch');
  const bytes = execFileSync('tar', ['-xOf', archive, lock.archive.entry], { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(sha256(bytes), lock.sha256, 'Extracted VPN component checksum mismatch');
  writeFileSync(binary, bytes, { flag: 'wx' });
}
assert.ok(lstatSync(binary).isFile(), 'VPN component must be a regular file');
assert.equal(sha256(readFileSync(binary)), lock.sha256, 'VPN component checksum does not match its pinned release');
assert.ok(readFileSync(path.join(root, 'LICENSE.txt'), 'utf8').includes('GNU GENERAL PUBLIC LICENSE'));
console.log(`HayDevVPN component ${lock.version} verified.`);
