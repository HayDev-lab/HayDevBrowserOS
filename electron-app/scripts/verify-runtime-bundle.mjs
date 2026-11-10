import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const required = [
  'node/node.exe', 'node/LICENSE', 'tor/tor.exe', 'searxng/python/python.exe',
  'searxng/searxng-runner.py', 'perplexica/server.js', 'THIRD_PARTY_NOTICES.txt',
];

export function verifyRuntimeBundle(root) {
  assert.ok(lstatSync(root).isDirectory(), 'The packaged runtime directory must be a local directory');
  const manifest = JSON.parse(readFileSync(path.join(root, 'runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 1, 'Unsupported runtime manifest');
  const remaining = new Map(Object.entries(manifest.files));
  for (const file of required) assert.ok(remaining.has(file), `Missing required runtime: ${file}`);

  function verifyDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (entry.isDirectory()) {
        verifyDirectory(file);
        continue;
      }
      assert.ok(entry.isFile(), `Unexpected runtime entry: ${relative}`);
      if (relative === 'runtime-manifest.json') continue;
      const expected = remaining.get(relative);
      assert.ok(expected, `Unlisted runtime file: ${relative}`);
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected, `Runtime checksum mismatch: ${relative}`);
      remaining.delete(relative);
    }
  }

  verifyDirectory(root);
  assert.equal(remaining.size, 0, `Missing runtime files: ${[...remaining.keys()].slice(0, 5).join(', ')}`);
  return manifest;
}
