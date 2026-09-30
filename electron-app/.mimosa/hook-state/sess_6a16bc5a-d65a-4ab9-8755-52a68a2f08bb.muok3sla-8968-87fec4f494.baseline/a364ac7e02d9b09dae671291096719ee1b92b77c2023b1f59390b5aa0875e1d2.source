/**
 * PURE_RESEARCH_PIPELINE — end-to-end deterministic pipeline test.
 *
 * PROMPT 9 correction #4A: the pure pipeline (ledger → cross-check →
 * citation validator → report builder) runs entirely against deterministic
 * fixtures — no Electron, no Ollama, no real browser. This is the static
 * guarantee that the research contract holds regardless of runtime.
 */
import { describe, it, expect } from 'vitest';
import { ResearchSourceLedger } from '../src/main/browser/research/pure/source-ledger';
import { validateCitations } from '../src/main/browser/research/pure/citation-validator';
import { crossCheckClaims } from '../src/main/browser/research/pure/cross-check';
import { buildResearchReport } from '../src/main/browser/research/pure/report-builder';
import { parseResearchAnswer } from '../src/main/browser/research/pure/research-report-parser';
import { RESEARCH_BOUNDS, type ResearchReport } from '@shared/research-types';

function buildPipeline(
  visited: Array<{ url: string; title: string; excerpt?: string; failed?: boolean }>,
  modelAnswer: string,
  runState: ResearchReport['runState'] = 'COMPLETED',
  now = 5_000_000
): ResearchReport {
  const ledger = new ResearchSourceLedger();
  visited.forEach((v, i) => {
    ledger.record({ url: v.url, title: v.title, excerpt: v.excerpt ?? '', failed: v.failed, now: i + 1 });
  });
  const parsed = parseResearchAnswer(modelAnswer);
  if (parsed.kind === 'invalid') {
    return buildResearchReport({
      ledger,
      crossCheck: crossCheckClaims(validateCitations(ledger, []), []),
      summary: modelAnswer.slice(0, RESEARCH_BOUNDS.MAX_SUMMARY_LENGTH),
      unknowns: ['model final answer could not be parsed as a research report'],
      citationRejections: [],
      modelOutputIssue: parsed.reason,
      runState,
      partial: runState !== 'COMPLETED',
      now,
    });
  }
  const validated = validateCitations(ledger, parsed.draft.findings);
  const crossCheck = crossCheckClaims(validated, parsed.draft.conflicts);
  return buildResearchReport({
    ledger,
    crossCheck,
    summary: parsed.draft.summary,
    unknowns: parsed.draft.unknowns,
    citationRejections: validated.rejections,
    runState,
    partial: runState !== 'COMPLETED',
    now,
  });
}

describe('PURE_RESEARCH_PIPELINE — deterministic end-to-end', () => {
  it('SUPPORTED: two sources, two SUPPORT stances → SUPPORTED finding + both URLs in sources', () => {
    const report = buildPipeline(
      [
        { url: 'https://a.example.com', title: 'A', excerpt: 'A says yes' },
        { url: 'https://b.example.com', title: 'B', excerpt: 'B also says yes' },
      ],
      JSON.stringify({
        summary: 'Both agree.',
        findings: [
          {
            claim: 'X is true',
            sources: [],
            evidence: [
              { source: 1, stance: 'SUPPORT' },
              { source: 2, stance: 'SUPPORT' },
            ],
          },
        ],
        conflicts: [],
        unknowns: [],
      })
    );
    expect(report.claims[0]!.status).toBe('SUPPORTED');
    expect(report.claims[0]!.singleSource).toBe(false);
    expect(report.sources.map((s) => s.url)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(report.runState).toBe('COMPLETED');
    expect(report.partial).toBe(false);
  });

  it('CONFLICTING: SUPPORT + CONTRADICT from different sources → CONFLICTING + conflict block kept', () => {
    const report = buildPipeline(
      [
        { url: 'https://a.example.com', title: 'A' },
        { url: 'https://b.example.com', title: 'B' },
      ],
      JSON.stringify({
        summary: 'Sources disagree.',
        findings: [
          {
            claim: 'X is true',
            sources: [],
            evidence: [
              { source: 1, stance: 'SUPPORT' },
              { source: 2, stance: 'CONTRADICT' },
            ],
          },
        ],
        conflicts: [{ description: 'A vs B', claims: [0] }],
        unknowns: [],
      })
    );
    expect(report.claims[0]!.status).toBe('CONFLICTING');
    expect(report.conflicts).toHaveLength(1);
    expect(report.claims[0]!.conflict).toBe('A vs B');
  });

  it('INSUFFICIENT: hallucinated citations are rejected; finding is INSUFFICIENT', () => {
    const report = buildPipeline(
      [{ url: 'https://a.example.com', title: 'A' }],
      JSON.stringify({
        summary: 's',
        findings: [{ claim: 'c1', sources: [99, 'https://invented.example.com/x'] }],
        conflicts: [],
        unknowns: [],
      })
    );
    expect(report.claims[0]!.status).toBe('INSUFFICIENT');
    expect(report.claims[0]!.sourceIds).toEqual([]);
    expect(report.unknowns.some((u) => u.includes('rejected citation'))).toBe(true);
    // The hallucinated URL was NOT added to the ledger → not in report sources.
    expect(report.sources.find((s) => s.url.includes('invented'))).toBeUndefined();
  });

  it('PARTIAL: a STOPPED run produces a partial report with ledger sources preserved', () => {
    const report = buildPipeline(
      [
        { url: 'https://a.example.com', title: 'A' },
        { url: 'https://b.example.com', title: 'B' },
      ],
      JSON.stringify({
        summary: 'partial',
        findings: [{ claim: 'c1', sources: [1] }],
        conflicts: [],
        unknowns: [],
      }),
      'STOPPED'
    );
    expect(report.partial).toBe(true);
    expect(report.runState).toBe('STOPPED');
    expect(report.unknowns.some((u) => u.includes('PARTIAL'))).toBe(true);
    expect(report.sources).toHaveLength(2);
  });

  it('FAILED load: a failed source is in the ledger but NOT citable', () => {
    const report = buildPipeline(
      [
        { url: 'https://a.example.com', title: 'A' },
        { url: 'https://broken.example.com', title: '', failed: true },
      ],
      JSON.stringify({
        summary: 's',
        findings: [{ claim: 'c1', sources: [2] }],
        conflicts: [],
        unknowns: [],
      })
    );
    // Source #2 was failed → finding has no valid citations → INSUFFICIENT.
    expect(report.claims[0]!.status).toBe('INSUFFICIENT');
    // The failed source is still listed in report sources (status='failed')
    // so the reader sees that we tried and failed.
    const failed = report.sources.find((s) => s.url === 'https://broken.example.com');
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
  });

  it('model-declared conflict WITHOUT evidence is downgraded to uncorroborated (not CONFLICTING)', () => {
    const report = buildPipeline(
      [
        { url: 'https://a.example.com', title: 'A' },
        { url: 'https://b.example.com', title: 'B' },
      ],
      JSON.stringify({
        summary: 's',
        findings: [
          {
            claim: 'c1',
            sources: [],
            evidence: [
              { source: 1, stance: 'SUPPORT' },
              { source: 2, stance: 'SUPPORT' },
            ],
          },
        ],
        conflicts: [{ description: 'sources disagree', claims: [0] }],
        unknowns: [],
      })
    );
    expect(report.claims[0]!.status).toBe('SUPPORTED');
    expect(report.conflicts).toEqual([]);
    expect(report.unknowns.some((u) => u.includes('not corroborated'))).toBe(true);
  });

  it('unparseable model answer → fail-closed: raw text as summary, no findings, issue reported', () => {
    const report = buildPipeline(
      [{ url: 'https://a.example.com', title: 'A' }],
      'I could not produce JSON.'
    );
    expect(report.claims).toEqual([]);
    expect(report.summary).toBe('I could not produce JSON.');
    expect(report.modelOutputIssue).toMatch(/no_json_object_found|json_parse_failed/);
    expect(report.unknowns.some((u) => u.includes('could not be parsed'))).toBe(true);
  });

  it('report sources come ONLY from the ledger (no model-injected URLs)', () => {
    const report = buildPipeline(
      [{ url: 'https://a.example.com', title: 'A' }],
      JSON.stringify({
        summary: 's',
        findings: [{ claim: 'c1', sources: ['https://invented.example.com/x'] }],
        conflicts: [],
        unknowns: [],
      })
    );
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!.url).toBe('https://a.example.com');
  });

  it('respects MAX_REPORT_SIZE — drops findings from the end to fit', () => {
    // Build a report that would exceed the size ceiling with many large findings.
    const findings = Array.from({ length: RESEARCH_BOUNDS.MAX_FINDINGS }, (_, i) => ({
      claim: `claim-${i}-${'x'.repeat(200)}`,
      sources: [1],
    }));
    const report = buildPipeline(
      [{ url: 'https://a.example.com', title: 'A' }],
      JSON.stringify({
        summary: 's'.repeat(500),
        findings,
        conflicts: [],
        unknowns: [],
      })
    );
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(RESEARCH_BOUNDS.MAX_REPORT_SIZE + 200);
  });
});