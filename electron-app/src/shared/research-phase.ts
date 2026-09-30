/**
 * Research phase derivation — pure logic shared by the renderer UI.
 *
 * Maps the run state + a compact activity view onto the V1 research phases:
 * Searching / Reading / Cross-checking / Writing report / Completed /
 * Stopped / Failed. Deterministic — no extra runtime state.
 *
 * Pure data — no Electron imports.
 */
import type { ResearchPhase } from './research-types';

export interface ResearchPhaseInput {
  state: 'IDLE' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'COMPLETED' | 'FAILED';
  /** Number of successful readPage actions so far. */
  readsCompleted: number;
  /** True if at least one navigate happened. */
  navigated: boolean;
}

/** Minimal timeline view (works with AgentTimelineEntry-shaped objects). */
export interface ResearchActivityView {
  tool?: string;
  state?: string;
}

export function countResearchActivity(timeline: ResearchActivityView[]): {
  readsCompleted: number;
  navigated: boolean;
} {
  let readsCompleted = 0;
  let navigated = false;
  for (const entry of timeline) {
    if (entry.tool === 'browser.read' && entry.state === 'completed') readsCompleted += 1;
    if (entry.tool === 'browser.navigate') navigated = true;
  }
  return { readsCompleted, navigated };
}

export function deriveResearchPhase(input: ResearchPhaseInput): ResearchPhase {
  switch (input.state) {
    case 'COMPLETED':
      return 'Completed';
    case 'STOPPED':
      return 'Stopped';
    case 'FAILED':
      return 'Failed';
    case 'IDLE':
      return 'Idle';
    case 'STOPPING':
      return 'Writing report';
    case 'RUNNING':
      if (input.readsCompleted >= 2) return 'Cross-checking';
      if (input.readsCompleted === 1) return 'Reading';
      return 'Searching';
  }
}
