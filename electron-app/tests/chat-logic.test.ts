/**
 * Chat logic tests — clean transcript derivation from timeline events.
 */
import { describe, it, expect } from 'vitest';
import {
  appendChatEntry,
  appendChatStateTransition,
  isAwaitingAnswer,
} from '../src/renderer/src/store/chat-logic';
import type { AgentTimelineEntry } from '@shared/agent-types';

function entry(over: Partial<AgentTimelineEntry> = {}): AgentTimelineEntry {
  return {
    id: 'e_' + Math.random().toString(36).slice(2, 8),
    step: 1,
    kind: 'navigate',
    target: '-',
    state: 'completed',
    summary: 'did a thing',
    timestamp: 1000,
    ...over,
  };
}

describe('appendChatEntry', () => {
  it('maps user_command to a user bubble (fullText preferred over summary)', () => {
    const out = appendChatEntry(
      [],
      entry({ kind: 'user_command', summary: 'Please remem…', fullText: 'Please remember my preferences' })
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: 'user', text: 'Please remember my preferences' });
  });

  it('maps final_answer to an agent bubble', () => {
    const out = appendChatEntry(
      [appendChatEntry([], entry({ kind: 'user_command', fullText: 'q' }))[0]!],
      entry({ kind: 'final_answer', summary: 'ans…', fullText: 'the full answer' })
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: 'agent', text: 'the full answer' });
  });

  it('ignores tool entries — same reference returned', () => {
    const base = appendChatEntry([], entry({ kind: 'user_command', fullText: 'q' }));
    const out = appendChatEntry(base, entry({ kind: 'page.click' }));
    expect(out).toBe(base);
  });
});

describe('appendChatStateTransition', () => {
  it('appends an error bubble when a run transitions to FAILED', () => {
    const base = appendChatEntry([], entry({ kind: 'user_command', fullText: 'q' }));
    const out = appendChatStateTransition(base, 'RUNNING', { state: 'FAILED', error: 'ollama down' }, () => 'err1');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: 'agent', text: 'ollama down', error: true });
  });

  it('does not duplicate when the transcript already ends with an agent bubble', () => {
    const base = [
      { id: 'a', role: 'user' as const, text: 'q' },
      { id: 'b', role: 'agent' as const, text: 'done' },
    ];
    const out = appendChatStateTransition(base, 'RUNNING', { state: 'FAILED', error: 'x' }, () => 'err2');
    expect(out).toBe(base);
  });

  it('ignores non-FAILED transitions', () => {
    const base = [{ id: 'a', role: 'user' as const, text: 'q' }];
    expect(appendChatStateTransition(base, 'IDLE', { state: 'RUNNING' }, () => 'x')).toBe(base);
    expect(appendChatStateTransition(base, 'RUNNING', { state: 'IDLE' }, () => 'x')).toBe(base);
  });
});

describe('isAwaitingAnswer', () => {
  it('true only while running and the last bubble is the user query', () => {
    const base = [{ id: 'a', role: 'user' as const, text: 'q' }];
    expect(isAwaitingAnswer(base, true)).toBe(true);
    expect(isAwaitingAnswer(base, false)).toBe(false);
    expect(isAwaitingAnswer([...base, { id: 'b', role: 'agent' as const, text: 'a' }], true)).toBe(false);
  });
});
