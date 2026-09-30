/**
 * Tor control-protocol client — minimal RFC-spec (control port v1):
 * AUTHENTICATE with the cookie from DataDirectory/control-auth-cookie,
 * subscribe to STATUS_CLIENT and surface bootstrap progress (spec §38).
 *
 * Runtime module — node:net only; protocol parsing unit-testable.
 */
import net from 'node:net';
import { promises as fs } from 'node:fs';

export interface TorControlOptions {
  host: string;
  port: number;
  cookiePath: string;
  timeoutMs: number;
  onProgress?: (percent: number, phase: string) => void;
  onClose?: () => void;
}

const BOOTSTRAP_RE = /BOOTSTRAP.*?PROGRESS=(\d+).*?(?:TAG=(\S+))?\s*(.*)/i;

/** Parse one STATUS_CLIENT line → progress info, or null. */
export function parseBootstrapEvent(line: string): { percent: number; phase: string } | null {
  if (!/STATUS_CLIENT/i.test(line) || !/BOOTSTRAP/i.test(line)) return null;
  const m = BOOTSTRAP_RE.exec(line);
  if (!m) return null;
  const percent = Number(m[1]);
  if (!Number.isFinite(percent)) return null;
  return { percent: Math.max(0, Math.min(100, percent)), phase: (m[3] ?? '').trim() };
}

/**
 * Connect to the control port and stream bootstrap events until closed or
 * 100% (the promise resolves at 100% or on close — it never rejects except
 * for auth/connection failure).
 */
export function followBootstrap(opts: TorControlOptions): { promise: Promise<number>; close: () => void } {
  let socket: net.Socket | null = null;
  const promise = new Promise<number>((resolve, reject) => {
    let buf = '';
    let lastPercent = 0;
    let stage: 'greet' | 'authing' | 'listening' = 'greet';
    const timer = setTimeout(() => {
      socket?.destroy();
      resolve(lastPercent); // bootstrap may finish without events — non-fatal
    }, Math.max(1, opts.timeoutMs));

    const finish = (percent: number): void => {
      clearTimeout(timer);
      socket?.destroy();
      resolve(percent);
    };

    socket = net.connect({ host: opts.host, port: opts.port });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(lastPercent);
    });
    socket.on('close', () => {
      opts.onClose?.();
    });
    socket.on('data', async (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        if (stage === 'greet') {
          if (!line.startsWith('250')) {
            clearTimeout(timer);
            reject(new Error('CONTROL_UNEXPECTED_REPLY'));
            return;
          }
          // Send AUTHENTICATE with the cookie hex.
          try {
            const cookie = (await fs.readFile(opts.cookiePath)).toString('hex').trim();
            socket!.write(`AUTHENTICATE ${cookie}\r\n`);
          } catch {
            socket!.write('AUTHENTICATE\r\n'); // no-cookie control port
          }
          stage = 'authing';
          continue;
        }
        if (stage === 'authing') {
          if (line.startsWith('250')) {
            socket!.write('SETEVENTS STATUS_CLIENT\r\n');
            stage = 'listening';
          } else {
            clearTimeout(timer);
            reject(new Error('CONTROL_AUTH_FAILED'));
          }
          continue;
        }
        const event = parseBootstrapEvent(line);
        if (event) {
          lastPercent = event.percent;
          opts.onProgress?.(event.percent, event.phase);
          if (event.percent >= 100) finish(100);
        }
      }
    });
  });
  return {
    promise,
    close: () => socket?.destroy(),
  };
}
