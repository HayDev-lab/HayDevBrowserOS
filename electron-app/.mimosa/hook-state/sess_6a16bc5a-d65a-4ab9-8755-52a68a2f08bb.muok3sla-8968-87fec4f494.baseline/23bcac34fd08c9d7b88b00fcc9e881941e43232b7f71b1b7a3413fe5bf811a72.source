/**
 * TorRuntime — detection / optional spawn / status of the Tor SOCKS gateway
 * (spec §10/§12/§45/§46/§47/§48).
 *
 * States (spec §47):
 *   NOT_INSTALLED — no SOCKS endpoint AND no tor binary found
 *   STARTING      — spawning tor, or probing for bootstrap
 *   READY         — end-to-end probe through SOCKS to an onion succeeded
 *   OFFLINE       — endpoint configured but probe failing (e.g. no bootstrap)
 *   ERROR         — spawn failed / binary crashed
 *
 * FAIL-CLOSED CONTRACT: nothing here ever opens a non-Tor path. If Tor is
 * not available the runtime reports it and every onion fetch fails.
 *
 * Process hygiene (spec §45): the spawned tor child is killed with its
 * whole process tree on stop/app-quit (taskkill /T /F on Windows,
 * kill(-pid) on POSIX with detached:true), so no zombie tor survives the
 * browser.
 *
 * Runtime module — node:child_process, node:fs, node:path only.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { probeSocks } from './socks-client';
import type { DarkWebConfig, DarkWebTorStatus, TorState } from '@shared/darkweb-types';

export class TorRuntime {
  private state: TorState = 'NOT_INSTALLED';
  private detail: string | null = null;
  private latencyMs: number | null = null;
  private lastCheckAt: number | null = null;
  private child: ChildProcess | null = null;
  private starting = false;
  private stopRequested = false;

  constructor(private readonly log: (msg: string) => void = () => {}) {}

  status(config: DarkWebConfig): DarkWebTorStatus {
    return {
      state: this.state,
      socksHost: config.tor.socksHost,
      socksPort: config.tor.socksPort,
      detail: this.detail,
      latencyMs: this.latencyMs,
      lastCheckAt: this.lastCheckAt,
    };
  }

  /** One end-to-end probe; optionally (re)spawns tor when allowed. */
  async ensureReady(config: DarkWebConfig, opts?: { spawnAllowed?: boolean }): Promise<DarkWebTorStatus> {
    if (this.stopRequested) return this.status(config);
    const endpoint = { host: config.tor.socksHost, port: config.tor.socksPort };
    const probe = await probeSocks({
      proxy: endpoint,
      probeHost: config.tor.probeUrl ? new URL(config.tor.probeUrl).hostname : 'www.google.com',
      timeoutMs: config.tor.probeTimeoutMs,
    });
    this.lastCheckAt = Date.now();

    if (probe.ok) {
      this.state = 'READY';
      this.latencyMs = probe.latencyMs;
      this.detail = null;
      return this.status(config);
    }

    this.latencyMs = null;
    // Endpoint refused / not listening → try to bring Tor up (once at a time).
    const spawnAllowed = opts?.spawnAllowed ?? true;
    if (spawnAllowed && config.tor.spawnIfAvailable && !this.child && !this.starting) {
      const binary = findTorBinary(config.tor.binaryPath);
      if (binary === null) {
        this.state = 'NOT_INSTALLED';
        this.detail = probe.errorCode === 'proxy_unreachable'
          ? 'No Tor SOCKS endpoint listening and no tor binary found. Install Tor (torproject.org) or the Tor Browser, then retry.'
          : `Tor probe failed: ${probe.errorCode}`;
        return this.status(config);
      }
      await this.spawnAndWait(binary, config);
      // Re-probe after spawn.
      return this.ensureReady(config, { spawnAllowed: false });
    }

    this.state = this.child || this.starting ? 'STARTING' : 'OFFLINE';
    if (this.state === 'OFFLINE') {
      this.detail = probe.errorCode === 'proxy_unreachable'
        ? 'Tor SOCKS endpoint is not accepting connections.'
        : `Tor is listening but the probe failed (${probe.errorCode}). Bootstrap may still be in progress.`;
    }
    return this.status(config);
  }

  /** True when onion fetches may proceed. */
  isReady(): boolean {
    return this.state === 'READY';
  }

  private spawnAndWait(binary: string, config: DarkWebConfig): Promise<void> {
    return new Promise<void>((resolve) => {
      this.starting = true;
      this.state = 'STARTING';
      this.detail = 'Starting bundled Tor process…';
      const dataDir = path.join(process.env.PAB_USER_DATA_DIR ?? '.', 'darkweb', 'tor-data');
      const args = [
        '--SocksPort', `${config.tor.socksHost}:${config.tor.socksPort}`,
        '--DataDirectory', dataDir,
        '--SocksPolicy', 'accept 127.0.0.1',
        '--SocksPolicy', 'reject *',
      ];
      this.log(`[darkweb] spawning tor: ${binary}`);
      let child: ChildProcess;
      try {
        child = process.platform === 'win32'
          ? spawn(binary, args, { stdio: 'ignore', windowsHide: true })
          : spawn(binary, args, { stdio: 'ignore', detached: true });
      } catch (err) {
        this.starting = false;
        this.state = 'ERROR';
        this.detail = `Failed to start tor: ${err instanceof Error ? err.message : 'unknown error'}`;
        resolve();
        return;
      }
      this.child = child;
      child.once('exit', (code) => {
        if (this.child === child) {
          this.child = null;
          this.starting = false;
          if (!this.stopRequested) {
            this.state = 'ERROR';
            this.detail = `tor exited unexpectedly (code ${code ?? 'signal'})`;
          }
        }
      });
      // Give the process a grace window to boot; readiness is confirmed by
      // the caller's re-probe, not by this timer.
      setTimeout(() => {
        this.starting = false;
        resolve();
      }, 1_500);
    });
  }

  /** Kill the spawned tor tree (idempotent, called on app quit). */
  stop(): void {
    this.stopRequested = true;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    try {
      if (process.platform === 'win32') {
        if (child.pid) {
          // tree-kill: tor.exe may keep bootstrap subprocesses on Windows.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        }
      } else {
        // detached:true put tor in its own group — negative pid kills it all.
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
    } catch (err) {
      this.log(`[darkweb] tor stop failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}

/**
 * Locate a usable tor binary. Order: explicit config path → PAB_TOR_PATH
 * env → Tor Browser install (Windows/macOS) → PATH common unix locations.
 * Returns null when nothing exists on disk (honest NOT_INSTALLED, spec §47).
 */
export function findTorBinary(explicitPath: string | null): string | null {
  const candidates: string[] = [];
  if (explicitPath) candidates.push(explicitPath);
  if (process.env.PAB_TOR_PATH) candidates.push(process.env.PAB_TOR_PATH);
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Tor Browser', 'Browser', 'tor.exe'));
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Tor Browser', 'Browser', 'tor.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Tor Browser', 'Browser', 'tor.exe'));
  }
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Tor Browser.app/Contents/MacOS/Tor/tor');
  }
  candidates.push('/usr/bin/tor', '/usr/local/bin/tor', '/opt/homebrew/bin/tor', '/usr/sbin/tor');
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}
