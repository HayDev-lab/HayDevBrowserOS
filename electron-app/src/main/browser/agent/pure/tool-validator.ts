/**
 * Tool validator — validates a model-produced ToolCall against the tool
 * registry's parameter specs, then constructs the matching ActionInput for
 * BrowserActionService dispatch.
 *
 * Pure logic — no Electron import. Reuses the existing `action-validator`
 * from PROMPT 4 for the final action-input validation.
 */
import type { ToolCall, ToolName, AuthorizationDecision } from '@shared/agent-types';
import type { ActionInput } from '@shared/browser-actions-types';
import { isKnownTool, getToolDefinition } from './tool-registry';
import { validateAction } from '../../actions/pure/action-validator';

export interface ToolValidationResult {
  valid: boolean;
  /** The constructed ActionInput, if valid. */
  actionInput?: ActionInput;
  /** Error messages if invalid. */
  errors: string[];
}

/**
 * Validate a ToolCall and construct the matching ActionInput.
 *
 * Steps:
 *   1. Check the tool name is known.
 *   2. Check each required parameter is present and correctly typed.
 *   3. Check enum parameters have valid values.
 *   4. Construct the ActionInput (resolving the active tab id if needed).
 *   5. Run the existing action-validator on the constructed input.
 *
 * The `activeTabId` is the currently active tab — used to resolve optional
 * `tabId` parameters that the model may have omitted.
 */
export function validateToolCall(
  call: ToolCall,
  activeTabId: string | null
): ToolValidationResult {
  const errors: string[] = [];

  // 1. Known tool?
  if (!isKnownTool(call.tool)) {
    return {
      valid: false,
      errors: [`unknown_tool:${call.tool}`],
    };
  }

  // 2. Validate parameters against the spec.
  const def = getToolDefinition(call.tool)!;
  const args = call.args ?? {};
  for (const spec of def.parameters) {
    const value = args[spec.name];
    if (value === undefined || value === null) {
      if (spec.required) {
        errors.push(`missing_parameter:${spec.name}`);
      }
      continue;
    }
    // Type check.
    if (spec.type === 'string' && typeof value !== 'string') {
      errors.push(`param_${spec.name}_must_be_string`);
      continue;
    }
    if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      errors.push(`param_${spec.name}_must_be_number`);
      continue;
    }
    if (spec.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`param_${spec.name}_must_be_boolean`);
      continue;
    }
    // Enum check.
    if (spec.enum && !spec.enum.includes(String(value))) {
      errors.push(
        `param_${spec.name}_invalid_enum:${String(value)} (allowed: ${spec.enum.join(', ')})`
      );
      continue;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 3. Construct the ActionInput.
  const actionInput = buildActionInput(call, activeTabId);
  if (!actionInput) {
    return {
      valid: false,
      errors: [`failed_to_build_action_input_for:${call.tool}`],
    };
  }

  // 4. Run the action validator (bounds, patterns, protocol whitelist).
  const actionValidation = validateAction(actionInput);
  if (!actionValidation.valid) {
    return {
      valid: false,
      errors: actionValidation.errors.map(
        (e) => `action_validation:${e.field}:${e.message}`
      ),
    };
  }

  return { valid: true, actionInput, errors: [] };
}

// ---------------------------------------------------------------------------
// ActionInput construction — per tool
// ---------------------------------------------------------------------------

function buildActionInput(
  call: ToolCall,
  activeTabId: string | null
): ActionInput | null {
  const args = call.args ?? {};
  const tabId = resolveTabIdParam(args, activeTabId);

  switch (call.tool as ToolName) {
    case 'browser.navigate':
      if (!tabId) return null;
      return {
        kind: 'navigate',
        tabId,
        url: String(args.url ?? ''),
      };

    case 'browser.read':
      if (!tabId) return null;
      return { kind: 'readPage', tabId };

    case 'tabs.list':
      return { kind: 'listTabs' };

    case 'tabs.open':
      return {
        kind: 'openTab',
        url: typeof args.url === 'string' ? args.url : undefined,
        activate: typeof args.activate === 'boolean' ? args.activate : undefined,
      };

    case 'tabs.activate':
      if (!tabId) return null;
      return { kind: 'activateTab', tabId };

    case 'tabs.close':
      if (!tabId) return null;
      return { kind: 'closeTab', tabId };

    case 'page.click':
      if (!tabId) return null;
      return {
        kind: 'click',
        tabId,
        elementId: String(args.elementId ?? ''),
      };

    case 'page.type':
      if (!tabId) return null;
      return {
        kind: 'type',
        tabId,
        elementId: String(args.elementId ?? ''),
        text: String(args.text ?? ''),
        clearFirst:
          typeof args.clearFirst === 'boolean' ? args.clearFirst : undefined,
      };

    case 'page.scroll':
      if (!tabId) return null;
      return {
        kind: 'scroll',
        tabId,
        direction: String(args.direction ?? 'down') as 'up' | 'down' | 'left' | 'right',
        amount: typeof args.amount === 'number' ? args.amount : undefined,
      };

    case 'agent.stop':
      return {
        kind: 'stop',
        reason: typeof args.reason === 'string' ? args.reason : undefined,
      };

    default:
      return null;
  }
}

function resolveTabIdParam(
  args: Record<string, unknown>,
  activeTabId: string | null
): string | null {
  const explicit = args.tabId;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return activeTabId;
}
