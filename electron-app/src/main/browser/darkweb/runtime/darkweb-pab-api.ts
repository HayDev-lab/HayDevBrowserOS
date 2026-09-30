/**
 * pab://darkweb mini-API — routes page requests from the darkweb search
 * page to the DarkWebService, following the same host-based routing style
 * as pab://search and pab://newtab (see main/index.ts handlePabRequest).
 *
 * SURFACE (all same-origin — pab://darkweb is a trusted internal page):
 *   GET  pab://darkweb/                    → search page HTML
 *   GET  /api/status                       → DarkWebUiStatus
 *   GET  /api/providers                    → DarkWebProviderStatus[]
 *   GET  /api/settings | POST (patch)      → config read/update
 *   POST /api/search  {query, providers?, limit?} → {searchId, …}
 *   GET  /api/search/:id                   → DarkWebSearchResponse
 *   POST /api/search/:id/cancel            → {ok}
 *   POST /api/preview {url}                → sanitized HTML preview
 *   POST /api/fetch   {url, mode}          → DarkWebFetchResult (text|metadata)
 *   POST /api/crawl   {url, maxDepth?, maxPages?} → {jobId}
 *   GET  /api/crawl/:id | GET /api/crawls  → job status(es)
 *   POST /api/crawl/:id/cancel             → {ok}
 *   POST /api/index/add {url}              → {added, reason}
 *   GET  /api/index/search?q=              → hits
 *   POST /api/index/clear                  → {ok}
 *   GET  /api/history | POST /api/history/clear
 *   GET  /api/downloads                    → quarantined download metadata
 *   POST /api/downloads/:id/save|discard   → move out of quarantine / delete
 *   GET  /open?url=<onion>                 → opens an isolated Tor tab
 *
 * SECURITY:
 *   - The renderer tab NEVER talks to onion sites directly; every onion
 *     byte flows through DarkWebService → TorGateway (spec §10).
 *   - Every URL passes validateOnionFetchUrl inside the service.
 *   - Errors return safe codes + short messages (spec §50); the raw
 *     transport detail goes into the page's expandable diagnostics only.
 *   - POST bodies are size-capped and JSON-parsed defensively.
 */
import { buildDarkWebPageHtml } from '../pure/darkweb-page';
import type { DarkWebService } from './darkweb-service';
import type { DarkWebDownloadInfo, DarkWebFetchMode, DarkWebSettingsPatch } from '@shared/darkweb-types';

export interface DarkWebPabApiDeps {
  service: DarkWebService;
  /** Open (or focus) an isolated dark-web tab; returns false if refused. */
  openDarkWebTab: (url: string) => boolean;
  /** Quarantine store (optional in unit tests). */
  downloads?: DarkWebDownloadStore | null;
}

/** Interface the electron-side quarantine manager implements. */
export interface DarkWebDownloadStore {
  list(): DarkWebDownloadInfo[];
  save(id: string): Promise<{ ok: boolean; reason?: string }>;
  discard(id: string): boolean;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_URL_PARAM = 2048;

export async function handleDarkWebPabRequest(
  request: Request,
  deps: DarkWebPabApiDeps
): Promise<Response> {
  const url = new URL(request.url);
  // pab://darkweb/... → URL pathname is "/..." on the darkweb host.
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  try {
    // ---- page ------------------------------------------------------------
    if (path === '/' && method === 'GET') {
      return htmlResponse(buildDarkWebPageHtml());
    }

    // ---- open in Tor tab -------------------------------------------------
    if (path === '/open' && method === 'GET') {
      const target = (url.searchParams.get('url') ?? '').slice(0, MAX_URL_PARAM);
      const ok = target.length > 0 && deps.openDarkWebTab(target);
      return htmlResponse(
        `<!doctype html><meta charset="utf-8"><title>Opening…</title><body style="background:#02040a;color:#9fb4d0;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>${
          ok ? 'Opening in an isolated Tor tab…' : 'Could not open: URL is not a valid .onion address.'
        }</p><script>setTimeout(function(){history.back()},600)</script></body>`
      );
    }

    // ---- status / providers / settings -----------------------------------
    if (path === '/api/status' && method === 'GET') {
      return json(await deps.service.uiStatus());
    }
    if (path === '/api/providers' && method === 'GET') {
      return json(deps.service.providerStatuses());
    }
    if (path === '/api/settings') {
      if (method === 'GET') return json(deps.service.getConfig());
      if (method === 'POST') {
        const body = await readJson(request);
        if (body === null) return badRequest('invalid_json');
        await deps.service.updateSettings(body as DarkWebSettingsPatch);
        return json({ ok: true, config: redactConfig(deps.service.getConfig()) });
      }
    }

    // ---- search ----------------------------------------------------------
    if (path === '/api/search' && method === 'POST') {
      const body = (await readJson(request)) as { query?: unknown; providers?: unknown; limit?: unknown } | null;
      if (!body || typeof body.query !== 'string') return badRequest('invalid_json');
      try {
        const initial = await deps.service.search.search({
          query: body.query,
          providers: Array.isArray(body.providers) ? body.providers.filter((p): p is string => typeof p === 'string') : undefined,
          limit: typeof body.limit === 'number' ? body.limit : undefined,
        });
        return json(initial);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'SEARCH_FAILED' }, 400);
      }
    }
    const searchMatch = /^\/api\/search\/([\w-]+)(\/cancel)?$/.exec(path);
    if (searchMatch) {
      if (method === 'GET' && !searchMatch[2]) {
        const snap = deps.service.search.getSearch(searchMatch[1]);
        return snap ? json(snap) : json({ error: 'NOT_FOUND' }, 404);
      }
      if (method === 'POST' && searchMatch[2]) {
        return json({ ok: deps.service.search.cancelSearch(searchMatch[1]) });
      }
    }

    // ---- preview / fetch ---------------------------------------------------
    if (path === '/api/preview' && method === 'POST') {
      const body = (await readJson(request)) as { url?: unknown } | null;
      if (!body || typeof body.url !== 'string') return badRequest('invalid_json');
      try {
        return json(await deps.service.fetchPreview(body.url));
      } catch (err) {
        return json({ error: safeError(err) }, 502);
      }
    }
    if (path === '/api/fetch' && method === 'POST') {
      const body = (await readJson(request)) as { url?: unknown; mode?: unknown } | null;
      if (!body || typeof body.url !== 'string') return badRequest('invalid_json');
      const mode: DarkWebFetchMode = body.mode === 'metadata' ? 'metadata' : 'text';
      try {
        return json(await deps.service.fetchPage(body.url, mode));
      } catch (err) {
        return json({ error: safeError(err) }, 502);
      }
    }

    // ---- crawl -------------------------------------------------------------
    if (path === '/api/crawl' && method === 'POST') {
      const body = (await readJson(request)) as { url?: unknown; maxDepth?: unknown; maxPages?: unknown } | null;
      if (!body || typeof body.url !== 'string') return badRequest('invalid_json');
      try {
        return json(
          deps.service.crawler.crawl({
            url: body.url,
            maxDepth: typeof body.maxDepth === 'number' ? body.maxDepth : undefined,
            maxPages: typeof body.maxPages === 'number' ? body.maxPages : undefined,
          })
        );
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'CRAWL_FAILED' }, 400);
      }
    }
    if (path === '/api/crawls' && method === 'GET') {
      return json(deps.service.crawler.listJobs());
    }
    const crawlMatch = /^\/api\/crawl\/([\w-]+)(\/cancel)?$/.exec(path);
    if (crawlMatch) {
      if (method === 'GET' && !crawlMatch[2]) {
        const st = deps.service.crawler.status(crawlMatch[1]);
        return st ? json(st) : json({ error: 'NOT_FOUND' }, 404);
      }
      if (method === 'POST' && crawlMatch[2]) {
        return json({ ok: deps.service.crawler.cancel(crawlMatch[1]) });
      }
    }

    // ---- local index -------------------------------------------------------
    if (path === '/api/index/add' && method === 'POST') {
      const body = (await readJson(request)) as { url?: unknown } | null;
      if (!body || typeof body.url !== 'string') return badRequest('invalid_json');
      try {
        return json(await deps.service.indexPage(body.url));
      } catch (err) {
        return json({ error: safeError(err) }, 502);
      }
    }
    if (path === '/api/index/search' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').slice(0, 512);
      const hits = await deps.service.index.search(q, 50);
      return json({ query: q, hits });
    }
    if (path === '/api/index/clear' && method === 'POST') {
      await deps.service.clearLocalIndex();
      return json({ ok: true });
    }

    // ---- history -----------------------------------------------------------
    if (path === '/api/history' && method === 'GET') {
      return json({ entries: await deps.service.history.list() });
    }
    if (path === '/api/history/clear' && method === 'POST') {
      await deps.service.clearSearchHistory();
      return json({ ok: true });
    }

    // ---- quarantined downloads ----------------------------------------------
    if (path === '/api/downloads' && method === 'GET') {
      return json({ downloads: deps.downloads?.list() ?? [] });
    }
    const dlMatch = /^\/api\/downloads\/([\w-]+)\/(save|discard)$/.exec(path);
    if (dlMatch && method === 'POST') {
      if (!deps.downloads) return json({ error: 'NO_DOWNLOAD_STORE' }, 404);
      if (dlMatch[2] === 'save') return json(await deps.downloads.save(dlMatch[1]));
      return json({ ok: deps.downloads.discard(dlMatch[1]) });
    }

    return json({ error: 'NOT_FOUND' }, 404);
  } catch (err) {
    // Never leak a stack trace to the page (spec §50).
    return json({ error: 'INTERNAL', detail: err instanceof Error ? err.message.slice(0, 200) : '' }, 500);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function badRequest(code: string): Response {
  return json({ error: code }, 400);
}

function safeError(err: unknown): string {
  // DarkWebFetchError carries its safe machine code in `.code`; the message
  // may be more verbose. Only contract-shaped codes are surfaced (spec §50).
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[a-z0-9_:.]{3,64}$/i.test(code) && !code.includes('..')) {
    return code;
  }
  const msg = err instanceof Error ? err.message : '';
  if (msg.startsWith('TOR_UNAVAILABLE') || msg.startsWith('ONION_UNREACHABLE')) {
    return msg.split(':')[0].trim();
  }
  return 'FETCH_FAILED';
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Settings echo for the UI — drop absolute paths (binaryPath). */
function redactConfig(config: unknown): unknown {
  const c = config as { tor?: { binaryPath?: string | null } };
  return { ...(c ?? {}), tor: { ...(c.tor ?? {}), binaryPath: c.tor?.binaryPath ? '<set>' : null } };
}
