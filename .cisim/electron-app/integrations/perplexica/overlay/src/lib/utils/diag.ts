/**
 * DIAG_SEARCH=1-gated hop-by-hop tracing for the search pipeline
 * (researcher iterations, tool calls, thought_signature custody, SearXNG
 * result counts). Silent in production.
 */
export function diagSearch(message: string): void {
  if (process.env.DIAG_SEARCH === '1') {
    console.log(`[diag-search] ${message}`);
  }
}
