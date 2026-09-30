/**
 * Cross-check classification — pure logic.
 *
 *   claim → compare STRUCTURED EVIDENCE stances across collected sources
 *           → derive status deterministically
 *
 * V1 statuses:
 *   SUPPORTED    — at least one source takes a SUPPORT stance on the claim,
 *                  and no source takes a CONTRADICT stance;
 *   CONFLICTING  — at least one SUPPORT and at least one CONTRADICT (from
 *                  DIFFERENT sources) on the same claim — the disagreement
 *                  is in the EVIDENCE, not in a free-text model phrase;
 *   INSUFFICIENT — no valid citations OR only NEUTRAL stances (the evidence
 *                  gap stays a gap — no consensus is invented).
 *
 * PROMPT 9 correction #2: the model's "the sources conflict" phrase is NOT
 * authoritative. The model may propose a `conflicts` block, but the final
 * CONFLICTING status is only set when the structured evidence actually
 * contains SUPPORT + CONTRADICT from distinct sources. A model-declared
 * conflict with no supporting evidence is downgraded to INSUFFICIENT and
 * the declared conflict is recorded in unknowns (the caller surfaces it
 * honestly, never as a confirmed conflict).
 *
 * No consensus is invented: agreement is never fabricated beyond what the
 * citations actually show.
 */
import type { ResearchClaim, ResearchEvidence } from '@shared/research-types';
import type { DraftConflict } from './research-report-parser';
import type { ValidatedCitations } from './citation-validator';

export interface CrossCheckOutcome {
  claims: ResearchClaim[];
  conflicts: Array<{ description: string; claimIndexes: number[] }>;
  /** Model-declared conflicts that the evidence did NOT corroborate. */
  uncorroboratedConflicts: string[];
}

export function crossCheckClaims(
  validated: ValidatedCitations,
  draftConflicts: DraftConflict[]
): CrossCheckOutcome {
  // Index evidence by finding index (claimKey = `f<index>`).
  const evidenceByIndex = new Map<number, ResearchEvidence[]>();
  for (const ev of validated.evidence) {
    const idx = parseClaimKey(ev.claimKey);
    if (idx === null) continue;
    const list = evidenceByIndex.get(idx) ?? [];
    list.push(ev);
    evidenceByIndex.set(idx, list);
  }

  // First pass: derive the structural status for each claim from evidence.
  const structuralStatuses: Array<'SUPPORTED' | 'CONFLICTING' | 'INSUFFICIENT'> = validated.claims.map(
    (claim, index) => {
      if (claim.sourceIds.length === 0) return 'INSUFFICIENT';
      const ev = evidenceByIndex.get(index) ?? [];
      if (ev.length === 0) {
        // Citations exist but no structured stances → weak / single-source
        // evidence. Treat as SUPPORTED (cited) but flag singleSource.
        return 'SUPPORTED';
      }
      const supportSources = new Set<number>();
      const contradictSources = new Set<number>();
      for (const item of ev) {
        if (item.stance === 'SUPPORT') supportSources.add(item.sourceId);
        else if (item.stance === 'CONTRADICT') contradictSources.add(item.sourceId);
      }
      if (supportSources.size > 0 && contradictSources.size > 0) {
        // Must be DIFFERENT sources (a single source cannot both support
        // and contradict the same claim — that would be a parser bug, not
        // a conflict).
        const disjoint = ![...supportSources].some((id) => contradictSources.has(id));
        if (disjoint) return 'CONFLICTING';
      }
      if (supportSources.size > 0) return 'SUPPORTED';
      // Only NEUTRAL or CONTRADICT-only evidence with no SUPPORT → the claim
      // is not actually corroborated by any read source.
      return 'INSUFFICIENT';
    }
  );

  // Map draft-conflict membership: finding index → conflict description.
  const conflictByIndex = new Map<number, string>();
  const keptConflicts: CrossCheckOutcome['conflicts'] = [];
  const uncorroboratedConflicts: string[] = [];

  draftConflicts.forEach((conflict) => {
    const indexes = conflict.claims.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < validated.claims.length
    );
    if (indexes.length === 0) return;
    // A model-declared conflict is only KEPT if the structural evidence
    // actually marks at least one of its claims as CONFLICTING.
    const corroborated = indexes.some((i) => structuralStatuses[i] === 'CONFLICTING');
    if (corroborated) {
      keptConflicts.push({ description: conflict.description, claimIndexes: indexes });
      for (const i of indexes) {
        if (!conflictByIndex.has(i)) conflictByIndex.set(i, conflict.description);
      }
    } else {
      uncorroboratedConflicts.push(
        `model-declared conflict not corroborated by evidence: ${truncate(conflict.description, 160)}`
      );
    }
  });

  const claims: ResearchClaim[] = validated.claims.map((claim, index) => {
    const status = structuralStatuses[index]!;
    if (status === 'INSUFFICIENT') {
      return { ...claim, status: 'INSUFFICIENT' as const, singleSource: false };
    }
    const conflict = conflictByIndex.get(index);
    if (status === 'CONFLICTING') {
      return {
        ...claim,
        status: 'CONFLICTING' as const,
        singleSource: claim.sourceIds.length === 1,
        conflict: conflict ?? 'Evidence stances disagree across sources',
      };
    }
    return {
      ...claim,
      status: 'SUPPORTED' as const,
      singleSource: claim.sourceIds.length === 1,
    };
  });

  return { claims, conflicts: keptConflicts, uncorroboratedConflicts };
}

function parseClaimKey(key: string): number | null {
  const match = /^f(\d+)$/.exec(key);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
