/**
 * Research query validation — pure logic.
 *
 * Minimal: non-empty after trim, bounded length, string type. No DSL.
 */
import { RESEARCH_BOUNDS } from '@shared/research-types';

export interface ResearchQueryValidation {
  valid: boolean;
  query?: string;
  reason?: string;
}

export function validateResearchQuery(input: unknown): ResearchQueryValidation {
  if (typeof input !== 'string') {
    return { valid: false, reason: 'query_must_be_string' };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'query_empty' };
  }
  if (trimmed.length > RESEARCH_BOUNDS.MAX_QUERY_LENGTH) {
    return { valid: false, reason: 'query_too_long' };
  }
  return { valid: true, query: trimmed };
}
