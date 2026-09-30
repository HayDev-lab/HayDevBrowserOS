/**
 * PortManager — dynamic, conflict-safe local port allocation (spec §29/§30).
 *
 * NEVER kills or reconfigures a foreign process holding the preferred
 * port: the preferred port is probed, and if occupied the allocator moves
 * to the next candidate (bounded scan) and finally to an OS-assigned
 * ephemeral port. Allocation actually RESERVES the port briefly via a
 * listen probe so concurrent allocations cannot collide; the caller must
 * start the service promptly (TOCTOU is documented — a service that fails
 * to bind reports STARTING→FAILED and the manager re-allocates).
 *
 * PURE-ish: the listen probe is injectable for tests.
 */
import net from 'node:net';

export interface PortProbe {
  /** True when a TCP server can bind 127.0.0.1:port right now. */
  canBind(port: number): Promise<boolean>;
}

export class NetPortProbe implements PortProbe {
  /**
   * A port counts as free only when (a) we can bind 127.0.0.1:port AND
   * (b) after releasing, NOTHING answers a TCP connect on it. The connect
   * probe catches wildcard holders (0.0.0.0:port) whose bind Windows lets
   * us shadow on the loopback address — such a collision would silently
   * route our traffic to the foreign service (spec §30).
   */
  canBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        resolve(false);
        return;
      }
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => {
          const probeSock = net.connect({ host: '127.0.0.1', port });
          const settle = (free: boolean): void => {
            probeSock.destroy();
            resolve(free);
          };
          probeSock.once('connect', () => settle(false)); // foreign listener answered
          probeSock.once('error', () => settle(true)); // connection refused → free
          setTimeout(() => settle(true), 250).unref?.();
        });
      });
    });
  }
}


export interface Allocation {
  port: number;
  /** The preferred port if it was free, else the chosen alternative. */
  preferredWasBusy: boolean;
}

export class PortManager {
  private readonly allocations = new Map<string, number>();
  private readonly probe: PortProbe;

  constructor(
    private readonly scanLimit = 32,
    probe: PortProbe | null = null
  ) {
    this.probe = probe ?? new NetPortProbe();
  }

  /**
   * Allocate a free loopback port for `key`, preferring `preferred`.
   * Re-allocating for the same key returns the previous allocation unless
   * it is no longer bindable (service died → fresh allocation).
   */
  async allocate(key: string, preferred: number): Promise<Allocation> {
    const existing = this.allocations.get(key);
    if (existing !== undefined && (await this.probe.canBind(existing))) {
      // Not yet bound by its service → still reserved logically.
      return { port: existing, preferredWasBusy: existing !== preferred };
    }
    if (await this.probe.canBind(preferred)) {
      this.allocations.set(key, preferred);
      return { port: preferred, preferredWasBusy: false };
    }
    // Scan upward from preferred+1 — no foreign process is ever touched.
    for (let i = 1; i <= this.scanLimit; i += 1) {
      const candidate = preferred + i;
      if (candidate > 65535) break;
      if (await this.probe.canBind(candidate)) {
        this.allocations.set(key, candidate);
        return { port: candidate, preferredWasBusy: true };
      }
    }
    // Last resort: let the OS pick (port 0 semantics — probe an ephemeral).
    for (let i = 0; i < 10; i += 1) {
      const ephemeral = 49152 + Math.floor(Math.random() * 16384);
      if (await this.probe.canBind(ephemeral)) {
        this.allocations.set(key, ephemeral);
        return { port: ephemeral, preferredWasBusy: true };
      }
    }
    throw new Error('NO_FREE_PORT');
  }

  release(key: string): void {
    this.allocations.delete(key);
  }

  get(key: string): number | undefined {
    return this.allocations.get(key);
  }

  releaseAll(): void {
    this.allocations.clear();
  }
}
