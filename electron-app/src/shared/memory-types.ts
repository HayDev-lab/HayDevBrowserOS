/**
 * Agent memory — typed contracts.
 *
 * The agent may propose facts about the user (preferences, routines).
 * A fact is stored ONLY after explicit user confirmation in the rail
 * (same trust pattern as the save-password prompt). Stored facts are
 * injected into the system prompt of future agent runs.
 *
 * SECURITY:
 *   - Facts are plain strings, bounded in length; never credentials
 *     (the agent tool description forbids secrets, and vault plaintext
 *     never exists in the agent layer anyway).
 *   - Incognito runs NEVER write memory (policy enforced in the loop).
 *
 * Pure data — no Electron imports.
 */

export interface UserFact {
  id: string;
  /** The confirmed fact, e.g. "Prefers dark themes and Russian UI". */
  fact: string;
  createdAt: number;
}

/** Pending "remember this?" prompt shown in the rail. */
export interface MemorySavePrompt {
  id: string;
  /** The proposed fact awaiting confirmation. */
  fact: string;
  createdAt: number;
}

/** Push payload for the `memory:prompt:update` channel. */
export type MemoryPromptUpdate =
  | { kind: 'set'; prompt: MemorySavePrompt }
  | { kind: 'clear' };

export const MEMORY_BOUNDS = {
  /** Max length of a single fact (chars). */
  MAX_FACT_LENGTH: 300,
  /** Max stored facts (oldest are evicted). */
  MAX_FACTS: 100,
} as const;
