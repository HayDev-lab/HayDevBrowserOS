/**
 * Provider health tracking + circuit breaker (spec §34/§35).
 *
 * PURE LOGIC — injectable clock for tests.
 *
 * Policy:
 *   - 1–(threshold-1) consecutive failures → DEGRADED (still used);
 *   - ≥ threshold consecutive failures → OFFLINE: circuit OPEN for
 *     cooldownMs, provider skipped by the orchestrator;
 *   - after cooldown the circuit HALF-OPENS (provider allowed again);
 *     one success resets everything.
 */

export interface ProviderHealthState {
  health: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  consecutiveFailures: number;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  circuitOpenUntil: number | null;
}

export interface ProviderHealthPolicy {
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before a half-open probe. */
  cooldownMs: number;
}

export const DEFAULT_PROVIDER_HEALTH_POLICY: ProviderHealthPolicy = {
  failureThreshold: 5,
  cooldownMs: 120_000,
};

const INITIAL: ProviderHealthState = {
  health: 'UNKNOWN',
  consecutiveFailures: 0,
  lastLatencyMs: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  circuitOpenUntil: null,
};

export class ProviderHealthTracker {
  private readonly states = new Map<string, ProviderHealthState>();

  constructor(
    private readonly policy: ProviderHealthPolicy = DEFAULT_PROVIDER_HEALTH_POLICY,
    private readonly now: () => number = () => Date.now()
  ) {}

  private stateOf(id: string): ProviderHealthState {
    let s = this.states.get(id);
    if (!s) {
      s = { ...INITIAL };
      this.states.set(id, s);
    }
    return s;
  }

  recordSuccess(id: string, latencyMs: number): void {
    const s = this.stateOf(id);
    s.consecutiveFailures = 0;
    s.lastLatencyMs = Math.max(0, Math.round(latencyMs));
    s.lastSuccessAt = this.now();
    s.circuitOpenUntil = null;
    s.health = 'HEALTHY';
  }

  recordFailure(id: string): void {
    const s = this.stateOf(id);
    s.consecutiveFailures += 1;
    s.lastFailureAt = this.now();
    if (s.consecutiveFailures >= this.policy.failureThreshold) {
      s.health = 'OFFLINE';
      s.circuitOpenUntil = this.now() + this.policy.cooldownMs;
    } else {
      // Including the first failure from UNKNOWN — anything failing is at
      // least DEGRADED; a never-called provider stays UNKNOWN.
      s.health = 'DEGRADED';
    }
  }

  /**
   * Whether the orchestrator may call this provider right now. An open
   * circuit half-opens after cooldownMs (one probe allowed — the probe
   * itself decides success/failure and updates the counters).
   */
  allow(id: string): boolean {
    const s = this.states.get(id);
    if (!s) return true;
    if (s.circuitOpenUntil === null) return true;
    if (this.now() >= s.circuitOpenUntil) {
      // Half-open: permit a probe; keep health OFFLINE until it resolves.
      return true;
    }
    return false;
  }

  getStatus(id: string): ProviderHealthState {
    return { ...this.stateOf(id) };
  }

  /** Reset one provider (manual re-enable from settings). */
  reset(id: string): void {
    this.states.delete(id);
  }

  resetAll(): void {
    this.states.clear();
  }
}
