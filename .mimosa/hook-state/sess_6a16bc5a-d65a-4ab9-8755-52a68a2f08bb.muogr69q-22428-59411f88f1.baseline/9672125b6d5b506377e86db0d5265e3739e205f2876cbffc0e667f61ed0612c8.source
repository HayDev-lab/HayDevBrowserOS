/**
 * Execution context manager — pure logic.
 *
 * Models a cancellation boundary for action sequences. Each context has:
 *   - A stable id.
 *   - A state: 'idle' | 'running' | 'aborted'.
 *   - An action count.
 *
 * Invariants:
 *   - `start()` creates a new context with state='idle', actionCount=0.
 *     The new context becomes the "current" context.
 *   - `recordAction(id)` is called by the action router before dispatching.
 *     It transitions state from 'idle' → 'running' on the first action.
 *     It refuses to record if state==='aborted' (returns -1).
 *   - `stop(id?, reason?)` transitions to 'aborted' and records the reason.
 *   - `isAborted(id)` returns true for aborted contexts AND for unknown ids.
 *
 * PROMPT 5 will wire this to HUMAN/AGENT state:
 *   - AGENT mode → start a new context
 *   - TAKE CONTROL → stop the current context
 *   - All actions check isAborted before dispatching
 *
 * NO electron import. Fully unit-testable.
 */
import type {
  ExecutionContextSnapshot,
  ExecutionContextStateName,
  ExecutionContextManager,
} from '@shared/browser-actions-types';

interface ContextEntry {
  id: string;
  state: ExecutionContextStateName;
  actionCount: number;
  createdAt: number;
  abortedAt: number | null;
  abortReason: string | null;
}

let _execCounter = 0;
function generateExecutionId(): string {
  _execCounter += 1;
  return `exec_${Date.now().toString(36)}_${_execCounter.toString(36)}`;
}

export class ExecutionContextManagerImpl implements ExecutionContextManager {
  private readonly contexts = new Map<string, ContextEntry>();
  private current: string | null = null;

  constructor(
    private idGenerator: () => string = generateExecutionId,
    private now: () => number = () => Date.now()
  ) {}

  start(): string {
    const id = this.idGenerator();
    const entry: ContextEntry = {
      id,
      state: 'idle',
      actionCount: 0,
      createdAt: this.now(),
      abortedAt: null,
      abortReason: null,
    };
    this.contexts.set(id, entry);
    this.current = id;
    return id;
  }

  currentId(): string | null {
    return this.current;
  }

  getState(id: string): ExecutionContextStateName | null {
    const entry = this.contexts.get(id);
    return entry ? entry.state : null;
  }

  snapshot(id: string): ExecutionContextSnapshot | null {
    const entry = this.contexts.get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      state: entry.state,
      actionCount: entry.actionCount,
      createdAt: entry.createdAt,
      abortedAt: entry.abortedAt,
      abortReason: entry.abortReason,
    };
  }

  recordAction(id: string): number {
    const entry = this.contexts.get(id);
    if (!entry) return -1;
    if (entry.state === 'aborted') return -1;
    if (entry.state === 'idle') entry.state = 'running';
    entry.actionCount += 1;
    return entry.actionCount;
  }

  stop(id?: string, reason: string = 'user_request'): boolean {
    const targetId = id ?? this.current;
    if (!targetId) return false;
    const entry = this.contexts.get(targetId);
    if (!entry) return false;
    if (entry.state === 'aborted') return false;
    entry.state = 'aborted';
    entry.abortedAt = this.now();
    entry.abortReason = reason;
    return true;
  }

  isAborted(id: string): boolean {
    const entry = this.contexts.get(id);
    if (!entry) return true; // Unknown id → treat as aborted (safe default).
    return entry.state === 'aborted';
  }

  /**
   * Returns true if a new action can be dispatched on the given context.
   * False if the context is unknown, aborted, or no context exists.
   */
  canDispatch(id: string | null | undefined): boolean {
    if (!id) return false;
    const entry = this.contexts.get(id);
    if (!entry) return false;
    return entry.state !== 'aborted';
  }

  reset(): void {
    this.contexts.clear();
    this.current = null;
  }

  /** List all context snapshots (for diagnostics). */
  list(): ExecutionContextSnapshot[] {
    return Array.from(this.contexts.values()).map((e) => ({
      id: e.id,
      state: e.state,
      actionCount: e.actionCount,
      createdAt: e.createdAt,
      abortedAt: e.abortedAt,
      abortReason: e.abortReason,
    }));
  }
}

// ---------------------------------------------------------------------------
// Stop result helper — counts how many contexts were aborted in this call.
// ---------------------------------------------------------------------------

export interface StopResult {
  executionId: string;
  aborted: boolean;
  cancelledCount: number;
}

/**
 * Stop a context and return a `StopResult` with the cancelled count.
 * If no execution id is provided, stops the current context.
 *
 * The `cancelledCount` is the number of additional in-flight actions that
 * would have been cancelled. For V1 this is always 0 (we don't track in-flight
 * actions across async boundaries); the field exists so PROMPT 5's agent loop
 * can report it back to the user.
 */
export function stopContext(
  manager: ExecutionContextManager,
  opts: { executionId?: string; reason?: string } = {}
): StopResult {
  const id = opts.executionId ?? manager.currentId() ?? '';
  if (!id) {
    return { executionId: '', aborted: false, cancelledCount: 0 };
  }
  const aborted = manager.stop(id, opts.reason ?? 'user_request');
  return {
    executionId: id,
    aborted,
    // V1: no in-flight tracking; the field is here for PROMPT 5.
    cancelledCount: 0,
  };
}
