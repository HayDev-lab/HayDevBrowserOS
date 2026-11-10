import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifyRuntimeBundle } from './verify-runtime-bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtimeDir = path.join(root, 'resources', 'packaged-runtimes');
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

function prepareBundle(matches) {
  const cache = path.join(root, '.cache', 'runtime-preparation');
  mkdirSync(cache, { recursive: true });
  const lockPath = path.join(cache, 'prepare.lock');
  const lock = openSync(lockPath, 'wx');
  try {
    const job = mkdtempSync(path.join(cache, 'build-'));
    const staged = path.join(job, 'runtime');
    const previous = path.join(job, 'previous');
    execFileSync(process.execPath, [path.join(root, 'scripts', 'prepare-perplexica.mjs')], { cwd: root, stdio: 'inherit' });
    execFileSync(process.execPath, [path.join(root, 'scripts', 'bundle-runtimes.mjs')], {
      cwd: root, stdio: 'inherit', env: { ...process.env, HAYDEV_RUNTIME_STAGE: staged },
    });
    assert.ok(matches(verifyRuntimeBundle(staged)), 'Prepared runtimes do not match their source locks');
    if (existsSync(runtimeDir)) renameSync(runtimeDir, previous);
    try { renameSync(staged, runtimeDir); }
    catch (error) {
      if (existsSync(previous)) renameSync(previous, runtimeDir);
      throw error;
    }
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

if (process.platform === 'win32') {
  const lock = readJson('resources/runtime-lock.json');
  assert.equal(`win32-${process.arch}`, lock.platform, 'The Windows runtime bundle is available for x64');
  const expected = { archives: lock.archives, perplexica: readJson('integrations/perplexica/source-lock.json') };
  const matches = ({ archives, perplexica }) => isDeepStrictEqual({ archives, perplexica }, expected);
  const manifestPath = path.join(runtimeDir, 'runtime-manifest.json');
  const existing = existsSync(manifestPath) ? verifyRuntimeBundle(runtimeDir) : null;
  if (!existing || !matches(existing)) {
    assert.ok(existing || !existsSync(runtimeDir) || !readdirSync(runtimeDir).length, 'Incomplete runtime directory. Move it aside before preparing a fresh bundle.');
    prepareBundle(matches);
  }
  console.log('Windows runtime files verified for the Tauri installer.');
}
