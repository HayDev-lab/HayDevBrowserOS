/**
 * SOCKS5 client with REMOTE DNS (socks5h semantics) — the only TCP path
 * used by the dark-web runtime (spec §10).
 *
 * SECURITY PROPERTIES:
 *   - Hostnames are sent to the proxy as ATYP=0x03 (domain) — .onion
 *     names are NEVER resolved through the OS resolver; there is no
 *     local DNS lookup of any kind on this path.
 *   - The client connects ONLY to the configured SOCKS endpoint; if that
 *     is Tor, all traffic is anonymized. If Tor is down the connection
 *     FAILS — the caller must not fall back to direct sockets (fail-closed
 *     is enforced in the fetcher, this module is just a dumb transport).
 *   - https targets are upgraded with TLS SNI = target hostname and
 *     certificate verification ON (rejectUnauthorized) — a hostile exit
 *     node cannot silently MITM.
 *
 * Runtime module — node:net / node:tls only; unit-tested against a mock
 * SOCKS5 server (tests/darkweb-socks.test.ts).
 */
import net from 'node:net';
import tls from 'node:tls';

export interface SocksEndpoint {
  host: string;
  port: number;
}

export class SocksConnectError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SocksConnectError';
  }
}

const REP_MESSAGES: Record<number, string> = {
  1: 'general SOCKS server failure',
  2: 'connection not allowed by ruleset',
  3: 'network unreachable',
  4: 'host unreachable (onion service likely offline)',
  5: 'connection refused',
  6: 'TTL expired',
  7: 'command not supported',
  8: 'address type not supported',
};

export interface SocksConnectOptions {
  proxy: SocksEndpoint;
  /** Target hostname — sent to the proxy verbatim (remote DNS). */
  targetHost: string;
  targetPort: number;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Upgrade to TLS after the SOCKS handshake (SNI = targetHost). */
  tls?: boolean;
}

export type SocksSocket = net.Socket;

/**
 * Establish a SOCKS5 CONNECT tunnel to targetHost:targetPort through the
 * given proxy. Resolves with the established (optionally TLS) socket.
 * Rejects with SocksConnectError carrying a safe machine code.
 */
export function socks5hConnect(opts: SocksConnectOptions): Promise<SocksSocket> {
  return new Promise<SocksSocket>((resolve, reject) => {
    let settled = false;
    let socket: net.Socket | null = null;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const finishOk = (s: SocksSocket): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    };
    const fail = (code: string, message: string, err?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (socket && !socket.destroyed) socket.destroy();
      reject(new SocksConnectError(code, err ? `${message}: ${err.message}` : message));
    };
    const onAbort = (): void => fail('aborted', 'socks connect aborted');

    if (!Number.isInteger(opts.proxy.port) || opts.proxy.port < 1 || opts.proxy.port > 65535) {
      fail('bad_proxy_port', 'invalid SOCKS proxy port');
      return;
    }

    timer = setTimeout(() => fail('timeout', 'socks connect timed out'), Math.max(1, opts.timeoutMs));
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    socket = net.connect({ host: opts.proxy.host, port: opts.proxy.port });
    socket.setNoDelay(true);

    socket.on('error', (err: Error) => fail('proxy_unreachable', 'cannot reach SOCKS proxy', err));

    let phase: 'greeting' | 'connect' = 'greeting';
    let buf = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1024) {
        // A compliant SOCKS5 server replies with a few bytes per phase.
        fail('proxy_protocol', 'socks proxy sent unexpected data');
        return;
      }

      if (phase === 'greeting') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) {
          fail('proxy_protocol', 'not a SOCKS5 proxy');
          return;
        }
        if (buf[1] !== 0x00) {
          fail('proxy_auth_unsupported', 'SOCKS proxy requires authentication (unsupported)');
          return;
        }
        buf = buf.subarray(2);
        phase = 'connect';
        // VER=5 CMD=CONNECT RSV=0 ATYP=domain, len-prefixed hostname, port BE.
        const host = Buffer.from(opts.targetHost, 'utf8');
        const req = Buffer.alloc(7 + host.length);
        req[0] = 0x05;
        req[1] = 0x01; // CONNECT
        req[2] = 0x00;
        req[3] = 0x03; // ATYP: domain name → REMOTE DNS
        req[4] = host.length;
        host.copy(req, 5);
        req.writeUInt16BE(opts.targetPort & 0xffff, 5 + host.length);
        socket!.write(req);
        return;
      }

      // phase === 'connect' — wait for the full variable-length reply.
      if (buf.length < 5) return;
      const rep = buf[1];
      const addrLen = buf[4];
      const total = 4 + addrLen + 2;
      if (buf.length < total) return;
      if (rep !== 0x00) {
        const msg = REP_MESSAGES[rep] ?? `socks error ${rep}`;
        const code = rep === 4 ? 'onion_unreachable' : `socks_rep_${rep}`;
        fail(code, msg);
        return;
      }
      const established: net.Socket = socket!;
      socket!.removeAllListeners('data');
      socket!.removeAllListeners('error');
      buf = Buffer.alloc(0);

      if (opts.tls) {
        const tlsSocket = tls.connect(
          {
            socket: established,
            servername: opts.targetHost,
            rejectUnauthorized: true,
          },
          () => finishOk(tlsSocket)
        );
        tlsSocket.on('error', (err: Error) => fail('tls_failed', 'TLS handshake through Tor failed', err));
        return;
      }
      finishOk(established);
    });

    socket.on('close', () => {
      if (!settled) fail('proxy_closed', 'socks proxy closed connection during handshake');
    });

    socket.write(Buffer.from([0x05, 0x01, 0x00]));
  });
}

/**
 * Cheap SOCKS-endpoint liveness probe: full handshake + CONNECT to the
 * target, then immediate teardown. Used by the Tor status indicator.
 * `probeHost` should be an .onion hostname so the probe also verifies
 * remote-DNS onion routing end-to-end.
 */
export async function probeSocks(opts: {
  proxy: SocksEndpoint;
  probeHost: string;
  probePort?: number;
  timeoutMs: number;
}): Promise<{ ok: boolean; latencyMs: number; errorCode: string | null }> {
  const started = Date.now();
  let socket: SocksSocket | null = null;
  try {
    socket = await socks5hConnect({
      proxy: opts.proxy,
      targetHost: opts.probeHost,
      targetPort: opts.probePort ?? 80,
      timeoutMs: opts.timeoutMs,
    });
    return { ok: true, latencyMs: Date.now() - started, errorCode: null };
  } catch (err) {
    const code = err instanceof SocksConnectError ? err.code : 'probe_failed';
    return { ok: false, latencyMs: Date.now() - started, errorCode: code };
  } finally {
    socket?.destroy();
  }
}
