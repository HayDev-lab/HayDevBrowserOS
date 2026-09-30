/**
 * ResearchSession — runtime glue for the DEEP_RESEARCH profile.
 *
 * NOT a second agent loop: it is (a) a RECORDING wrapper around the existing
 * BrowserActionPort that fills the source ledger deterministically from real
 * navigate/readPage results, and (b) the post-run report assembler that runs
 * the pure pipeline (parse → validate citations → cross-check → build).
 *
 * The agent loop itself is untouched except for receiving the recording port
 * and the research prompt overlay — same loop, same controller, same service.
 *
 * No Electron import (the ports are structural interfaces).
 */
import type {
  ActionInput,
  ActionResult,
  PageSnapshot,
} from '@shared/browser-actions-types';
import type { AgentRunResult, BrowserActionPort } from '@shared/agent-types';
import type { ResearchReport } from '@shared/research-types';
import { RESEARCH_BOUNDS } from '@shared/research-types';
import { ResearchSourceLedger } from '../pure/source-ledger';
import { parseResearchAnswer } from '../pure/research-report-parser';
import { validateCitations } from '../pure/citation-validator';
import { crossCheckClaims } from '../pure/cross-check';
import { buildResearchReport } from '../pure/report-builder';
import { buildResearchInstructions } from '../pure/research-prompt';

export interface ResearchSessionStats {
  readsCompleted: number;
  navigated: boolean;
  sourcesRecorded: number;
}

export class ResearchSession {
  readonly ledger = new ResearchSourceLedger();
  private stats: ResearchSessionStats = {
    readsCompleted: 0,
    navigated: false,
    sourcesRecorded: 0,
  };

  /**
   * Wrap the existing BrowserActionPort so every real browser action is
   * recorded. The agent loop calls this port EXACTLY as before.
   */
  recordingPort(inner: BrowserActionPort, now: () => number = Date.now): BrowserActionPort {
    const session = this;
    return {
      dispatch: async (input: ActionInput): Promise<ActionResult<unknown>> => {
        const result = await inner.dispatch(input);
        session.recordFromAction(input, result, now());
        return result;
      },
      startExecutionContext: () => inner.startExecutionContext(),
      stopExecutionContext: (opts?: { reason?: string }) =>
        inner.stopExecutionContext(opts ?? {}),
    };
  }

  /** System-prompt overlay for the loop (research mission + citations). */
  promptOverlay(): string {
    return buildResearchInstructions(RESEARCH_BOUNDS.MAX_SOURCES);
  }

  getStats(): ResearchSessionStats {
    return { ...this.stats, sourcesRecorded: this.ledger.size() };
  }

  /**
   * Assemble the final (or partial) research report from the ledger and the
   * model's final answer. Pure-pipeline orchestration only.
   */
  buildReport(run: AgentRunResult, now: number = Date.now()): ResearchReport {
    const parsed = run.answer ? parseResearchAnswer(run.answer) : { kind: 'invalid' as const, reason: 'no_final_answer' };

    if (parsed.kind === 'invalid') {
      // Fail-closed: no findings, honest raw-text summary, issue reported.
      const crossCheck = crossCheckClaims(validateCitations(this.ledger, []), []);
      return buildResearchReport({
        ledger: this.ledger,
        crossCheck,
        summary: clamp(run.answer ?? '', RESEARCH_BOUNDS.MAX_SUMMARY_LENGTH),
        unknowns: ['model final answer could not be parsed as a research report'],
        citationRejections: [],
        modelOutputIssue: parsed.reason,
        runState: run.state,
        partial: run.state !== 'COMPLETED',
        now,
      });
    }

    const validated = validateCitations(this.ledger, parsed.draft.findings);
    const crossCheck = crossCheckClaims(validated, parsed.draft.conflicts);
    return buildResearchReport({
      ledger: this.ledger,
      crossCheck,
      summary: parsed.draft.summary,
      unknowns: parsed.draft.unknowns,
      citationRejections: validated.rejections,
      runState: run.state,
      partial: run.state !== 'COMPLETED',
      now,
    });
  }

  // -------------------------------------------------------------------------
  // Internal — deterministic recording from REAL action results
  // -------------------------------------------------------------------------

  private recordFromAction(
    input: ActionInput,
    result: ActionResult<unknown>,
    now: number
  ): void {
    if (input.kind === 'navigate') {
      this.stats.navigated = true;
      if (!result.success) {
        // The browser really failed to load this URL → failed source.
        this.ledger.record({ url: input.url, title: '', failed: true, now });
      }
      return;
    }
    if (input.kind === 'readPage') {
      if (!result.success) return;
      const snapshot = result.data as PageSnapshot | undefined;
      if (!snapshot || typeof snapshot.url !== 'string') return; // malformed snapshot → ignore
      // PROMPT 9 correction #1: a source is recorded only after a REAL read.
      // An empty/whitespace URL cannot identify a visited page — ignore it
      // rather than polluting the ledger with an unsourced entry.
      if (snapshot.url.trim().length === 0) return;
      this.stats.readsCompleted += 1;
      const outcome = this.ledger.record({
        url: snapshot.url,
        title: typeof snapshot.title === 'string' ? snapshot.title : snapshot.url,
        excerpt: typeof snapshot.visibleText === 'string' ? snapshot.visibleText : '',
        now,
      });
      void outcome; // outcomes are observable via the ledger itself
    }
  }
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
