/**
 * Research report builder — pure logic.
 *
 * Assembles the final ResearchReport. STRUCTURAL GUARANTEE: the `sources`
 * block is copied verbatim from the ledger of actually visited pages — the
 * builder receives URLs only through the ledger, so fictitious URLs cannot
 * appear in a report.
 *
 * Also enforces the report-size bound: if the serialized report would exceed
 * MAX_REPORT_SIZE, findings are dropped from the end (marked in unknowns).
 */
import { RESEARCH_BOUNDS, type ResearchReport, type ResearchSource } from '@shared/research-types';
import type { ResearchSourceLedger } from './source-ledger';
import type { ResearchClaim } from '@shared/research-types';
import type { CrossCheckOutcome } from './cross-check';

export interface BuildReportInput {
  ledger: ResearchSourceLedger;
  crossCheck: CrossCheckOutcome;
  /** Model-provided summary (already clamped by the parser). */
  summary: string;
  unknowns: string[];
  citationRejections: string[];
  modelOutputIssue?: string;
  runState: string;
  /** True when the run ended early (STOPPED / aborted / failed). */
  partial: boolean;
  now: number;
}

export function buildResearchReport(input: BuildReportInput): ResearchReport {
  const sources: ResearchReport['sources'] = input.ledger
    .list()
    .map((s: ResearchSource) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      status: s.status,
      order: s.order,
    }));

  const unknowns = [...input.unknowns];
  for (const rejection of input.citationRejections) unknowns.push(rejection);
  for (const unc of input.crossCheck.uncorroboratedConflicts) unknowns.push(unc);
  if (input.modelOutputIssue) unknowns.push(`model output issue: ${input.modelOutputIssue}`);
  if (input.partial) {
    unknowns.push('report is PARTIAL — the run ended before completion (evidence may be incomplete)');
  }

  let claims = input.crossCheck.claims;
  let conflicts = input.crossCheck.conflicts;

  // Report-size guard: drop findings from the end until it fits.
  let serialized = serialize({
    summary: input.summary,
    claims,
    conflicts,
    unknowns,
    sources,
    runState: input.runState,
    partial: input.partial,
    modelOutputIssue: input.modelOutputIssue,
    generatedAt: input.now,
  });
  while (serialized.length > RESEARCH_BOUNDS.MAX_REPORT_SIZE && claims.length > 0) {
    claims = claims.slice(0, claims.length - 1);
    conflicts = conflicts.map((c) => ({
      ...c,
      claimIndexes: c.claimIndexes.filter((i) => i < claims.length),
    }));
    serialized = serialize({
      summary: input.summary,
      claims,
      conflicts,
      unknowns,
      sources,
      runState: input.runState,
      partial: input.partial,
      modelOutputIssue: input.modelOutputIssue,
      generatedAt: input.now,
    });
  }

  return {
    summary: input.summary,
    claims,
    conflicts,
    unknowns: unknowns.slice(0, RESEARCH_BOUNDS.MAX_UNKNOWN_ITEMS + 6),
    sources,
    runState: input.runState,
    partial: input.partial,
    modelOutputIssue: input.modelOutputIssue,
    generatedAt: input.now,
  };
}

function serialize(report: ResearchReport): string {
  try {
    return JSON.stringify(report);
  } catch {
    return '';
  }
}
