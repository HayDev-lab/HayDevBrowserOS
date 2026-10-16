/**
 * P06 gate — search → extraction → verifiable research, driven through the
 * REAL agent loop with the deterministic fixture SearXNG + fake LLM:
 *  1. scripted autoresearch: web_search → 2× web_fetch → structured finish.
 *     The report must contain ledger-backed claims (the sourceId-99 claim
 *     is DROPPED), provenance (finalUrl/status/hash/fetchedAt), honest
 *     unknowns and partial=false;
 *  2. a research run with NO tool use must report partial=true with empty
 *     claims — honest absence, never a fabricated structure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

const invoke = (page, cmd, args) =>
  page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

test('P06: research pipeline produces ledger-backed claims and honest partial', { timeout: 240_000 }, async (t) => {
  const app = new AppHandle();
  t.after(async () => { await app.stop(); });
  await app.launch();

  const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input', { timeout: 30_000 });
  await chrome.fill('.commandbar__input', fixtureServer.url('/static'));
  await chrome.keyboard.press('Enter');
  await app.waitTabPage(/\/static/, 30_000);
  const mode = await invoke(chrome, 'control_set_mode', { mode: 'AGENT' });
  assert.equal(mode.accepted, true);

  // --- 1. Full scripted research run.
  const run = await invoke(chrome, 'agent_run', {
    req: { command: 'research the alpha fact !!autoresearch', profile: 'DEEP_RESEARCH', max_steps: 12 },
  });
  assert.equal(run.status, 'ok', `research run must complete: ${JSON.stringify(run).slice(0, 300)}`);
  const report = await invoke(chrome, 'agent_research_report', {});
  assert.ok(report, 'a research report must exist');
  assert.equal(report.runState, 'COMPLETED', `run state: ${report.runState}`);

  // The claim citing source 99 (never fetched) must be dropped.
  assert.equal(report.droppedClaims, 1, 'the unfetched-source claim must be dropped');
  assert.equal(report.claims.length, 1, 'exactly the ledger-backed claim survives');
  assert.deepEqual(report.claims[0].sourceIds, [1], 'only page-a contains the cited fragment verbatim');
  assert.equal(report.claims[0].verification, 'excerpt-present');
  assert.equal(report.claims[0].interpretation, 'model-claim');
  assert.match(report.claims[0].text, /100 degrees Celsius/);

  // Provenance: both sources carry finalUrl, status, fetch time, hash.
  assert.equal(report.sources.length, 2, `expected 2 fetched sources, got ${report.sources.length}`);
  for (const s of report.sources) {
    assert.ok(/\/page-(a|b)$/.test(String(s.finalUrl ?? s.requestedUrl)), `source url: ${s.finalUrl}`);
    assert.equal(s.httpStatus, 200);
    assert.match(String(s.contentHash), /^[0-9a-f]{64}$/, 'content hash must be sha256 hex');
    assert.ok(Number(s.fetchedAt) > 0, 'fetch timestamp must be recorded');
  }

  // Honest structure: unknowns real, conflicts checked-empty, partial false.
  assert.equal(report.unknowns.length, 1);
  assert.deepEqual(report.conflicts, []);
  assert.equal(report.partial, true, 'dropping an unsupported claim must keep the report incomplete');
  assert.equal(report.evidenceState, 'excerpts-matched');
  assert.ok(report.sources.every(s => s.url === s.finalUrl));

  // Extraction sanity: page-a content actually reached the ledger text via
  // the new extractor (nav chrome stripped, article text kept).
  const pageA = report.sources.find((s) => String(s.finalUrl).endsWith('/page-a'));
  assert.ok(pageA, 'page-a in ledger');

  // --- 2. Honest partial: a research run without any tool use.
  const plain = await invoke(chrome, 'agent_run', {
    req: { command: 'just answer plainly !!plain', profile: 'DEEP_RESEARCH', max_steps: 2 },
  });
  assert.equal(plain.status, 'ok');
  const partialReport = await invoke(chrome, 'agent_research_report', {});
  assert.equal(partialReport.partial, true, 'no-tool research must be marked partial');
  assert.equal(partialReport.claims.length, 0, 'no claims may be fabricated');
  assert.equal(partialReport.sources.length, 0);
});
