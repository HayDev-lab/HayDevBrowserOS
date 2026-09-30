/**
 * Managed search services (spec §14/§16/§22–§28):
 *
 *   PerplexicaService — the backend engine behind Web Search / Research.
 *     Packaged runtime: Next standalone server.js spawned with
 *     ELECTRON_RUN_AS_NODE (NO system Node — spec §18/§19).
 *     Dev fallback: a configured Perplexica checkout with a production
 *     build (`next start` via the same as-node mechanism).
 *     DATA_DIR is isolated under userData and seeded once from the dev
 *     checkout, with search.searxngURL patched to the MANAGED SearXNG
 *     endpoint (spec §28/§29 — no docker hostnames, dynamic ports).
 *
 *   SearXNGService — LOCAL_NATIVE bundled Python runtime (no Docker,
 *     spec §22/§24/§25) or REMOTE URL fallback (spec §26). Health is a
 *     REAL functional JSON query (spec §27/§32).
 */
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { ManagedService, type ManagedServiceOptions, type ServiceStatus } from './managed-service';
import { probeHttp, type HealthResult } from './health';
import type { SpawnRequest } from './process-supervisor';

// ---------------------------------------------------------------------------
// Verified chat-model resolution (root-cause fix for the infinite spinner:
// Perplexica's live model list starts with keys that 404 for the account —
// e.g. models/gemini-2.5-flash — and a 404 inside generateObject makes the
// non-stream /api/search promise never settle).
// ---------------------------------------------------------------------------

/** Curated cheap+quality candidates, tried in order (spec §8/§9). */
export const PREFERRED_CHAT_MODELS: readonly string[] = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
];

interface ResolveOpts {
  perProbeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

let resolvedCache: Promise<string | null> | null = null;

/**
 * Probe candidates with a 1-token generation against the Gemini
 * OpenAI-compatible endpoint; resolve to the FIRST model that actually
 * answers 200. Cached for the process lifetime. Never throws.
 */
export function resolvePreferredChatModel(opts: ResolveOpts = {}): Promise<string | null> {
  if (resolvedCache) return resolvedCache;
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.perProbeTimeoutMs ?? 6_000;
  resolvedCache = (async () => {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) return null;
    const base = 'https://generativelanguage.googleapis.com/v1beta/openai';
    const candidates = [
      process.env.GEMINI_MODEL?.trim(),
      ...PREFERRED_CHAT_MODELS,
    ].filter((m): m is string => !!m && m.length > 0);
    for (const model of candidates) {
      try {
        const resp = await doFetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (resp.ok) return model;
      } catch {
        // probe failed → next candidate
      }
    }
    return null;
  })();
  return resolvedCache;
}

/** Test seam — drop the cached resolution. */
export function resetPreferredChatModelCache(): void {
  resolvedCache = null;
}

// ---------------------------------------------------------------------------
// Perplexica config: Gemini provider injection (Web Search / Research LLM)
// ---------------------------------------------------------------------------

/** Mirrors Perplexica's hashObj: sha256 over JSON with sorted keys. */
export function perplexicaConfigHash(config: Record<string, unknown>): string {
  const json = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(json).digest('hex');
}

export interface GeminiSeedOptions {
  apiKey: string;
  /** Preferred chat model key, e.g. "models/gemini-2.5-flash". */
  chatModelKey?: string;
}

/**
 * Build the Perplexica `gemini` modelProvider entry (native provider id
 * `gemini`, config { apiKey }, hash mirrors Perplexica's own hashObj).
 */
export function buildGeminiProviderEntry(opts: GeminiSeedOptions): Record<string, unknown> {
  const chatKey = opts.chatModelKey ?? process.env.GEMINI_MODEL?.trim() ?? 'models/gemini-2.5-flash';
  const liteKey = chatKey.replace('gemini-', 'gemini-').includes('flash-lite')
    ? chatKey
    : 'models/gemini-2.5-flash-lite';
  const config = { apiKey: opts.apiKey };
  return {
    id: 'gemini',
    name: 'Gemini',
    type: 'gemini',
    chatModels: [
      { name: 'Gemini Flash (preferred)', key: chatKey },
      { name: 'Gemini Flash Lite (cheapest)', key: liteKey },
    ],
    embeddingModels: [{ name: 'Gemini Embedding', key: 'models/gemini-embedding-001' }],
    config,
    hash: perplexicaConfigHash(config),
  };
}

/**
 * Ensure an `openai`-shaped provider entry exists for an OpenAI-compatible
 * endpoint (used for NVIDIA NIM: baseURL https://integrate.api.nvidia.com/v1).
 * The Perplexica registry maps id `openai` → its OpenAI provider class,
 * which sends `config.baseURL` + `config.apiKey` verbatim.
 */
export function ensureOpenAiCompatProvider(
  cfg: { modelProviders?: Array<Record<string, unknown>> },
  opts: { id: string; name: string; baseUrl: string; apiKey: string; models: Array<{ key: string; name: string }> }
): void {
  cfg.modelProviders = cfg.modelProviders ?? [];
  cfg.modelProviders = cfg.modelProviders.filter((p) => p.id !== opts.id);
  const config = { apiKey: opts.apiKey, baseURL: opts.baseUrl };
  cfg.modelProviders.unshift({
    id: opts.id,
    name: opts.name,
    type: 'openai',
    chatModels: opts.models,
    embeddingModels: [],
    config,
    hash: perplexicaConfigHash(config),
  });
}

/**
 * Ensure a `gemini` provider exists in a Perplexica config object (in
 * place). Existing non-gemini providers are preserved.
 */
export function ensureGeminiProvider(
  cfg: { modelProviders?: Array<Record<string, unknown>>; search?: { searxngURL?: string } },
  opts: GeminiSeedOptions
): void {
  cfg.modelProviders = cfg.modelProviders ?? [];
  cfg.modelProviders = cfg.modelProviders.filter((p) => p.id !== 'gemini');
  cfg.modelProviders.unshift(buildGeminiProviderEntry(opts));
}

// ---------------------------------------------------------------------------
// Perplexica
// ---------------------------------------------------------------------------

export interface PerplexicaRuntime {
  /** Directory containing the standalone server.js (bundled or dev build). */
  standaloneDir: string | null;
  /** Dev checkout with node_modules (used when standaloneDir is null). */
  devDir: null | { dir: string; nextBin: string };
  /** Source data dir to seed the managed DATA_DIR from (once). */
  seedDataDir: string | null;
}

export interface PerplexicaServiceOptions extends ManagedServiceOptions {
  runtime: PerplexicaRuntime;
  /** Writable instance dir (userData/runtime/perplexica). */
  dataDir: string;
  /** Resolved SearXNG URL for config.json seeding ('' → leave as-is). */
  getSearxngUrl: () => string | null;
  logName?: string;
}

export class PerplexicaService extends ManagedService {
  readonly name = 'Perplexica';

  constructor(protected readonly o: PerplexicaServiceOptions) {
    super(o);
  }

  protected async spawnRequest(port: number): Promise<SpawnRequest | null> {
    // Seed the isolated DATA_DIR BEFORE the server starts — Perplexica
    // requires data/config.json at startup (module evaluation time).
    await this.seedDataDir();
    const rt = this.o.runtime;
    const logName = this.o.logName ?? 'perplexica.log';
    if (rt.standaloneDir) {
      return {
        key: this.opts.key,
        command: process.execPath,
        args: [path.join(rt.standaloneDir, 'server.js')],
        cwd: rt.standaloneDir,
        asNode: true,
        logName,
        env: {
          PORT: String(port),
          HOSTNAME: '127.0.0.1',
          DATA_DIR: this.o.dataDir,
          NODE_ENV: 'production',
          // Hop-by-hop search tracing passthrough (opt-in diagnostics).
          ...(process.env.DIAG_SEARCH ? { DIAG_SEARCH: process.env.DIAG_SEARCH } : {}),
        },
        onExit: (info) => void this.handleChildExit(info),
      };
    }
    if (rt.devDir) {
      return {
        key: this.opts.key,
        command: process.execPath,
        args: [rt.devDir.nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'],
        cwd: rt.devDir.dir,
        asNode: true,
        logName,
        env: {
          DATA_DIR: this.o.dataDir,
          NODE_ENV: 'production',
        },
        onExit: (info) => void this.handleChildExit(info),
      };
    }
    return null; // RUNTIME_NOT_BUNDLED → honest FAILED (spec §72 semantics)
  }

  protected async checkHealth(endpoint: string): Promise<HealthResult> {
    // Any non-5xx proves the HTTP server answers (Perplexica / redirects).
    return probeHttp(endpoint + '/', { timeoutMs: this.opts.healthTimeoutMs, validate: (s) => s < 500 });
  }

  private async seedDataDir(): Promise<void> {
    // Seed the isolated DATA_DIR once (config + chats), then point SearXNG
    // at the MANAGED endpoint — never a docker hostname (spec §28).
    try {
      await fs.mkdir(this.o.dataDir, { recursive: true });
      const targetConfig = path.join(this.o.dataDir, 'data', 'config.json');
      const seed = this.o.runtime.seedDataDir;
      // Perplexica resolves its drizzle MIGRATIONS relative to DATA_DIR —
      // copy them from the runtime tree (standalone omits them there).
      const drizzleSource = this.o.runtime.standaloneDir
        ? path.join(this.o.runtime.standaloneDir, 'drizzle')
        : this.o.runtime.devDir
          ? path.join(this.o.runtime.devDir.dir, 'drizzle')
          : null;
      if (drizzleSource && exists(drizzleSource)) {
        await fs.cp(drizzleSource, path.join(this.o.dataDir, 'drizzle'), { recursive: true }).catch(() => {});
      }
      if (seed && !exists(targetConfig)) {
        await fs.mkdir(path.join(this.o.dataDir, 'data'), { recursive: true });
        const sourceConfig = path.join(seed, 'config.json');
        if (exists(sourceConfig)) {
          await fs.copyFile(sourceConfig, targetConfig).catch(() => {});
        }
        await fs.copyFile(path.join(seed, 'db.sqlite'), path.join(this.o.dataDir, 'data', 'db.sqlite')).catch(() => {});
      }
      const searxngUrl = this.o.getSearxngUrl();
      if (searxngUrl && exists(targetConfig)) {
        const raw = await fs.readFile(targetConfig, 'utf8');
        const cfg = JSON.parse(raw) as { search?: { searxngURL?: string } };
        cfg.search = { ...(cfg.search ?? {}), searxngURL: searxngUrl };
        await fs.writeFile(targetConfig, JSON.stringify(cfg, null, 2));
      }
      if (!exists(targetConfig)) {
        // No seed available (packaged install): bootstrap a minimal config
        // so the server boots; LLM providers are injected below from env.
        await fs.mkdir(path.join(this.o.dataDir, 'data'), { recursive: true });
        const minimal = {
          version: 1,
          setupComplete: true,
          preferences: {},
          personalization: {},
          modelProviders: [] as Array<Record<string, unknown>>,
          search: { searxngURL: searxngUrl ?? '' },
        };
        await fs.writeFile(targetConfig, JSON.stringify(minimal, null, 2));
      }
      // Gemini provider injection (Web Search / Research LLM): the key comes
      // from the environment at seed time and lives only in the isolated
      // userData config (never in the repo, spec §89).
      const geminiKey = process.env.GEMINI_API_KEY?.trim();
      if (geminiKey && exists(targetConfig)) {
        const raw = await fs.readFile(targetConfig, 'utf8');
        const cfg = JSON.parse(raw) as { modelProviders?: Array<Record<string, unknown>>; search?: { searxngURL?: string } };
        ensureGeminiProvider(cfg, {
          apiKey: geminiKey,
          chatModelKey: process.env.GEMINI_MODEL?.trim() || undefined,
        });
        await fs.writeFile(targetConfig, JSON.stringify(cfg, null, 2));
        this.log('[perplexica] gemini provider seeded into managed config');
      }
      // NVIDIA NIM provider (OpenAI-compatible) — alternative Web Search LLM.
      const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
      if (nvidiaKey && exists(targetConfig)) {
        const raw = await fs.readFile(targetConfig, 'utf8');
        const cfg = JSON.parse(raw) as { modelProviders?: Array<Record<string, unknown>>; search?: { searxngURL?: string } };
        ensureOpenAiCompatProvider(cfg, {
          id: 'openai',
          name: 'NVIDIA NIM',
          baseUrl: process.env.NVIDIA_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
          apiKey: nvidiaKey,
          models: [{ key: process.env.NVIDIA_MODEL?.trim() || 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (NVIDIA NIM)' }],
        });
        await fs.writeFile(targetConfig, JSON.stringify(cfg, null, 2));
        this.log('[perplexica] nvidia nim provider seeded into managed config');
      }
    } catch (err) {
      this.log(`[perplexica] seed failed (continuing): ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}

function exists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SearXNG
// ---------------------------------------------------------------------------

export interface SearxngRuntime {
  /** Bundled portable python root containing python.exe (LOCAL_NATIVE). */
  pythonDir: string | null;
  /** Bundled site-packages root with searx installed (LOCAL_NATIVE). */
  appDir: string | null;
  /** Runner script shipped next to the bundle. */
  runnerPy: string | null;
}

export interface SearxngServiceOptions extends ManagedServiceOptions {
  runtime: SearxngRuntime;
  /** Writable dir for the generated settings.yml (userData/runtime/searxng). */
  configDir: string;
  logName?: string;
}

export class SearxngService extends ManagedService {
  readonly name = 'SearXNG';

  constructor(protected readonly o: SearxngServiceOptions) {
    super(o);
  }

  protected async spawnSettings(port: number): Promise<string | null> {
    // settings.yml: loopback-only bind, dynamic port, JSON format ON —
    // verified by the functional health check (spec §27/§31).
    //
    // Engine policy (root-cause #2 of the dead search): on a native Windows
    // runtime most default engines are unreachable or bot-blocked from this
    // egress (duckduckgo — connection-level block, brave/qwant — 429/CAPTCHA,
    // mojeek/startpage — empty). keep_only restricts the tree to the two
    // engines verified with real queries (bing, google). CRITICAL: both must
    // ALSO be explicitly `disabled: false` — in SearXNG defaults they are
    // disabled, and default (no engines= param) queries run only enabled
    // engines, producing an instantly cached EMPTY result.
    try {
      await fs.mkdir(this.o.configDir, { recursive: true });
      const file = path.join(this.o.configDir, 'settings.yml');
      const yaml = [
        'use_default_settings:',
        '  engines:',
        '    keep_only:',
        '      - bing',
        '      - google',
        'engines:',
        '  - name: bing',
        '    disabled: false',
        '  - name: google',
        '    disabled: false',
        'server:',
        '  secret_key: "haydev-managed-instance-not-a-secret"',
        `  bind_address: "127.0.0.1"`,
        `  port: ${port}`,
        'outgoing:',
        '  request_timeout: 10.0',
        'search:',
        '  formats:',
        '    - html',
        '    - json',
        '',
      ].join('\n');
      await fs.writeFile(file, yaml);
      return file;
    } catch {
      return null;
    }
  }

  protected async spawnRequest(port: number): Promise<SpawnRequest | null> {
    const rt = this.o.runtime;
    if (!rt.pythonDir || !rt.appDir || !rt.runnerPy) return null;
    const settings = await this.spawnSettings(port);
    if (!settings) return null;
    const pythonExe = process.platform === 'win32'
      ? path.join(rt.pythonDir, 'python.exe')
      : path.join(rt.pythonDir, 'bin', 'python3');
    return {
      key: this.opts.key,
      command: pythonExe,
      args: [rt.runnerPy],
      cwd: rt.appDir,
      logName: this.o.logName ?? 'searxng.log',
      env: {
        SEARXNG_SETTINGS_PATH: settings,
        // The runner binds THIS port (settings.yml alone is not authoritative).
        SEARXNG_PORT: String(port),
        PYTHONPATH: rt.appDir,
        PYTHONHOME: rt.pythonDir,
      },
      onExit: (info) => void this.handleChildExit(info),
    };
  }

  /** REAL functional check: an actual search query with JSON output. */
  protected async checkHealth(endpoint: string): Promise<HealthResult> {
    return probeHttp(`${endpoint}/search?q=haydev+health&format=json`, {
      timeoutMs: this.opts.healthTimeoutMs,
      validate: (_s, body) => body.includes('"results"'),
    });
  }
}

export type { ServiceStatus };
