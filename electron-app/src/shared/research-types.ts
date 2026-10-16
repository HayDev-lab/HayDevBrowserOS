/**
 * Deep Research Lite — typed contracts (PROMPT 9).
 *
 * ONE research workflow over the EXISTING agent runtime:
 *
 *   QUERY → SEARCH → OPEN SOURCES → READ → EXTRACT → CROSS-CHECK → REPORT
 *
 * There is NO second agent loop: DEEP_RESEARCH is an execution PROFILE on
 * AgentRunRequest; the same runAgentLoop / AgentController / BrowserActionService
 * drive everything. This module only defines the pure data contracts.
 *
 * SECURITY:
 *   - Source content is UNTRUSTED DATA: bounded excerpts only, never full
 *     HTML, never huge PageSnapshot dumps.
 *   - The source ledger is in-memory only (never persisted in V1).
 *   - Report source URLs come ONLY from the ledger of actually visited
 *     pages — fictitious URLs are structurally impossible in the builder.
 *
 * Pure data — no Electron, no SDK imports.
 */

// ---------------------------------------------------------------------------
// Execution profile
// ---------------------------------------------------------------------------

/**
 * STANDARD      — the normal agent run (PROMPT 5 behavior).
 * DEEP_RESEARCH — the research profile: research system-prompt overlay,
 *                 evidence recording into a source ledger, bounded research
 *                 limits, and a structured report completion contract.
 */
export type AgentRunProfile = 'STANDARD' | 'DEEP_RESEARCH';

// ---------------------------------------------------------------------------
// Source ledger
// ---------------------------------------------------------------------------

export type ResearchSourceStatus = 'visited' | 'failed' | 'extracted' | 'empty';

export interface ResearchSource {
  /** 1-based visit order (also the citation index). */
  id: number;
  /** Canonical URL (see url-canonicalizer) of the visited page. */
  url: string;
  /** Raw URL as observed (pre-canonicalization). */
  rawUrl: string;
  title: string;
  status: ResearchSourceStatus;
  /** Bounded excerpt of the page's visible text (UNTRUSTED, size-capped). */
  excerpt: string;
  /** 1-based arrival order across the run. */
  order: number;
  visitedAt: number;
}

// ---------------------------------------------------------------------------
// Evidence / cross-check
// ---------------------------------------------------------------------------

/**
 * Stance a source takes on a claim. This is the STRUCTURED evidence model
 * the deterministic cross-check consumes — never a free-text model phrase
 * like "the sources conflict".
 *
 *   SUPPORT     — the source's excerpt corroborates the claim;
 *   CONTRADICT  — the source's excerpt argues against the claim;
 *   NEUTRAL     — the source mentions the topic but takes no stance
 *                 (background-only; cannot confirm or refute).
 *
 * Cross-check derives the final status deterministically:
 *   SUPPORT + SUPPORT         → SUPPORTED
 *   SUPPORT + CONTRADICT      → CONFLICTING
 *   one source / no stance    → INSUFFICIENT
 */
export type EvidenceStance = 'SUPPORT' | 'CONTRADICT' | 'NEUTRAL';

export interface ResearchEvidence {
  /** References ResearchSource.id (must be a visited source in the ledger). */
  sourceId: number;
  /** Stable key linking this evidence to a draft finding (finding index). */
  claimKey: string;
  stance: EvidenceStance;
}

// ---------------------------------------------------------------------------
// Claims / evidence / cross-check
// ---------------------------------------------------------------------------

export type CrossCheckStatus = 'SUPPORTED' | 'CONFLICTING' | 'INSUFFICIENT' | 'UNVERIFIED';

/**
 * A research finding. `sourceIds` reference ResearchSource.id values that
 * were validated against the ledger (hallucinated refs are removed and
 * reported, not silently kept).
 */
export interface ResearchClaim {
  quote?: string;
  verification?: 'excerpt-present';
  interpretation?: 'model-claim';
  claim: string;
  sourceIds: number[];
  status: CrossCheckStatus;
  /** True when the claim rests on a single source (weaker evidence). */
  singleSource: boolean;
  /** Present when the claim participates in a declared conflict. */
  conflict?: string;
}

export interface ResearchConflict {
  description: string;
  claimIndexes: number[];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ResearchReport {
  /** Bounded summary text (model-provided, clamped). */
  summary: string;
  claims: ResearchClaim[];
  conflicts: ResearchConflict[];
  unknowns: string[];
  sources: Array<Pick<ResearchSource, 'id' | 'url' | 'title' | 'status' | 'order'>>;
  /** Run outcome context (COMPLETED / STOPPED / FAILED …). */
  runState: string;
  /** True when the report was produced from a partially-collected ledger. */
  partial: boolean;
  /** Present when the model's final answer could not be parsed. */
  modelOutputIssue?: string;
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// UI phase (derived deterministically from the run state + timeline)
// ---------------------------------------------------------------------------

export type ResearchPhase =
  | 'Idle'
  | 'Searching'
  | 'Reading'
  | 'Cross-checking'
  | 'Writing report'
  | 'Completed'
  | 'Stopped'
  | 'Failed';

// ---------------------------------------------------------------------------
// Bounds — centralized, conservative
// ---------------------------------------------------------------------------

export const RESEARCH_BOUNDS = {
  /** Query length (trimmed). */
  MAX_QUERY_LENGTH: 500,
  /** Default/hard step budget for research runs (≤ AGENT_LOOP_BOUNDS.HARD_MAX_STEPS). */
  DEFAULT_MAX_STEPS: 24,
  HARD_MAX_STEPS: 30,
  /** Distinct sources recorded per run (visited + failed). */
  MAX_SOURCES: 8,
  /** Findings kept in the report. */
  MAX_FINDINGS: 20,
  /** Structured evidence items (source stances) kept per run. */
  MAX_EVIDENCE_ITEMS: 60,
  /** Per-source excerpt characters (visibleText digest). */
  MAX_EXCERPT_LENGTH: 400,
  /** Per-field text clamps for the model-provided report parts. */
  MAX_SUMMARY_LENGTH: 4_000,
  MAX_CLAIM_LENGTH: 600,
  MAX_CONFLICT_DESCRIPTION: 600,
  MAX_UNKNOWN_ITEMS: 10,
  MAX_UNKNOWN_LENGTH: 300,
  /** Whole-report safety ceiling (characters, serialized). */
  MAX_REPORT_SIZE: 20_000,
  /** Research timeout (clamped by AGENT_LOOP_BOUNDS.HARD_TIMEOUT_MS upstream). */
  TIMEOUT_MS: 240_000,
} as const;
