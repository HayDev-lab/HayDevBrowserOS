/**
 * MCP argument parser — converts raw, untrusted JSON arguments into typed
 * requests for the EXISTING services.
 *
 * REUSE RULE (PROMPT 8): this module does NOT invent parallel URL/element
 * validation rules. It performs minimal shape/type checks needed to safely
 * CONSTRUCT a typed request, then the caller runs the EXISTING
 * `validateAction()` for every bound (URL protocol whitelist, element id
 * pattern, text length, scroll caps, …).
 *
 * Pure logic — no Electron, no MCP SDK.
 */
import type {
  ActionInput,
  ValidationError,
  ValidationResult,
} from '@shared/browser-actions-types';
import type { AgentRunRequest } from '@shared/agent-types';
import { AGENT_LOOP_BOUNDS } from '@shared/agent-types';

// ---------------------------------------------------------------------------
// Bounds local to the MCP argument surface
// ---------------------------------------------------------------------------
const MAX_COMMAND_LENGTH = 2_000;
const MAX_REASON_LENGTH = 200;

type RawArgs = Record<string, unknown>;
type ScrollDirection = 'up' | 'down' | 'left' | 'right';

function isScrollDirection(value: string): value is ScrollDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

export interface ParsedMcpRequest {
  /** Typed browser action (present for browser/tabs/page tools). */
  action?: ActionInput;
  /** Typed agent request (present for agent.run). */
  agentRequest?: AgentRunRequest;
  /** Present for agent.stop / browser.take_control. */
  reason?: string;
  /** Present for darkweb_* tools. */
  darkwebRequest?: DarkWebRequest;
}

export type DarkWebRequest =
  | { kind: 'status' }
  | { kind: 'providers' }
  | { kind: 'search'; query: string; providers?: string[]; limit?: number; timeoutMs?: number }
  | { kind: 'fetch'; url: string; mode: 'text' | 'metadata' }
  | { kind: 'crawl'; url: string; maxDepth?: number; maxPages?: number }
  | { kind: 'crawl_status'; jobId: string }
  | { kind: 'stop_crawl'; jobId: string }
  | { kind: 'search_local_index'; query: string; limit?: number };

export type McpArgsResult = ValidationResult & { parsed?: ParsedMcpRequest };

function err(field: string, message: string): ValidationError {
  return { field, message };
}

function fail(errors: ValidationError[]): McpArgsResult {
  return { valid: false, errors };
}

function ok(parsed: ParsedMcpRequest): McpArgsResult {
  return { valid: true, errors: [], parsed };
}

function isObj(args: unknown): args is RawArgs {
  return typeof args === 'object' && args !== null && !Array.isArray(args);
}

function optStr(args: RawArgs, field: string, errors: ValidationError[]): string | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') {
    errors.push(err(field, `${field} must be a string when provided`));
    return undefined;
  }
  return v;
}

function reqStr(args: RawArgs, field: string, errors: ValidationError[]): string | undefined {
  const v = args[field];
  if (typeof v !== 'string' || v.length === 0) {
    errors.push(err(field, `${field} must be a non-empty string`));
    return undefined;
  }
  return v;
}

function optBool(args: RawArgs, field: string, errors: ValidationError[]): boolean | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') {
    errors.push(err(field, `${field} must be a boolean when provided`));
    return undefined;
  }
  return v;
}

function optNum(args: RawArgs, field: string, errors: ValidationError[]): number | undefined {
  const v = args[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(err(field, `${field} must be a finite number when provided`));
    return undefined;
  }
  return v;
}

function parseReason(args: RawArgs, errors: ValidationError[]): string | undefined {
  const reason = optStr(args, 'reason', errors);
  if (reason !== undefined && reason.length > MAX_REASON_LENGTH) {
    errors.push(err('reason', `reason length exceeds ${MAX_REASON_LENGTH} characters`));
    return undefined;
  }
  return reason;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse raw MCP tool arguments for a KNOWN tool (unknown tools are rejected
 * earlier, at the registry lookup). Shape-level validation only — bounds and
 * URL/element rules are enforced by the EXISTING validateAction downstream.
 */
export function parseMcpArgs(toolName: string, rawArgs: unknown): McpArgsResult {
  if (rawArgs === undefined || rawArgs === null) {
    rawArgs = {};
  }
  if (!isObj(rawArgs)) {
    return fail([err('args', 'arguments must be a JSON object')]);
  }
  const args = rawArgs;
  const errors: ValidationError[] = [];

  switch (toolName) {
    case 'browser.status':
      return ok({});

    case 'tabs.list':
      return ok({ action: { kind: 'listTabs' } });

    case 'browser.navigate': {
      const tabId = reqStr(args, 'tabId', errors);
      const url = reqStr(args, 'url', errors);
      if (errors.length) return fail(errors);
      return ok({ action: { kind: 'navigate', tabId: tabId!, url: url! } });
    }

    case 'browser.read': {
      const tabId = reqStr(args, 'tabId', errors);
      const maxTextLength = optNum(args, 'maxTextLength', errors);
      const maxElements = optNum(args, 'maxElements', errors);
      if (errors.length) return fail(errors);
      return ok({
        action: {
          kind: 'readPage',
          tabId: tabId!,
          maxTextLength,
          maxElements,
        },
      });
    }

    case 'tabs.open': {
      const url = optStr(args, 'url', errors);
      const activate = optBool(args, 'activate', errors);
      if (errors.length) return fail(errors);
      return ok({
        action: { kind: 'openTab', url: url && url.length > 0 ? url : undefined, activate },
      });
    }

    case 'tabs.activate':
    case 'tabs.close': {
      const tabId = reqStr(args, 'tabId', errors);
      if (errors.length) return fail(errors);
      return ok({
        action:
          toolName === 'tabs.activate'
            ? { kind: 'activateTab', tabId: tabId! }
            : { kind: 'closeTab', tabId: tabId! },
      });
    }

    case 'page.click': {
      const tabId = reqStr(args, 'tabId', errors);
      const elementId = reqStr(args, 'elementId', errors);
      if (errors.length) return fail(errors);
      return ok({ action: { kind: 'click', tabId: tabId!, elementId: elementId! } });
    }

    case 'page.type': {
      const tabId = reqStr(args, 'tabId', errors);
      const elementId = reqStr(args, 'elementId', errors);
      const text = reqStr(args, 'text', errors);
      const clearFirst = optBool(args, 'clearFirst', errors);
      if (errors.length) return fail(errors);
      return ok({
        action: { kind: 'type', tabId: tabId!, elementId: elementId!, text: text!, clearFirst },
      });
    }

    case 'page.scroll': {
      const tabId = reqStr(args, 'tabId', errors);
      const direction = reqStr(args, 'direction', errors);
      const amount = optNum(args, 'amount', errors);
      if (errors.length) return fail(errors);
      if (direction === undefined || !isScrollDirection(direction)) {
        return fail([
          err('direction', 'direction must be one of up, down, left, right'),
        ]);
      }
      return ok({
        action: { kind: 'scroll', tabId: tabId!, direction, amount },
      });
    }

    case 'agent.run': {
      const command = reqStr(args, 'command', errors);
      const maxSteps = optNum(args, 'maxSteps', errors);
      if (errors.length) return fail(errors);
      if (command !== undefined && command.length > MAX_COMMAND_LENGTH) {
        return fail([err('command', `command length exceeds ${MAX_COMMAND_LENGTH} characters`)]);
      }
      if (maxSteps !== undefined && (maxSteps < 1 || maxSteps > AGENT_LOOP_BOUNDS.HARD_MAX_STEPS)) {
        return fail([
          err('maxSteps', `maxSteps must be between 1 and ${AGENT_LOOP_BOUNDS.HARD_MAX_STEPS}`),
        ]);
      }
      return ok({ agentRequest: { command: command!, maxSteps } });
    }

    case 'agent.stop': {
      const reason = parseReason(args, errors);
      if (errors.length) return fail(errors);
      return ok({ reason });
    }

    case 'browser.take_control': {
      const reason = parseReason(args, errors);
      if (errors.length) return fail(errors);
      return ok({ reason });
    }

    // -------------------------------------------------------------------------
    // Dark-web tools — shape-level parsing only; onion URL validation and
    // all limits are enforced downstream by DarkWebService (fail-closed).
    // -------------------------------------------------------------------------
    case 'darkweb_status':
      return ok({ darkwebRequest: { kind: 'status' } });

    case 'darkweb_providers':
      return ok({ darkwebRequest: { kind: 'providers' } });

    case 'darkweb_search': {
      const query = reqStr(args, 'query', errors);
      const limit = optNum(args, 'limit', errors);
      const timeoutMs = optNum(args, 'timeoutMs', errors);
      const providersRaw = args.providers;
      let providers: string[] | undefined;
      if (providersRaw !== undefined) {
        if (typeof providersRaw !== 'string') {
          errors.push(err('providers', 'providers must be a comma-separated string'));
        } else {
          providers = providersRaw
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
        }
      }
      if (errors.length) return fail(errors);
      if (query !== undefined && query.length > 512) {
        return fail([err('query', 'query length exceeds 512 characters')]);
      }
      return ok({ darkwebRequest: { kind: 'search', query: query!, providers, limit, timeoutMs } });
    }

    case 'darkweb_fetch': {
      const url = reqStr(args, 'url', errors);
      const mode = optStr(args, 'mode', errors);
      if (errors.length) return fail(errors);
      if (mode !== undefined && mode !== 'text' && mode !== 'metadata') {
        return fail([err('mode', 'mode must be "text" or "metadata"')]);
      }
      if (url !== undefined && url.length > 2048) {
        return fail([err('url', 'url length exceeds 2048 characters')]);
      }
      return ok({ darkwebRequest: { kind: 'fetch', url: url!, mode: mode === 'metadata' ? 'metadata' : 'text' } });
    }

    case 'darkweb_crawl': {
      const url = reqStr(args, 'url', errors);
      const maxDepth = optNum(args, 'maxDepth', errors);
      const maxPages = optNum(args, 'maxPages', errors);
      if (errors.length) return fail(errors);
      return ok({ darkwebRequest: { kind: 'crawl', url: url!, maxDepth, maxPages } });
    }

    case 'darkweb_crawl_status':
    case 'darkweb_stop_crawl': {
      const jobId = reqStr(args, 'jobId', errors);
      if (errors.length) return fail(errors);
      return ok({
        darkwebRequest:
          toolName === 'darkweb_crawl_status'
            ? { kind: 'crawl_status', jobId: jobId! }
            : { kind: 'stop_crawl', jobId: jobId! },
      });
    }

    case 'darkweb_search_local_index': {
      const query = reqStr(args, 'query', errors);
      const limit = optNum(args, 'limit', errors);
      if (errors.length) return fail(errors);
      return ok({ darkwebRequest: { kind: 'search_local_index', query: query!, limit } });
    }

    case 'runtime_status':
      return ok({});

    default:
      // Unknown tool — the registry lookup should have caught this already.
      return fail([err('tool', `unknown tool: ${toolName}`)]);
  }
}
