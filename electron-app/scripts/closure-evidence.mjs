import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [runId, action, name, ...args] = process.argv.slice(2);
if (!/^[a-zA-Z0-9-]+$/.test(runId ?? '')) throw new Error('run-id required');
const out = resolve(root, 'artifacts/closure', runId);
mkdirSync(out, { recursive: true });
const manifestPath = resolve(out, 'run-manifest.json');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const sha = (data) => createHash('sha256').update(data).digest('hex');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
  runId, startedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
  status: 'INCOMPLETE', commands: [], snapshots: [], requirements: {}, artifacts: [],
};
const save = () => writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
// `m` re-reads the manifest before every mutation: gates may run concurrently.
// A fresh run has no file yet — the in-memory manifest is then the truth.
let m = manifest;
const reload = () => { m = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : manifest; };

// Build-input filtering. Transient probe profiles, generated checkouts and
// build outputs are NOT build inputs — they must never enter the fingerprint
// (r09 final-inputs accidentally carried a probe profile). Everything that
// IS an input stays: sources incl. deletions, lockfiles, configs, generators,
// pinned integration inputs, resources inputs, CI.
const INPUT_EXCLUDE = [
  /(^|\/)\.locprobe/, /(^|\/)\.locprobe-tools/, /(^|\/)\.noauto/, /(^|\/)\.r03probe/,
  /(^|\/)\.memprobe/, /(^|\/)\.abtest/, /(^|\/)\.vite\//, /(^|\/)\.cache\//, /(^|\/)target\//,
  /(^|\/)haydev-e2e-/, /(^|\/)node_modules\//, /(^|\/)qa-shots\//, /(^|\/)dist\//,
  /\.log$/, /(^|\/)\.env/, /mcp-token/, /ui-locale\.json/, /session\.json$/,
  /credentials\.vault/, /history\.json$/, /bookmarks\.json$/, /shield-allow\.json/,
  /privacy\.json$/, /performance\.json$/, /(^|\/)binary\.json$/,
];
const isInput = (p) => !INPUT_EXCLUDE.some((re) => re.test(p));

if (action === 'snapshot') {
  if (existsSync(resolve(out, `${name}-source.json`))) throw new Error(`snapshot ${name} already exists in ${runId}; use a unique name — evidence is never overwritten`);
  const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0'))]
    .filter(p => p && !p.startsWith('artifacts/') && isInput(p)).sort();
  const files = paths.map(path => ({ path, sha256: existsSync(resolve(root, path)) ? sha(readFileSync(resolve(root, path))) : null }));
  const excluded = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    .filter(p => p && !p.startsWith('artifacts/') && !isInput(p)).length;
  const buildInputs = files.filter(f => f.path.startsWith('electron-app/') || f.path.startsWith('.github/'));
  const snapshot = { name, at: new Date().toISOString(), head: git('rev-parse', 'HEAD'),
    treeSha256: sha(JSON.stringify(files)), buildInputsSha256: sha(JSON.stringify(buildInputs)),
    files, buildInputFiles: buildInputs.length, excludedTransientPaths: excluded };
  writeFileSync(resolve(out, `${name}-source.json`), JSON.stringify(snapshot, null, 2) + '\n');
  writeFileSync(resolve(out, `${name}-git-status.txt`), git('status', '--short') + '\n');
  reload();
  m.snapshots.push({ ...snapshot, files: `${name}-source.json` });
  save(); console.log(JSON.stringify({ ...snapshot, files: files.length }));
} else if (action === 'verify-inputs') {
  // Compare the CURRENT tree/build-inputs against a named snapshot and record
  // the verdict in the manifest — build identity must not rely on an env
  // string alone.
  if (!name) throw new Error('verify-inputs <snapshot-name>');
  const snapPath = resolve(out, `${name}-source.json`);
  if (!existsSync(snapPath)) throw new Error(`snapshot ${name} not found`);
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  const diffs = [];
  for (const f of snap.files) {
    const cur = existsSync(resolve(root, f.path)) ? sha(readFileSync(resolve(root, f.path))) : null;
    if (cur !== f.sha256) diffs.push({ path: f.path, before: (f.sha256 ?? 'absent').slice(0, 12), after: (cur ?? 'absent').slice(0, 12), buildInput: f.path.startsWith('electron-app/') || f.path.startsWith('.github/') });
  }
  const buildInputDiffs = diffs.filter(d => d.buildInput);
  const verdict = { snapshot: name, at: new Date().toISOString(), inputsUnchanged: buildInputDiffs.length === 0,
    treeUnchanged: diffs.length === 0, diffs, buildInputDiffs };
  reload();
  (m.inputVerifications ??= []).push(verdict);
  save(); console.log(JSON.stringify({ inputsUnchanged: verdict.inputsUnchanged, treeUnchanged: verdict.treeUnchanged, diffCount: diffs.length, buildInputDiffCount: buildInputDiffs.length }));
} else if (action === 'requirement') {
  // requirement <ID> <STATUS> <command> [log] — one entry per source MUST.
  // The ID takes the `name` slot: closure-evidence <run> requirement <ID> <STATUS> ...
  const [status, command, log] = args;
  if (!name || !status) throw new Error('requirement <ID> <PASS|FAIL|NOT_RUN|BLOCKED_EXTERNAL> <command> [log]');
  reload();
  m.requirements[name] = { status, command: command ?? '', log: log ?? '', recordedAt: new Date().toISOString() };
  save(); console.log(JSON.stringify({ id: name, ...m.requirements[name] }));
} else if (action === 'artifact') {
  // artifact <label> <path> — record SHA-256 + provenance of a built artifact.
  if (!name || !args[0]) throw new Error('artifact <label> <path>');
  const p = resolve(root, args[0]);
  if (!existsSync(p)) throw new Error(`artifact missing: ${args[0]}`);
  reload();
  const lastSnapshot = m.snapshots.at(-1);
  const entry = { label: name, path: args[0], sha256: sha(readFileSync(p)), recordedAt: new Date().toISOString(),
    builtAfterSnapshot: lastSnapshot?.name, snapshotBuildInputsSha256: lastSnapshot?.buildInputsSha256 };
  m.artifacts.push(entry);
  save(); console.log(JSON.stringify(entry));
} else if (action === 'run') {
  const [executable, ...commandArgs] = args;
  if (!name || !executable) throw new Error('run <gate> <executable> [args]');
  if (existsSync(resolve(out, `${name}.log`))) throw new Error(`log ${name}.log already exists in ${runId}; use a unique gate name — evidence is never overwritten`);
  const log = resolve(out, `${name}.log`);
  const source = manifest.snapshots.at(-1);
  const env = { ...process.env, HAYDEV_BUILD_INPUT_SHA256: source?.buildInputsSha256 ?? 'unrecorded', HAYDEV_BUILD_HEAD: manifest.head, HAYDEV_EVIDENCE_DIR: out };
  const binary = resolve(root, 'electron-app/src-tauri/target', process.env.HAYDEV_E2E_MODE === 'release' ? 'release' : 'debug', 'app.exe');
  const record = { name, command: [executable, ...commandArgs], cwd: 'electron-app', startedAt: new Date().toISOString(), log: `${name}.log`, sourceSnapshot: source?.name, buildInputsSha256: source?.buildInputsSha256, binaryBeforeSha256: existsSync(binary) ? sha(readFileSync(binary)) : null };
  writeFileSync(log, JSON.stringify(record) + '\n');
  const isCmd = process.platform === 'win32' && /^(npm|npx)$/.test(executable);
  const child = spawn(isCmd ? 'cmd.exe' : executable, isCmd ? ['/d', '/s', '/c', [executable, ...commandArgs].join(' ')] : commandArgs,
    { cwd: resolve(root, 'electron-app'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => appendFileSync(log, b));
  child.on('error', e => appendFileSync(log, String(e) + '\n'));
  child.on('close', code => {
    record.binaryAfterSha256 = existsSync(binary) ? sha(readFileSync(binary)) : null;
    record.exitCode = code ?? -1; record.finishedAt = new Date().toISOString();
    // Reload: independent gates may finish concurrently.
    const latest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    latest.commands.push(record); writeFileSync(manifestPath, JSON.stringify(latest, null, 2) + '\n');
    console.log(JSON.stringify(record));
    console.log(readFileSync(log, 'utf8').split('\n').slice(-35).join('\n'));
    process.exitCode = record.exitCode;
  });
} else { throw new Error('expected snapshot | verify-inputs | requirement | artifact | run'); }
