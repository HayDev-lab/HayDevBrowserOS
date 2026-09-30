/**
 * MCP (Model Context Protocol) — typed contracts for the LOCAL MCP Server.
 *
 * PROMPT 8: the MCP server is a thin external adapter over the EXISTING
 * execution layers:
 *
 *     Local MCP Client (trusted, same machine)
 *              ↓  HTTP 127.0.0.1 (Streamable HTTP, stateless)
 *         MCP Server (this layer)
 *              ↓
 *     BrowserActionService  ← single browser execution layer
 *     AgentController       ← single agent runtime
 *     TAKE CONTROL          ← existing takeover logic
 *
 * There is NO second automation layer and NO second agent loop here.
 *
 * SECURITY:
 *   - Every MCP tool result MUST be JSON-serializable safe data
 *     (McpToolPayload): no Electron objects, no WebContents, no Buffers,
 *     no stack traces, no filesystem paths, no environment, no secrets.
 *   - The MCP layer never sees Vault plaintext (no vault tools exposed).
 *
 * Pure data — no Electron, no MCP SDK imports.
 */

import type { ActionInput, ActionResult } from './browser-actions-types';
import type { AgentRunRequest, AgentRunResult, AgentStatusSnapshot } from './agent-types';

// ---------------------------------------------------------------------------
// Execution ownership — arbitration between the internal agent and MCP
// ---------------------------------------------------------------------------

/**
 * Who currently owns browser execution.
 *
 *   NONE            — idle; MCP may acquire ownership.
 *   INTERNAL_AGENT  — the internal Ollama agent run is active; direct MCP
 *                     browser actions are rejected.
 *   MCP             — an MCP-initiated browser operation is in flight;
 *                     conflicting MCP execution is rejected.
 */
export type ExecutionOwner = 'NONE' | 'INTERNAL_AGENT' | 'MCP';

export interface OwnershipDecision {
  allowed: boolean;
  /** Machine-readable rejection reason (errorCode contract). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// MCP ports — minimal structural interfaces over the EXISTING services
// ---------------------------------------------------------------------------

/**
 * Browser port — satisfied by BrowserActionService (single execution layer).
 * The MCP handler NEVER touches BrowserCore / WebContents / executeJavaScript.
 * Browser actions run inside an execution context, exactly like the internal
 * agent's runs (the action router rejects context-less dispatches).
 */
export interface McpBrowserPort {
  dispatch(input: ActionInput): Promise<ActionResult<unknown>>;
  startExecutionContext(): string;
  stopExecutionContext(opts: { reason?: string }): {
    executionId: string;
    aborted: boolean;
    cancelledCount: number;
  };
}

/**
 * Agent port — satisfied by AgentController (single agent runtime).
 * `takeControl` is the EXISTING TAKE CONTROL logic.
 */
export interface McpAgentPort {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  stop(reason?: string): { accepted: boolean };
  takeControl(reason?: string): { accepted: boolean };
  getStatus(): AgentStatusSnapshot;
}

// ---------------------------------------------------------------------------
// Dark-web port — satisfied by DarkWebService (single dark-web surface).
// All methods return safe, serializable data (see darkweb-types.ts); page
// content is wrapped in the UNTRUSTED envelope by the service.
// ---------------------------------------------------------------------------

export interface McpDarkWebSearchRequest {
  query: string;
  providers?: string[];
  limit?: number;
  timeoutMs?: number;
}

export interface McpDarkWebPort {
  status(): Promise<unknown>;
  providers(): unknown[];
  search(request: McpDarkWebSearchRequest): Promise<unknown>;
  fetch(url: string, mode: 'text' | 'metadata'): Promise<unknown>;
  crawl(request: { url: string; maxDepth?: number; maxPages?: number }): { jobId: string };
  crawlStatus(jobId: string): unknown;
  stopCrawl(jobId: string): boolean;
  searchLocalIndex(query: string, limit?: number): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Result contract — safe, serializable
// ---------------------------------------------------------------------------

/**
 * The ONLY shape an MCP tool may return. All fields are plain JSON values.
 *
 *   success     — did the underlying operation succeed.
 *   status      — coarse status word ('ok' | 'rejected' | 'error' | 'busy').
 *   data        — serializable payload (present on success when applicable).
 *   errorCode   — machine-readable failure code (present on failure).
 *   safeMessage — short human-readable message, secrets-free, length-bounded.
 */
export interface McpToolPayload {
  success: boolean;
  status: 'ok' | 'rejected' | 'error' | 'busy';
  data?: unknown;
  errorCode?: string;
  safeMessage?: string;
}

/** MCP server lifecycle status snapshot (safe to expose). */
export interface McpServerStatus {
  running: boolean;
  host: string;
  port: number | null;
  toolCount: number;
  executionOwner: ExecutionOwner;
}
