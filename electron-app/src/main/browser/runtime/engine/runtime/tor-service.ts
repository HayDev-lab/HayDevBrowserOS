/**
 * TorService — the managed Tor runtime (spec §11/§35–§39).
 *
 * managed mode (default): spawn a bundled/found tor binary on DYNAMIC
 * SOCKS + Control ports, track bootstrap % via the control port, READY
 * only at 100% (spec §38).
 * external mode: adopt a configured SOCKS endpoint (e.g. a system tor on
 * 9050) when it probes healthy — never touched, never killed.
 *
 * Health = an end-to-end SOCKS5H CONNECT to an .onion probe target
 * (remote-DNS verified — spec §39/§46).
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ManagedService, type ManagedServiceOptions, type ServiceStatus } from './managed-service';
import type { SpawnRequest } from './process-supervisor';
import { probeSocks, type SocksEndpoint } from '../../../darkweb/runtime/socks-client';
import { findTorBinary } from '../../../darkweb/runtime/tor-runtime';
import { followBootstrap } from './tor-control';
import type { HealthResult } from './health';

export interface TorServiceOptions extends ManagedServiceOptions {
  /** 'managed' (default) spawns our own tor; 'external' adopts socksPort. */
  mode: 'managed' | 'external';
  /** Preferred control port (dynamic on conflict). */
  preferredControlPort: number;
  /** DataDirectory for runtime state + control-auth-cookie (spec §37). */
  dataDir: string;
  /** Probe target fetched THROUGH Tor for health. */
  probeHost: string;
  /** Where a bundled tor may live (null = look in install dirs / PATH). */
  bundledTorPath: string | null;
  logName?: string;
}

export class TorService extends ManagedService {
  readonly name = 'Tor';
  socksHost = '127.0.0.1';
  controlPort: number | null = null;
  externalMode = false;

  constructor(protected readonly o: TorServiceOptions) {
    super(o);
  }

  /** The SOCKS endpoint for the Tor session / dark-web services (§39). */
  getSocksEndpoint(): SocksEndpoint | null {
    if (this.port === null) return null;
    return { host: this.socksHost, port: this.port };
  }

  /**
   * External mode never spawns: adopt the configured SOCKS endpoint when it
   * probes healthy, else honest FAILED(TOR_UNAVAILABLE) — fail-closed
   * (spec §45), never a clearnet fallback.
   */
  async start(): Promise<ServiceStatus> {
    if (this.o.mode === 'managed') return super.start();
    const socks = { host: this.socksHost, port: this.o.preferredPort };
    const r = await probeSocks({ proxy: socks, probeHost: this.o.probeHost, timeoutMs: this.o.startTimeoutMs });
    if (r.ok) {
      this.port = this.o.preferredPort;
      this.externalMode = true;
      this.setState('READY', { reason: 'external_adopted' });
      this.startHealthLoop();
      return this.status();
    }
    this.setState('FAILED', { reason: 'TOR_UNAVAILABLE' });
    return this.status();
  }

  protected async spawnRequest(socksPort: number): Promise<SpawnRequest | null> {
    if (this.o.mode === 'external') return null;
    const binary = this.o.bundledTorPath ?? findTorBinary(null);
    if (!binary) return null; // honest NOT_INSTALLED → FAILED(RUNTIME_NOT_BUNDLED)
    const ctrl = await this.o.ports.allocate(`${this.opts.key}-control`, this.o.preferredControlPort);
    this.controlPort = ctrl.port;
    // tor creates the DataDirectory only if its PARENT exists — pre-create.
    await fs.mkdir(this.o.dataDir, { recursive: true });
    return {
      key: this.opts.key,
      command: binary,
      args: [
        '--SocksPort', `127.0.0.1:${socksPort}`,
        '--ControlPort', `127.0.0.1:${ctrl.port}`,
        '--CookieAuthentication', '1',
        '--DataDirectory', this.o.dataDir,
        '--SocksPolicy', 'accept 127.0.0.1',
        '--SocksPolicy', 'reject *',
        // NO --quiet: error output must reach our log (spec §87).
      ],
      logName: this.o.logName ?? 'tor.log',
      onExit: (info) => void this.handleChildExit(info),
    };
  }

  protected async onSpawned(): Promise<void> {
    if (this.controlPort === null || this.port === null) return;
    this.setState('BOOTSTRAPPING', { reason: 'tor_control', progress: 0 });
    const follower = followBootstrap({
      host: '127.0.0.1',
      port: this.controlPort,
      cookiePath: path.join(this.o.dataDir, 'control-auth-cookie'),
      timeoutMs: this.opts.startTimeoutMs,
      onProgress: (percent, phase) => {
        this.setState(this.snap.state === 'BOOTSTRAPPING' ? 'BOOTSTRAPPING' : this.snap.state, {
          progress: percent,
          reason: phase || null,
        });
      },
    });
    void follower.promise.catch(() => {});
  }

  /** SOCKS end-to-end probe IS the health check (spec §32 tor branch). */
  protected async checkHealth(_endpoint: string): Promise<HealthResult> {
    const socks = this.getSocksEndpoint();
    if (!socks) return { ok: false, latencyMs: 0, errorCode: 'NO_SOCKS' };
    const r = await probeSocks({ proxy: socks, probeHost: this.o.probeHost, timeoutMs: this.opts.healthTimeoutMs });
    return { ok: r.ok, latencyMs: r.latencyMs, errorCode: r.errorCode };
  }
}
