import { describe, it, expect } from 'vitest';
import {
  AgentStateMachine,
  isValidTransition,
  getValidTransitions,
} from '../src/main/browser/agent/pure/agent-state-machine';
import type { AgentStateName } from '@shared/agent-types';
import { makeClock } from './_helpers';

describe('agent-state-machine / start', () => {
  it('starts in IDLE state', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    expect(sm.getState()).toBe('IDLE');
    expect(sm.isTerminal()).toBe(false);
    expect(sm.isActive()).toBe(false);
  });

  it('start() transitions IDLE → RUNNING and returns a run id', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    const runId = sm.start();
    expect(runId).not.toBeNull();
    expect(runId).toMatch(/^agent_run_/);
    expect(sm.getState()).toBe('RUNNING');
    expect(sm.isActive()).toBe(true);
    expect(sm.isTerminal()).toBe(false);
  });

  it('start() refuses if not IDLE', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    const second = sm.start();
    expect(second).toBeNull();
  });

  it('start() refuses from terminal states (must reset first)', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.markCompleted();
    expect(sm.start()).toBeNull();
  });
});

describe('agent-state-machine / recordStep', () => {
  it('increments step count when RUNNING', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    expect(sm.recordStep()).toBe(1);
    expect(sm.recordStep()).toBe(2);
    expect(sm.recordStep()).toBe(3);
  });

  it('refuses (-1) when not RUNNING', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    expect(sm.recordStep()).toBe(-1);
  });

  it('refuses after markCompleted', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.markCompleted();
    expect(sm.recordStep()).toBe(-1);
  });
});

describe('agent-state-machine / stop + markStopped', () => {
  it('stop() transitions RUNNING → STOPPING', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    expect(sm.stop('user_request')).toBe(true);
    expect(sm.getState()).toBe('STOPPING');
    expect(sm.isActive()).toBe(true);
  });

  it('markStopped() transitions STOPPING → STOPPED', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.stop();
    expect(sm.markStopped()).toBe(true);
    expect(sm.getState()).toBe('STOPPED');
    expect(sm.isTerminal()).toBe(true);
    expect(sm.isActive()).toBe(false);
  });

  it('stop() refuses when not RUNNING', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    expect(sm.stop()).toBe(false);
    sm.start();
    sm.markCompleted();
    expect(sm.stop()).toBe(false);
  });

  it('markStopped() refuses when not STOPPING', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    expect(sm.markStopped()).toBe(false);
    sm.start();
    expect(sm.markStopped()).toBe(false);
  });
});

describe('agent-state-machine / markCompleted', () => {
  it('transitions RUNNING → COMPLETED', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    expect(sm.markCompleted('final_answer')).toBe(true);
    expect(sm.getState()).toBe('COMPLETED');
    expect(sm.isTerminal()).toBe(true);
  });

  it('allows STOPPING → COMPLETED (loop finished last step as stop requested)', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.stop();
    expect(sm.markCompleted()).toBe(true);
    expect(sm.getState()).toBe('COMPLETED');
  });

  it('refuses from IDLE or terminal', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    expect(sm.markCompleted()).toBe(false);
    sm.start();
    sm.markCompleted();
    expect(sm.markCompleted()).toBe(false);
  });
});

describe('agent-state-machine / markFailed', () => {
  it('transitions RUNNING → FAILED with error message', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    expect(sm.markFailed('ollama_error', 'provider_error')).toBe(true);
    expect(sm.getState()).toBe('FAILED');
    expect(sm.snapshot().error).toBe('ollama_error');
    expect(sm.snapshot().reason).toBe('provider_error');
  });

  it('transitions STOPPING → FAILED', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.stop();
    expect(sm.markFailed('timeout', 'timeout')).toBe(true);
    expect(sm.getState()).toBe('FAILED');
  });

  it('refuses from IDLE', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    expect(sm.markFailed('err', 'r')).toBe(false);
  });
});

describe('agent-state-machine / reset', () => {
  it('resets terminal states to IDLE', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.markCompleted();
    expect(sm.reset()).toBe(true);
    expect(sm.getState()).toBe('IDLE');
  });

  it('refuses reset from non-terminal states', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    expect(sm.reset()).toBe(false);
  });
});

describe('agent-state-machine / snapshot', () => {
  it('captures the full state', () => {
    const sm = new AgentStateMachine(makeClock(5000));
    sm.start();
    sm.recordStep();
    sm.recordStep();
    const snap = sm.snapshot();
    expect(snap).toEqual({
      state: 'RUNNING',
      reason: null,
      stepCount: 2,
      startedAt: 6000,
      endedAt: null,
      error: null,
    });
  });

  it('captures failure state', () => {
    const sm = new AgentStateMachine(makeClock(1000));
    sm.start();
    sm.markFailed('test_error', 'test_reason');
    const snap = sm.snapshot();
    expect(snap.state).toBe('FAILED');
    expect(snap.error).toBe('test_error');
    expect(snap.reason).toBe('test_reason');
    expect(snap.endedAt).toBeGreaterThan(0);
  });
});

describe('agent-state-machine / transition validation', () => {
  const valid: Array<[AgentStateName, AgentStateName]> = [
    ['IDLE', 'RUNNING'],
    ['RUNNING', 'STOPPING'],
    ['RUNNING', 'COMPLETED'],
    ['RUNNING', 'FAILED'],
    ['STOPPING', 'STOPPED'],
    ['STOPPING', 'COMPLETED'],
    ['STOPPING', 'FAILED'],
    ['STOPPED', 'IDLE'],
    ['COMPLETED', 'IDLE'],
    ['FAILED', 'IDLE'],
  ];

  for (const [from, to] of valid) {
    it(`allows ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  }

  const invalid: Array<[AgentStateName, AgentStateName]> = [
    ['IDLE', 'COMPLETED'],
    ['IDLE', 'STOPPING'],
    ['IDLE', 'STOPPED'],
    ['IDLE', 'FAILED'],
    ['RUNNING', 'IDLE'],
    ['RUNNING', 'RUNNING'],
    ['STOPPING', 'IDLE'],
    ['STOPPING', 'RUNNING'],
    ['STOPPED', 'RUNNING'],
    ['STOPPED', 'COMPLETED'],
    ['COMPLETED', 'RUNNING'],
    ['FAILED', 'RUNNING'],
  ];

  for (const [from, to] of invalid) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  }

  it('getValidTransitions returns the expected list for each state', () => {
    expect(getValidTransitions('IDLE')).toEqual(['RUNNING']);
    expect(getValidTransitions('RUNNING').sort()).toEqual(['COMPLETED', 'FAILED', 'STOPPING']);
    expect(getValidTransitions('STOPPING').sort()).toEqual(['COMPLETED', 'FAILED', 'STOPPED']);
    expect(getValidTransitions('STOPPED')).toEqual(['IDLE']);
    expect(getValidTransitions('COMPLETED')).toEqual(['IDLE']);
    expect(getValidTransitions('FAILED')).toEqual(['IDLE']);
  });
});
