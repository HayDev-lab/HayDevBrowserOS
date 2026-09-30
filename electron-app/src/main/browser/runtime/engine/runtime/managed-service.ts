/**
 * ManagedService — base class binding the state machine, supervisor, port
 * manager and health polling into one long-lived service lifecycle
 * (spec §16/§17/§32/§70/§71/§72/§92/§93).
 *
 * Lifecycle:
 *   start()  → adopt EXTERNAL endpoint if configured+healthy (no spawn),
 *              else allocate a port, spawn via supervisor, poll health to
 *              READY (state DEGRADED but still polling after the deadline).
 *   Health loop (every interval): READY→DEGRADED on repeated failures and
 *              back — request-level errors NEVER restart the process
 *              (spec §92/§93: services are long-lived, not per-request).
 *   Child exit → bounded restart with exponential backoff (spec §71) or
 *              FAILED when the policy budget is exhausted (spec §72: the
 *              browser itself never goes down).
 *   stop()   → graceful: stop polling, tree-kill, STOPPED.
 *
 * No Electron imports — testable with the supervisor's spawn seams.
 */
import type { ProcessSupervisor, SpawnRequest } from './process-supervisor';
import {
  initialSnapshot,
  transition,
  nextRestartDelay,
  isRunning,
  DEFAULT_RESTART_POLICY,
  type RestartPolicy,
  type ServiceState,
  type ServiceStateSnapshot,
} from '../pure/service-state-machine';
import type { PortManager } from '../pure/port-manager';
import { probeHttp, type HealthResult } from './health';

export interface ManagedServiceOptions {
  key: string;
  supervisor: ProcessSupervisor;
  ports: PortManager;
  /** Preferred loopback port; conflicts move to a neighbour (spec §30). */
  preferredPort: number;
  /** Deadline for the first READY after spawn. */
  startTimeoutMs: number;
  healthIntervalMs: number;
  healthTimeoutMs: number;
  /** Consecutive health failures before READY degrades. */
  healthFailuresToDegrade: number;
  restartPolicy?: RestartPolicy;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface ServiceStatus {
  key: string;
  state: ServiceState;
  reason: string | null;
  endpoint: string | null;
  /** 'managed' = our child process; 'external' = adopted endpoint. */
  source: 'managed' | 'external' | 'none';
  pid: number | null;
  port: number | null;
  restartAttempt: number;
  lastHealth: HealthResult | null;
  startedAt: number | null;
  readyAt: number | null;
  progress: number | null;
}

export abstract class ManagedService {
  protected snap: ServiceStateSnapshot = initialSnapshot(0);
  protected port: number | null = null;
  protected externalUrl: string | null = null;
  protected healthFailures = 0;
  private healthTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  protected constructor(protected readonly opts: ManagedServiceOptions) {}

  /** Human service name for logs. */
  abstract readonly name: string;

  /** The URL consumers should use, or null while unavailable. */
  get endpoint(): string | null {
    if (this.externalUrl) return this.externalUrl;
    if (this.port === null) return null;
    return `http://127.0.0.1:${this.port}`;
  }

  get state(): ServiceState {
    return this.snap.state;
  }

  /** Spawn request for a MANAGED instance on the given port. */
  protected abstract spawnRequest(port: number): SpawnRequest | null | Promise<SpawnRequest | null>;
  /** Health check for a MANAGED instance (or adopted external URL). */
  protected abstract checkHealth(endpoint: string): Promise<HealthResult>;
  /** Called after spawn when STARTING begins (e.g. tor → BOOTSTRAPPING). */
  protected onSpawned(): void | Promise<void> {}

  // ---------------------------------------------------------------------------
  async start(externalUrl: string | null = null): Promise<ServiceStatus> {
    if (this.disposed) throw new Error('SERVICE_DISPOSED');
    // EXTERNAL adopt mode: a healthy configured endpoint wins (dev zero-change).
    if (externalUrl) {
      const health = await this.checkHealth(externalUrl);
      if (health.ok) {
        this.externalUrl = externalUrl;
        this.port = null;
        this.apply(transition(this.snap, 'READY', { now: this.now(), reason: 'external_adopted' }));
        this.startHealthLoop();
        return this.status();
      }
      this.log(`[${this.opts.key}] external ${externalUrl} unhealthy (${health.errorCode}) — falling back to managed`);
    }
    if (isRunning(this.snap.state)) return this.status();
    this.apply(transition(this.snap, 'STARTING', { now: this.now(), reason: this.snap.attempt > 0 ? 'restart' : 'start' }));
    await this.spawnAndAwait();
    return this.status();
  }

  async stop(): Promise<void> {
    this.stopHealthLoop();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.externalUrl !== null || this.snap.state === 'STOPPED') {
      this.externalUrl = null;
      this.apply(transition(this.snap, 'STOPPED', { now: this.now() }));
      return;
    }
    this.apply(transition(this.snap, 'STOPPING', { now: this.now() }));
    await this.opts.supervisor.stop(this.opts.key);
    this.opts.ports.release(this.opts.key);
    this.port = null;
    this.apply(transition(this.snap, 'STOPPED', { now: this.now() }));
  }

  /** Controlled manual restart (spec §8 restartService). */
  async restart(): Promise<ServiceStatus> {
    await this.stop();
    this.snap = { ...this.snap, attempt: 0 };
    return this.start(this.externalUrl);
  }

  /**
   * Bounded wait until a consumer-usable endpoint is known (managed port
   * allocated or external adopted) or the deadline passes. Never throws.
   */
  async whenEndpointSettled(timeoutMs: number): Promise<void> {
    const deadline = this.now() + timeoutMs;
    while (this.endpoint === null && this.now() < deadline && isRunning(this.snap.state)) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
  }

  status(): ServiceStatus {
    const external = this.externalUrl !== null;
    return {
      key: this.opts.key,
      state: this.snap.state,
      reason: this.snap.reason,
      endpoint: this.endpoint,
      source: external ? 'external' : this.port !== null ? 'managed' : 'none',
      pid: external ? null : this.opts.supervisor.pid(this.opts.key),
      port: this.port,
      restartAttempt: this.snap.attempt,
      lastHealth: this.lastHealth,
      startedAt: this.snap.startedAt,
      readyAt: this.snap.readyAt,
      progress: this.snap.progress,
    };
  }

  // ---------------------------------------------------------------------------
  protected lastHealth: HealthResult | null = null;
  protected log(msg: string): void {
    this.opts.log?.(msg);
  }
  protected now(): number {
    return this.opts.now?.() ?? Date.now();
  }
  protected setState(state: Parameters<typeof transition>[1], opts: { reason?: string | null; progress?: number | null } = {}): void {
    this.apply(transition(this.snap, state, { now: this.now(), ...opts }));
  }

  private apply(result: { snap: ServiceStateSnapshot; legal: boolean }): void {
    this.snap = result.snap;
  }

  private async spawnAndAwait(): Promise<void> {
    const allocation = await this.opts.ports.allocate(this.opts.key, this.opts.preferredPort);
    if (allocation.preferredWasBusy) {
      this.log(`[${this.opts.key}] preferred port ${this.opts.preferredPort} busy → using ${allocation.port}`);
    }
    this.port = allocation.port;
    const req = await this.spawnRequest(allocation.port);
    if (req === null) {
      this.apply(transition(this.snap, 'FAILED', { now: this.now(), reason: 'RUNTIME_NOT_BUNDLED' }));
      return;
    }
    await this.opts.supervisor.start(req);
    await this.onSpawned();

    // Poll health until the start deadline; afterwards keep the loop running
    // but mark DEGRADED (spec §17) — the child stays up, no kill-restart.
    const deadline = this.now() + this.opts.startTimeoutMs;
    for (;;) {
      const health = await this.pollOnce();
      if (health.ok) {
        this.apply(transition(this.snap, 'READY', { now: this.now() }));
        this.startHealthLoop();
        return;
      }
      if (this.snap.state === 'STOPPING' || this.snap.state === 'STOPPED') return;
      if (this.now() > deadline) {
        this.apply(transition(this.snap, 'DEGRADED', { now: this.now(), reason: health.errorCode ?? 'START_TIMEOUT' }));
        this.startHealthLoop();
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(500, this.opts.healthIntervalMs)));
    }
  }

  /** One health poll; updates READY/DEGRADED when already past STARTING. */
  private async pollOnce(): Promise<HealthResult> {
    const endpoint = this.endpoint;
    const health = endpoint === null
      ? { ok: false, latencyMs: 0, errorCode: 'NO_ENDPOINT' }
      : await this.checkHealth(endpoint);
    this.lastHealth = health;
    if (health.ok) this.healthFailures = 0;
    else this.healthFailures += 1;
    if (this.snap.state === 'READY' && this.healthFailures >= this.opts.healthFailuresToDegrade) {
      this.apply(transition(this.snap, 'DEGRADED', { now: this.now(), reason: health.errorCode }));
    } else if (this.snap.state === 'DEGRADED' && health.ok) {
      this.apply(transition(this.snap, 'READY', { now: this.now() }));
    }
    return health;
  }

  protected startHealthLoop(): void {
    this.stopHealthLoop();
    this.healthTimer = setInterval(() => {
      void this.pollOnce();
    }, this.opts.healthIntervalMs);
    this.healthTimer.unref?.();
  }

  protected stopHealthLoop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /**
   * Supervisor hook: the child exited. Wire this from the manager for every
   * service. Expected exits (user stop) do nothing; unexpected exits run
   * the bounded restart policy (spec §71).
   */
  async handleChildExit(info: { expected: boolean; code: number | null }): Promise<void> {
    if (this.disposed || info.expected) return;
    this.stopHealthLoop();
    const attempt = this.snap.attempt + 1;
    const delay = nextRestartDelay(this.opts.restartPolicy ?? DEFAULT_RESTART_POLICY, attempt);
    if (delay === null) {
      this.apply(transition(this.snap, 'FAILED', { now: this.now(), reason: `EXITED_UNEXPECTEDLY_${info.code ?? 'signal'}` }));
      return;
    }
    this.apply(transition(this.snap, 'RESTARTING', { now: this.now(), reason: `restart_${attempt}` }));
    this.snap = { ...this.snap, attempt };
    this.log(`[${this.opts.key}] child exited (code=${info.code}) — restart ${attempt} in ${delay}ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.disposed) return;
      void (async () => {
        this.apply(transition(this.snap, 'STARTING', { now: this.now(), reason: 'restart' }));
        await this.spawnAndAwait();
      })();
    }, delay);
    this.restartTimer.unref?.();
  }
}

export { probeHttp };
