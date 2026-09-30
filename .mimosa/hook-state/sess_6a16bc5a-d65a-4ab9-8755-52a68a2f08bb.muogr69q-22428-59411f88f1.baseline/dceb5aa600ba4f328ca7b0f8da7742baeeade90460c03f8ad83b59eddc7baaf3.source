/**
 * Citation validation — pure logic (CITATION INTEGRITY).
 *
 * Every draft citation from the model is checked against the ACTUAL ledger:
 *   - numeric citation → the visited source with that id;
 *   - URL citation → canonical URL match against a visited source;
 *   - hallucinated refs (unknown id / URL not in the ledger) are REJECTED
 *     and reported, never silently kept;
 *   - duplicate citations of the same source collapse to one;
 *   - a finding left with ZERO valid citations is downgraded to
 *     INSUFFICIENT (no-evidence findings are never presented as supported).
 */
import type { ResearchSourceLedger } from './source-ledger';
import type { DraftCitation, DraftEvidence, DraftFinding } from './research-report-parser';
import { normalizeStance } from './research-report-parser';
import type { ResearchClaim, ResearchEvidence } from '@shared/research-types';
import { RESEARCH_BOUNDS } from '@shared/research-types';

export interface ValidatedCitations {
  /** Findings with valid source ids + the invalid refs that were rejected. */
  claims: Array<Omit<ResearchClaim, 'status' | 'singleSource' | 'conflict'>>;
  /** Structured evidence per finding (resolved against the ledger). */
  evidence: ResearchEvidence[];
  /** Human-readable rejection notes (bounded count) for the Unknowns block. */
  rejections: string[];
  /** Indexes (into the input findings) whose citations were ALL invalid. */
  insufficientIndexes: number[];
}

const MAX_REJECTIONS_REPORTED = 6;

export function validateCitations(
  ledger: ResearchSourceLedger,
  findings: DraftFinding[]
): ValidatedCitations {
  const claims: ValidatedCitations['claims'] = [];
  const evidence: ResearchEvidence[] = [];
  const rejections: string[] = [];
  const insufficientIndexes: number[] = [];

  findings.forEach((finding, index) => {
    const validIds = new Set<number>();
    for (const citation of finding.sources) {
      const resolved = resolveCitation(ledger, citation);
      if (resolved) {
        validIds.add(resolved.id);
      } else if (rejections.length < MAX_REJECTIONS_REPORTED) {
        rejections.push(
          typeof citation === 'number'
            ? `rejected citation: source #${citation} not in ledger (hallucinated id)`
            : `rejected citation: URL not in visited ledger: ${truncateUrl(citation)}`
        );
      }
    }
    // Resolve structured evidence stances (PROMPT 9 correction #2).
    // The model's stance label is normalized; the source MUST exist in the
    // ledger — hallucinated evidence is dropped (and reported once).
    const seenEvidence = new Set<number>();
    for (const ev of finding.evidence ?? []) {
      if (evidence.length >= RESEARCH_BOUNDS.MAX_EVIDENCE_ITEMS) break;
      const resolved = resolveCitation(ledger, ev.source);
      if (!resolved) {
        if (rejections.length < MAX_REJECTIONS_REPORTED) {
          rejections.push(
            typeof ev.source === 'number'
              ? `rejected evidence: source #${ev.source} not in ledger`
              : `rejected evidence: source URL not in ledger: ${truncateUrl(String(ev.source))}`
          );
        }
        continue;
      }
      if (seenEvidence.has(resolved.id)) continue;
      seenEvidence.add(resolved.id);
      evidence.push({
        sourceId: resolved.id,
        claimKey: `f${index}`,
        stance: normalizeStance(ev.stance),
      });
      // An evidence item with SUPPORT/CONTRADICT also counts as a citation
      // for that finding (the source was really read and took a stance).
      validIds.add(resolved.id);
    }
    const ids = [...validIds];
    if (ids.length === 0) {
      insufficientIndexes.push(index);
    }
    claims.push({ claim: finding.claim, sourceIds: ids });
  });

  return { claims, evidence, rejections, insufficientIndexes };
}

function resolveCitation(
  ledger: ResearchSourceLedger,
  citation: DraftCitation
): { id: number } | null {
  if (typeof citation === 'number') {
    if (!Number.isInteger(citation) || citation < 1) return null;
    const source = ledger.byId(citation);
    return source ? { id: source.id } : null;
  }
  if (typeof citation === 'string' && citation.length > 0) {
    const source = ledger.byUrl(citation);
    return source ? { id: source.id } : null;
  }
  return null;
}

function truncateUrl(url: string): string {
  return url.length > 100 ? `${url.slice(0, 100)}…` : url;
}
