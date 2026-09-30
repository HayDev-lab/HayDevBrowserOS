import { describe, it, expect } from 'vitest';
import {
  ExecutionContextManagerImpl,
  stopContext,
} from '../src/main/browser/actions/pure/execution-context';
import { makeIdGen, makeClock } from './_helpers';

// ===========================================================================
// Lifecycle
// ===========================================================================
describe('execution-context / start', () => {
  it('creates a context with state=idle', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(id).toBe('exec_1');
    expect(mgr.getState(id)).toBe('idle');
    expect(mgr.currentId()).toBe(id);
  });

  it('each call produces a unique id', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id1 = mgr.start();
    const id2 = mgr.start();
    expect(id1).not.toBe(id2);
    expect(mgr.currentId()).toBe(id2);
  });

  it('records createdAt', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(5000));
    const id = mgr.start();
    const snap = mgr.snapshot(id);
    expect(snap!.createdAt).toBe(6000); // clock ticks +1000 first
  });
});

// ===========================================================================
// recordAction
// ===========================================================================
describe('execution-context / recordAction', () => {
  it('transitions idle → running on first action', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.getState(id)).toBe('idle');
    mgr.recordAction(id);
    expect(mgr.getState(id)).toBe('running');
  });

  it('increments action count', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.recordAction(id)).toBe(1);
    expect(mgr.recordAction(id)).toBe(2);
    expect(mgr.recordAction(id)).toBe(3);
  });

  it('returns -1 for unknown context id', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    expect(mgr.recordAction('does-not-exist')).toBe(-1);
  });

  it('returns -1 for aborted context', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    mgr.stop(id, 'user_request');
    expect(mgr.recordAction(id)).toBe(-1);
  });
});

// ===========================================================================
// stop / abort
// ===========================================================================
describe('execution-context / stop', () => {
  it('transitions to aborted state', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.stop(id, 'user_request')).toBe(true);
    expect(mgr.getState(id)).toBe('aborted');
    expect(mgr.isAborted(id)).toBe(true);
  });

  it('records abort reason and timestamp', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    mgr.stop(id, 'take_control');
    const snap = mgr.snapshot(id);
    expect(snap!.abortReason).toBe('take_control');
    expect(snap!.abortedAt).toBeGreaterThan(0);
  });

  it('defaults to the current context when no id is provided', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.stop()).toBe(true);
    expect(mgr.isAborted(id)).toBe(true);
  });

  it('returns false when stopping an already-aborted context', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.stop(id, 'reason1')).toBe(true);
    expect(mgr.stop(id, 'reason2')).toBe(false);
  });

  it('returns false when no context exists', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    expect(mgr.stop()).toBe(false);
    expect(mgr.stop('does-not-exist')).toBe(false);
  });

  it('records first abort reason only (subsequent stop ignored)', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    mgr.stop(id, 'first');
    mgr.stop(id, 'second');
    const snap = mgr.snapshot(id);
    expect(snap!.abortReason).toBe('first');
  });
});

// ===========================================================================
// isAborted / canDispatch
// ===========================================================================
describe('execution-context / isAborted', () => {
  it('returns true for unknown context id', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    expect(mgr.isAborted('does-not-exist')).toBe(true);
  });

  it('returns false for a freshly-started context', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.isAborted(id)).toBe(false);
  });

  it('returns true after stop', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    mgr.stop(id);
    expect(mgr.isAborted(id)).toBe(true);
  });
});

describe('execution-context / canDispatch', () => {
  it('returns false for null/undefined', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    expect(mgr.canDispatch(null)).toBe(false);
    expect(mgr.canDispatch(undefined)).toBe(false);
  });

  it('returns false for unknown id', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    expect(mgr.canDispatch('unknown')).toBe(false);
  });

  it('returns true for idle and running contexts', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    expect(mgr.canDispatch(id)).toBe(true);
    mgr.recordAction(id);
    expect(mgr.canDispatch(id)).toBe(true);
  });

  it('returns false for aborted contexts', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    mgr.stop(id);
    expect(mgr.canDispatch(id)).toBe(false);
  });
});

// ===========================================================================
// Snapshot
// ===========================================================================
describe('execution-context / snapshot', () => {
  it('returns null for unknown id', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    expect(mgr.snapshot('unknown')).toBeNull();
  });

  it('returns the full snapshot', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(5000));
    const id = mgr.start();
    mgr.recordAction(id);
    mgr.recordAction(id);
    const snap = mgr.snapshot(id);
    expect(snap).toEqual({
      id,
      state: 'running',
      actionCount: 2,
      createdAt: 6000,
      abortedAt: null,
      abortReason: null,
    });
  });
});

// ===========================================================================
// reset
// ===========================================================================
describe('execution-context / reset', () => {
  it('clears all contexts and current pointer', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id1 = mgr.start();
    const id2 = mgr.start();
    mgr.reset();
    expect(mgr.currentId()).toBeNull();
    expect(mgr.snapshot(id1)).toBeNull();
    expect(mgr.snapshot(id2)).toBeNull();
  });
});

// ===========================================================================
// list
// ===========================================================================
describe('execution-context / list', () => {
  it('returns all contexts', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id1 = mgr.start();
    const id2 = mgr.start();
    const list = mgr.list();
    expect(list.length).toBe(2);
    expect(list.map((s) => s.id)).toEqual([id1, id2]);
  });
});

// ===========================================================================
// stopContext helper
// ===========================================================================
describe('execution-context / stopContext helper', () => {
  it('returns aborted=true for an active context', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    const result = stopContext(mgr, { reason: 'take_control' });
    expect(result.executionId).toBe(id);
    expect(result.aborted).toBe(true);
    expect(result.cancelledCount).toBe(0);
  });

  it('returns aborted=false when no context exists', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const result = stopContext(mgr);
    expect(result.executionId).toBe('');
    expect(result.aborted).toBe(false);
  });

  it('accepts an explicit executionId', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    const result = stopContext(mgr, { executionId: id });
    expect(result.executionId).toBe(id);
    expect(result.aborted).toBe(true);
  });

  it('returns aborted=false when stopping an already-aborted context', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    stopContext(mgr, { reason: 'first' });
    const result = stopContext(mgr, { reason: 'second' });
    expect(result.aborted).toBe(false);
  });
});

// ===========================================================================
// Multiple contexts — TAKE CONTROL semantics
// ===========================================================================
describe('execution-context / TAKE CONTROL semantics', () => {
  it('stopping one context does not affect a new one', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id1 = mgr.start();
    mgr.recordAction(id1);
    mgr.stop(id1, 'take_control');

    // New context can be started separately.
    const id2 = mgr.start();
    expect(mgr.isAborted(id1)).toBe(true);
    expect(mgr.isAborted(id2)).toBe(false);
    expect(mgr.canDispatch(id1)).toBe(false);
    expect(mgr.canDispatch(id2)).toBe(true);
  });

  it('recordAction on a new context works after the previous one was aborted', () => {
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id1 = mgr.start();
    mgr.stop(id1, 'take_control');
    const id2 = mgr.start();
    expect(mgr.recordAction(id2)).toBe(1);
    expect(mgr.recordAction(id2)).toBe(2);
  });

  it('browser/tab state is NOT destroyed by stop', () => {
    // The execution-context manager has no knowledge of tabs or sessions —
    // stop() only updates the context state. This test documents that
    // contract: stopping does not affect any external state.
    const mgr = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
    const id = mgr.start();
    mgr.recordAction(id);
    mgr.stop(id, 'take_control');
    // No tab state to verify here — the point is that the manager's API
    // surface contains no tab/session-destruction methods.
    expect(typeof mgr.stop).toBe('function');
    expect(typeof mgr.recordAction).toBe('function');
    // Snapshot still exists (context record preserved for diagnostics).
    expect(mgr.snapshot(id)).not.toBeNull();
    expect(mgr.snapshot(id)!.state).toBe('aborted');
  });
});
