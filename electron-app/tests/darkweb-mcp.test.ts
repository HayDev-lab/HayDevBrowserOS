/**
 * Dark-web MCP surface (spec §28–§31): registry integrity, argument
 * parsing, and handler routing through a fake McpDarkWebPort.
 */
import { describe, it, expect } from 'vitest';
import { MCP_TOOL_DEFINITIONS, auditRegistry, listMcpToolNames, FORBIDDEN_MCP_TOOLS } from '../src/main/browser/mcp/pure/mcp-tool-registry';
import { parseMcpArgs } from '../src/main/browser/mcp/pure/mcp-args';
import { McpToolHandler } from '../src/main/browser/mcp/runtime/mcp-tool-handler';
import { McpOwnershipGuard } from '../src/main/browser/mcp/pure/mcp-ownership';

const DARKWEB_TOOLS = [
  'darkweb_status',
  'darkweb_search',
  'darkweb_fetch',
  'darkweb_crawl',
  'darkweb_crawl_status',
  'darkweb_stop_crawl',
  'darkweb_search_local_index',
  'darkweb_providers',
];

describe('registry integrity (spec §69)', () => {
  it('registers all 8 darkweb tools and stays audit-clean', () => {
    const names = listMcpToolNames();
    for (const t of DARKWEB_TOOLS) expect(names).toContain(t);
    const audit = auditRegistry();
    expect(audit.valid).toBe(true);
  });

  it('no darkweb tool collides with the forbidden list', () => {
    for (const t of DARKWEB_TOOLS) expect(FORBIDDEN_MCP_TOOLS).not.toContain(t);
    expect(MCP_TOOL_DEFINITIONS.filter((d) => d.name.startsWith('darkweb_'))).toHaveLength(8);
  });

  it('darkweb tools declare object schemas with valid required sets', () => {
    for (const name of DARKWEB_TOOLS) {
      const def = MCP_TOOL_DEFINITIONS.find((d) => d.name === name)!;
      expect(def.inputSchema.type).toBe('object');
      for (const req of def.inputSchema.required) {
        expect(req in def.inputSchema.properties, `${name}.${req}`).toBe(true);
      }
    }
  });
});

describe('argument parsing (spec §29/§30/§31)', () => {
  it('parses darkweb_search with optional providers/limit/timeout', () => {
    const ok = parseMcpArgs('darkweb_search', { query: 'markets', providers: 'ahmia,tor66', limit: 5 });
    expect(ok.valid).toBe(true);
    expect(ok.parsed?.darkwebRequest).toMatchObject({
      kind: 'search',
      query: 'markets',
      providers: ['ahmia', 'tor66'],
      limit: 5,
    });
    const minimal = parseMcpArgs('darkweb_search', { query: 'x' });
    expect(minimal.valid).toBe(true);
    const bad = parseMcpArgs('darkweb_search', {});
    expect(bad.valid).toBe(false);
    const long = parseMcpArgs('darkweb_search', { query: 'x'.repeat(600) });
    expect(long.valid).toBe(false);
  });

  it('parses darkweb_fetch with mode whitelist', () => {
    expect(parseMcpArgs('darkweb_fetch', { url: 'http://x.onion/' }).valid).toBe(true);
    expect(parseMcpArgs('darkweb_fetch', { url: 'http://x.onion/', mode: 'metadata' }).valid).toBe(true);
    expect(parseMcpArgs('darkweb_fetch', { url: 'http://x.onion/', mode: 'raw' }).valid).toBe(false);
    expect(parseMcpArgs('darkweb_fetch', { mode: 'text' }).valid).toBe(false);
  });

  it('parses crawl / crawl_status / stop_crawl / local index', () => {
    expect(parseMcpArgs('darkweb_crawl', { url: 'http://x.onion/', maxDepth: 2 }).valid).toBe(true);
    expect(parseMcpArgs('darkweb_crawl_status', { jobId: 'j1' }).valid).toBe(true);
    expect(parseMcpArgs('darkweb_stop_crawl', {}).valid).toBe(false);
    expect(parseMcpArgs('darkweb_search_local_index', { query: 'q', limit: 3 }).valid).toBe(true);
    expect(parseMcpArgs('darkweb_status', {}).parsed?.darkwebRequest).toMatchObject({ kind: 'status' });
    expect(parseMcpArgs('darkweb_providers', {}).parsed?.darkwebRequest).toMatchObject({ kind: 'providers' });
  });
});

describe('handler routing (spec §28–§31)', () => {
  const calls: string[] = [];
  function fakePort() {
    return {
      status: async () => {
        calls.push('status');
        return { enabled: true, tor: { state: 'OFFLINE' } };
      },
      providers: () => {
        calls.push('providers');
        return [{ id: 'ahmia', health: 'HEALTHY' }];
      },
      search: async (req: { query: string }) => {
        calls.push(`search:${req.query}`);
        return { state: 'DONE', total: 1, results: [{ url: 'http://x.onion/' }] };
      },
      fetch: async (url: string, mode: string) => {
        calls.push(`fetch:${mode}`);
        return { url, untrustedContent: true, text: 'UNTRUSTED_EXTERNAL_CONTENT' };
      },
      crawl: (req: { url: string }) => {
        calls.push(`crawl:${req.url}`);
        return { jobId: 'job1' };
      },
      crawlStatus: (jobId: string) => {
        calls.push(`crawlStatus:${jobId}`);
        if (jobId !== 'job1') return null;
        return { jobId, state: 'DONE', docsAdded: 2 };
      },
      stopCrawl: (jobId: string) => {
        calls.push(`stopCrawl:${jobId}`);
        return true;
      },
      searchLocalIndex: async (q: string) => {
        calls.push(`index:${q}`);
        return [];
      },
    };
  }

  function handler(withDarkweb = true) {
    return new McpToolHandler({
      browser: {
        dispatch: async () => ({ success: true, data: {}, executionId: 'ctx', completedAt: 0 }),
        startExecutionContext: () => 'ctx',
        stopExecutionContext: () => ({ executionId: 'ctx', aborted: false, cancelledCount: 0 }),
      },
      agent: {
        run: async () => ({ state: 'COMPLETED', answer: '', stepCount: 0, reason: null, error: null }),
        stop: () => ({ accepted: true }),
        takeControl: () => ({ accepted: true }),
        getStatus: () => ({ state: 'IDLE', controlMode: 'HUMAN', stepCount: 0, maxSteps: 15, startedAt: null, endedAt: null, reason: null, error: null, providerConfigured: false, providerConfig: null }),
      },
      ownership: new McpOwnershipGuard(),
      darkweb: withDarkweb ? (fakePort() as never) : undefined,
    });
  }

  it('routes search/fetch/crawl through the port with structured payloads', async () => {
    const h = handler(true);
    const search = await h.handle('darkweb_search', { query: 'markets' });
    expect(search.success).toBe(true);
    expect(search.data).toMatchObject({ state: 'DONE', total: 1 });

    const fetch = await h.handle('darkweb_fetch', { url: 'http://x.onion/' });
    expect(fetch.success).toBe(true);
    expect((fetch.data as { untrustedContent: boolean }).untrustedContent).toBe(true);

    const crawl = await h.handle('darkweb_crawl', { url: 'http://x.onion/' });
    expect(crawl.data).toMatchObject({ jobId: 'job1' });

    const status = await h.handle('darkweb_crawl_status', { jobId: 'job1' });
    expect((status.data as { docsAdded: number }).docsAdded).toBe(2);

    const stop = await h.handle('darkweb_stop_crawl', { jobId: 'job1' });
    expect((stop.data as { stopped: boolean }).stopped).toBe(true);

    await h.handle('darkweb_status', {});
    await h.handle('darkweb_providers', {});
    await h.handle('darkweb_search_local_index', { query: 'q' });
    expect(calls).toContain('search:markets');
    expect(calls).toContain('fetch:text');
    expect(calls).toContain('crawl:http://x.onion/');
    expect(calls).toContain('crawlStatus:job1');
    expect(calls).toContain('stopCrawl:job1');
    expect(calls).toContain('status');
    expect(calls).toContain('providers');
    expect(calls).toContain('index:q');
  });

  it('rejected invalid arguments and unknown jobs without throwing', async () => {
    const h = handler(true);
    expect((await h.handle('darkweb_search', {})).errorCode).toBe('invalid_arguments');
    expect((await h.handle('darkweb_crawl_status', { jobId: 'missing' })).errorCode).toBe('crawl_job_not_found');
    expect((await h.handle('darkweb_fetch', { url: 'http://x.onion/', mode: 'shell' })).errorCode).toBe('invalid_arguments');
  });

  it('darkweb tools are rejected cleanly when the subsystem is absent', async () => {
    const h = handler(false);
    const r = await h.handle('darkweb_search', { query: 'q' });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('darkweb_unavailable');
  });
});
