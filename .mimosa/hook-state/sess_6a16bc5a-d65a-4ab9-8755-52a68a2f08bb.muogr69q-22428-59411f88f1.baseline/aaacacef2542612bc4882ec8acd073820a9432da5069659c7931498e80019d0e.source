/**
 * MCP result mapper — converts internal results into the SAFE, serializable
 * MCP payload contract (McpToolPayload).
 *
 * SECURITY (PROMPT 8):
 *   - Only JSON-serializable values leave through MCP.
 *   - Errors are mapped to errorCode + bounded safeMessage — never stack
 *     traces, never raw Error objects.
 *   - Data is passed through a JSON round-trip: anything non-serializable
 *     (functions, symbols, Electron objects) is dropped instead of leaking.
 *
 * Pure logic — no Electron, no MCP SDK.
 */
import type { ActionResult } from '@shared/browser-actions-types';
import type { AgentRunResult } from '@shared/agent-types';
import type { McpToolPayload } from '@shared/mcp-types';

const MAX_SAFE_MESSAGE = 300;

function boundedMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_SAFE_MESSAGE);
}

/**
 * JSON-safe copy of `value`. Returns undefined when the value (or any part
 * of it) cannot be represented as JSON — fail-closed rather than leaking.
 */
function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/** Map an ActionResult from the single browser execution layer. */
export function fromActionResult(result: ActionResult<unknown>): McpToolPayload {
  if (result.success) {
    return {
      success: true,
      status: 'ok',
      data: jsonSafe(result.data),
    };
  }
  return {
    success: false,
    status: 'error',
    errorCode: result.error ?? 'action_failed',
    safeMessage: boundedMessage(result.evidence ?? result.error ?? 'action failed'),
  };
}

/** Map an AgentRunResult from the single agent runtime. */
export function fromAgentResult(result: AgentRunResult): McpToolPayload {
  if (result.state === 'COMPLETED') {
    return {
      success: true,
      status: 'ok',
      data: jsonSafe({
        state: result.state,
        answer: result.answer,
        stepCount: result.stepCount,
        reason: result.reason,
      }),
    };
  }
  return {
    success: false,
    status: 'error',
    errorCode: result.reason ?? result.state.toLowerCase(),
    safeMessage: boundedMessage(result.error ?? `agent run ended in state ${result.state}`),
  };
}

/** Build a rejection payload (ownership/authorization/validation denials). */
export function rejected(errorCode: string, safeMessage: string): McpToolPayload {
  return {
    success: false,
    status: 'rejected',
    errorCode,
    safeMessage: boundedMessage(safeMessage),
  };
}

/** Build a busy payload (conflicting execution). */
export function busy(errorCode: string, safeMessage: string): McpToolPayload {
  return {
    success: false,
    status: 'busy',
    errorCode,
    safeMessage: boundedMessage(safeMessage),
  };
}

/** Map an unexpected thrown value — never leak stack traces. */
export function fromThrown(err: unknown): McpToolPayload {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
  return {
    success: false,
    status: 'error',
    errorCode: 'internal_error',
    safeMessage: boundedMessage(message),
  };
}

/** Serialize a payload for the MCP wire (text content block). */
export function serializePayload(payload: McpToolPayload): string {
  return JSON.stringify(payload);
}
