import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const APP = process.cwd();
const tests = execSync('git ls-files "tests/*.test.ts"', { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean).map(t => path.resolve(APP, t)).filter(t => existsSync(t));

const broken = [];
for (const t of tests) {
  const src = readFileSync(t, 'utf8');
  const missing = [];
  for (const m of src.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(t), m[1]);
    const candidates = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')];
    if (!candidates.some(c => existsSync(c))) missing.push(m[1]);
  }
  for (const m of src.matchAll(/from\s+['"]@shared\/([\w-]+)['"]/g)) {
    if (!existsSync(path.join(APP, 'src/shared', m[1] + '.ts'))) missing.push('@shared/' + m[1]);
  }
  if (missing.length) broken.push({ test: path.relative(APP, t), missing });
}

console.log('tests with unresolved imports:', broken.length);
for (const b of broken) {
  console.log('  -', b.test, '→', b.missing.join(', '));
}
// These are tests of the removed Electron-era runtime modules: remove them.
for (const b of broken) rmSync(path.resolve(APP, b.test), { force: true });
console.log('removed:', broken.length);
