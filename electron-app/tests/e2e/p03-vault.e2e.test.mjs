/**
 * P03 gate — vault: contracts, domains, randomness, data.
 * Full native cycle on SYNTHETIC credentials only:
 *   save → restart → list/has → fill authorized form → delete,
 * plus hostile-host / ambiguous-record / generator-contract negatives.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

// Rust AppError surfaces as an invoke() rejection — capture it explicitly.
const invokeRaw = (page, cmd, args) =>
  page.evaluate(async ([c, a]) => {
    try {
      return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(c, a) };
    } catch (e) {
      // Tauri serializes AppError as {code, message} — keep the code visible.
      return { ok: false, error: typeof e === 'string' ? e : JSON.stringify(e) };
    }
  }, [cmd, args]);

const invoke = async (page, cmd, args) => {
  const r = await invokeRaw(page, cmd, args);
  if (!r.ok) throw new Error(`${cmd} rejected: ${r.error}`);
  return r.value;
};

test('P03: vault save→restart→fill→delete cycle with domain policy', { timeout: 240_000 }, async (t) => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-vault-'));
  let app = new AppHandle();
  t.after(async () => {
    await app.stop().catch(() => {});
    rmSync(dataRoot, { recursive: true, force: true });
  });

  const loginUrl = fixtureServer.url('/login');
  const staticUrl = fixtureServer.url('/static');

  // --- session 1: save + generate ---
  await app.launch({ dataRoot });
  const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input', { timeout: 30_000 });

  const saved = await invoke(chrome, 'vault_save', {
    input: { domain: '127.0.0.1', username: 'e2e-user', password: 'e2e-synth-pass-1' },
  });
  assert.equal(saved.success, true, `save must succeed: ${JSON.stringify(saved)}`);
  const recordId = saved.record.id;

  const gen = await invoke(chrome, 'vault_generate_and_store', {
    input: { domain: 'example.com', username: 'gen-user' },
  });
  assert.equal(gen.success, true);
  assert.match(gen.generated, /^.{20}$/, 'generated secret must be returned exactly once, 20 chars');

  await app.stop();
  app = new AppHandle();

  // --- session 2 (same data root): list/has → fill → negatives → delete ---
  await app.launch({ dataRoot });
  const chrome2 = app.chromePage();
  await chrome2.waitForSelector('.commandbar__input', { timeout: 30_000 });

  // Persistence across restart.
  const list = await invoke(chrome2, 'vault_list', {});
  const creds = list.credentials ?? [];
  assert.equal(creds.length, 2, 'both synthetic records survive restart');
  assert.ok(creds.every((c) => !('password' in c) && !('generated' in c)), 'metadata never carries secrets');
  const has = await invoke(chrome2, 'vault_has', { input: { domain: '127.0.0.1', username: 'e2e-user' } });
  assert.equal(has.has, true);

  // Authorized fill: open the login fixture, then fill the concrete record.
  await chrome2.fill('.commandbar__input', loginUrl);
  await chrome2.keyboard.press('Enter');
  const tabPage = await app.waitTabPage(/\/login/, 30_000);
  await tabPage.waitForSelector('#fixture-login', { timeout: 20_000 });
  const fill = await invoke(chrome2, 'vault_fill', { input: { id: recordId, tabId: (await app.activeTabId(chrome2)) } });
  assert.equal(fill.success, true, `authorized fill must succeed: ${JSON.stringify(fill)}`);
  assert.deepEqual([...fill.filled].sort(), ['password', 'username']);
  const typedUser = await tabPage.inputValue('#fixture-user');
  const typedPass = await tabPage.inputValue('#fixture-pass');
  assert.equal(typedUser, 'e2e-user');
  assert.equal(typedPass, 'e2e-synth-pass-1');

  // Hostile host: the record's domain appears in the QUERY of an unrelated
  // host — the old substring policy would have filled here.
  const mismatchRecord = creds.find((c) => c.domain === 'example.com');
  await chrome2.fill('.commandbar__input', `${staticUrl}?next=https://example.com/login`);
  await chrome2.keyboard.press('Enter');
  await app.waitTabPage(/\/static/, 30_000);
  const hostile = await invokeRaw(chrome2, 'vault_fill', { input: { id: mismatchRecord.id } });
  assert.equal(hostile.ok, false, 'fill must be refused on an unrelated host');
  assert.match(hostile.error, /VAULT_DOMAIN_MISMATCH/);

  // Ambiguous legacy record: a public-suffix fragment authorizes nothing.
  // On an unrelated host the fill refuses with MISMATCH; the AMBIGUOUS
  // branch itself (host UNDER the fragment, e.g. anything.co.uk vs co.uk)
  // is pinned by the Rust unit test `public_suffix_records_are_ambiguous`.
  const amb = await invoke(chrome2, 'vault_save', {
    input: { domain: 'co.uk', username: 'legacy', password: 'legacy-pass' },
  });
  await chrome2.fill('.commandbar__input', loginUrl);
  await chrome2.keyboard.press('Enter');
  await app.waitTabPage(/\/login/, 30_000);
  const ambiguous = await invokeRaw(chrome2, 'vault_fill', { input: { id: amb.record.id } });
  assert.equal(ambiguous.ok, false, 'co.uk record must NOT authorize any fill');
  assert.match(ambiguous.error, /VAULT_DOMAIN_(MISMATCH|AMBIGUOUS)/);

  // Wrong tab: fill targeting a tab on the same loopback host but with NO
  // login form — must still refuse (no fields), never succeed silently.
  await chrome2.fill('.commandbar__input', staticUrl);
  await chrome2.keyboard.press('Enter');
  await app.waitTabPage(/\/static/, 30_000);
  const wrongTab = await invokeRaw(chrome2, 'vault_fill', { input: { id: recordId, tabId: await app.activeTabId(chrome2) } });
  assert.equal(wrongTab.ok, false, 'fill on a form-less tab must be refused');
  assert.match(wrongTab.error, /VAULT_(NO_LOGIN_FIELDS|DOMAIN_MISMATCH)/);

  // Delete only the chosen record.
  const del = await invoke(chrome2, 'vault_delete', { id: amb.record.id });
  assert.equal(del.success, true);
  const after = await invoke(chrome2, 'vault_list', {});
  assert.equal((after.credentials ?? []).length, 2, 'only the chosen record is removed');
  assert.ok((after.credentials ?? []).every((c) => c.id !== amb.record.id));

  await app.stop();
});
