import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';

test('P21: AI settings UI, encrypted keys, provider resolution and restart persistence', { timeout:180_000 }, async t => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'haydev-ai-settings-'));
  const envOverrides = { GEMINI_API_KEY:'', OPENAI_API_KEY:'', OPENROUTER_API_KEY:'' };
  let app = new AppHandle();
  t.after(async () => { await app.stop(); rmSync(dataRoot, { recursive:true, force:true }); });
  await app.launch({ dataRoot, envOverrides });
  let page = app.chromePage();
  const invoke = (name, args = {}) => page.evaluate(async ([n,a]) => {
    try { return await window.__TAURI_INTERNALS__.invoke(n,a); }
    catch (e) { throw new Error(JSON.stringify(e)); }
  }, [name,args]);
  await page.waitForSelector('.commandbar__input');
  assert.equal((await invoke('ai_settings_get')).providers.length, 3);
  await page.getByRole('button', { name:'AI settings', exact:true }).click();
  const panel = page.getByRole('region', { name:'AI settings', exact:true });
  await page.screenshot({ path:path.join(app.evidenceDir,'ai-settings-before.png') });
  await panel.getByLabel('Agent provider', { exact:true }).selectOption('openrouter');
  const ids = ['gemini', 'openrouter', 'openai'];
  const names = ['Gemini', 'OpenRouter', 'OpenAI'];
  const secrets = ids.map(id => `fixture-${id}-not-a-real-key-12345`);
  for (let i=0;i<ids.length;i++) {
    await panel.getByLabel(`${names[i]} · API key`, { exact:true }).fill(secrets[i]);
    await panel.getByLabel(`${names[i]} · Agent model (select or enter ID)`, { exact:true }).fill(`${ids[i]}-fixture-model`);
  }
  await panel.getByLabel('Gemini Live model (select or enter ID)', { exact:true }).fill('gemini-fixture-live');
  await panel.getByRole('button', { name:'Save settings', exact:true }).click();
  await panel.getByText('Settings saved. They apply to the next agent run.', { exact:true }).waitFor();
  for (const name of names) assert.equal(await panel.getByLabel(`${name} · API key`, { exact:true }).inputValue(), '');
  const saved = await invoke('ai_settings_get');
  assert.equal(saved.activeProvider, 'openrouter');
  assert.ok(saved.providers.every(p => p.configured && p.keySource === 'saved'));
  const onDisk = readFileSync(path.join(dataRoot,'ai-settings.json'),'utf8');
  for (const secret of secrets) { assert.ok(!onDisk.includes(secret)); assert.ok(!JSON.stringify(saved).includes(secret)); }
  assert.ok(JSON.parse(onDisk).providers.openai.encryptedKey.length > 30);
  const status = await invoke('agent_status');
  assert.equal(status.providerConfigured,true);
  assert.equal(status.providerConfig.baseUrl,'https://openrouter.ai/api/v1');
  assert.equal(status.providerConfig.model,'openrouter-fixture-model');
  assert.equal(saved.geminiLiveModel,'gemini-fixture-live');
  await page.screenshot({ path:path.join(app.evidenceDir,'ai-settings.png') });
  const badPatch = { activeProvider:'not-a-provider', geminiLiveModel:'live', providers:[] };
  await assert.rejects(invoke('ai_settings_save', { patch:badPatch }), /AI_INVALID_PROVIDER/);
  assert.equal(readFileSync(path.join(dataRoot,'ai-settings.json'),'utf8'),onDisk);
  await app.stop();
  app = new AppHandle();
  await app.launch({ dataRoot, envOverrides });
  page = app.chromePage();
  await page.waitForSelector('.commandbar__input');
  assert.deepEqual(await invoke('ai_settings_get'),saved);
  // Switching provider must keep its existing key, and deleting one must not erase another.
  const patch = { activeProvider:'openai', geminiLiveModel:saved.geminiLiveModel, providers:saved.providers.map(p => ({id:p.id,model:p.model,removeKey:p.id==='openrouter'})) };
  const updated = await invoke('ai_settings_save',{patch});
  assert.equal(updated.providers.find(p => p.id==='openrouter').configured,false);
  assert.equal(updated.providers.find(p => p.id==='openai').configured,true);
  const switched = await invoke('agent_status');
  assert.equal(switched.providerConfigured,true);
  assert.equal(switched.providerConfig.baseUrl,'https://api.openai.com/v1');
  assert.equal(switched.providerConfig.model,'openai-fixture-model');
});
