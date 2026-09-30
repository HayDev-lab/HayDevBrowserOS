/**
 * Agent overlay labels — pure mapping from tool names to the short status
 * shown on the in-page agent overlay plaque.
 *
 * The vocabulary is FIXED and code-owned (never model-controlled text) —
 * the overlay template only ever receives these enum-derived strings, so
 * no untrusted data reaches the injected script.
 */
import type { ToolName } from '@shared/agent-types';

const LABELS: Record<string, string> = {
  'browser.navigate': 'Navigating',
  'browser.read': 'Reading page',
  'page.click': 'Clicking',
  'page.type': 'Typing',
  'page.scroll': 'Scrolling',
  'page.screenshot': 'Capturing screen',
  'tabs.list': 'Finding tabs',
  'tabs.open': 'Creating tab',
  'tabs.activate': 'Switching tab',
  'tabs.close': 'Closing tab',
  'agent.stop': 'Finishing',
  'vault.has': 'Checking vault',
  'vault.fill': 'Filling credentials',
  'vault.generate_and_store': 'Generating password',
};

const FALLBACK = 'Working';

export function getOverlayLabelForTool(tool: ToolName | string): string {
  return LABELS[tool] ?? FALLBACK;
}
