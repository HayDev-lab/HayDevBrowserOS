/**
 * Execution ownership — minimal arbitration layer (PROMPT 8).
 *
 * A single state variable answers ONE question at a time:
 * "who is currently allowed to drive the browser?"
 *
 *   ExecutionOwner =
 *     NONE            — idle. MCP may acquire.
 *     INTERNAL_AGENT  — the internal Ollama agent run is active.
 *     MCP             — an MCP-initiated operation is in flight.
 *
 * V1 policy (enforced here):
 *
 *   NONE            → MCP action allowed
 *   MCP             → conflicting MCP execution rejected
 *   INTERNAL_AGENT  → MCP direct browser action rejected
 *   browser.take_control → internal agent aborted → owner released → HUMAN
 *   operation failure    → owner always released (callers use try/finally)
 *
 * This is deliberately NOT a scheduler, queue or distributed lock: a single
 * synchronous owner field, transitioned only through the methods below.
 *
 * Pure logic — no Electron, no MCP SDK. Fully unit-testable.
 */
import type { ExecutionOwner, OwnershipDecision } from '@shared/mcp-types';
import type { AgentStateName } from '@shared/agent-types';

export interface McpOwnershipState {
  owner: ExecutionOwner;
}

export const DEFAULT_MCP_OWNERSHIP: McpOwnershipState = { owner: 'NONE' };

// ---------------------------------------------------------------------------
// Pure decision helpers
// ---------------------------------------------------------------------------

/**
 * May an MCP browser operation begin in this state?
 *   NONE → allowed.  MCP → rejected (conflict).  INTERNAL_AGENT → rejected.
 */
export function checkMcpBrowserAction(state: McpOwnershipState): OwnershipDecision {
  switch (state.owner) {
    case 'NONE':
      return { allowed: true };
    case 'MCP':
      return { allowed: false, reason: 'mcp_execution_in_progress' };
    case 'INTERNAL_AGENT':
      return { allowed: false, reason: 'internal_agent_active' };
  }
}

/** True while an internal agent run is starting/running/winding down. */
export function isAgentStateActive(state: AgentStateName): boolean {
  return state === 'RUNNING' || state === 'STOPPING';
}

// ---------------------------------------------------------------------------
// Guard — the minimal arbitration object
// ---------------------------------------------------------------------------

/**
 * Single-owner arbitration guard. All methods are synchronous; async
 * operations MUST bracket their await points with begin/endOperation in
 * try/finally so the owner is always released, even on failure.
 */
export class McpOwnershipGuard {
  private state: McpOwnershipState = { ...DEFAULT_MCP_OWNERSHIP };

  getOwner(): ExecutionOwner {
    return this.state.owner;
  }

  /**
   * Acquire ownership for a direct MCP browser operation (NONE → MCP).
   * Rejected if another MCP operation is in flight or the internal agent
   * is active.
   */
  beginMcpBrowserOperation(): OwnershipDecision {
    const decision = checkMcpBrowserAction(this.state);
    if (decision.allowed) {
      this.state = { owner: 'MCP' };
    }
    return decision;
  }

  /**
   * Acquire ownership for an MCP-initiated agent run (NONE → INTERNAL_AGENT).
   * The run IS the internal agent, so the owner becomes INTERNAL_AGENT for
   * its whole duration — concurrent direct MCP browser actions are rejected.
   */
  beginMcpAgentRun(): OwnershipDecision {
    const decision = checkMcpBrowserAction(this.state);
    if (decision.allowed) {
      this.state = { owner: 'INTERNAL_AGENT' };
    }
    return decision;
  }

  /**
   * TAKE CONTROL is the P0 emergency brake: always allowed from any state.
   * The caller aborts the internal agent via the EXISTING takeover logic;
   * afterwards the owner is released (endOperation) so HUMAN + NONE.
   */
  beginTakeControl(): OwnershipDecision {
    return { allowed: true };
  }

  /**
   * Release the owner. Idempotent — safe to call from try/finally even if
   * take_control already reset the state.
   */
  endOperation(): void {
    this.state = { owner: 'NONE' };
  }

  /**
   * Reflect the internal agent's lifecycle (wired from AgentController
   * state-change callbacks in main/index.ts).
   *
   *   active=true  → NONE → INTERNAL_AGENT. Refused while an MCP operation
   *                  is in flight (the controller itself also rejects
   *                  concurrent runs, so this is defense-in-depth).
   *   active=false → INTERNAL_AGENT → NONE (idempotent otherwise).
   */
  markInternalAgentActive(active: boolean): boolean {
    if (active) {
      if (this.state.owner === 'MCP') return false;
      if (this.state.owner === 'INTERNAL_AGENT') return true;
      this.state = { owner: 'INTERNAL_AGENT' };
      return true;
    }
    if (this.state.owner === 'INTERNAL_AGENT') {
      this.state = { owner: 'NONE' };
    }
    return true;
  }

  /** Test/dispose helper: reset to the default state. */
  reset(): void {
    this.state = { ...DEFAULT_MCP_OWNERSHIP };
  }
}
