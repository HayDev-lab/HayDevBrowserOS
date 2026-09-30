/**
 * Aggregate ranking (spec §9) — NEVER trusts a single engine's ordering.
 *
 * Deterministic, LLM-free scoring from configurable weights:
 *   - independent provider count (dedup confidence),
 *   - query-term coverage in title / snippet / URL,
 *   - availability (reachability) and freshness.
 *
 * PURE LOGIC — no electron, no node imports.
 */
import type { Reachability } from '@shared/darkweb-types';
import type { MergedResult } from './normalize';
import type { DarkWebConfig } from '@shared/darkweb-types';

export interface ScoredResult {
  title: string;
  url: string;
  hostname: string;
  snippet: string;
  providers: string[];
  score: number;
  reachable: Reachability;
  checkedAt: number | null;
  lastSeen: number | null;
}

export interface RankingWeights {
  providerCount: number;
  titleMatch: number;
  snippetMatch: number;
  urlMatch: number;
  reachable: number;
  freshness: number;
}

export function weightsFromConfig(config: DarkWebConfig): RankingWeights {
  return { ...config.ranking };
}

export function extractQueryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of String(query ?? '').toLowerCase().split(/[\s,.;:!?()"']+/)) {
    const t = raw.trim();
    if (t.length >= 2 && !seen.has(t)) seen.add(t);
  }
  return [...seen];
}

function coverage(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  let hit = 0;
  for (const t of terms) {
    if (lower.includes(t)) hit += 1;
  }
  return hit / terms.length;
}

const FRESHNESS_HALF_LIFE_DAYS = 30;

function freshnessFactor(lastSeen: number | null, now: number): number {
  if (lastSeen === null || lastSeen <= 0) return 0;
  const ageDays = Math.max(0, (now - lastSeen) / 86_400_000);
  return Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

const REACHABLE_FACTOR: Record<Reachability, number> = {
  yes: 1,
  unknown: 0.4,
  no: 0,
};

export function scoreMergedResult(
  merged: MergedResult,
  terms: string[],
  weights: RankingWeights,
  reachable: Reachability,
  now: number
): number {
  const providerScore = Math.min(merged.providers.length, 5) * weights.providerCount;
  const titleScore = coverage(terms, merged.title) * weights.titleMatch;
  const snippetScore = coverage(terms, merged.snippet) * weights.snippetMatch;
  const urlScore = coverage(terms, merged.url) * weights.urlMatch;
  const reachScore = REACHABLE_FACTOR[reachable] * weights.reachable;
  const freshScore = freshnessFactor(merged.lastSeen, now) * weights.freshness;
  // Two decimals — enough for stable display, avoids float noise in diffs.
  return Math.round((providerScore + titleScore + snippetScore + urlScore + reachScore + freshScore) * 100) / 100;
}

/** Score + sort descending; stable for equal scores (by URL). */
export function rankResults(
  merged: MergedResult[],
  query: string,
  weights: RankingWeights,
  reachability: Map<string, { reachable: Reachability; checkedAt: number | null }>,
  now: number
): ScoredResult[] {
  const terms = extractQueryTerms(query);
  const scored = merged.map((m) => {
    const reach = reachability.get(m.key) ?? { reachable: 'unknown' as Reachability, checkedAt: null };
    return {
      title: m.title,
      url: m.url,
      hostname: m.hostname,
      snippet: m.snippet,
      providers: [...m.providers].sort(),
      score: scoreMergedResult(m, terms, weights, reach.reachable, now),
      reachable: reach.reachable,
      checkedAt: reach.checkedAt,
      lastSeen: m.lastSeen,
    };
  });
  scored.sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return scored;
}
