import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

test('Free LLM reads a synthetic tab and displays the answer', {
  skip: process.env.HAYDEV_E2E_LIVE_FREE !== '1',
  timeout: 240_000,
}, async (t) => {
  const app = new AppHandle();
  t.after(async () => { await app.stop(); });
  await app.launch({ envOverrides: { AI_PROVIDER: '', GEMINI_API_KEY: '', OLLAMA_API_KEY: '', NVIDIA_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '' } });
  const shell = app.chromePage();
  const invoke = (name, args = {}) => shell.evaluate(([command, params]) => window.__TAURI_INTERNALS__.invoke(command, params), [name, args]);
  await shell.getByRole('button', { name: 'Set up an AI provider', exact: true }).click();
  const settings = shell.getByRole('region', { name: 'AI settings', exact: true });
  await settings.getByLabel('Agent provider', { exact: true }).selectOption('kilo-free');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'Settings saved' }).waitFor();
  const provider = (await invoke('agent_status')).providerConfig;
  assert.equal(provider.credentialRef, 'anonymous');
  assert.equal(provider.model, 'kilo-auto/free');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  const url = fixtureServer.url('/static');
  const address = shell.locator('.commandbar__input');
  await address.fill(url);
  await address.press('Enter');
  await app.waitTabPage(/\/static$/);
  assert.equal((await invoke('control_set_mode', { mode: 'AGENT' })).accepted, true);
  const task = shell.getByRole('textbox', { name: 'Agent task input', exact: true });
  await task.fill('Call read_page on this synthetic test page. Then use finish with the exact heading you read. Do not click, navigate, or use any other tool.');
  await task.press('Escape');
  assert.match(await task.inputValue(), /^Call read_page/, 'Esc preserves the draft');
  await shell.getByRole('button', { name: 'Send message to agent', exact: true }).click();
  await shell.locator('.agent-bubble').filter({ hasText: 'FIXTURE_STATIC_OK' }).waitFor({ timeout: 120_000 });
  const timeline = await invoke('agent_timeline_list');
  assert.ok(timeline.some(entry => entry.kind === 'tool_result' && entry.state === 'completed' && entry.summary === 'read_page: completed'), 'the real browser tool ran');
  assert.equal((await invoke('agent_status')).state, 'COMPLETED');
});
