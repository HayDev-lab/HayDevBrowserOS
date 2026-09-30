/**
 * HayDevRuntimeManager — ONE owner for all internal backend engines
 * (spec §2/§8/§9/§33/§72/§73):
 *
 *   Perplexica (Web Search / Research backend)   SearchRuntime
 *   SearXNG    (search engine behind Perplexica) SearchRuntime
 *   Tor        (SOCKS gateway for onion mode)    TorRuntime
 *
 * Lifecycle: start() is async and non-blocking — the UI never waits
 * (spec §33). A crashing engine NEVER takes the browser down (spec §72);
 * only that engine goes DEGRADED/FAILED while the supervisor's bounded
 * restart policy tries to bring it back (spec §71).
 *
 * Endpoint resolution order (spec §26/§82 — dev zero-change, zero Docker):
 *   1. EXTERNAL healthy URL from env (PAB_PERPLEXICA_URL / PAB_SEARXNG_URL)
 *      → adopted, no process spawned (dev convenience, current behaviour);
 *   2. BUNDLED managed runtime under resources/runtimes (packaged app);
 *   3. DEV managed runtime from a configured checkout (PAB_PERPLEXICA_DIR)
 *      with a production build;
 *   4. honest DEGRADED/FAILED — never a silent fake.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { ProcessSupervisor } from './process-supervisor';
import { PortManager } from '../pure/port-manager';
import { PerplexicaService, SearxngService, type PerplexicaRuntime, type SearxngRuntime } from './search-services';
import { TorService } from './tor-service';
import { probeHttp } from './health';
import type { ServiceStatus } from './managed-service';

export interface RuntimeManagerDeps {
  userDataDir: string;
  /** process.resourcesPath in packaged apps; null in dev. */
  resourcesPath: string | null;
  /** Dev checkout (PAB_PERPLEXICA_DIR). */
  perplexicaDevDir: string | null;
  /** Explicit external endpoints (env). */
  perplexicaExternalUrl: string | null;
  searxngExternalUrl: string | null;
  torMode: 'managed' | 'external';
  torSocksPort: number;
  log?: (msg: string) => void;
  now?: () => number;
}

export interface RuntimeStatus {
  perplexica: ServiceStatus | null;
  searxng: ServiceStatus | null;
  tor: ServiceStatus | null;
  startedAt: number | null;
}

const PREFERRED = {
  perplexica: 3000,
  searxng: 8888,
  torSocks: 9050,
  torControl: 9051,
};

export class HayDevRuntimeManager {
  private readonly supervisor: ProcessSupervisor;
  private readonly ports = new PortManager();
  private perplexica: PerplexicaService | null = null;
  private searxng: SearxngService | null = null;
  private tor: TorService | null = null;
  private startedAt: number | null = null;
  private startPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly deps: RuntimeManagerDeps) {
    this.supervisor = new ProcessSupervisor({
      logsDir: path.join(deps.userDataDir, 'runtime', 'logs'),
      now: deps.now,
    });
  }

  private log(msg: string): void {
    this.deps.log?.(msg);
  }

  // ---------------------------------------------------------------------------
  // Bundled / dev runtime discovery (read-only, spec §76/§77)
  // ---------------------------------------------------------------------------

  private runtimesRoot(): string | null {
    if (this.deps.resourcesPath) {
      const p = path.join(this.deps.resourcesPath, 'runtimes');
      return existsSync(p) ? p : null;
    }
    // Dev: the electron-app repo may carry a local bundle (scripts/bundle-runtimes).
    const devBundle = path.join(__dirname, '..', '..', 'resources', 'runtimes');
    return existsSync(devBundle) ? devBundle : null;
  }

  private perplexicaRuntime(): PerplexicaRuntime {
    const root = this.runtimesRoot();
    const bundled = root ? path.join(root, 'perplexica') : null;
    if (bundled && existsSync(path.join(bundled, 'server.js'))) {
      return { standaloneDir: bundled, devDir: null, seedDataDir: this.deps.perplexicaDevDir ? path.join(this.deps.perplexicaDevDir, 'data') : null };
    }
    if (this.deps.perplexicaDevDir) {
      const dir = this.deps.perplexicaDevDir;
      const nextBin = path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
      if (existsSync(nextBin)) {
        return { standaloneDir: null, devDir: { dir, nextBin }, seedDataDir: path.join(dir, 'data') };
      }
    }
    return { standaloneDir: null, devDir: null, seedDataDir: null };
  }

  private searxngRuntime(): SearxngRuntime {
    const root = this.runtimesRoot();
    if (!root) return { pythonDir: null, appDir: null, runnerPy: null };
    const base = path.join(root, 'searxng');
    const pythonDir = process.platform === 'win32' ? path.join(base, 'python') : path.join(base, 'python');
    const appDir = path.join(base, 'app');
    const runnerPy = path.join(base, 'searxng-runner.py');
    if (existsSync(pythonDir) && existsSync(appDir) && existsSync(runnerPy)) {
      return { pythonDir, appDir, runnerPy };
    }
    return { pythonDir: null, appDir: null, runnerPy: null };
  }

  private torBinaryPath(): string | null {
    const root = this.runtimesRoot();
    const bundled = root ? path.join(root, 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor') : null;
    return bundled && existsSync(bundled) ? bundled : null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle (spec §8/§33)
  // ---------------------------------------------------------------------------

  /** Async, non-blocking: the app shows its window immediately. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startedAt = Date.now();
    this.startPromise = this.startAll().catch((err) => {
      this.log(`[runtime] start error (browser continues): ${err instanceof Error ? err.message : 'unknown'}`);
    });
    return this.startPromise;
  }

  private async startAll(): Promise<void> {
    const now = this.deps.now;
    const common = (key: string, preferredPort: number, startTimeoutMs: number) => ({
      key,
      supervisor: this.supervisor,
      ports: this.ports,
      preferredPort,
      startTimeoutMs,
      healthIntervalMs: 15_000,
      healthTimeoutMs: 4_000,
      healthFailuresToDegrade: 2,
      now,
      log: (m: string) => this.log(m),
    });

    // ---- SearXNG (Perplexica wants its URL for config seeding) -----------
    this.searxng = new SearxngService({
      ...common('searxng', PREFERRED.searxng, 45_000),
      runtime: this.searxngRuntime(),
      configDir: path.join(this.deps.userDataDir, 'runtime', 'searxng'),
    });
    const searxngExternal = await resolveExternal(this.deps.searxngExternalUrl, (u) => this.probeSearxng(u));
    void this.searxng.start(searxngExternal).then((st) => {
      this.log(`[runtime] searxng ${st.state} via ${st.source} ${st.endpoint ?? ''}`);
    });

    // Wait (bounded) for the searxng endpoint so Perplexica's seeded config
    // can point at it; Perplexica itself stays non-blocking.
    await this.searxng.whenEndpointSettled(50_000);

    // ---- Perplexica -------------------------------------------------------
    this.perplexica = new PerplexicaService({
      ...common('perplexica', PREFERRED.perplexica, 60_000),
      runtime: this.perplexicaRuntime(),
      dataDir: path.join(this.deps.userDataDir, 'runtime', 'perplexica'),
      getSearxngUrl: () => this.searxng?.endpoint ?? null,
    });
    const perplexicaExternal = await resolveExternal(this.deps.perplexicaExternalUrl, (u) => probeHttp(`${u}/`, { timeoutMs: 3_000 }));
    void this.perplexica.start(perplexicaExternal).then((st) => {
      this.log(`[runtime] perplexica ${st.state} via ${st.source} ${st.endpoint ?? ''}`);
    });

    // ---- Tor (independent — starts in parallel) ---------------------------
    this.tor = new TorService({
      ...common('tor', this.deps.torSocksPort, 90_000),
      mode: this.deps.torMode,
      preferredControlPort: PREFERRED.torControl,
      dataDir: path.join(this.deps.userDataDir, 'runtime', 'tor', 'data'),
      probeHost: 'www.google.com', // only the CONNECT+remote-DNS path matters
      bundledTorPath: this.torBinaryPath(),
    });
    void this.tor.start().then((st) => {
      this.log(`[runtime] tor ${st.state} (${st.source}) progress=${st.progress}`);
    });
  }

  private probeSearxng(url: string) {
    return probeHttp(`${url}/search?q=ping&format=json`, {
      timeoutMs: 3_000,
      validate: (_s, body) => body.includes('"results"'),
    });
  }

  // ---------------------------------------------------------------------------
  // Queries (spec §86)
  // ---------------------------------------------------------------------------

  getStatus(): RuntimeStatus {
    return {
      perplexica: this.perplexica?.status() ?? null,
      searxng: this.searxng?.status() ?? null,
      tor: this.tor?.status() ?? null,
      startedAt: this.startedAt,
    };
  }

  getEndpoint(key: 'perplexica' | 'searxng'): string | null {
    if (key === 'perplexica') return this.perplexica?.endpoint ?? null;
    return this.searxng?.endpoint ?? null;
  }

  getSocksEndpoint(): { host: string; port: number } | null {
    return this.tor?.getSocksEndpoint() ?? null;
  }

  async restartService(key: 'perplexica' | 'searxng' | 'tor'): Promise<ServiceStatus | null> {
    if (key === 'perplexica' && this.perplexica) return this.perplexica.restart();
    if (key === 'searxng' && this.searxng) return this.searxng.restart();
    if (key === 'tor' && this.tor) return this.tor.restart();
    return null;
  }

  recentLogs(key: string, lines = 40): string[] {
    return this.supervisor.recentLogs(key, lines);
  }

  // ---------------------------------------------------------------------------
  // Shutdown (spec §73/§74): stop engines, then sweep the process tree.
  // ---------------------------------------------------------------------------

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.allSettled([
      this.perplexica?.stop(),
      this.searxng?.stop(),
      this.tor?.stop(),
    ]);
    await this.supervisor.stopAll();
    await this.supervisor.sweepOrphans();
    this.ports.releaseAll();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}

async function resolveExternal(url: string | null, probe: (u: string) => Promise<{ ok: boolean }>): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await probe(url);
    return r.ok ? url : null;
  } catch {
    return null;
  }
}
