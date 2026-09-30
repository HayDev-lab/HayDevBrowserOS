/**
 * Selection actions — context-menu prompts for the agent.
 *
 * The user selects text on a page and picks Explain / Translate /
 * Summarize; the selected text (page content — UNTRUSTED) is embedded into
 * a bounded prompt and sent as an agent command. The system prompt already
 * treats page content as data, never as instructions.
 *
 * Pure — no Electron imports.
 */

export type SelectionActionKind = 'explain' | 'translate' | 'summarize';

/** Hard cap for the embedded selection (the model sees the page too). */
export const MAX_SELECTION_LENGTH = 4000;

export function buildSelectionPrompt(
  action: SelectionActionKind,
  rawText: string
): string {
  const text = String(rawText ?? '').trim().slice(0, MAX_SELECTION_LENGTH);
  const quoted = `"""\n${text}\n"""`;
  switch (action) {
    case 'explain':
      return `Explain the following text from the page in the active tab in simple terms. If it is technical, explain the key concepts.\n\n${quoted}`;
    case 'translate':
      return `Translate the following text from the page in the active tab into Russian. Output only the translation.\n\n${quoted}`;
    case 'summarize':
      return `Summarize the following text from the page in the active tab in 3-5 bullet points.\n\n${quoted}`;
    default:
      return `Review the following text from the page in the active tab.\n\n${quoted}`;
  }
}
