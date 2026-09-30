/**
 * Citation integrity + cross-check evidence model — pure pipeline tests.
 *
 * PROMPT 9 corrections:
 *   #2 — cross-check does NOT trust a model phrase; status derives from
 *        structured ResearchEvidence stances (SUPPORT/CONTRADICT/NEUTRAL)
 *        validated against the ledger.
 *   #3 — citation integrity fails closed: hallucinated ids/URLs are
 *        rejected; a finding with zero valid citations is INSUFFICIENT;
 *        model-supplied URLs that are not in the ledger are NOT added.
 */
import { describe, it, expect } from 'vitest';
import { ResearchSourceLedger } from '../src/main/browser/research/pure/source-ledger';
import { validateCitations } from '../src/main/browser/research/pure/citation-validator';
import { crossCheckClaims } from '../src/main/browser/research/pure/cross-check';
import { normalizeStance } from '../src/main/browser/research/pure/research-report-parser';
import type { DraftFinding } from '../src/main/browser/research/pure/research-report-parser';
import { RESEARCH_BOUNDS } from '@shared/research-types';

function ledgerWith(urls: string[]): ResearchSourceLedger {
  const ledger = new ResearchSourceLedger();
  urls.forEach((u, i) => {
    ledger.record({ url: u, title: `T${i + 1}`, excerpt: `excerpt ${i + 1}`, now: i + 1 });
  });
  return ledger;
}

describe('normalizeStance — fail-closed stance normalization', () => {
  it('maps SUPPORT synonyms to SUPPORT', () => {
    expect(normalizeStance('SUPPORT')).toBe('SUPPORT');
    expect(normalizeStance('supports')).toBe('SUPPORT');
    expect(normalizeStance('Corroborate')).toBe('SUPPORT');
    expect(normalizeStance('CONFIRMS')).toBe('SUPPORT');
  });
  it('maps CONTRADICT synonyms to CONTRADICT', () => {
    expect(normalizeStance('CONTRADICT')).toBe('CONTRADICT');
    expect(normalizeStance('refutes')).toBe('CONTRADICT');
    expect(normalizeStance('Disputes')).toBe('CONTRADICT');
  });
  it('defaults unknown / empty / malformed to NEUTRAL (never SUPPORT/CONTRADICT)', () => {
    expect(normalizeStance('')).toBe('NEUTRAL');
    expect(normalizeStance('maybe')).toBe('NEUTRAL');
    expect(normalizeStance('kinda supports but not really')).toBe('NEUTRAL');
    expect(normalizeStance('   ')).toBe('NEUTRAL');
  });
});

describe('validateCitations — fail-closed citation integrity', () => {
  it('resolves numeric citations against the visited ledger', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const out = validateCitations(ledger, [
      { claim: 'c1', sources: [1, 2] },
    ]);
    expect(out.claims[0]!.sourceIds).toEqual([1, 2]);
    expect(out.rejections).toEqual([]);
    expect(out.insufficientIndexes).toEqual([]);
  });

  it('rejects hallucinated numeric ids and marks the finding INSUFFICIENT', () => {
    const ledger = ledgerWith(['https://a.com']);
    const out = validateCitations(ledger, [
      { claim: 'c1', sources: [99] },
    ]);
    expect(out.claims[0]!.sourceIds).toEqual([]);
    expect(out.insufficientIndexes).toEqual([0]);
    expect(out.rejections.length).toBeGreaterThan(0);
    expect(out.rejections[0]).toMatch(/hallucinated id/);
  });

  it('resolves URL citations against the canonicalized visited ledger (host case + fragment)', () => {
    const ledger = ledgerWith(['https://example.com/page']);
    const out = validateCitations(ledger, [
      { claim: 'c1', sources: ['https://EXAMPLE.com/page#frag'] },
    ]);
    expect(out.claims[0]!.sourceIds).toEqual([1]);
  });

  it('REJECTS URL citations not in the ledger (does NOT add the URL)', () => {
    const ledger = ledgerWith(['https://a.com']);
    const out = validateCitations(ledger, [
      { claim: 'c1', sources: ['https://invented.example.com/x'] },
    ]);
    expect(out.claims[0]!.sourceIds).toEqual([]);
    expect(out.insufficientIndexes).toEqual([0]);
    expect(ledger.byUrl('https://invented.example.com/x')).toBeNull();
    expect(ledger.size()).toBe(1);
  });

  it('deduplicates citations of the same source', () => {
    const ledger = ledgerWith(['https://a.com']);
    const out = validateCitations(ledger, [
      { claim: 'c1', sources: [1, 1, 'https://a.com'] },
    ]);
    expect(out.claims[0]!.sourceIds).toEqual([1]);
  });

  it('resolves structured evidence stances and normalizes them', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const out = validateCitations(ledger, [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'support' },
          { source: 2, stance: 'contradicts' },
        ],
      },
    ]);
    expect(out.evidence).toHaveLength(2);
    expect(out.evidence[0]).toMatchObject({ sourceId: 1, stance: 'SUPPORT', claimKey: 'f0' });
    expect(out.evidence[1]).toMatchObject({ sourceId: 2, stance: 'CONTRADICT', claimKey: 'f0' });
    // Evidence with SUPPORT/CONTRADICT also counts as a citation.
    expect(out.claims[0]!.sourceIds).toEqual([1, 2]);
  });

  it('drops evidence with hallucinated source ids and reports them', () => {
    const ledger = ledgerWith(['https://a.com']);
    const out = validateCitations(ledger, [
      {
        claim: 'c1',
        sources: [],
        evidence: [{ source: 99, stance: 'support' }],
      },
    ]);
    expect(out.evidence).toEqual([]);
    expect(out.claims[0]!.sourceIds).toEqual([]);
    expect(out.insufficientIndexes).toEqual([0]);
    expect(out.rejections.some((r) => r.includes('rejected evidence'))).toBe(true);
  });

  it('caps evidence items at RESEARCH_BOUNDS.MAX_EVIDENCE_ITEMS', () => {
    const ledger = new ResearchSourceLedger();
    for (let i = 0; i < RESEARCH_BOUNDS.MAX_EVIDENCE_ITEMS + 5; i += 1) {
      ledger.record({ url: `https://e${i}.com`, title: `E${i}`, now: i });
    }
    const evidence = Array.from({ length: RESEARCH_BOUNDS.MAX_EVIDENCE_ITEMS + 5 }, (_, i) => ({
      source: i + 1,
      stance: 'support',
    }));
    const out = validateCitations(ledger, [{ claim: 'c1', sources: [], evidence }]);
    expect(out.evidence.length).toBeLessThanOrEqual(RESEARCH_BOUNDS.MAX_EVIDENCE_ITEMS);
  });
});

describe('crossCheckClaims — structured evidence drives the status', () => {
  it('SUPPORT + SUPPORT → SUPPORTED', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'support' },
          { source: 2, stance: 'support' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('SUPPORTED');
    expect(out.claims[0]!.singleSource).toBe(false);
  });

  it('SUPPORT + CONTRADICT (different sources) → CONFLICTING', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'support' },
          { source: 2, stance: 'contradict' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('CONFLICTING');
  });

  it('only NEUTRAL stances → INSUFFICIENT (no consensus invented)', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'neutral' },
          { source: 2, stance: 'neutral' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('INSUFFICIENT');
  });

  it('a single source with SUPPORT → SUPPORTED + singleSource=true', () => {
    const ledger = ledgerWith(['https://a.com']);
    const findings: DraftFinding[] = [
      { claim: 'c1', sources: [], evidence: [{ source: 1, stance: 'support' }] },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('SUPPORTED');
    expect(out.claims[0]!.singleSource).toBe(true);
  });

  it('no citations and no evidence → INSUFFICIENT', () => {
    const ledger = ledgerWith(['https://a.com']);
    const validated = validateCitations(ledger, [{ claim: 'c1', sources: [] }]);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('INSUFFICIENT');
  });

  it('citations WITHOUT stances → SUPPORTED (cited but weak — singleSource flag tells the reader)', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const validated = validateCitations(ledger, [{ claim: 'c1', sources: [1, 2] }]);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('SUPPORTED');
    expect(out.claims[0]!.singleSource).toBe(false);
  });

  it('CONTRADICT-only evidence (no SUPPORT) → INSUFFICIENT (no refutation without a claim to refute)', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'contradict' },
          { source: 2, stance: 'contradict' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, []);
    expect(out.claims[0]!.status).toBe('INSUFFICIENT');
  });

  it('does NOT trust a model-declared conflict when evidence is only SUPPORT', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'support' },
          { source: 2, stance: 'support' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, [
      { description: 'sources disagree', claims: [0] },
    ]);
    expect(out.claims[0]!.status).toBe('SUPPORTED');
    expect(out.conflicts).toEqual([]);
    expect(out.uncorroboratedConflicts.length).toBeGreaterThan(0);
  });

  it('KEEPS a model-declared conflict only when evidence actually conflicts', () => {
    const ledger = ledgerWith(['https://a.com', 'https://b.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'support' },
          { source: 2, stance: 'contradict' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    const out = crossCheckClaims(validated, [
      { description: 'sources disagree', claims: [0] },
    ]);
    expect(out.claims[0]!.status).toBe('CONFLICTING');
    expect(out.conflicts).toHaveLength(1);
    expect(out.uncorroboratedConflicts).toEqual([]);
  });

  it('ignores draft conflicts with out-of-range claim indexes', () => {
    const ledger = ledgerWith(['https://a.com']);
    const validated = validateCitations(ledger, [{ claim: 'c1', sources: [1] }]);
    const out = crossCheckClaims(validated, [
      { description: 'ghost', claims: [99] },
    ]);
    expect(out.conflicts).toEqual([]);
  });

  it('same source cannot both SUPPORT and CONTRADICT a claim (parser bug, not a conflict)', () => {
    const ledger = ledgerWith(['https://a.com']);
    const findings: DraftFinding[] = [
      {
        claim: 'c1',
        sources: [],
        evidence: [
          { source: 1, stance: 'support' },
          { source: 1, stance: 'contradict' },
        ],
      },
    ];
    const validated = validateCitations(ledger, findings);
    // The dedup in validateCitations means only the first evidence per source
    // is kept, so the contradiction is dropped — the claim is SUPPORTED.
    const out = crossCheckClaims(validated, []);
    expect(validated.evidence).toHaveLength(1);
    expect(out.claims[0]!.status).toBe('SUPPORTED');
  });
});