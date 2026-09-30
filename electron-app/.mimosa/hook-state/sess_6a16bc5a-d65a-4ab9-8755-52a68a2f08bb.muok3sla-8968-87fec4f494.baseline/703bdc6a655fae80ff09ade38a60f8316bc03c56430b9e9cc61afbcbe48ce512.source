/**
 * SOCKS5H transport + HTTP-over-SOCKS integration tests.
 *
 * A mock SOCKS5 server simulates the Tor client side exactly where it
 * matters: the client must send CONNECT with ATYP=domain (remote DNS —
 * spec §56) and the mock then splices the socket to a local HTTP server.
 * Everything the real fetcher does (redirect validation, byte caps,
 * chunked bodies, timeouts) is exercised here without Tor.
 */
import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { socks5hConnect, SocksConnectError } from '../src/main/browser/darkweb/runtime/socks-client';
import { httpOverSocks, HttpOverSocksError } from '../src/main/browser/darkweb/runtime/http-over-socks';

// ---------------------------------------------------------------------------
// Mock SOCKS5 server (Tor stand-in)
// ---------------------------------------------------------------------------

/** Verbatim-connect SOCKS5 server: connects to `targetMap[hostname]`. */
function startMockSocks(targetPort: number): Promise<{ port: number; close: () => Promise<void>; seenDomains: string[] }> {
  const seenDomains: string[] = [];
  const server = net.createServer((client) => {
    // Stream-parse: greeting and CONNECT may arrive in one segment.
    let stage: 'greet' | 'request' | 'spliced' = 'greet';
    let buf = Buffer.alloc(0);
    let remote: net.Socket | null = null;
    client.on('error', () => {});
    client.on('close', () => remote?.destroy());
    client.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greet') {
        // Greeting: VER(1) NMETHODS(1) METHODS(NMETHODS).
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) {
          client.destroy();
          return;
        }
        const greetLen = 2 + buf[1];
        if (buf.length < greetLen) return;
        buf = buf.subarray(greetLen);
        client.write(Buffer.from([0x05, 0x00]));
        stage = 'request';
      }
      if (stage === 'request') {
        // Request: VER CMD RSV ATYP ADDR PORT — domain form only.
        if (buf.length < 5) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x01 || buf[3] !== 0x03) {
          client.destroy();
          return;
        }
        const len = buf[4];
        const total = 5 + len + 2;
        if (buf.length < total) return;
        const host = buf.subarray(5, 5 + len).toString('utf8');
        buf = buf.subarray(total);
        seenDomains.push(host);
        remote = net.connect(targetPort, '127.0.0.1');
        stage = 'spliced';
        remote.on('connect', () => {
          // VER=5 REP=0 RSV=0 ATYP=ipv4 BND.ADDR=0 BND.PORT=0
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.pipe(remote!);
          remote!.pipe(client);
        });
        remote.on('error', () => {
          client.write(Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // host unreachable
          client.end();
        });
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        seenDomains,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
            // Don't wait on lingering half-open test sockets.
            setTimeout(res, 500).unref();
          }),
      });
    });
  });
}

function startHttpServer(): Promise<{ port: number; close: () => Promise<void>; hangMode: { on: boolean } }> {
  const hangMode = { on: false };
  const server = http.createServer((req, res) => {
    if (hangMode.on) return; // never respond — socket stays open
    if (req.url === '/hello') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><title>Hello</title><body>hi onion</body></html>');
    } else if (req.url === '/json') {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    } else if (req.url === '/binary') {
      res.setHeader('content-type', 'application/octet-stream');
      res.end(Buffer.from([0x00, 0x01, 0x02]));
    } else if (req.url === '/big') {
      res.setHeader('content-length', String(2 * 1024 * 1024));
      res.write(Buffer.alloc(2 * 1024 * 1024, 0x41));
      res.end();
    } else if (req.url === '/chunked') {
      res.setHeader('transfer-encoding', 'chunked');
      res.write('chunk-one-');
      setTimeout(() => res.write('chunk-two'), 10);
      setTimeout(() => res.end('!'), 30);
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/hello' });
      res.end();
    } else if (req.url === '/redirect-clearnet') {
      res.writeHead(302, { location: 'https://example.com/' });
      res.end();
    } else if (req.url === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' });
      res.end();
    } else if (req.url === '/slow-body') {
      // Raw partial write + clean FIN — the client must detect a
      // content-length truncation instead of waiting for the timeout.
      const sock = req.socket;
      sock.write('HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 1000\r\n\r\npartial');
      sock.end();
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => new Promise<void>((res) => server.close(() => res())),
        hangMode,
      });
    });
  });
}

const PERMISSIVE = (u: string): string => {
  // Simulates the strict validator for test hostnames (fake TLD).
  const parsed = new URL(u);
  if (!/\.onion\.test$/.test(parsed.hostname)) {
    throw new HttpOverSocksError('not_onion_host', 'blocked by test validator');
  }
  return u;
};

let socks: Awaited<ReturnType<typeof startMockSocks>> | null = null;
let httpSrv: Awaited<ReturnType<typeof startHttpServer>> | null = null;

afterEach(async () => {
  await socks?.close();
  await httpSrv?.close();
  socks = null;
  httpSrv = null;
});

describe('socks5hConnect', () => {
  it('performs the handshake and sends the hostname to the proxy (remote DNS)', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    const socket = await socks5hConnect({
      proxy: { host: '127.0.0.1', port: socks.port },
      targetHost: 'examplev3host.onion.test',
      targetPort: 80,
      timeoutMs: 3000,
    });
    expect(socks.seenDomains).toContain('examplev3host.onion.test');
    socket.destroy();
  });

  it('rejects when the proxy is not listening (fail-closed)', async () => {
    await expect(
      socks5hConnect({
        proxy: { host: '127.0.0.1', port: 1 }, // nothing listens here
        targetHost: 'x.onion.test',
        targetPort: 80,
        timeoutMs: 1500,
      })
    ).rejects.toBeInstanceOf(SocksConnectError);
  });
});

describe('httpOverSocks', () => {
  const base = (port: number, path: string): string => `http://targetv3.onion.test${path}`;

  it('GETs a page through the tunnel', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    const res = await httpOverSocks({
      proxy: { host: '127.0.0.1', port: socks.port },
      url: base(socks.port, '/hello'),
      timeoutMs: 3000,
      maxBytes: 64 * 1024,
      maxRedirects: 4,
      validateUrl: PERMISSIVE,
    });
    expect(res.status).toBe(200);
    expect(res.body!.toString()).toContain('hi onion');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('decodes chunked bodies', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    const res = await httpOverSocks({
      proxy: { host: '127.0.0.1', port: socks.port },
      url: base(socks.port, '/chunked'),
      timeoutMs: 5000,
      maxBytes: 64 * 1024,
      maxRedirects: 4,
      validateUrl: PERMISSIVE,
    });
    expect(res.body!.toString()).toBe('chunk-one-chunk-two!');
  });

  it('follows same-policy redirects and reports finalUrl', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    const res = await httpOverSocks({
      proxy: { host: '127.0.0.1', port: socks.port },
      url: base(socks.port, '/redirect'),
      timeoutMs: 3000,
      maxBytes: 64 * 1024,
      maxRedirects: 4,
      validateUrl: PERMISSIVE,
    });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toContain('/hello');
    expect(res.redirectCount).toBe(1);
  });

  it('BLOCKS a redirect off the onion policy (spec §11)', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    await expect(
      httpOverSocks({
        proxy: { host: '127.0.0.1', port: socks.port },
        url: base(socks.port, '/redirect-clearnet'),
        timeoutMs: 3000,
        maxBytes: 64 * 1024,
        maxRedirects: 4,
        validateUrl: PERMISSIVE,
      })
    ).rejects.toMatchObject({ code: 'not_onion_host' });
  });

  it('aborts on oversized content-length', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    await expect(
      httpOverSocks({
        proxy: { host: '127.0.0.1', port: socks.port },
        url: base(socks.port, '/big'),
        timeoutMs: 3000,
        maxBytes: 1024,
        maxRedirects: 0,
        validateUrl: PERMISSIVE,
      })
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('detects redirect loops', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    await expect(
      httpOverSocks({
        proxy: { host: '127.0.0.1', port: socks.port },
        url: base(socks.port, '/redirect-loop'),
        timeoutMs: 3000,
        maxBytes: 64 * 1024,
        maxRedirects: 4,
        validateUrl: PERMISSIVE,
      })
    ).rejects.toMatchObject({ code: 'redirect_loop' });
  });

  it('times out when the server never responds', async () => {
    httpSrv = await startHttpServer();
    httpSrv.hangMode.on = true;
    socks = await startMockSocks(httpSrv.port);
    await expect(
      httpOverSocks({
        proxy: { host: '127.0.0.1', port: socks.port },
        url: base(socks.port, '/hello'),
        timeoutMs: 500,
        maxBytes: 64 * 1024,
        maxRedirects: 0,
        validateUrl: PERMISSIVE,
      })
    ).rejects.toMatchObject({ code: 'socket_error' });
  });

  it('flags truncated content-length bodies', async () => {
    httpSrv = await startHttpServer();
    socks = await startMockSocks(httpSrv.port);
    await expect(
      httpOverSocks({
        proxy: { host: '127.0.0.1', port: socks.port },
        url: base(socks.port, '/slow-body'),
        timeoutMs: 1500,
        maxBytes: 64 * 1024,
        maxRedirects: 0,
        validateUrl: PERMISSIVE,
      })
    ).rejects.toMatchObject({ code: 'truncated' });
  });
});
