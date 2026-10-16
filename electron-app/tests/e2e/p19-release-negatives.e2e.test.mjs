import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const invoke = (page, c, a = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);

// N05: production SSRF policy on release, proven by ACTUAL tool calls — the
// research web_fetch of the loopback fixture must be refused (no QA
// TEST_FETCH_ALLOW exists in a release binary), and the run must stay honest
// about the failure instead of fabricating sources.
test('P19: release refuses loopback research fetch and reports the refusal honestly', { timeout: 60000 }, async t => {
  if (process.env.HAYDEV_E2E_MODE !== 'release') { t.skip('release-only negative: the debug QA allowlist would legitimately permit loopback'); return; }
  const app = new AppHandle(); t.after(() => app.stop()); await app.launch();
  const chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  await invoke(chrome, 'control_set_mode', { mode: 'AGENT' });
  const obs = fixtureServer.observations;
  const before = obs.toolResults.length;
  const run = await invoke(chrome, 'agent_run', { req: { command: `!!fetch ${fixtureServer.url('/page-a')}`, profile: 'DEEP_RESEARCH', maxSteps: 3 } });
  assert.equal(run.status, 'ok', 'the run completes honestly');
  assert.equal(obs.toolResults.length, before + 1, 'the fetch tool executed (the refusal is its result)');
  const result = JSON.stringify(obs.toolResults.at(-1));
  assert.match(result, /FETCH_ADDRESS_REJECTED|FETCH_URL_REJECTED|EGRESS|not a permitted public destination|not allowed|refused/i,
    'the tool result must carry the production refusal');
  assert.doesNotMatch(result, /alpha|untrustedContent/, 'no fixture page content may leak through in release');
});
