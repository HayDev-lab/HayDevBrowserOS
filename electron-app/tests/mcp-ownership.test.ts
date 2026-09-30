/**
 * Execution ownership — arbitration tests (PROMPT 8).
 *
 * Proves the V1 policy table:
 *   NONE            → MCP action allowed
 *   MCP             → conflicting MCP execution rejected
 *   INTERNAL_AGENT  → MCP direct browser action rejected
 *   take_control    → allowed from any state, owner released
 *   operation end   → owner always released (success or failure)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  McpOwnershipGuard,
  checkMcpBrowserAction,
  isAgentStateActive,
  DEFAULT_MCP_OWNERSHIP,
} from '../src/main/browser/mcp/pure/mcp-ownership';

describe('mcp-ownership / pure decision function', () => {
  it('NONE allows MCP browser actions', () => {
    expect(checkMcpBrowserAction({ owner: 'NONE' })).toEqual({ allowed: true });
  });

  it('MCP rejects conflicting MCP execution', () => {
    const decision = checkMcpBrowserAction({ owner: 'MCP' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('mcp_execution_in_progress');
  });

  it('INTERNAL_AGENT rejects MCP direct browser actions', () => {
    const decision = checkMcpBrowserAction({ owner: 'INTERNAL_AGENT' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('internal_agent_active');
  });
});

describe('mcp-ownership / guard transitions', () => {
  let guard: McpOwnershipGuard;

  beforeEach(() => {
    guard = new McpOwnershipGuard();
  });

  it('starts in NONE', () => {
    expect(guard.getOwner()).toBe('NONE');
    expect(DEFAULT_MCP_OWNERSHIP.owner).toBe('NONE');
  });

  it('NONE → MCP on beginMcpBrowserOperation, released on endOperation', () => {
    expect(guard.beginMcpBrowserOperation()).toEqual({ allowed: true });
    expect(guard.getOwner()).toBe('MCP');
    guard.endOperation();
    expect(guard.getOwner()).toBe('NONE');
  });

  it('MCP → second MCP browser operation rejected', () => {
    guard.beginMcpBrowserOperation();
    const second = guard.beginMcpBrowserOperation();
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('mcp_execution_in_progress');
    expect(guard.getOwner()).toBe('MCP'); // unchanged
  });

  it('MCP → MCP agent run rejected while a browser operation is in flight', () => {
    guard.beginMcpBrowserOperation();
    const decision = guard.beginMcpAgentRun();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('mcp_execution_in_progress');
  });

  it('INTERNAL_AGENT → MCP browser operation rejected', () => {
    expect(guard.markInternalAgentActive(true)).toBe(true);
    expect(guard.getOwner()).toBe('INTERNAL_AGENT');
    const decision = guard.beginMcpBrowserOperation();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('internal_agent_active');
    expect(guard.getOwner()).toBe('INTERNAL_AGENT'); // unchanged
  });

  it('INTERNAL_AGENT → MCP agent run rejected', () => {
    guard.markInternalAgentActive(true);
    const decision = guard.beginMcpAgentRun();
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('internal_agent_active');
  });

  it('NONE → INTERNAL_AGENT on beginMcpAgentRun (the run IS the internal agent)', () => {
    expect(guard.beginMcpAgentRun()).toEqual({ allowed: true });
    expect(guard.getOwner()).toBe('INTERNAL_AGENT');
  });

  it('endOperation is idempotent (double release safe for try/finally)', () => {
    guard.beginMcpBrowserOperation();
    guard.endOperation();
    guard.endOperation();
    expect(guard.getOwner()).toBe('NONE');
  });

  it('markInternalAgentActive(false) releases INTERNAL_AGENT', () => {
    guard.markInternalAgentActive(true);
    expect(guard.markInternalAgentActive(false)).toBe(true);
    expect(guard.getOwner()).toBe('NONE');
  });

  it('markInternalAgentActive(false) is a no-op when idle or MCP-owned', () => {
    expect(guard.markInternalAgentActive(false)).toBe(true);
    expect(guard.getOwner()).toBe('NONE');
    guard.beginMcpBrowserOperation();
    expect(guard.markInternalAgentActive(false)).toBe(true);
    expect(guard.getOwner()).toBe('MCP'); // MCP op still owns execution
  });

  it('markInternalAgentActive(true) is refused while an MCP op is in flight', () => {
    guard.beginMcpBrowserOperation();
    expect(guard.markInternalAgentActive(true)).toBe(false);
    expect(guard.getOwner()).toBe('MCP');
  });

  it('markInternalAgentActive(true) is idempotent while INTERNAL_AGENT', () => {
    guard.markInternalAgentActive(true);
    expect(guard.markInternalAgentActive(true)).toBe(true);
    expect(guard.getOwner()).toBe('INTERNAL_AGENT');
  });

  it('take_control is allowed from every state', () => {
    const setups: Array<(g: McpOwnershipGuard) => void> = [
      () => undefined,
      (g) => void g.beginMcpBrowserOperation(),
      (g) => g.markInternalAgentActive(true),
    ];
    for (const setup of setups) {
      const local = new McpOwnershipGuard();
      setup(local);
      expect(local.beginTakeControl()).toEqual({ allowed: true });
      local.endOperation();
      expect(local.getOwner()).toBe('NONE');
    }
  });

  it('reset() returns to the default state', () => {
    guard.markInternalAgentActive(true);
    guard.reset();
    expect(guard.getOwner()).toBe('NONE');
  });
});

describe('mcp-ownership / agent-state mapping', () => {
  it('RUNNING and STOPPING count as active; everything else idle', () => {
    expect(isAgentStateActive('RUNNING')).toBe(true);
    expect(isAgentStateActive('STOPPING')).toBe(true);
    expect(isAgentStateActive('IDLE')).toBe(false);
    expect(isAgentStateActive('STOPPED')).toBe(false);
    expect(isAgentStateActive('COMPLETED')).toBe(false);
    expect(isAgentStateActive('FAILED')).toBe(false);
  });
});
