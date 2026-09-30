/**
 * Renderer-side view helper over the shared research-phase logic.
 * Keeps AgentPanel free of phase-derivation details.
 */
import type { AgentTimelineEntry, AgentStatusSnapshot, ResearchPhase } from '@shared/ipc-types';
import { countResearchActivity, deriveResearchPhase } from '@shared/research-phase';

export function researchPhaseFrom(
  status: AgentStatusSnapshot | null,
  timeline: AgentTimelineEntry[],
  researchActive: boolean
): ResearchPhase | null {
  if (!researchActive) return null;
  const state = status?.state ?? 'IDLE';
  const { readsCompleted, navigated } = countResearchActivity(timeline);
  return deriveResearchPhase({ state, readsCompleted, navigated });
}
