/**
 * Agent chat logic — derives a clean conversation (user query → agent
 * answer) from timeline events and run-state transitions.
 *
 * Pure — no React, no Electron; unit-testable.
 */
import type { AgentTimelineEntry } from '@shared/agent-types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  /** Failed-run marker (agent bubble with error styling). */
  error?: boolean;
  /** Wall-clock creation time (epoch ms) for bubble timestamps. */
  ts?: number;
}

interface StateLike {
  state: string;
  error?: string | null;
  reason?: string | null;
}

/**
 * Append a timeline entry to an existing chat transcript when it carries
 * chat meaning (user_command / final_answer). Returns the same array
 * reference when the entry is not chat-bearing.
 */
export function appendChatEntry(
  messages: ChatMessage[],
  entry: AgentTimelineEntry
): ChatMessage[] {
  if (entry.kind === 'user_command') {
    return [
      ...messages,
      {
        id: entry.id,
        role: 'user',
        text: entry.fullText ?? entry.summary,
        ts: Date.now(),
      },
    ];
  }
  if (entry.kind === 'final_answer') {
    return [
      ...messages,
      {
        id: entry.id,
        role: 'agent',
        text: entry.fullText ?? entry.summary,
        ts: Date.now(),
      },
    ];
  }
  return messages;
}

/**
 * Append an agent error bubble when a run transitions to FAILED (so the
 * chat always closes the loop the user opened). Deduplicated: skipped when
 * the transcript already ends with an agent bubble from the same step.
 */
export function appendChatStateTransition(
  messages: ChatMessage[],
  prev: string | null,
  next: StateLike,
  idFactory: () => string
): ChatMessage[] {
  if (prev === next.state || next.state !== 'FAILED') return messages;
  if (messages.length > 0 && messages[messages.length - 1]!.role === 'agent') {
    return messages;
  }
  return [
    ...messages,
    {
      id: idFactory(),
      role: 'agent',
      text: next.error || next.reason || 'The task failed.',
      error: true,
    },
  ];
}

/** True while a run is active and the transcript waits for the answer. */
export function isAwaitingAnswer(
  messages: ChatMessage[],
  agentRunning: boolean
): boolean {
  return agentRunning && messages[messages.length - 1]?.role === 'user';
}
