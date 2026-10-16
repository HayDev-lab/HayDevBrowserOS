import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputs = path.join(root, 'integrations/perplexica');
const lockBytes = readFileSync(path.join(inputs, 'source-lock.json'));
const lock = JSON.parse(lockBytes);
const digest = createHash('sha256').update(lockBytes).digest('hex');
const destination = path.join(root, '.cache/perplexica');
const marker = path.join(destination, '.haydev-source.json');
for (const [name, hash] of Object.entries(lock.files)) {
  const actual = createHash('sha256').update(readFileSync(path.join(inputs, name))).digest('hex');
  if (actual !== hash) throw new Error(`Integration input checksum mismatch: ${name}`);
}
const git = (...args) => execFileSync('git', ['-C', destination, ...args], { stdio: 'inherit' });
if (!existsSync(marker)) {
  if (existsSync(destination)) throw new Error('Incomplete integration directory; inspect it before moving it aside. No automatic reset.');
  mkdirSync(destination, { recursive: true });
  git('init');
  git('config', 'core.autocrlf', 'false');
  git('fetch', '--depth=1', lock.repository, lock.commit);
  git('checkout', '--detach', 'FETCH_HEAD');
  git('apply', '--check', path.join(inputs, 'integration.patch'));
  git('apply', path.join(inputs, 'integration.patch'));
  cpSync(path.join(inputs, 'overlay'), destination, { recursive: true });
  writeFileSync(marker, JSON.stringify({ digest, commit: lock.commit }, null, 2));
} else if (JSON.parse(readFileSync(marker)).digest !== digest) {
  throw new Error('Integration inputs changed; inspect and move the old generated checkout aside before preparing again.');
}
if (!process.argv.includes('--source-only')) {
  const npm = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'] : ['ci', '--no-audit', '--no-fund'];
  const env = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', NEXT_TELEMETRY_DISABLED: '1' };
  // This is a Node runtime, not Electron. Do not inherit a developer shell's
  // native-addon ABI/toolchain overrides from the retired Electron packager.
  for (const key of Object.keys(env)) if (/^(npm_config_(node_gyp|runtime|target|disturl)|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  execFileSync(npm, args, { cwd: destination, stdio: 'inherit', env });
}
console.log(`Prepared Perplexica ${lock.commit} with reviewed patch; inputs ${digest}`);
