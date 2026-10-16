/**
 * Native E2E harness — launches the REAL Tauri app in an ISOLATED profile
 * and connects Playwright to the app's OWN WebView2 environments over CDP.
 *
 * Isolation contract:
 * - data root is a fresh temp dir (HAYDEV_DATA_DIR) — the real user profile
 *   under %APPDATA%\com.haydev.browser is never opened or cleaned;
 * - the fake LLM endpoint (local fixture) is injected via provider env so
 *   no model API is ever contacted;
 * - MCP binds a test-only port (MCP_SERVER_PORT);
 * - live switches are OFF (PROBE/RUNTIME_ACCEPTANCE/GEMINI_CERT/DIAG_SEARCH=0).
 *
 * CDP discovery: the app opens one debug port per WebView2 environment
 * (chrome shell + tab process). We scan the app's port ranges for
 * /json/version responders and classify them by target URLs — the chrome
 * environment serves the React shell (index.html), the tab environment
 * serves pab:// and http(s) pages. No pages()[0] guessing.
 */
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startFixtures, stopFixtures, fixtureServer } from './fixtures/server.mjs';

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..', '..');
const BIN_DEBUG = path.join(APP_ROOT, 'src-tauri', 'target', 'debug', 'app.exe');
const BIN_RELEASE = path.join(APP_ROOT, 'src-tauri', 'target', 'release', 'app.exe');

function httpJson(port, pathname = '/json/version', timeoutMs = 400) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { reject(new Error('timeout')); }, timeoutMs);
    const req = fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(timeoutMs) });
    req.then(async (r) => {
      clearTimeout(t);
      if (!r.ok) throw new Error(`http ${r.status}`);
      resolve(await r.json());
    }).catch((e) => { clearTimeout(t); reject(e); });
  });
}

async function discoverCdpPorts(log) {
  // Since the shell/default-environment merge there is ONE WebView2 browser
  // process (shell + default tabs share it) and therefore ONE DevTools port
  // in [9220..9259]. Agent/Private/DarkWeb envs have separate browser
  // processes whose port value collides (only the first environment binds).
  const deadline = Date.now() + 60_000;
  const seen = [];
  while (Date.now() < deadline) {
    for (let p = 9220; p <= 9259; p += 1) {
      try {
        const v = await httpJson(p);
        if (v && v.Browser) return [p];
      } catch { /* not listening */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CDP discovery failed: no responder in 9220..9259 (${log.join(' | ')})`);
}

export class AppHandle {
  constructor() {
    this.proc = null;
    this.vite = null;
    this.dataRoot = null;
    this.logsDir = null;
    this.chrome = null; // playwright Browser (chrome env)
    this.tabs = null;   // playwright Browser (tab env)
    this.ports = null;
    this.fixture = null;
  }

  async startVite() {
    // The DEBUG binary serves the renderer from the dev URL (Tauri dev
    // context): bring up the same vite server `tauri dev` would. Release
    // builds embed assets and skip this.
    const { spawn } = await import('node:child_process');
    this.vite = spawn(process.execPath,
      [path.join(APP_ROOT, 'node_modules/vite/bin/vite.js'), '-c', 'vite.renderer.config.ts', '--port', '5180', '--strictPort'],
      { cwd: APP_ROOT, stdio: 'ignore', windowsHide: true });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch('http://localhost:5180/', { signal: AbortSignal.timeout(800) });
        if (r.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('vite dev server did not come up on :5180');
  }

  async launch({ dataRoot = null, envOverrides = {} } = {}) {
    this.fixture = await startFixtures();
    const useRelease = process.env.HAYDEV_E2E_MODE === 'release';
    if (!useRelease) await this.startVite();
    const baseBin = process.env.HAYDEV_APP_BIN
      || (useRelease ? BIN_RELEASE : BIN_DEBUG);
    // A caller-supplied dataRoot (restart/persistence tests) is NEVER
    // deleted by stop() — the caller owns its lifecycle.
    this.evidenceDir = path.join(process.env.HAYDEV_EVIDENCE_DIR || path.join(APP_ROOT, '../artifacts/e2e'), `native-${Date.now()}`);
    mkdirSync(this.evidenceDir, { recursive: true });
    writeFileSync(path.join(this.evidenceDir, 'binary.json'), JSON.stringify({ path: baseBin,
      sha256: createHash('sha256').update(readFileSync(baseBin)).digest('hex'),
      identity: JSON.parse(execFileSync(baseBin, ['--build-identity'], { encoding: 'utf8', windowsHide: true })) }, null, 2));
    this.dataRootCreated = !dataRoot;
    this.dataRoot = dataRoot || mkdtempSync(path.join(tmpdir(), 'haydev-e2e-'));
    this.logsDir = this.dataRoot; // sanitized test logs live in the run dir
    const env = {
      ...process.env,
      HAYDEV_DATA_DIR: this.dataRoot,
      HAYDEV_QA_MODE: '1',
      HAYDEV_AUTOMATION_DEBUG: '1',
      MCP_SERVER_PORT: process.env.HAYDEV_MCP_TEST_PORT || '27901',
      HAYDEV_NO_ENGINES: process.env.HAYDEV_E2E_ENGINES === '1' ? '0' : '1',
      // Research search tool: point the app's SearXNG resolution at the
      // deterministic local fixture (P06). Unset in engine-mode runs.
      PAB_SEARXNG_URL: process.env.HAYDEV_E2E_ENGINES === '1' ? '' : fixtureServer.url('/searxng'),
      // Test-only fetch allowlist for the fixture origin (debug builds only;
      // release binaries cannot enable it — netguard.rs).
      HAYDEV_TEST_FETCH_ALLOW: `${fixtureServer.url('/')},http://localhost:5180/`,
      AI_PROVIDER: 'gemini',
      GEMINI_BASE_URL: fixtureServer.url('/v1'),
      GEMINI_API_KEY: 'e2e-fake-key-not-real',
      PROBE: '0',
      RUNTIME_ACCEPTANCE: '0',
      GEMINI_CERT: '0',
      DIAG_SEARCH: '0',
      ...envOverrides,
    };
    const logPath = path.join(this.logsDir, 'app-stdout.log');
    const out = [];
    this.spawnedAt = Date.now();
    this.proc = spawn(baseBin, [], { env, cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => { out.push(String(d)); });
    this.proc.stderr.on('data', (d) => { out.push(String(d)); });
    this.proc.on('exit', (code, sig) => out.push(`[exit code=${code} sig=${sig}]`));
    this._logRef = out;
    this._logPath = logPath;

    const ports = await discoverCdpPorts(out);
    this.ports = ports;
    // One shared browser process: shell (tauri.localhost / dev URL) and tab
    // pages live on the same CDP endpoint; the class helpers filter by URL.
    const [sharedPort] = ports;
    this.chrome = await chromium.connectOverCDP(`http://127.0.0.1:${sharedPort}`);
    this.tabs = this.chrome;
    // Diagnostics for native-set failures: page closes, renderer crashes
    // (WebView2 ProcessFailed surfaces as Target.targetCrashed), target
    // destruction, and app exit. No payloads — URLs and ids only.
    const diag = (msg) => out.push(`[HARNESS ${new Date().toISOString()}] ${msg}\n`);
    this.proc.on('exit', (code, sig) => diag(`app exit code=${code} sig=${sig}`));
    try {
      const diagSession = await this.chrome.newBrowserCDPSession();
      await diagSession.send('Target.setDiscoverTargets', { discover: true });
      diagSession.on('Target.targetCrashed', (e) => diag(`targetCrashed: targetId=${e?.targetId}`));
      diagSession.on('Target.targetDestroyed', (e) => diag(`targetDestroyed: targetId=${e?.targetId}`));
    } catch (e) { diag(`diagnostics unavailable: ${String(e).slice(0, 120)}`); }
    try {
      for (const page of this.tabs.contexts()[0].pages()) {
        page.on('close', () => diag(`page closed: ${page.url()}`));
      }
      this.tabs.contexts()[0].on('page', (p) => p.on('close', () => diag(`page closed: ${p.url()}`)));
    } catch (e) { diag(`page-close watch unavailable: ${String(e).slice(0, 120)}`); }
    // Playwright initializes downloads to deny on an attached context. Restore
    // WebView2's embedder policy so native DownloadStarting/StateChanged run.
    const downloadSession = await this.tabs.newBrowserCDPSession();
    await downloadSession.send('Browser.setDownloadBehavior', { behavior: 'default' });
    await downloadSession.detach();
    return this;
  }

  chromePage() {
    const ctx = this.chrome.contexts()[0];
    if (!ctx || ctx.pages().length === 0) throw new Error('chrome env: no pages');
    return ctx.pages().find((p) => /index\.html|localhost:5180|tauri\.localhost|commandbar/.test(p.url()))
      || ctx.pages()[0];
  }

  tabPages() {
    const ctx = this.tabs.contexts()[0];
    // One shared CDP browser: exclude the shell document from tab pages.
    return ctx ? ctx.pages().filter((p) => !/tauri\.localhost|localhost:5180|index\.html/.test(p.url())) : [];
  }

  /** The active tab id from the real registry (camelCase wire format). */
  async activeTabId(chromePage) {
    const tabs = await chromePage.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_tabs_list'));
    const active = (Array.isArray(tabs) ? tabs : []).find((x) => x?.isActive);
    if (!active) throw new Error(`no active tab in registry (${JSON.stringify(tabs)?.slice(0, 300)})`);
    return active.id;
  }

  async waitTabPage(urlPattern, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const page = this.tabPages().find((p) => urlPattern.test(p.url()));
      if (page) return page;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`tab page matching ${urlPattern} not found; have: ${this.tabPages().map((p) => p.url()).join(' | ')}`);
  }

  /** Dump sanitized stdout/stderr to the run dir and return the path. */
  flushLogs(runDir) {
    const text = (this._logRef || []).join('').replace(/(api[_-]?key|authorization|bearer)[=:]\s*\S+/gi, '$1=<redacted>');
    const p = path.join(runDir, 'app-stdout.log');
    writeFileSync(p, text || '(empty)');
    return p;
  }

  async stop({ runDir = null, graceful = false } = {}) {
    if (runDir) this.flushLogs(runDir);
    if (this.proc && this.proc.exitCode === null) {
      const { execSync } = await import('node:child_process');
      if (graceful) {
        // taskkill WITHOUT /F posts WM_CLOSE → Tauri runs the ExitRequested
        // path (session persist, engine stop). Escalate to /F only if the
        // app has not exited within the grace period.
        try { execSync(`taskkill /PID ${this.proc.pid}`, { stdio: 'ignore' }); } catch { /* gone */ }
        const deadline = Date.now() + 10_000;
        while (this.proc.exitCode === null && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      if (this.proc.exitCode === null) {
        try { execSync(`taskkill /PID ${this.proc.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
      }
    }
    if (this.vite && this.vite.exitCode === null) {
      const { execSync } = await import('node:child_process');
      try { execSync(`taskkill /PID ${this.vite.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
    }
    await new Promise((r) => setTimeout(r, 800));
    if (this.chrome) { await this.chrome.close().catch(() => {}); this.chrome = null; }
    if (this.tabs) { await this.tabs.close().catch(() => {}); this.tabs = null; }
    await stopFixtures();
    if (this.evidenceDir) this.flushLogs(this.evidenceDir);
    if (this.dataRoot && this.dataRootCreated && !process.env.HAYDEV_E2E_KEEP_DATA) {
      rmSync(this.dataRoot, { recursive: true, force: true });
    }
  }

  /** Assert no orphan processes reference this run's data root. */
  async assertNoOrphans() {
    const literal = this.dataRoot.replaceAll("'", "''");
    const listing = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${literal}') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    const lines = listing.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      throw new Error(`orphan processes still reference the test data root:\n${lines.join('\n')}`);
    }
    return true;
  }
}

export { APP_ROOT };
