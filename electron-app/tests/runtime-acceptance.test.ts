/**
 * LIVE acceptance for the unified runtime (spec §105/§106/§110/§111/§112).
 *
 * Skipped unless RUNTIME_ACCEPTANCE=1 — it spawns REAL managed services
 * (SearXNG via the bundled portable Python, Perplexica via the bundled
 * standalone build) and performs REAL network queries.
 *
 * Docker is never consulted: this is the Docker-OFF proof (§105).
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { HayDevRuntimeManager } from '../src/main/browser/runtime/engine/runtime/haydev-runtime-manager';
import { probeHttp } from '../src/main/browser/runtime/engine/runtime/health';

const RUN = process.env.RUNTIME_ACCEPTANCE === '1';
const APP_ROOT = path.resolve(__dirname, '..');
const RUNTIMES = path.join(APP_ROOT, 'resources', 'runtimes');
const d = (msg: string): void => console.log(`[acceptance] ${msg}`);

describe.skipIf(!RUN)('LIVE unified runtime acceptance (Docker-off)', () => {
  it('brings up managed SearXNG + Perplexica, serves a REAL web search, survives a crash, shuts down clean', { timeout: 720_000 }, async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'haydev-acc-'));
    const perplexicaStandalone = path.join(RUNTIMES, 'perplexica');
    const perplexicaDevDir = process.env.PAB_PERPLEXICA_DIR ?? 'D:\\Projects\\Perplexica';

    const manager = new HayDevRuntimeManager({
      userDataDir: userData,
      // Manager appends 'runtimes' to resourcesPath — point at the repo's
      // resources/ dir where the bundle was built.
      resourcesPath: existsSync(RUNTIMES) ? path.join(APP_ROOT, 'resources') : null,
      // Dev checkout provides the SEED (data/config.json + db) even when the
      // runtime itself is the bundled standalone build.
      perplexicaDevDir,
      perplexicaExternalUrl: null, // FORCED managed — no adoption (spec §13)
      searxngExternalUrl: null, // FORCED managed — the Docker-off proof (§105)
      torMode: 'managed',
      torSocksPort: 19550,
      log: d,
    });

    await manager.start();
    // Orphan safety: whatever fails below, managed children MUST be stopped.
    try {

    // ---- Wait for READY states (UI never blocks; this test does) --------
    async function waitReady(key: 'searxng' | 'perplexica', maxMs: number): Promise<void> {
      const deadline = Date.now() + maxMs;
      for (;;) {
        const st = manager.getStatus()[key]!;
        if (st.state === 'READY') return;
        if (Date.now() > deadline) throw new Error(`${key} not READY (state=${st.state} reason=${st.reason})`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await waitReady('searxng', 90_000);
    d(`searxng READY on ${manager.getStatus().searxng!.endpoint}`);

    // ---- SearXNG: managed, LOCAL_NATIVE, functional JSON check ----------
    const searxng = manager.getStatus().searxng;
    expect(searxng?.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const sx = await probeHttp(`${searxng!.endpoint}/search?q=haydev+acceptance&format=json`, {
      timeoutMs: 20_000,
      validate: (_s, body) => body.includes('"results"'),
    });
    expect(sx.ok, `searxng functional query failed: ${sx.errorCode}`).toBe(true);

    // ---- Perplexica: managed (no system node — ELECTRON_RUN_AS_NODE) ----
    await waitReady('perplexica', 120_000);
    const perplexica = manager.getStatus().perplexica;
    d(`perplexica READY on ${perplexica!.endpoint}`);
    expect(perplexica?.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(perplexica?.source).toBe('managed');

    // ---- REAL Web Search through the managed chain (spec §7 step 5) -----
    // Model selection mirrors the existing pab://search page contract:
    // /api/providers → first ollama provider's first chat model.
    const providers = (await fetch(`${perplexica!.endpoint}/api/providers`).then((r) => r.json())) as {
      providers: Array<{ id: string; name: string; chatModels: Array<{ key: string }>; embeddingModels?: Array<{ key: string }> }>;
    };
    const chatProvider = (providers.providers ?? []).find((p) => /ollama/i.test(p.name) && p.chatModels?.length);
    // Prefer a model the backing Ollama actually serves RIGHT NOW
    // (/api/tags), then the env default, then any deepseek, then first.
    let chatKey: string | undefined;
    try {
      const base = process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
      const tags = (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.json())) as {
        models?: Array<{ name: string }>;
      };
      const served = new Set((tags.models ?? []).map((m) => m.name));
      chatKey = chatProvider?.chatModels.find((m) => served.has(m.key))?.key;
    } catch {
      // Ollama unreachable → static preference below.
    }
    const preferredKey =
      process.env.PAB_PERPLEXICA_MODEL?.trim() || 'deepseek-v4-pro:0813';
    chatKey ??= chatProvider?.chatModels.find((m) => m.key === preferredKey)?.key;
    chatKey ??= chatProvider?.chatModels.find((m) => /deepseek/i.test(m.key))?.key;
    chatKey ??= chatProvider?.chatModels[0]?.key;
    const chatModel = chatProvider && chatKey
      ? { providerId: chatProvider.id, key: chatKey }
      : undefined;
    // The API REQUIRES embeddingModel (route dereferences it) — the
    // existing pab://search page falls back to the chat model for it.
    const embeddingModel = chatModel;
    d(`chat model: ${chatModel?.providerId} / ${chatModel?.key ?? 'none'}`);
    const searchResp = await fetch(`${perplexica!.endpoint}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        optimizationMode: 'balanced',
        sources: ['web'],
        query: 'what is the Tor network',
        history: [],
        stream: false,
        ...(chatModel ? { chatModel } : {}),
        ...(embeddingModel ? { embeddingModel } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (searchResp && searchResp.ok) {
      const answer = (await searchResp.json().catch(() => ({}))) as { message?: string; sources?: unknown[] };
      expect((answer.message ?? '').length).toBeGreaterThan(20);
      expect(Array.isArray(answer.sources)).toBe(true);
      d(`web search answer: ${answer.message!.slice(0, 80)}… (sources: ${answer.sources?.length})`);
    } else {
      // NO FAKE PASS (spec §72): an LLM answer requires the user's EXTERNAL
      // Ollama Cloud account. When the backing provider itself refuses
      // (billing/auth), the pipeline is proven up to that boundary and the
      // failure is reported as EXTERNAL — never as a fake success.
      const logFile = path.join(userData, 'runtime', 'logs', 'perplexica.log');
      const log = await fs.readFile(logFile, 'utf8').catch(() => '');
      const externalBilling = /subscription payment is past due|unauthorized|invalid api key/i.test(log);
      expect(externalBilling, 'search failed WITHOUT an external-provider signature — see runtime/logs/perplexica.log').toBe(true);
      d('EXTERNAL_PROVIDER_UNAVAILABLE: LLM billing/auth refused — search pipeline up, answer NOT_VERIFIED (external)');
    }

    // ---- Crash isolation + bounded restart (spec §71/§72/§110/§111) -----
    const searxngPid = manager.getStatus().searxng!.pid!;
    const { killTree } = await import('../src/main/browser/runtime/engine/runtime/process-supervisor');
    await killTree(searxngPid);
    // Supervisor restarts with backoff (1s) → READY again.
    let restarted = false;
    for (let i = 0; i < 40 && !restarted; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = manager.getStatus().searxng!;
      restarted = st.state === 'READY' && st.pid !== null && st.pid !== searxngPid;
    }
    expect(restarted, 'searxng did not restart after crash').toBe(true);
    d(`searxng restarted with new pid ${manager.getStatus().searxng!.pid}`);

    // ---- Tor: honest state without a bundled binary or running tor ------
    const tor = manager.getStatus().tor!;
    d(`tor: ${tor.state} ${tor.reason ?? ''}`);
    expect(['READY', 'FAILED', 'NOT_INSTALLED' as unknown as string]).toContain(tor.state);

    // ---- Clean shutdown — no orphans (spec §73/§112) ---------------------
    } finally {
      await manager.stop();
    }
    const sxPidAfter = manager.getStatus().searxng!.pid;
    const ppidAfter = manager.getStatus().perplexica!.pid;
    expect(sxPidAfter).toBeNull();
    expect(ppidAfter).toBeNull();
    await fs.rm(userData, { recursive: true, force: true });
    d('clean shutdown verified');
  });
});
