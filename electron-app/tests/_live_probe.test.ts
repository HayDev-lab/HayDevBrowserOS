/**
 * One-off live probe (gated PROBE=1, not part of the default suite):
 * managed runtime + a single /api/search request to a chosen provider with a
 * generous timeout, then the Perplexica log diag/error tail.
 *   PROVIDER=openai|gemini TIMEOUT_MS=240000 DIAG_SEARCH=1 PROBE=1 \
 *     node node_modules/vitest/vitest.mjs run tests/_live_probe.test.ts
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HayDevRuntimeManager } from '../src/main/browser/runtime/engine/runtime/haydev-runtime-manager';

const RUN = process.env.PROBE === '1';
const APP_ROOT = path.resolve(__dirname, '..');
const RUNTIMES = path.join(APP_ROOT, 'resources', 'runtimes');
const PROVIDER = process.env.PROVIDER || 'openai';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 240_000);
const d = (m: string): void => console.log(`[probe] ${m}`);

describe.skipIf(!RUN)(`single-provider research probe (${PROVIDER})`, () => {
  it(
    'runs one /api/search request end to end',
    { timeout: 600_000 },
    async () => {
      const userData = mkdtempSync(path.join(os.tmpdir(), 'haydev-probe-'));
      const manager = new HayDevRuntimeManager({
        userDataDir: userData,
        resourcesPath: existsSync(RUNTIMES) ? path.join(APP_ROOT, 'resources') : null,
        perplexicaDevDir: process.env.PAB_PERPLEXICA_DIR ?? 'D:\\Projects\\Perplexica',
        perplexicaExternalUrl: null,
        searxngExternalUrl: null,
        torMode: 'managed',
        torSocksPort: 19550,
        log: d,
      });
      await manager.start();
      try {
        const waitReady = async (key: 'perplexica' | 'searxng', maxMs: number) => {
          const deadline = Date.now() + maxMs;
          for (;;) {
            const st = manager.getStatus()[key]!;
            if (st.state === 'READY') return st;
            if (Date.now() > deadline) throw new Error(`${key} not READY (${st.state}/${st.reason})`);
            await new Promise((r) => setTimeout(r, 400));
          }
        };
        const px = await waitReady('perplexica', 120_000);
        await waitReady('searxng', 90_000);
        const P = px.endpoint!;

        const providers = (await (
          await fetch(`${P}/api/providers`)
        ).json()) as {
          providers: Array<{ id: string; chatModels: Array<{ key: string }>; embeddingModels?: Array<{ key: string }> }>;
        };
        const list = providers.providers || [];
        const target = list.find((p) => p.id === PROVIDER) ?? list[0]!;
        const gemini = list.find((p) => p.id === 'gemini');
        // Prefer a live model over the list head (list may contain dead ones).
        const PREFERRED = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
        const pickModel = (models: Array<{ key: string }>): string => {
          for (const pref of PREFERRED) {
            const hit = models.find(
              (m) => m.key === pref || m.key === `models/${pref}` || m.key.endsWith(`/${pref}`),
            );
            if (hit) return hit.key;
          }
          return models[0]!.key;
        };
        d(`provider=${target.id} models=${target.chatModels.map((m) => m.key).join(',')}`);
        const body = {
          optimizationMode: 'balanced',
          sources: ['web'],
          query: 'Latest OpenAI developments',
          history: [],
          stream: false,
          chatModel: { providerId: target.id, key: pickModel(target.chatModels) },
          embeddingModel: gemini?.embeddingModels?.length
            ? { providerId: 'gemini', key: gemini.embeddingModels[0]!.key }
            : { providerId: target.id, key: pickModel(target.chatModels) },
        };
        const t0 = Date.now();
        const resp = await fetch(`${P}/api/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await resp.text();
        d(`HTTP ${resp.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        try {
          const j = JSON.parse(text) as {
            message?: string;
            sources?: Array<{ metadata?: { url?: string }; url?: string }>;
            error?: unknown;
          };
          d(`message: ${(j.message || '').slice(0, 140)}`);
          const srcs = (j.sources || []).map(
            (s) => (s.metadata && s.metadata.url) || s.url || '',
          );
          d(`sources=${srcs.length}`);
          d(`first: ${JSON.stringify(srcs.slice(0, 4))}`);
          if (j.error) d(`error: ${JSON.stringify(j.error)}`);
          expect(resp.status).toBe(200);
          expect((j.sources || []).length).toBeGreaterThan(0);
        } catch {
          d(`non-JSON body: ${text.slice(0, 300)}`);
          throw new Error('non-JSON response');
        }
      } finally {
        await manager.stop();
        const logPath = path.join(userData, 'runtime', 'logs', 'perplexica.log');
        if (existsSync(logPath)) {
          const lines = readFileSync(logPath, 'utf8').split('\n');
          const interesting = lines.filter((l) =>
            /diag-search|unhandled|⨯|error/i.test(l),
          );
          d('---- perplexica.log (diag/error lines) ----');
          for (const l of interesting.slice(-50)) d('  | ' + l.slice(0, 240));
        }
      }
    },
  );
});
