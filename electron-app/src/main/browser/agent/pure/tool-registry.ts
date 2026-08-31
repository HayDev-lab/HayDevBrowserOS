/**
 * Tool registry — maps the 10 V1 tool names to BrowserActionService action
 * inputs. Pure logic — no Electron import.
 *
 * The registry is the SINGLE source of truth for which tools exist. The
 * agent loop, the tool validator, and the system prompt all consume it.
 */
import type { ToolName } from '@shared/agent-types';
import type { ActionInput } from '@shared/browser-actions-types';

export interface ToolDefinition {
  name: ToolName;
  /** Human-readable description for the system prompt. */
  description: string;
  /** JSON-schema-ish parameter description (for the model + validator). */
  parameters: ToolParameterSpec[];
}

export interface ToolParameterSpec {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  /** Enum of allowed values (for string params). */
  enum?: string[];
  /** Optional default if omitted. */
  default?: unknown;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'browser.navigate',
    description:
      'Navigate the active tab (or a specified tab) to a URL. The URL must use http:, https:, or about: protocol.',
    parameters: [
      { name: 'tabId', type: 'string', required: false, description: 'Tab to navigate. Defaults to the active tab.' },
      { name: 'url', type: 'string', required: true, description: 'The URL to navigate to.' },
    ],
  },
  {
    name: 'browser.read',
    description:
      'Read the current page: URL, title, visible text, interactive elements, and forms. Returns a PageSnapshot.',
    parameters: [
      { name: 'tabId', type: 'string', required: false, description: 'Tab to read. Defaults to the active tab.' },
    ],
  },
  {
    name: 'tabs.list',
    description: 'List all open tabs.',
    parameters: [],
  },
  {
    name: 'tabs.open',
    description: 'Open a new tab. Optionally navigate it to a URL.',
    parameters: [
      { name: 'url', type: 'string', required: false, description: 'URL to open in the new tab.' },
      { name: 'activate', type: 'boolean', required: false, description: 'Activate the new tab. Default: true.', default: true },
    ],
  },
  {
    name: 'tabs.activate',
    description: 'Activate (switch to) a tab.',
    parameters: [
      { name: 'tabId', type: 'string', required: true, description: 'The tab id to activate.' },
    ],
  },
  {
    name: 'tabs.close',
    description: 'Close a tab.',
    parameters: [
      { name: 'tabId', type: 'string', required: true, description: 'The tab id to close.' },
    ],
  },
  {
    name: 'page.click',
    description:
      'Click an interactive element on the page. The elementId must come from a prior browser.read call.',
    parameters: [
      { name: 'tabId', type: 'string', required: false, description: 'Tab to click in. Defaults to the active tab.' },
      { name: 'elementId', type: 'string', required: true, description: 'Stable element id from PageSnapshot (e.g. "el_0").' },
    ],
  },
  {
    name: 'page.type',
    description:
      'Type text into an editable element. SECURITY: if the target is a password field, the typed text is redacted from logs and never echoed back.',
    parameters: [
      { name: 'tabId', type: 'string', required: false, description: 'Tab to type in. Defaults to the active tab.' },
      { name: 'elementId', type: 'string', required: true, description: 'Stable element id from PageSnapshot.' },
      { name: 'text', type: 'string', required: true, description: 'Text to type.' },
      { name: 'clearFirst', type: 'boolean', required: false, description: 'Clear the field before typing. Default: true.', default: true },
    ],
  },
  {
    name: 'page.scroll',
    description: 'Scroll the page in a direction by a pixel amount.',
    parameters: [
      { name: 'tabId', type: 'string', required: false, description: 'Tab to scroll. Defaults to the active tab.' },
      { name: 'direction', type: 'string', required: true, description: 'Scroll direction.', enum: ['up', 'down', 'left', 'right'] },
      { name: 'amount', type: 'number', required: false, description: 'Pixels to scroll. Default: 400.', default: 400 },
    ],
  },
  {
    name: 'agent.stop',
    description:
      'Stop the current agent run. Use this when the task is impossible or you have enough information to give a final answer.',
    parameters: [
      { name: 'reason', type: 'string', required: false, description: 'Why you are stopping.' },
    ],
  },
] as const;

const TOOL_NAMES: ReadonlySet<ToolName> = new Set(
  TOOL_DEFINITIONS.map((t) => t.name)
);

export function isKnownTool(name: string): name is ToolName {
  return TOOL_NAMES.has(name as ToolName);
}

export function getToolDefinition(name: ToolName): ToolDefinition | null {
  return TOOL_DEFINITIONS.find((t) => t.name === name) ?? null;
}

export function listToolNames(): ToolName[] {
  return TOOL_DEFINITIONS.map((t) => t.name);
}

// ---------------------------------------------------------------------------
// Tool → ActionInput mapping
// ---------------------------------------------------------------------------

/**
 * Resolve the active tab id from the tool args, falling back to undefined
 * (the BrowserActionService will use the active tab — actually V1 requires
 * an explicit tabId, so the agent loop must resolve it before calling).
 *
 * For V1: tools that accept an optional `tabId` default to the active tab.
 * The agent loop resolves "active tab" → concrete tab id before dispatching.
 */
export function resolveTabId(
  args: Record<string, unknown>,
  activeTabId: string | null
): string | null {
  const explicit = args.tabId;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return activeTabId;
}

/**
 * Build the description block for the system prompt. Pure function —
 * the controller concatenates this with the security rules.
 */
export function buildToolDescriptionsBlock(): string {
  const lines = TOOL_DEFINITIONS.map((t) => {
    const params = t.parameters.length === 0
      ? '(no parameters)'
      : t.parameters
          .map((p) => {
            const req = p.required ? 'required' : 'optional';
            const en = p.enum ? ` (one of: ${p.enum.join(', ')})` : '';
            return `${p.name} (${p.type}, ${req})${en}: ${p.description}`;
          })
          .join('; ');
    return `- ${t.name}: ${t.description}. Parameters: ${params}`;
  });
  return lines.join('\n');
}
