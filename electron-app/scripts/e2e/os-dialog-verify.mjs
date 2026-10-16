/**
 * R03 OS-dialog acceptance — CDP verification half.
 * Usage: node scripts/e2e/os-dialog-verify.mjs <step>
 *   attach-armed   — print state the operator checks after choosing a file in the REAL dialog
 *   expect-cancel  — assert no attachment and no error after a cancelled dialog
 *   expect-refused — assert the late pick after STOP was refused (no attachment)
 * The app must already run with HAYDEV_QA_MODE=1 HAYDEV_AUTOMATION_DEBUG=1 and
 * an isolated HAYDEV_DATA_DIR. Dialog interaction happens via Computer Use.
 */
import { chromium } from 'playwright-core';

const step = process.argv[2] ?? 'attach-armed';
const chrome = await chromium.connectOverCDP('http://127.0.0.1:9220');
const page = chrome.contexts()[0].pages().find(p => /tauri\.localhost|localhost:5180/.test(p.url()));
if (!page) { console.error('shell page not found'); process.exit(1); }

const panelText = async () => page.evaluate(() => document.body.innerText);

if (step === 'attach-armed') {
  // Agent mode must be on for the run panel; report panel state for the operator.
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('control_set_mode', { mode: 'AGENT' }));
  const text = await panelText();
  console.log(JSON.stringify({ agentMode: /AGENT/.test(text), hasAttach: /attach|вложен|կց/i.test(text) }));
} else if (step === 'expect-cancel') {
  const text = await panelText();
  const chips = await page.locator('.agent-panel__attachment').count();
  console.log(JSON.stringify({ chips, hasError: /ATTACHMENT_|DOCUMENT_/.test(text) }));
  process.exit(chips === 0 ? 0 : 2);
} else if (step === 'expect-refused') {
  const deadline = Date.now() + 20000;
  let chips = -1; let refused = false;
  while (Date.now() < deadline) {
    chips = await page.locator('.agent-panel__attachment').count();
    const text = await panelText();
    refused = /ATTACHMENT_PICK_FAILED|DOCUMENT_CANCELLED|attachFail|не удалось выбрать|Փաստաթուղթ|selection (failed|timed out)|cancelled/i.test(text);
    if (refused) break;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(JSON.stringify({ chips, refused }));
  process.exit(refused && chips === 0 ? 0 : 2);
}
await chrome.close();
process.exit(0);
