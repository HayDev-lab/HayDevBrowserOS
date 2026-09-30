/**
 * MCP tool handler — the request flow orchestrator (PROMPT 8).
 *
 * Every MCP tool call walks the SAME pipeline:
 *
 *   REQUEST
 *     → SCHEMA VALIDATION          (registry lookup + parseMcpArgs + the
 *                                    EXISTING validateAction — no parallel rules)
 *     → EXECUTION OWNERSHIP CHECK  (McpOwnershipGuard)
 *     → AUTHORIZATION              (authorizeMcpTool — pure policy)
 *     → EXISTING SERVICE           (McpBrowserPort / McpAgentPort — the
 *                                    BrowserActionService + AgentController)
 *     → SAFE RESULT                (McpToolPayload — serializable, secret-free)
 *
 * The handler NEVER touches BrowserCore, WebContents, NavigationController,
 * TabManager or executeJavaScript — those are reachable only through
 * BrowserActionService, which stays the single browser execution layer.
 *
 * No Electron import — fully testable without a GUI.
 */
import type {
  McpBrowserPort,
  McpAgentPort,
  McpDarkWebPort,
  McpToolPayload,
  OwnershipDecision,
} from '@shared/mcp-types';
import { validateAction } from '../../actions/pure/action-validator';
import { isKnownMcpTool } from '../pure/mcp-tool-registry';
import { parseMcpArgs, type ParsedMcpRequest } from '../pure/mcp-args';
import {
  McpOwnershipGuard,
  checkMcpBrowserAction,
} from '../pure/mcp-ownership';
import {
  fromActionResult,
  fromAgentResult,
  fromThrown,
  rejected,
  busy,
} from '../pure/mcp-result';

export interface McpToolHandlerDeps {
  browser: McpBrowserPort;
  agent: McpAgentPort;
  ownership: McpOwnershipGuard;
  /** Optional dark-web subsystem (darkweb_* tools are rejected when absent). */
  darkweb?: McpDarkWebPort;
  /** Optional unified-runtime diagnostics (runtime_status tool). */
  runtimeStatus?: () => unknown;
  /** Override Date.now for tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// AUTHORIZATION (pure policy)
// ---------------------------------------------------------------------------

/**
 * Post-ownership authorization. V1 policy:
 *   - browser/tabs/page tools → allowed (ownership check already ran; the
 *     MCP client is a trusted local operator, like the user at the keyboard).
 *   - agent.run / agent.stop   → allowed (the AgentController enforces its
 *     own HUMAN/AGENT rules — no silent control-mode switching from MCP).
 *   - browser.take_control     → always allowed (P0 emergency brake).
 */
export function authorizeMcpTool(toolName: string): OwnershipDecision {
  switch (toolName) {
    case 'browser.status':
    case 'agent.stop':
    case 'browser.take_control':
      return { allowed: true };
    default:
      // Ownership check is the authority for browser mutation tools; it has
      // already been applied by the caller before dispatch.
      return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class McpToolHandler {
  constructor(private deps: McpToolHandlerDeps) {}

  /**
   * Handle one MCP tool call. Always resolves to a safe McpToolPayload —
   * internal throws are caught and mapped (never leak stack traces).
   */
  async handle(toolName: string, rawArgs: unknown): Promise<McpToolPayload> {
    // 1. Registry lookup — unknown tools are rejected outright.
    if (!isKnownMcpTool(toolName)) {
      return rejected('unknown_tool', `unknown MCP tool: ${toolName}`);
    }

    // 2. Argument parsing (shape) — then, for browser tools, the EXISTING
    //    validateAction (URL whitelist, element ids, bounds).
    const parsed = parseMcpArgs(toolName, rawArgs);
    if (!parsed.valid || !parsed.parsed) {
      const first = parsed.errors[0];
      return rejected(
        'invalid_arguments',
        first ? `${first.field}: ${first.message}` : 'invalid arguments'
      );
    }
    if (parsed.parsed.action) {
      const validation = validateAction(parsed.parsed.action);
      if (!validation.valid) {
        const first = validation.errors[0];
        return rejected(
          'invalid_arguments',
          first ? `${first.field}: ${first.message}` : 'invalid arguments'
        );
      }
    }

    // 3–6. Ownership → authorization → existing service → safe result.
    try {
      switch (toolName) {
        case 'browser.status':
          return this.handleStatus();

        case 'browser.navigate':
        case 'browser.read':
        case 'tabs.list':
        case 'tabs.open':
        case 'tabs.activate':
        case 'tabs.close':
        case 'page.click':
        case 'page.type':
        case 'page.scroll':
          return await this.handleBrowserAction(parsed.parsed.action!);

        case 'agent.run':
          return await this.handleAgentRun(parsed.parsed.agentRequest!);

        case 'agent.stop': {
          const outcome = this.deps.agent.stop(parsed.parsed.reason ?? 'mcp_request');
          return {
            success: outcome.accepted,
            status: outcome.accepted ? 'ok' : 'rejected',
            errorCode: outcome.accepted ? undefined : 'no_active_run',
            safeMessage: outcome.accepted
              ? 'agent stop requested'
              : 'no active agent run',
          };
        }

        case 'browser.take_control':
          return this.handleTakeControl(parsed.parsed.reason);

        case 'darkweb_status':
        case 'darkweb_providers':
        case 'darkweb_search':
        case 'darkweb_fetch':
        case 'darkweb_crawl':
        case 'darkweb_crawl_status':
        case 'darkweb_stop_crawl':
        case 'darkweb_search_local_index':
          return await this.handleDarkWeb(parsed.parsed.darkwebRequest!);

        case 'runtime_status':
          if (!this.deps.runtimeStatus) {
            return rejected('runtime_unavailable', 'unified runtime manager is not attached');
          }
          return { success: true, status: 'ok', data: this.deps.runtimeStatus() };

        default:
          // Unreachable: registry membership checked above.
          return rejected('unknown_tool', `unknown MCP tool: ${toolName}`);
      }
    } catch (err) {
      return fromThrown(err);
    }
  }

  // -------------------------------------------------------------------------
  // browser.status — read-only aggregation of EXISTING status methods.
  // No browser action is dispatched; available in any ownership state.
  // -------------------------------------------------------------------------
  private handleStatus(): McpToolPayload {
    const status = this.deps.agent.getStatus();
    return {
      success: true,
      status: 'ok',
      data: {
        controlMode: status.controlMode,
        agentState: status.state,
        stepCount: status.stepCount,
        providerConfigured: status.providerConfigured,
        executionOwner: this.deps.ownership.getOwner(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Direct browser tools → EXACTLY ONE BrowserActionService dispatch.
  // Ownership AND an execution context bracket the await via try/finally
  // (both always released) — mirroring how the internal agent's runs use
  // the service (the action router rejects context-less dispatches).
  // -------------------------------------------------------------------------
  private async handleBrowserAction(action: Parameters<McpBrowserPort['dispatch']>[0]): Promise<McpToolPayload> {
    const decision = this.deps.ownership.beginMcpBrowserOperation();
    if (!decision.allowed) {
      if (decision.reason === 'mcp_execution_in_progress') {
        return busy(decision.reason, 'another MCP operation is already in progress');
      }
      return rejected(
        decision.reason ?? 'ownership_rejected',
        'the internal agent is active — direct MCP browser actions are rejected; use browser.take_control to abort it'
      );
    }
    this.deps.browser.startExecutionContext();
    try {
      const result = await this.deps.browser.dispatch(action);
      return fromActionResult(result);
    } finally {
      // Operation failure or success — context and owner are ALWAYS released.
      this.deps.browser.stopExecutionContext({ reason: 'mcp_operation_completed' });
      this.deps.ownership.endOperation();
    }
  }

  // -------------------------------------------------------------------------
  // agent.run → the EXISTING AgentController (no second agent loop).
  // Ownership becomes INTERNAL_AGENT for the whole run.
  // -------------------------------------------------------------------------
  private async handleAgentRun(request: { command: string; maxSteps?: number }): Promise<McpToolPayload> {
    const decision = this.deps.ownership.beginMcpAgentRun();
    if (!decision.allowed) {
      if (decision.reason === 'mcp_execution_in_progress') {
        return busy(decision.reason, 'another MCP operation is already in progress');
      }
      return rejected(
        decision.reason ?? 'ownership_rejected',
        'the internal agent is already active'
      );
    }
    try {
      const result = await this.deps.agent.run(request);
      return fromAgentResult(result);
    } finally {
      // Run completed, failed or threw — the owner is ALWAYS released.
      this.deps.ownership.endOperation();
    }
  }

  // -------------------------------------------------------------------------
  // browser.take_control → the EXISTING takeover logic in AgentController:
  //   abort signal + stopExecutionContext + mode → HUMAN + latch.
  // Browser state (tabs, active page, sessions) is PRESERVED by design.
  // -------------------------------------------------------------------------
  private handleTakeControl(reason?: string): McpToolPayload {
    const decision = this.deps.ownership.beginTakeControl();
    if (!decision.allowed) {
      // Unreachable — take control is unconditional. Kept for symmetry.
      return rejected('takeover_refused', 'take control was refused');
    }
    try {
      const outcome = this.deps.agent.takeControl(reason ?? 'mcp_take_control');
      const controlMode = this.deps.agent.getStatus().controlMode;
      return {
        success: outcome.accepted,
        status: 'ok',
        data: {
          accepted: outcome.accepted,
          controlMode,
          // Postcondition of this handler: the finally block below always
          // releases the owner, so the reported owner is NONE.
          executionOwner: 'NONE' as const,
        },
        safeMessage:
          'TAKE CONTROL applied — agent aborted, control mode is HUMAN, browser state preserved',
      };
    } finally {
      // Internal agent aborted → owner released → HUMAN.
      this.deps.ownership.endOperation();
    }
  }

  // -------------------------------------------------------------------------
  // Dark-web tools → the EXISTING DarkWebService (single dark-web surface).
  // These tools never touch browser tabs/execution ownership — they operate
  // the isolated Tor gateway directly. Fetch results arrive wrapped in the
  // UNTRUSTED_EXTERNAL_CONTENT envelope from the service.
  // -------------------------------------------------------------------------
  private async handleDarkWeb(
    request: NonNullable<ParsedMcpRequest['darkwebRequest']>
  ): Promise<McpToolPayload> {
    const darkweb = this.deps.darkweb;
    if (!darkweb) {
      return rejected('darkweb_unavailable', 'dark-web subsystem is not enabled in this build');
    }
    switch (request.kind) {
      case 'status':
        return { success: true, status: 'ok', data: await darkweb.status() };
      case 'providers':
        return { success: true, status: 'ok', data: darkweb.providers() };
      case 'search': {
        try {
          const result = await darkweb.search({
            query: request.query,
            providers: request.providers,
            limit: request.limit,
            timeoutMs: request.timeoutMs,
          });
          return { success: true, status: 'ok', data: result };
        } catch (err) {
          return fromThrown(err);
        }
      }
      case 'fetch': {
        try {
          const result = await darkweb.fetch(request.url, request.mode);
          return { success: true, status: 'ok', data: result };
        } catch (err) {
          return fromThrown(err);
        }
      }
      case 'crawl':
        try {
          return { success: true, status: 'ok', data: darkweb.crawl(request) };
        } catch (err) {
          return fromThrown(err);
        }
      case 'crawl_status': {
        const status = darkweb.crawlStatus(request.jobId);
        if (status === null) return rejected('crawl_job_not_found', 'no such crawl job');
        return { success: true, status: 'ok', data: status };
      }
      case 'stop_crawl': {
        const stopped = darkweb.stopCrawl(request.jobId);
        return {
          success: stopped,
          status: 'ok',
          data: { jobId: request.jobId, stopped },
        };
      }
      case 'search_local_index': {
        try {
          const result = await darkweb.searchLocalIndex(request.query, request.limit ?? 20);
          return { success: true, status: 'ok', data: result };
        } catch (err) {
          return fromThrown(err);
        }
      }
    }
  }
}
