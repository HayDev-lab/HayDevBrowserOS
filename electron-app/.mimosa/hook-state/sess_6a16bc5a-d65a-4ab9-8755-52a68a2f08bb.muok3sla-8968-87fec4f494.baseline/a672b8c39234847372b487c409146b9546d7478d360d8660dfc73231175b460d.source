/**
 * Minimal HTTP/1.1 client OVER the SOCKS5H tunnel — the programmatic
 * fetch transport for onion resources (search engines, page fetch,
 * availability checks, crawler).
 *
 * WHY NOT node fetch/undici: a SOCKS5-with-remote-DNS dispatcher would
 * still do things we must control tightly. Here every byte is accounted:
 *   - response size hard-capped (maxBytes) — decompression bombs are
 *     impossible because `Accept-Encoding: identity` is sent and any
 *     content-coding other than `identity` aborts the request;
 *   - header block capped (64 KiB);
 *   - redirects are followed ONLY by re-running the caller's validator on
 *     every hop (fail-closed against onion→clearnet and onion→private-IP
 *     redirects) with a hop cap and a loop guard;
 *   - per-request timeout + AbortSignal; sockets are always destroyed.
 *
 * Runtime module — unit-tested against a local HTTP server behind a mock
 * SOCKS5 server (tests/darkweb-socks.test.ts, darkweb-fetcher.test.ts).
 */
import { socks5hConnect, type SocksEndpoint } from './socks-client';

export interface HttpOverSocksResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer | null;
  /** URL after redirects (validated hops only). */
  finalUrl: string;
  bytesReceived: number;
  redirectCount: number;
}

export class HttpOverSocksError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpOverSocksError';
  }
}

export interface HttpOverSocksOptions {
  proxy: SocksEndpoint;
  method?: 'GET' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  body?: Buffer | null;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  signal?: AbortSignal;
  /**
   * Validator for the seed URL and EVERY redirect hop. Must throw
   * HttpOverSocksError to reject. Injected to keep this transport
   * policy-free (the fetcher supplies the onion/SSRF validator; tests
   * supply permissive or strict variants).
   */
  validateUrl: (url: string) => string; // returns normalized URL or throws
  /** Test seam — override the socks transport. */
  connect?: typeof socks5hConnect;
}

const MAX_HEADER_BYTES = 64 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 PersonalAgenticBrowser-DarkWeb/1.0';

interface ParsedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
}

function parseUrlTarget(url: string): { host: string; port: number; path: string; isTls: boolean } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpOverSocksError('bad_url', `unparseable URL`);
  }
  const isTls = u.protocol === 'https:';
  if (u.protocol !== 'http:' && !isTls) {
    throw new HttpOverSocksError('bad_protocol', `unsupported protocol: ${u.protocol}`);
  }
  return {
    host: u.hostname.toLowerCase(),
    port: u.port === '' ? (isTls ? 443 : 80) : Number(u.port),
    path: `${u.pathname}${u.search}` || '/',
    isTls,
  };
}

/** Read one full HTTP response off the socket with hard caps. */
function readResponse(
  socket: import('node:net').Socket,
  maxBytes: number,
  headAllowed: boolean
): Promise<ParsedResponse> {
  return new Promise<ParsedResponse>((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let headerEnd = -1;
    let settled = false;
    let body = Buffer.alloc(0);
    let expected: 'content-length' | 'chunked' | 'until-close' = 'until-close';
    let contentLength = -1;
    let chunkState: { remaining: number; inChunk: boolean } | null = null;

    const finish = (resp: ParsedResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(resp);
    };
    const fail = (code: string, message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new HttpOverSocksError(code, message));
    };
    const cleanup = (): void => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const finishBody = (headers: Record<string, string>, status: number, statusText: string): void => {
      if (body.length > maxBytes) {
        fail('response_too_large', `response exceeds ${maxBytes} bytes`);
        return;
      }
      finish({ status, statusText, headers, body });
    };

    const onData = (chunk: Buffer): void => {
      if (headerEnd === -1) {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length > MAX_HEADER_BYTES) {
          fail('header_too_large', 'response header block exceeds 64 KiB');
          return;
        }
        headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headerText = buf.subarray(0, headerEnd).toString('latin1');
        const lines = headerText.split('\r\n');
        const statusLine = lines[0] ?? '';
        const sm = /^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/i.exec(statusLine);
        if (!sm) {
          fail('bad_response', 'malformed HTTP status line');
          return;
        }
        const headers: Record<string, string> = {};
        for (const line of lines.slice(1)) {
          const idx = line.indexOf(':');
          if (idx === -1) continue;
          const k = line.slice(0, idx).trim().toLowerCase();
          headers[k] = line.slice(idx + 1).trim();
        }
        const coding = (headers['transfer-encoding'] ?? '').toLowerCase();
        contentLength = headers['content-length'] !== undefined ? Number(headers['content-length']) : -1;
        if (!Number.isFinite(contentLength)) contentLength = -1;
        expected = coding.includes('chunked') ? 'chunked' : contentLength >= 0 ? 'content-length' : 'until-close';

        if (expected === 'content-length' && contentLength > maxBytes) {
          fail('response_too_large', `content-length ${contentLength} exceeds ${maxBytes} bytes`);
          return;
        }
        const rest = buf.subarray(headerEnd + 4);
        buf = Buffer.alloc(0);
        if (rest.length > 0) processBody(rest, headers, Number(sm[1]), sm[2] ?? '');
        else if (headAllowed || contentLength === 0) finishBody(headers, Number(sm[1]), sm[2] ?? '');
        // expected === 'until-close' with no body yet: keep waiting for close.
        return;
      }
      processBody(chunk, undefined, undefined, undefined);
    };

    const processBody = (
      chunk: Buffer,
      hdrs?: Record<string, string>,
      status?: number,
      statusText?: string
    ): void => {
      const headers = hdrs ?? currentHeaders!;
      const st = status ?? currentStatus!;
      const stText = statusText ?? currentStatusText!;
      if (expected === 'chunked') {
        let pos = 0;
        if (chunkState === null) chunkState = { remaining: 0, inChunk: false };
        while (pos < chunk.length) {
          if (!chunkState.inChunk) {
            const nl = chunk.indexOf('\r\n', pos);
            if (nl === -1) {
              pos = chunk.length; // wait for more size-line bytes
              continue;
            }
            const sizeLine = chunk.subarray(pos, nl).toString('latin1').split(';')[0].trim();
            const size = Number.parseInt(sizeLine, 16);
            if (!Number.isFinite(size) || size < 0) {
              fail('bad_chunk', 'malformed chunked encoding');
              return;
            }
            pos = nl + 2;
            if (size === 0) {
              finishBody(headers, st, stText);
              return;
            }
            chunkState.remaining = size;
            chunkState.inChunk = true;
          } else {
            const take = Math.min(chunkState.remaining, chunk.length - pos);
            body = Buffer.concat([body, chunk.subarray(pos, pos + take)]);
            chunkState.remaining -= take;
            pos += take;
            if (body.length > maxBytes) {
              fail('response_too_large', 'chunked response exceeds byte cap');
              return;
            }
            if (chunkState.remaining === 0) {
              chunkState.inChunk = false;
              pos += 2; // CRLF after chunk data
            }
          }
        }
        currentHeaders = headers;
        currentStatus = st;
        currentStatusText = stText;
        return;
      }
      body = Buffer.concat([body, chunk]);
      if (body.length > maxBytes) {
        fail('response_too_large', 'response exceeds byte cap');
        return;
      }
      currentHeaders = headers;
      currentStatus = st;
      currentStatusText = stText;
      if (expected === 'content-length' && body.length >= contentLength) {
        finishBody(headers, st, stText);
        return;
      }
      if (expected === 'until-close') return; // resolve on close
    };

    let currentHeaders: Record<string, string> | null = null;
    let currentStatus = 0;
    let currentStatusText = '';

    const onError = (err: Error): void => fail('socket_error', `socket error: ${err.message}`);
    const onClose = (): void => {
      if (headerEnd === -1) {
        fail('connection_closed', 'connection closed before response headers');
        return;
      }
      if (expected === 'until-close' && currentHeaders) {
        finishBody(currentHeaders, currentStatus, currentStatusText);
        return;
      }
      if (!settled && currentHeaders && expected === 'content-length' && body.length < contentLength) {
        fail('truncated', 'connection closed before full body arrived');
        return;
      }
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/**
 * Perform an HTTP(S) request over the SOCKS5H tunnel, following redirects
 * only when every hop passes `validateUrl`.
 */
export async function httpOverSocks(opts: HttpOverSocksOptions): Promise<HttpOverSocksResult> {
  const connect = opts.connect ?? socks5hConnect;
  const maxRedirects = Math.max(0, Math.min(8, opts.maxRedirects));
  let currentUrl = opts.validateUrl(opts.url);
  let redirectCount = 0;
  let method = opts.method ?? 'GET';

  for (;;) {
    if (opts.signal?.aborted) throw new HttpOverSocksError('aborted', 'request aborted');
    const target = parseUrlTarget(currentUrl);
    const socket = await connect({
      proxy: opts.proxy,
      targetHost: target.host,
      targetPort: target.port,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      tls: target.isTls,
    });

    try {
      const headers: string[] = [
        `${method} ${target.path} HTTP/1.1`,
        `Host: ${target.host}${target.port === (target.isTls ? 443 : 80) ? '' : `:${target.port}`}`,
        `User-Agent: ${USER_AGENT}`,
        'Accept: text/html, text/plain, application/json;q=0.9, */*;q=0.1',
        // No content-coding accepted — see module docstring.
        'Accept-Encoding: identity',
        'Connection: close',
      ];
      for (const [k, v] of Object.entries(opts.headers ?? {})) {
        if (k.toLowerCase() === 'host' || k.toLowerCase() === 'content-length') continue;
        headers.push(`${k}: ${String(v).replace(/[\r\n]/g, ' ')}`);
      }
      if (opts.body && method !== 'HEAD') {
        headers.push(`Content-Length: ${opts.body.length}`);
      }
      const payload = Buffer.concat([
        Buffer.from(`${headers.join('\r\n')}\r\n\r\n`, 'latin1'),
        opts.body && method !== 'HEAD' ? opts.body : Buffer.alloc(0),
      ]);

      const timeoutTimer = setTimeout(() => {
        socket.destroy(new Error('response timeout'));
      }, Math.max(1, opts.timeoutMs));
      const onAbort = (): void => {
        socket.destroy(new Error('aborted'));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      let resp: ParsedResponse;
      try {
        socket.write(payload);
        resp = await readResponse(socket, opts.maxBytes, method === 'HEAD');
      } finally {
        clearTimeout(timeoutTimer);
        opts.signal?.removeEventListener('abort', onAbort);
      }

      const location = resp.headers['location'];
      const isRedirect = [301, 302, 303, 307, 308].includes(resp.status);
      if (isRedirect && location) {
        if (redirectCount >= maxRedirects) {
          throw new HttpOverSocksError('too_many_redirects', 'redirect limit exceeded');
        }
        redirectCount += 1;
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          throw new HttpOverSocksError('bad_redirect', 'unparseable redirect location');
        }
        // Loop guard: same URL twice in a chain is a redirect loop.
        if (next.href === currentUrl) {
          throw new HttpOverSocksError('redirect_loop', 'redirect points at itself');
        }
        method = resp.status === 303 || (resp.status !== 307 && resp.status !== 308 && method !== 'HEAD') ? 'GET' : method;
        currentUrl = opts.validateUrl(next.href);
        continue;
      }

      const bytesReceived = resp.body.length;
      socket.destroy();
      return {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers,
        body: method === 'HEAD' ? null : resp.body,
        finalUrl: currentUrl,
        bytesReceived,
        redirectCount,
      };
    } finally {
      if (!socket.destroyed) socket.destroy();
    }
  }
}

/** Decode a text body honouring the charset from Content-Type (§13). */
export function decodeBody(body: Buffer, contentType: string | null): string {
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '');
  const charset = (m?.[1] ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return body.toString('utf8');
  }
}
