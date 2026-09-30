/**
 * DIAG (temporary, gated DIAG_SEARCH=1): trace ONE search request hop-by-hop
 * against the MANAGED runtime — find the exact hanging hop (spec §3/§4).
 * Delete after the root cause is fixed.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { HayDevRuntimeManager } from '../src/main/browser/runtime/engine/runtime/haydev-runtime-manager';
import { resolvePreferredChatModel } from '../src/main/browser/runtime/engine/runtime/search-services';

const RUN = process.env.DIAG_SEARCH === '1';
const APP_ROOT = path.resolve(__dirname, '..');
const RUNTIMES = path.join(APP_ROOT, 'resources', 'runtimes');
const d = (m: string): void => console.log(`[diag] ${m}`);

function timedFetch(label: string, url: string, init: RequestInit | undefined, timeoutMs: number) {
  return (async () => {
    const started = Date.now();
    try {
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const body = await resp.text();
      d(`${label}: HTTP ${resp.status} in ${Date.now() - started}ms (${body.length}b)`);
      return { ok: resp.ok, status: resp.status, body: body as string };
    } catch (err) {
      d(`${label}: FAIL in ${Date.now() - started}ms — ${err instanceof Error ? err.message : 'unknown'}`);
      return { ok: false, error: String(err), body: '' };
    }
  })();
}

describe.skipIf(!RUN)('DIAG search hop trace (managed runtime)', () => {
  it('traces UI-equivalent request through every hop', { timeout: 600_000 }, async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'haydev-diag-'));
    const manager = new HayDevRuntimeManager({
      userDataDir: userData,
      resourcesPath: existsSync(RUNTIMES) ? path.join(APP_ROOT, 'resources') : null,
      perplexicaDevDir: process.env.PAB_PERPLEXICA_DIR ?? 'D:\\Projects\\Perplexica',
      perplexicaExternalUrl: null, // FORCED managed
      searxngExternalUrl: null, // FORCED managed
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
      d(`managed P=${P} SX=${manager.getStatus().searxng!.endpoint}`);

      // HOP 1: /api/providers — RUNTIME provider state (spec §7)
      const prov = await timedFetch('HOP1 /api/providers', `${P}/api/providers`, {}, 20_000);
      expect(prov.ok).toBe(true);
      const providers = (JSON.parse(prov.body).providers ?? []) as Array<{
        id: string; name: string; chatModels: Array<{ key: string }>; embeddingModels?: Array<{ key: string }>;
      }>;
      for (const p of providers) {
        d(`  provider id=${p.id} name=${p.name} chat=[${p.chatModels.map((m) => m.key).join(', ')}] embed=[${(p.embeddingModels ?? []).map((m) => m.key).join(', ')}]`);
      }
      const gemini = providers.find((p) => p.id === 'gemini');
      const nvidia = providers.find((p) => p.id === 'openai');

      // HOP 2b: EXACT Perplexica URL construction
      const purl = new URL(`${manager.getStatus().searxng!.endpoint}/search?format=json`);
      purl.searchParams.append('q', 'What is OpenAI?');
      const h2b = await timedFetch('HOP2b perplexica-style url', purl.toString(), {}, 15_000);
      if (h2b.ok) d('  HOP2b results: ' + (JSON.parse(h2b.body).results ?? []).length);
      // HOP 2: managed SearXNG direct
      const sx = await timedFetch('HOP2 searxng direct', `${manager.getStatus().searxng!.endpoint}/search?q=openai&format=json`, {}, 30_000);
      expect(sx.ok).toBe(true);

      const mkBody = (chat: { providerId: string; key: string }, embed: { providerId: string; key: string }) => ({
        optimizationMode: 'balanced', sources: ['web'], query: 'What is OpenAI?',
        history: [], stream: false, chatModel: chat, embeddingModel: embed,
      });

      const verified = await resolvePreferredChatModel();
      d('verified chat model: ' + verified);
      // HOP 3: VERIFIED gemini chat + REAL gemini embedding model
      if (gemini?.chatModels?.length && gemini.embeddingModels?.length) {
        const r = await timedFetch('HOP3 gemini+geminiEmbed', `${P}/api/search`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mkBody(
            { providerId: gemini.id, key: (gemini.chatModels.find((m) => m.key.endsWith(verified ?? 'gemini-3.1-flash-lite')) ?? gemini.chatModels[0]!)!.key },
            { providerId: gemini.id, key: gemini.embeddingModels[0]!.key },
          )) }, 60_000);
        if (r.ok) {
          const j3 = JSON.parse(r.body) as { sources?: Array<{ metadata?: { url?: string }; url?: string }>; message?: string };
          const srcs = (j3.sources ?? []).map((x) => ((x.metadata && x.metadata.url) || x.url || '').slice(0, 50));
          d(`  HOP3 sources=${srcs.length} -> ${JSON.stringify(srcs.slice(0, 4))}`);
          d(`  HOP3 answer: ${(j3.message ?? '').slice(0, 110)}`);
        }
      }

      // HOP 5: NVIDIA NIM through managed Perplexica
      if (nvidia?.chatModels?.length) {
        const r = await timedFetch('HOP5 nvidia', `${P}/api/search`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mkBody(
            { providerId: nvidia.id, key: nvidia.chatModels[0]!.key },
            gemini?.embeddingModels?.length
              ? { providerId: gemini.id, key: gemini.embeddingModels[0]!.key }
              : { providerId: nvidia.id, key: nvidia.chatModels[0]!.key },
          )) }, 90_000);
        if (r.ok) { const j5 = JSON.parse(r.body); d(`  HOP5 sources: ${(j5.sources ?? []).length} answer: ${(j5.message ?? '').slice(0, 90)}`); }
      }

      // ---- Post-mortem of the hanging instance (spec §3/§4) --------------
      const cfgPath = path.join(userData, 'runtime', 'perplexica', 'data', 'config.json');
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as {
          search?: { searxngURL?: string };
          modelProviders?: Array<{ id: string; type: string }>;
        };
        d(`RUNTIME CONFIG searxngURL=${cfg.search?.searxngURL} providers=[${(cfg.modelProviders ?? []).map((p) => `${p.id}:${p.type}`).join(', ')}]`);
      }
      const logPath = path.join(userData, 'runtime', 'logs', 'perplexica.log');
      if (existsSync(logPath)) {
        const all = (await fs.readFile(logPath, 'utf8')).split('\n').filter(Boolean);
        const errBlocks = []; let cur: string[] = []; for (const l of all) { if (/^(Error|⨯|TypeError|unhandledRejection)/.test(l)) { if (cur.length) errBlocks.push(cur); cur = [l]; } else if (cur.length) cur.push(l); } if (cur.length) errBlocks.push(cur);
        const flat = errBlocks.flat().filter((l) => !/makeStatusError|makeRequest|node:internal|at async Module/.test(l));
        const errs = flat.slice(-40);
        const tail = errs.length ? errs : all.slice(-10);
        d('---- perplexica.log (filtered) ----');
        for (const line of tail) d('  | ' + line.slice(0, 220));
      }

      expect(true).toBe(true);
    } finally {
      await manager.stop();
      // keep temp for post-mortem
    }
  });
});
