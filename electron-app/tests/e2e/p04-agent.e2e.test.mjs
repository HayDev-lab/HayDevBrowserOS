/**
 * P04 gate — agent ownership, stop, streaming, budgets. All against the
 * LOCAL fake LLM (no external API is contacted):
 *  1. stop acknowledgement ≤ 250 ms; cancellable work (in-flight HTTP)
 *     finishes draining ≤ 2 s; the run ends STOPPING, never as a completed
 *     answer;
 *  2. streaming: SSE deltas surface as thought(running) timeline entries
 *     and the final answer is assembled correctly;
 *  3. takeover mid-run: run drains ≤ 2 s and ZERO new tool dispatch after
 *     the revoke;
 *  4. a second run is refused while one is active.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const invoke = (page, cmd, args) =>
  page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

async function timeline(page) {
  return invoke(page, 'agent_timeline_list', {});
}

async function status(page) {
  return invoke(page, 'agent_status', {});
}

async function waitFor(predicate, { timeoutMs = 10_000, stepMs = 80, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return { value, elapsed: Date.now() - start };
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(stepMs);
  }
}

test('P04: stop latency, streaming, takeover, concurrency', { timeout: 240_000 }, async (t) => {
  const app = new AppHandle();
  t.after(async () => { await app.stop(); });
  await app.launch();

  const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input', { timeout: 30_000 });

  // A real active tab + AGENT mode are prerequisites for a run.
  await chrome.fill('.commandbar__input', fixtureServer.url('/static'));
  await chrome.keyboard.press('Enter');
  await app.waitTabPage(/\/static/, 30_000);
  const mode = await invoke(chrome, 'control_set_mode', { mode: 'AGENT' });
  assert.equal(mode.accepted, true, 'AGENT mode must be accepted');

  // --- 1. Stop during an in-flight model call (fake LLM responds after 8 s).
  let stopAckMs = null;
  let runResult = null;
  const runPromise = invoke(chrome, 'agent_run', {
    req: { command: 'research the fixture with a slow model !!delay', max_steps: 3 },
  }).then((v) => { runResult = v; }).catch((e) => { runResult = { __error: String(e) }; });

  await waitFor(async () => (await status(chrome)).state === 'RUNNING', { label: 'run start' });
  const t0 = Date.now();
  const stopResp = await invoke(chrome, 'agent_stop', { reason: 'e2e stop' });
  stopAckMs = Date.now() - t0;
  assert.equal(stopResp.accepted, true, 'stop must be accepted');
  assert.ok(stopAckMs <= 250, `stop ack must be ≤250 ms (took ${stopAckMs} ms)`);

  const drained = await waitFor(
    async () => {
      const tl = await timeline(chrome);
      return tl.some((e) => e.state === 'aborted');
    },
    { timeoutMs: 2500, label: 'abort entry' },
  ).catch((e) => ({ error: e }));
  const drainMs = Date.now() - t0;
  assert.ok(drainMs <= 2000, `cancellable work must finish ≤2 s (took ${drainMs} ms)`);
  assert.ok(!drained.error, `abort entry must exist: ${drained.error ?? 'ok'}`);
  await runPromise;
  const finalStatus = await status(chrome);
  assert.ok(
    ['STOPPING', 'STOPPED'].includes(finalStatus.state),
    `stopped run must end STOPPING/STOPPED, got ${finalStatus.state}`,
  );
  const tl1 = await timeline(chrome);
  assert.ok(
    !tl1.some((e) => e.kind === 'final_answer'),
    'an interrupted run must NOT produce a final answer',
  );

  // --- 4. Concurrent run refusal (the first run holds the agent with a
  // slow model response while a second run is attempted).
  const secondRun = invoke(chrome, 'agent_run', { req: { command: 'slow hold !!delay', max_steps: 2 } });
  await waitFor(async () => (await status(chrome)).state === 'RUNNING', { label: 'second run start' });
  const concurrent = await invoke(chrome, 'agent_run', { req: { command: 'sneaky parallel', max_steps: 2 } });
  assert.equal(concurrent.status, 'error', 'a second run must be refused');
  assert.equal(concurrent.reason, 'AGENT_ALREADY_RUNNING', 'refusal keeps the documented early-failure contract');
  await invoke(chrome, 'agent_stop', { reason: 'e2e cleanup' });
  await secondRun;

  // --- 2. Streaming: partial deltas become visible timeline entries.
  const streamRun = await invoke(chrome, 'agent_run', {
    req: { command: 'say the fixture greeting !!stream', max_steps: 2 },
  });
  assert.equal(streamRun.status, 'ok', `stream run must complete: ${JSON.stringify(streamRun)}`);
  assert.ok(
    String(streamRun.answer ?? '').includes('HELLO FIXTURE'),
    `final answer must be the assembled stream: ${streamRun.answer}`,
  );
  const tl2 = await timeline(chrome);
  const runningThoughts = tl2.filter((e) => e.kind === 'thought' && e.state === 'running');
  assert.ok(
    runningThoughts.length >= 1 && runningThoughts.some((e) => /HEL|LO |FIXTURE/.test(e.summary)),
    'streaming deltas must surface as running thought entries (not one batch dump)',
  );

  // --- 3. Takeover during an endless tool loop: zero dispatch after revoke.
  let takeoverTs = null;
  const toolRun = invoke(chrome, 'agent_run', {
    req: { command: 'keep navigating !!tool', max_steps: 30 },
  }).catch((e) => ({ __error: String(e) }));
  await waitFor(
    async () => (await timeline(chrome)).some((e) => e.kind === 'navigate'),
    { label: 'first navigate tool dispatch', timeoutMs: 15_000 },
  );
  const t1 = Date.now();
  const takeover = await invoke(chrome, 'control_take_control', { reason: 'e2e takeover' });
  takeoverTs = Date.now();
  assert.equal(takeover.accepted, true, 'takeover must be accepted');
  const drainedTakeover = await waitFor(
    async () => ['STOPPING', 'STOPPED', 'IDLE'].includes((await status(chrome)).state)
      && (await status(chrome)).state !== 'RUNNING',
    { timeoutMs: 2000, stepMs: 50, label: 'run drain after takeover' },
  ).catch((e) => ({ error: e }));
  const takeoverDrainMs = Date.now() - t1;
  assert.ok(takeoverDrainMs <= 2000, `takeover drain must be ≤2 s (took ${takeoverDrainMs} ms)`);
  assert.ok(!drainedTakeover.error, `drain must complete: ${drainedTakeover.error ?? 'ok'}`);
  await toolRun;
  const tl3 = await timeline(chrome);
  const lateTools = tl3.filter(
    (e) => ['navigate', 'snapshot', 'click', 'type_text', 'read_page'].includes(e.kind)
      && Number(e.timestamp) > takeoverTs + 250,
  );
  assert.deepEqual(lateTools, [], `no tool dispatch after takeover (found: ${JSON.stringify(lateTools)})`);
  // Acknowledge the latch so the shared agent state is clean for later suites.
  await invoke(chrome, 'control_set_mode', { mode: 'AGENT' });
  await invoke(chrome, 'control_set_mode', { mode: 'HUMAN' });
});
