/**
 * Research final-answer parser — pure pipeline tests.
 *
 * PROMPT 9 correction #2: the parser extracts the structured `evidence`
 * block (source + stance) alongside citations. Stance strings are
 * normalized later — the parser only shape-checks and clamps.
 */
import { describe, it, expect } from 'vitest';
import { parseResearchAnswer } from '../src/main/browser/research/pure/research-report-parser';
import { RESEARCH_BOUNDS } from '@shared/research-types';

describe('parseResearchAnswer — pure parsing', () => {
  it('parses a well-formed JSON object', () => {
    const raw = JSON.stringify({
      summary: 's',
      findings: [{ claim: 'c1', sources: [1, 'https://x.com'] }],
      conflicts: [{ description: 'd', claims: [0] }],
      unknowns: ['u'],
    });
    const out = parseResearchAnswer(raw);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.draft.summary).toBe('s');
      expect(out.draft.findings).toHaveLength(1);
      expect(out.draft.findings[0]!.sources).toEqual([1, 'https://x.com']);
      expect(out.draft.conflicts).toHaveLength(1);
      expect(out.draft.unknowns).toEqual(['u']);
    }
  });

  it('parses a ```json fenced object embedded in prose', () => {
    const raw = `Here is my report:\n\`\`\`json\n{"summary":"s","findings":[],"conflicts":[],"unknowns":[]}\n\`\`\`\nDone.`;
    const out = parseResearchAnswer(raw);
    expect(out.kind).toBe('ok');
  });

  it('extracts the structured evidence block', () => {
    const raw = JSON.stringify({
      summary: 's',
      findings: [
        {
          claim: 'c1',
          sources: [1],
          evidence: [
            { source: 1, stance: 'SUPPORT' },
            { source: 2, stance: 'contradicts' },
          ],
        },
      ],
      conflicts: [],
      unknowns: [],
    });
    const out = parseResearchAnswer(raw);
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.findings[0]!.evidence).toHaveLength(2);
    expect(out.draft.findings[0]!.evidence![0]).toEqual({ source: 1, stance: 'SUPPORT' });
  });

  it('returns invalid for empty input', () => {
    expect(parseResearchAnswer('').kind).toBe('invalid');
    expect(parseResearchAnswer('   ').kind).toBe('invalid');
  });

  it('returns invalid when no JSON object is present', () => {
    const out = parseResearchAnswer('I have no structured answer.');
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') expect(out.reason).toMatch(/no_json_object_found/);
  });

  it('returns invalid for malformed JSON', () => {
    const out = parseResearchAnswer('{ not json }');
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') expect(out.reason).toMatch(/json_parse_failed/);
  });

  it('clamps summary to MAX_SUMMARY_LENGTH (… appended)', () => {
    const long = 'x'.repeat(RESEARCH_BOUNDS.MAX_SUMMARY_LENGTH + 100);
    const out = parseResearchAnswer(JSON.stringify({ summary: long, findings: [], conflicts: [], unknowns: [] }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.summary.length).toBe(RESEARCH_BOUNDS.MAX_SUMMARY_LENGTH + 1);
    expect(out.draft.summary.endsWith('…')).toBe(true);
  });

  it('drops findings without a non-empty claim string', () => {
    const out = parseResearchAnswer(
      JSON.stringify({
        summary: 's',
        findings: [
          { claim: '', sources: [1] },
          { claim: 'ok', sources: [1] },
          { sources: [1] },
        ],
        conflicts: [],
        unknowns: [],
      })
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.findings).toHaveLength(1);
    expect(out.draft.findings[0]!.claim).toBe('ok');
  });

  it('drops evidence with non-number/non-string source', () => {
    const out = parseResearchAnswer(
      JSON.stringify({
        summary: 's',
        findings: [
          {
            claim: 'c1',
            sources: [],
            evidence: [
              { source: 1, stance: 'support' },
              { source: { bad: true }, stance: 'support' },
              { source: 2, stance: 5 },
            ],
          },
        ],
        conflicts: [],
        unknowns: [],
      })
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.findings[0]!.evidence).toHaveLength(2);
  });

  it('caps findings at MAX_FINDINGS', () => {
    const findings = Array.from({ length: RESEARCH_BOUNDS.MAX_FINDINGS + 5 }, (_, i) => ({
      claim: `c${i}`,
      sources: [],
    }));
    const out = parseResearchAnswer(
      JSON.stringify({ summary: 's', findings, conflicts: [], unknowns: [] })
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.findings.length).toBeLessThanOrEqual(RESEARCH_BOUNDS.MAX_FINDINGS);
  });

  it('caps unknowns at MAX_UNKNOWN_ITEMS', () => {
    const unknowns = Array.from({ length: RESEARCH_BOUNDS.MAX_UNKNOWN_ITEMS + 5 }, (_, i) => `u${i}`);
    const out = parseResearchAnswer(
      JSON.stringify({ summary: 's', findings: [], conflicts: [], unknowns })
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.unknowns.length).toBeLessThanOrEqual(RESEARCH_BOUNDS.MAX_UNKNOWN_ITEMS);
  });

  it('handles the first balanced object only (ignores trailing text)', () => {
    const raw = '{"summary":"s","findings":[],"conflicts":[],"unknowns":[]} and then more text { "another": "object" }';
    const out = parseResearchAnswer(raw);
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.draft.summary).toBe('s');
  });
});