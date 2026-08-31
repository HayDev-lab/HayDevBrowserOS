/**
 * Timeline redactor — pure logic.
 *
 * Redacts sensitive data from timeline entries BEFORE they are persisted or
 * sent to the renderer via IPC.
 *
 * Rules:
 *   - `page.type` tool calls NEVER include the typed text in the timeline.
 *   - If `wasPasswordField` is true, the summary explicitly states
 *     "typed into password field (redacted)".
 *   - If the tool returned a PageSnapshot, only a short summary is kept
 *     (no full page dumps in the timeline).
 *   - All summaries are truncated to MAX_SUMMARY_LENGTH (200 chars).
 *
 * NO electron import. Fully unit-testable.
 */
import type {
  AgentTimelineEntry,
  TimelineEntryState,
  ToolResult,
  ToolName,
} from '@shared/agent-types';
import { AGENT_LOOP_BOUNDS } from '@shared/agent-types';

const REDACTED = '<redacted>';

// ---------------------------------------------------------------------------
// Summary builders — one per tool kind
// ---------------------------------------------------------------------------

/**
 * Build a safe summary string for a tool call + result.
 *
 * The summary is what appears in the timeline. It MUST NOT contain:
 *   - Typed text from page.type (even if not a password field — defense in depth)
 *   - API keys, credentials, file paths
 *   - Full page HTML or visible text
 */
export function buildSafeSummary(
  tool: ToolName,
  args: Record<string, unknown>,
  result: ToolResult | null
): string {
  switch (tool) {
    case 'browser.navigate': {
      const url = String(args.url ?? '');
      return `navigate → ${truncate(url, 100)}`;
    }
    case 'browser.read': {
      if (result?.success && result.data) {
        const snap = result.data as { url?: string; interactiveElements?: unknown[] };
        const elCount = Array.isArray(snap.interactiveElements) ? snap.interactiveElements.length : 0;
        return `read page → ${truncate(snap.url ?? '', 80)} (${elCount} elements)`;
      }
      return 'read page';
    }
    case 'tabs.list': {
      if (result?.success && result.data) {
        const data = result.data as { tabs?: unknown[] };
        const count = Array.isArray(data.tabs) ? data.tabs.length : 0;
        return `list tabs → ${count} tabs`;
      }
      return 'list tabs';
    }
    case 'tabs.open': {
      const url = String(args.url ?? '');
      return url ? `open tab → ${truncate(url, 80)}` : 'open tab';
    }
    case 'tabs.activate': {
      return `activate tab → ${String(args.tabId ?? '')}`;
    }
    case 'tabs.close': {
      return `close tab → ${String(args.tabId ?? '')}`;
    }
    case 'page.click': {
      return `click → ${String(args.elementId ?? '')}`;
    }
    case 'page.type': {
      // NEVER include the typed text in the summary — even if it's not a
      // password field. Defense in depth: the timeline is renderer-visible.
      const target = String(args.elementId ?? '');
      // wasPasswordField may be on the top-level result OR inside result.data
      // (depending on which layer constructed the ToolResult).
      const data = result?.data as { wasPasswordField?: boolean; charactersTyped?: number } | undefined;
      const wasPasswordField = !!result?.wasPasswordField || !!data?.wasPasswordField;
      if (wasPasswordField) {
        return `type into password field → ${target} (${REDACTED})`;
      }
      // Prefer the adapter's reported charactersTyped (actual chars entered)
      // over args.text.length (which may differ if the field truncated).
      const charCount = typeof data?.charactersTyped === 'number'
        ? data.charactersTyped
        : typeof args.text === 'string' ? args.text.length : 0;
      return `type → ${target} (${charCount} chars, ${REDACTED})`;
    }
    case 'page.scroll': {
      const dir = String(args.direction ?? '');
      const amt = typeof args.amount === 'number' ? args.amount : 400;
      return `scroll ${dir} → ${amt}px`;
    }
    case 'agent.stop': {
      return `stop → ${truncate(String(args.reason ?? ''), 100)}`;
    }
    case 'vault.has': {
      return `vault.has → ${truncate(String(args.domain ?? ''), 80)}`;
    }
    case 'vault.fill': {
      // NEVER include the password — the fill result only has success flags.
      return `vault.fill → ${truncate(String(args.domain ?? ''), 80)} (${REDACTED})`;
    }
    case 'vault.generate_and_store': {
      // NEVER include the generated password.
      return `vault.generate → ${truncate(String(args.domain ?? ''), 80)} (${REDACTED})`;
    }
    default:
      return 'unknown_tool';
  }
}

// ---------------------------------------------------------------------------
// Target description builder
// ---------------------------------------------------------------------------

export function buildTargetDescription(
  tool: ToolName,
  args: Record<string, unknown>
): string {
  const tabId = typeof args.tabId === 'string' ? args.tabId : 'active';
  switch (tool) {
    case 'browser.navigate':
      return `tab:${tabId}`;
    case 'browser.read':
      return `tab:${tabId}`;
    case 'tabs.list':
      return 'all';
    case 'tabs.open':
      return 'new';
    case 'tabs.activate':
    case 'tabs.close':
      return `tab:${String(args.tabId ?? '')}`;
    case 'page.click':
    case 'page.type':
      return `tab:${tabId},el:${String(args.elementId ?? '')}`;
    case 'page.scroll':
      return `tab:${tabId}`;
    case 'agent.stop':
      return 'run';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Timeline entry construction
// ---------------------------------------------------------------------------

let _entryCounter = 0;
function generateEntryId(): string {
  _entryCounter += 1;
  return `tl_${Date.now().toString(36)}_${_entryCounter.toString(36)}`;
}

export interface CreateTimelineEntryInput {
  step: number;
  tool: ToolName | string;
  args: Record<string, unknown>;
  result: ToolResult | null;
  state: TimelineEntryState;
  now?: () => number;
}

export function createTimelineEntry(
  input: CreateTimelineEntryInput
): AgentTimelineEntry {
  const now = input.now ?? Date.now;
  const tool = input.tool as ToolName;
  const summary = buildSafeSummary(tool, input.args, input.result);
  const target = buildTargetDescription(tool, input.args);
  return {
    id: generateEntryId(),
    step: input.step,
    kind: input.tool,
    target,
    state: input.state,
    summary: truncate(summary, AGENT_LOOP_BOUNDS.MAX_SUMMARY_LENGTH),
    timestamp: now(),
  };
}

/**
 * Create a non-tool timeline entry (for user_command, final_answer,
 * parse_error, max_steps events).
 */
export function createEventTimelineEntry(
  step: number,
  kind: string,
  summary: string,
  state: TimelineEntryState = 'completed',
  now: () => number = Date.now
): AgentTimelineEntry {
  return {
    id: generateEntryId(),
    step,
    kind,
    target: '-',
    state,
    summary: truncate(summary, AGENT_LOOP_BOUNDS.MAX_SUMMARY_LENGTH),
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// Verification — used by tests + the controller to assert no secrets leak
// ---------------------------------------------------------------------------

/**
 * Returns true if the timeline entry's summary contains any of the
 * forbidden substrings (used as a defense-in-depth check before sending
 * the entry to the renderer).
 */
export function containsForbiddenSecret(entry: AgentTimelineEntry): boolean {
  // The summary must never contain the word "password" followed by a colon
  // and a value — but "password field (redacted)" is fine.
  // We check for common secret patterns.
  const s = entry.summary.toLowerCase();
  // Check for API-key-like patterns (long hex/base64 strings).
  if (/[a-f0-9]{32,}/i.test(entry.summary)) return true;
  if (/[a-z0-9+/_-]{40,}/i.test(entry.summary)) return true;
  // Check for explicit "key:" patterns.
  if (/(api[_-]?key|secret|token|password)\s*[:=]\s*\S+/i.test(entry.summary)) {
    // Allow "password field (redacted)".
    if (!/password field\s*\(\s*redacted\s*\)/i.test(entry.summary)) return true;
  }
  // For page.type entries, the typed text must NEVER appear.
  if (entry.kind === 'page.type') {
    // The summary is built by buildSafeSummary which always redacts.
    // If someone constructs a custom summary with the text, this catches it.
    if (s.includes('typed:') || s.includes('text:')) return true;
  }
  return false;
}

/**
 * Sanitize a list of timeline entries — returns a new list with any
 * forbidden entries replaced with a redacted placeholder.
 */
export function sanitizeTimeline(
  entries: AgentTimelineEntry[]
): AgentTimelineEntry[] {
  return entries.map((e) =>
    containsForbiddenSecret(e)
      ? { ...e, summary: REDACTED }
      : e
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return s.slice(0, max - 1) + '…';
}

export const REDACTION_MARKER = REDACTED;
