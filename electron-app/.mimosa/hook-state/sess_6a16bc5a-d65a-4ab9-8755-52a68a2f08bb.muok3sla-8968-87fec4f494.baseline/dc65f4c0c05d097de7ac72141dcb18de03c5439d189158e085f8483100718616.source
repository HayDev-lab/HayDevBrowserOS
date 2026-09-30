/**
 * Managed-service state machine (spec §17).
 *
 * STOPPED → STARTING → (BOOTSTRAPPING) → READY ⇄ DEGRADED
 *                                ↘ FAILED
 * READY/DEGRADED/FAILED → RESTARTING → STARTING…
 * any      → STOPPING → STOPPED
 *
 * PURE — injectable clock, fully unit-testable. Illegal transitions are
 * reported, never thrown — the supervisor decides what to do with them.
 */

export type ServiceState =
  | 'STOPPED'
  | 'STARTING'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'DEGRADED'
  | 'RESTARTING'
  | 'FAILED'
  | 'STOPPING';

export interface ServiceStateSnapshot {
  state: ServiceState;
  /** Machine-readable reason (e.g. HEALTH_TIMEOUT, EXITED_UNEXPECTEDLY). */
  reason: string | null;
  attempt: number;
  startedAt: number | null;
  readyAt: number | null;
  /** Tor bootstrap progress 0–100 when BOOTSTRAPPING/READY (spec §38). */
  progress: number | null;
}

const TERMINAL: ReadonlySet<ServiceState> = new Set(['STOPPED', 'FAILED']);

export function initialSnapshot(now: number): ServiceStateSnapshot {
  return { state: 'STOPPED', reason: null, attempt: 0, startedAt: null, readyAt: null, progress: null };
}

/**
 * Apply a state transition. Returns the (possibly unchanged) snapshot and a
 * flag telling whether the transition was legal. STARTING and RESTARTING
 * (re)arm startedAt; READY records readyAt; FAILED/STOPPED clear progress.
 */
export function transition(
  snap: ServiceStateSnapshot,
  to: ServiceState,
  opts: { now: number; reason?: string | null; progress?: number | null }
): { snap: ServiceStateSnapshot; legal: boolean } {
  const from = snap.state;
  if (TERMINAL.has(from) && to === from) return { snap, legal: true };

  const legal = isLegalTransition(from, to);
  if (!legal) return { snap, legal: false };

  const next: ServiceStateSnapshot = {
    ...snap,
    state: to,
    reason: opts.reason ?? (to === from ? snap.reason : null),
    progress: opts.progress !== undefined ? opts.progress : to === 'STOPPED' || to === 'FAILED' ? null : snap.progress,
  };
  if (to === 'STARTING' || to === 'RESTARTING') {
    next.startedAt = opts.now;
    next.readyAt = null;
  }
  if (to === 'READY') next.readyAt = opts.now;
  return { snap: next, legal: true };
}

function isLegalTransition(from: ServiceState, to: ServiceState): boolean {
  switch (from) {
    case 'STOPPED': return to === 'STARTING' || to === 'STOPPING';
    case 'STARTING': return ['BOOTSTRAPPING', 'READY', 'DEGRADED', 'FAILED', 'STOPPING', 'RESTARTING'].includes(to);
    case 'BOOTSTRAPPING': return ['READY', 'DEGRADED', 'FAILED', 'STOPPING', 'RESTARTING'].includes(to);
    case 'READY': return ['DEGRADED', 'FAILED', 'STOPPING', 'RESTARTING'].includes(to);
    case 'DEGRADED': return ['READY', 'FAILED', 'STOPPING', 'RESTARTING'].includes(to);
    case 'RESTARTING': return ['STARTING', 'FAILED', 'STOPPING'].includes(to);
    case 'FAILED': return ['STARTING', 'RESTARTING', 'STOPPING', 'STOPPED'].includes(to);
    case 'STOPPING': return to === 'STOPPED';
    default: return false;
  }
}

/** Terminal-but-recoverable: FAILED may be restarted (bounded by policy). */
export function isRunning(state: ServiceState): boolean {
  return state === 'STARTING' || state === 'BOOTSTRAPPING' || state === 'READY' || state === 'DEGRADED' || state === 'RESTARTING';
}

// ---------------------------------------------------------------------------
// Restart policy (spec §71) — bounded, exponential backoff, no loops.
// ---------------------------------------------------------------------------

export interface RestartPolicy {
  maxAttempts: number;
  backoffBaseMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = { maxAttempts: 3, backoffBaseMs: 1_000 };

/** Delay before attempt N (1-based); undefined when the budget is exhausted. */
export function nextRestartDelay(policy: RestartPolicy, attempt: number): number | null {
  if (attempt < 1 || attempt > policy.maxAttempts) return null;
  return policy.backoffBaseMs * Math.pow(2, attempt - 1);
}
