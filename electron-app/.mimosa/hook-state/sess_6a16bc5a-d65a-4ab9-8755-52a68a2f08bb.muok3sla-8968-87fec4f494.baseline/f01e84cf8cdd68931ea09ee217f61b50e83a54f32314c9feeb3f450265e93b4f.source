/**
 * Research final-answer parser — pure logic.
 *
 * The DEEP_RESEARCH prompt asks the model to finish with a JSON object:
 *
 *   {"summary": "...",
 *    "findings": [{"claim": "...", "sources": [1, "https://…", …]}],
 *    "conflicts": [{"description": "...", "claims": [0, 1]}],
 *    "unknowns": ["..."]}
 *
 * This parser is TOLERANT but FAIL-CLOSED:
 *   - extracts the first balanced JSON object (plain or ```json fenced);
 *   - shape-checks and clamps every field to the research bounds;
 *   - anything unparseable → { kind: 'invalid' } with the reason — the
 *     caller still reports the raw text honestly as the summary.
 *
 * Page/model content is UNTRUSTED: sizes clamped, types checked.
 */
import { RESEARCH_BOUNDS, type EvidenceStance } from '@shared/research-types';

/** What the model may cite: a 1-based source index or a source URL. */
export type DraftCitation = number | string;

/**
 * Structured evidence a model may attach to a finding. The stance is the
 * ONLY field the cross-check trusts — and it is still validated against the
 * ledger (sourceId must be a visited source).
 */
export interface DraftEvidence {
  /** 1-based source id or URL (resolved against the ledger, like citations). */
  source: number | string;
  /** Model-provided stance; non-matching values default to NEUTRAL. */
  stance: string;
}

export interface DraftFinding {
  claim: string;
  sources: DraftCitation[];
  /** Optional structured evidence (PROMPT 9 correction #2). */
  evidence?: DraftEvidence[];
}

export interface DraftConflict {
  description: string;
  /** Indexes into the draft findings array. */
  claims: number[];
}

export interface DraftReport {
  summary: string;
  findings: DraftFinding[];
  conflicts: DraftConflict[];
  unknowns: string[];
}

export type ParsedResearchAnswer =
  | { kind: 'ok'; draft: DraftReport }
  | { kind: 'invalid'; reason: string };

export function parseResearchAnswer(rawAnswer: string): ParsedResearchAnswer {
  if (typeof rawAnswer !== 'string' || rawAnswer.trim().length === 0) {
    return { kind: 'invalid', reason: 'empty_answer' };
  }

  const jsonText = extractJsonObject(rawAnswer);
  if (jsonText === null) {
    return { kind: 'invalid', reason: 'no_json_object_found' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { kind: 'invalid', reason: `json_parse_failed: ${safeReason(err)}` };
  }
  if (!isRecord(parsed)) {
    return { kind: 'invalid', reason: 'answer_not_an_object' };
  }

  const summary = clampText(
    typeof parsed.summary === 'string' ? parsed.summary : '',
    RESEARCH_BOUNDS.MAX_SUMMARY_LENGTH
  );

  const findingsRaw = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings: DraftFinding[] = [];
  for (const f of findingsRaw.slice(0, RESEARCH_BOUNDS.MAX_FINDINGS)) {
    if (!isRecord(f) || typeof f.claim !== 'string' || f.claim.trim().length === 0) continue;
    const sourcesRaw = Array.isArray(f.sources) ? f.sources : [];
    const sources = sourcesRaw.filter(
      (s): s is DraftCitation => typeof s === 'number' || typeof s === 'string'
    );
    const evidenceRaw = Array.isArray(f.evidence) ? f.evidence : [];
    const evidence: DraftEvidence[] = [];
    for (const ev of evidenceRaw.slice(0, RESEARCH_BOUNDS.MAX_EVIDENCE_ITEMS)) {
      if (!isRecord(ev)) continue;
      const source = ev.source;
      if (typeof source !== 'number' && typeof source !== 'string') continue;
      const stance = typeof ev.stance === 'string' ? ev.stance.trim().toUpperCase() : '';
      evidence.push({ source, stance });
    }
    findings.push({
      claim: clampText(f.claim.trim(), RESEARCH_BOUNDS.MAX_CLAIM_LENGTH),
      sources,
      evidence: evidence.length > 0 ? evidence : undefined,
    });
  }

  const conflictsRaw = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
  const conflicts: DraftConflict[] = [];
  for (const c of conflictsRaw.slice(0, RESEARCH_BOUNDS.MAX_FINDINGS)) {
    if (!isRecord(c) || typeof c.description !== 'string' || c.description.trim().length === 0) {
      continue;
    }
    const claims = Array.isArray(c.claims)
      ? c.claims.filter((i): i is number => typeof i === 'number' && Number.isInteger(i))
      : [];
    conflicts.push({
      description: clampText(c.description.trim(), RESEARCH_BOUNDS.MAX_CONFLICT_DESCRIPTION),
      claims,
    });
  }

  const unknownsRaw = Array.isArray(parsed.unknowns) ? parsed.unknowns : [];
  const unknowns = unknownsRaw
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .slice(0, RESEARCH_BOUNDS.MAX_UNKNOWN_ITEMS)
    .map((u) => clampText(u.trim(), RESEARCH_BOUNDS.MAX_UNKNOWN_LENGTH));

  return { kind: 'ok', draft: { summary, findings, conflicts, unknowns } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first balanced top-level {...} from arbitrary text. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function clampText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeReason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * Normalize a model-supplied stance string to the canonical EvidenceStance
 * enum. Unknown / empty / non-matching strings default to NEUTRAL — never
 * to SUPPORT or CONTRADICT (fail-closed: the model cannot invent stances).
 */
export function normalizeStance(raw: string): EvidenceStance {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === 'SUPPORT' || s === 'SUPPORTS' || s === 'CORROBORATE' || s === 'CONFIRMS') {
    return 'SUPPORT';
  }
  if (s === 'CONTRADICT' || s === 'CONTRADICTS' || s === 'REFUTES' || s === 'DISPUTES') {
    return 'CONTRADICT';
  }
  return 'NEUTRAL';
}
