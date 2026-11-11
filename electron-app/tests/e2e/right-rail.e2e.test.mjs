import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';

test('VPN and AI settings occupy their own rail and preserve the agent draft', { timeout: 90_000 }, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await app.launch();
  const shell = app.chromePage();
  await shell.getByRole('radio', { name: 'Switch to AGENT mode', exact: true }).click();
  const input = shell.getByRole('textbox', { name: 'Agent task input', exact: true });
  await input.fill('Keep this unsent draft');
  const agent = shell.getByRole('complementary', { name: 'Agent panel', exact: true });
  await shell.getByRole('button', { name: 'Proton VPN', exact: true }).click();
  const vpn = shell.getByRole('region', { name: 'Proton VPN', exact: true });
  await vpn.waitFor();
  await agent.waitFor({ state: 'hidden' });
  assert.equal(await shell.getByRole('button', { name: 'Close agent panel', exact: true }).count(), 0);
  await vpn.getByRole('button', { name: 'Check Windows routes', exact: true }).waitFor();
  assert.equal(await vpn.getByLabel('Provider data folder').count(), 0);
  const layout = await vpn.evaluate(panel => {
    const box = panel.getBoundingClientRect();
    const header = panel.querySelector('header').getBoundingClientRect();
    const body = panel.querySelector('.panel__body').getBoundingClientRect();
    return {
      width: box.width, right: box.right, viewportWidth: innerWidth,
      bottom: box.bottom, viewportHeight: innerHeight,
      headerBottom: header.bottom, bodyTop: body.top,
      background: getComputedStyle(panel).backgroundColor,
      contentFits: panel.scrollWidth <= panel.clientWidth,
    };
  });
  assert.ok(layout.width >= 350 && layout.width <= 362);
  assert.ok(Math.abs(layout.right - layout.viewportWidth) <= 1);
  assert.ok(layout.bottom <= layout.viewportHeight - 20);
  assert.ok(layout.bodyTop >= layout.headerBottom);
  assert.ok(!layout.background.startsWith('rgba') && layout.background !== 'transparent');
  assert.equal(layout.contentFits, true);
  await shell.screenshot({ path: path.join(app.evidenceDir, 'vpn-rail.png') });

  // Switching to AI settings replaces VPN rather than stacking over it.
  await shell.getByRole('button', { name: 'AI settings', exact: true }).click();
  await vpn.waitFor({ state: 'hidden' });
  const settings = shell.locator('.ai-settings');
  await settings.waitFor();
  await agent.waitFor({ state: 'hidden' });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await agent.waitFor();
  assert.equal(await input.inputValue(), 'Keep this unsent draft');

  // A settings panel also reserves native content space when the agent is closed.
  await agent.getByRole('button', { name: 'Close agent panel', exact: true }).click();
  await agent.waitFor({ state: 'hidden' });
  const content = await app.activeTabId(shell);
  const readWidth = () => shell.evaluate(id => window.__TAURI_INTERNALS__.invoke('browser_evaluate', {
    req: { tabId: id, expression: 'innerWidth' },
  }), content);
  const wide = await readWidth();
  await shell.getByRole('button', { name: 'Proton VPN', exact: true }).click();
  await vpn.waitFor();
  await shell.waitForFunction(async ({ id, width }) => {
    const current = await window.__TAURI_INTERNALS__.invoke('browser_evaluate', { req: { tabId: id, expression: 'innerWidth' } });
    return current < width - 300;
  }, { id: content, width: wide });
  await vpn.getByRole('button', { name: 'Close', exact: true }).click();
  await vpn.waitFor({ state: 'hidden' });
  assert.equal(await agent.isVisible(), false);
  await shell.getByRole('button', { name: 'Language', exact: true }).click();
  await shell.getByRole('button', { name: 'Proton VPN', exact: true }).click();
  await vpn.getByRole('button', { name: 'Проверить маршруты Windows', exact: true }).waitFor();
  await agent.waitFor({ state: 'hidden' });
  assert.equal(await vpn.evaluate(panel => panel.scrollWidth <= panel.clientWidth), true);
  await shell.screenshot({ path: path.join(app.evidenceDir, 'vpn-rail-ru.png') });
  writeFileSync(path.join(app.evidenceDir, 'right-rail.json'), JSON.stringify({
    realWebView2: true, exclusivePanels: true, opaqueSettings: true,
    agentDraftPreserved: true, nativeContentResized: true, russianLayout: true, layout,
  }, null, 2));
});
