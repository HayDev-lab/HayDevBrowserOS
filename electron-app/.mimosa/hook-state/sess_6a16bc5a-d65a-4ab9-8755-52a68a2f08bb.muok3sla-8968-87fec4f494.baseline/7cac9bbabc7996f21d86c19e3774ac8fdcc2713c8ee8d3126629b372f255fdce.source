/**
 * DarkWebFetcher fail-closed gates (spec §13/§32/§33/§57) + provider port
 * behavior, with an injectable transport (no network).
 */
import { describe, it, expect } from 'vitest';
import { DarkWebFetcher } from '../src/main/browser/darkweb/runtime/fetcher';
import { HttpOverSocksError } from '../src/main/browser/darkweb/runtime/http-over-socks';
import { validateDarkWebConfig } from '../src/main/browser/darkweb/pure/darkweb-config';
import type { httpOverSocks, HttpOverSocksOptions } from '../src/main/browser/darkweb/runtime/http-over-socks';

const A = 'a'.repeat(56);
const ONION = `http://${A}.onion/`;

type Transport = typeof httpOverSocks;

function makeFetcher(over: {
  torReady?: boolean;
  transport?: Transport;
  config?: Partial<Parameters<typeof validateDarkWebConfig>[0]>;
}) {
  const base = validateDarkWebConfig(null).config;
  const config = { ...base, ...(over.config ?? {}) };
  let torReady = over.torReady ?? true;
  return {
    fetcher: new DarkWebFetcher({
      getConfig: () => config,
      isTorReady: () => torReady,
      socksEndpoint: () => ({ host: '127.0.0.1', port: 9050 }),
      transport: over.transport,
    }),
    setTorReady: (v: boolean) => {
      torReady = v;
    },
  };
}

const okTransport = (body: string, contentType = 'text/html; charset=utf-8'): Transport =>
  (async (opts: HttpOverSocksOptions) => {
    return {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': contentType },
      body: Buffer.from(body),
      finalUrl: opts.url,
      bytesReceived: Buffer.byteLength(body),
      redirectCount: 0,
    };
  }) as unknown as Transport;

describe('DarkWebFetcher — fail-closed gates', () => {
  it('refuses non-onion URLs before any network activity', async () => {
    const { fetcher } = makeFetcher({ torReady: false, transport: okTransport('x') });
    for (const url of [
      'https://example.com/',
      'http://127.0.0.1/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      `http://${'x'.repeat(16)}.onion/`, // v2
    ]) {
      await expect(fetcher.fetch(url)).rejects.toMatchObject({ code: expect.not.stringMatching('TOR_UNAVAILABLE') });
    }
  });

  it('refuses when Tor is not READY — TOR_UNAVAILABLE (spec §57 fail-closed)', async () => {
    const { fetcher } = makeFetcher({ torReady: false, transport: okTransport('x') });
    await expect(fetcher.fetch(ONION)).rejects.toMatchObject({ code: 'TOR_UNAVAILABLE' });
  });

  it('blocks disallowed MIME on success — binary is never auto-consumed', async () => {
    const { fetcher } = makeFetcher({ transport: okTransport('\x00\x01', 'application/octet-stream') });
    const r = await fetcher.fetch(ONION);
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
    expect(r.text).toBeNull();
  });

  it('allows text/html and application/json, decodes text', async () => {
    const html = makeFetcher({ transport: okTransport('<title>T</title><p>hello</p>') });
    const r1 = await html.fetcher.fetch(ONION);
    expect(r1.text).toContain('hello');

    const json = makeFetcher({ transport: okTransport('{"a":1}', 'application/json') });
    const r2 = await json.fetcher.fetch(ONION);
    expect(r2.text).toBe('{"a":1}');
  });

  it('metadata mode sends no meaningful body through', async () => {
    let seenMethod: string | undefined;
    const transport: Transport = (async (opts: HttpOverSocksOptions) => {
      seenMethod = opts.method;
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
        body: null,
        finalUrl: opts.url,
        bytesReceived: 0,
        redirectCount: 0,
      };
    }) as unknown as Transport;
    const { fetcher } = makeFetcher({ transport });
    const r = await fetcher.fetch(ONION, { mode: 'metadata' });
    expect(seenMethod).toBe('HEAD');
    expect(r.body).toBeNull();
  });

  it('maps unreachable onion (SOCKS rep 4) to ONION_UNREACHABLE', async () => {
    const { fetcher } = makeFetcher({
      transport: (async () => {
        throw new HttpOverSocksError('socks_rep_4', 'host unreachable (onion service likely offline)');
      }) as unknown as Transport,
    });
    await expect(fetcher.fetch(ONION)).rejects.toMatchObject({ code: 'ONION_UNREACHABLE' });
  });

  it('checkReachable never throws — returns reachable/errorCode', async () => {
    const down = makeFetcher({ torReady: false });
    const r = await down.fetcher.checkReachable(ONION, 1000);
    expect(r.reachable).toBe(false);
    expect(r.errorCode).toBe('TOR_UNAVAILABLE');
    expect(typeof r.checkedAt).toBe('number');
  });
});
