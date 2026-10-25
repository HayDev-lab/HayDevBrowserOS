/**
 * N04 driver — release PDF/DOCX × {AgentPanel, internal newtab/search} with
 * REAL Windows file-dialog picks (the operator performs them via Computer
 * Use; HAYDEV_TEST_PICK_FILE is never set) and the local synthetic LLM as a
 * CONTENT VERIFIER: the `!!document` mode answers the corpus facts only if
 * the attached document text actually reached the provider prompt.
 *
 * Usage: node scripts/e2e/n04-driver.mjs <releaseExePath> <evidenceDir>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startFixtures, stopFixtures, fixtureServer } from './fixtures/server.mjs';

const [exe, evidenceDir] = process.argv.slice(2);
if (!exe || !evidenceDir) { console.error('usage: n04-driver <exe> <evidenceDir>'); process.exit(1); }
mkdirSync(evidenceDir, { recursive: true });
const CORPUS = 'D:\\Projects\\BrowserHayDev\\artifacts\\closure\\20261015-stabilization-r08\\documents';
const ALL = [
  { id: 'pdf-agent', doc: 'multilingual.pdf', ui: 'agent' },
  { id: 'docx-agent', doc: 'multilingual.docx', ui: 'agent' },
  { id: 'pdf-newtab', doc: 'multilingual.pdf', ui: 'newtab' },
  { id: 'docx-newtab', doc: 'multilingual.docx', ui: 'newtab' },
];
// N04_COMBO=<id|all> (default all) — run a single combo for operator-in-the-loop picks.
const COMBOS = process.env.N04_COMBO && process.env.N04_COMBO !== 'all'
  ? ALL.filter(c => c.id === process.env.N04_COMBO) : ALL;
const QUESTION = 'What amounts and cities are listed in the attached files? !!document';
const pause = ms => new Promise(r => setTimeout(r, ms));
function exists(page) { try { return page && !page.isClosed(); } catch { return false; } }
async function until(f, ms, message) { const end = Date.now() + ms; do { const v = await f(); if (v) return v; await pause(300); } while (Date.now() < end); throw new Error(message); }

const results = [];
import { existsSync as _ex, readFileSync as _rf } from 'node:fs';
const seenFile = path.join(evidenceDir, 'n04-summary.json');
const seen = (_ex(seenFile) ? JSON.parse(_rf(seenFile, 'utf8')).results : []).filter(r => !r.error);
for (const combo of COMBOS) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'haydev-n04-'));
  const fixture = await startFixtures();
  let browser = null; let proc = null;
  try {
    const env = {
      ...process.env,
      HAYDEV_DATA_DIR: dataRoot, HAYDEV_QA_MODE: '1', HAYDEV_AUTOMATION_DEBUG: '1', HAYDEV_NO_ENGINES: '1',
      MCP_SERVER_PORT: '27901', PAB_SEARXNG_URL: fixtureServer.url('/searxng'),
      AI_PROVIDER: 'gemini', GEMINI_BASE_URL: fixtureServer.url('/v1'), GEMINI_API_KEY: 'e2e-fake-key-not-real',
      PROBE: '0', RUNTIME_ACCEPTANCE: '0', GEMINI_CERT: '0', DIAG_SEARCH: '0',
    };
    const appLog = path.join(evidenceDir, 'n04-app.log');
    const appOut = openSync(appLog, 'a');
    proc = spawn(exe, [], { env, cwd: path.dirname(exe), stdio: ['ignore', appOut, appOut] });
    await until(async () => { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9220'); return true; } catch { return false; } }, 45000, 'CDP did not come up');
    const ctx = browser.contexts()[0];
    const shell = await until(async () => ctx.pages().find(p => /tauri\.localhost/.test(p.url())), 30000, 'shell not found');
    await shell.waitForSelector('.commandbar__input', { timeout: 30000 });

    // Arm the combo UI, then hand the REAL dialog to the operator.
    if (combo.ui === 'agent') {
      await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('control_set_mode', { mode: 'AGENT' }));
      await pause(500);
      await shell.evaluate(() => [...document.querySelectorAll('button')].find(b => /attach a file/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '')).click());
    } else {
      const tab = ctx.pages().find(p => /pab\.newtab|pab\.localhost\/newtab/i.test(p.url()));
      await tab.evaluate(() => document.getElementById('sattach')?.click());
    }
    console.log(`[N04] READY ${combo.id} — pick ${CORPUS}\\${combo.doc} in the REAL dialog now`);

    // Wait for the pick to land.
    let newtabTab = null;
    const findNewtab = () => ctx.pages().find(p => /pab\.newtab|pab\.localhost\/newtab/i.test(p.url()))
      ?? ctx.pages().find(p => /newtab/i.test(p.url()));
    await until(async () => {
      if (combo.ui === 'agent') return (await shell.locator('.agent-panel__attachment').count()) > 0;
      newtabTab = findNewtab();
      if (!newtabTab) return false;
      return await newtabTab.evaluate(() => document.querySelectorAll('.chip, [aria-label^="Remove attachment"]').length > 0);
    }, 240000, `attachment for ${combo.id} never appeared`).then(() => console.log(`[N04] ATTACHED ${combo.id}`));

    // Ask through the SAME UI path (panel ids / newtab bridge ride along).
    if (combo.ui === 'agent') {
      const tabIdData = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_tabs_list'));
      const active = (Array.isArray(tabIdData) ? tabIdData : []).find(x => x.isActive);
      const staticUrl = fixtureServer.url('/static');
      await shell.evaluate(([id, url]) => window.__TAURI_INTERNALS__.invoke('browser_navigate', { req: { tabId: id, url } }), [active.id, staticUrl]).catch(() => {});
      await pause(2500);
      const mode = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('control_set_mode', { mode: 'AGENT' }));
      if (!mode.accepted) throw new Error('AGENT mode refused: ' + JSON.stringify(mode));
      await pause(400);
      const box = shell.locator('.agent-panel__input').first();
      await box.fill(QUESTION);
      await pause(300);
      await shell.evaluate(() => document.querySelector('.agent-panel__send')?.click());
    } else {
      const tab = (newtabTab && exists(newtabTab)) ? newtabTab : findNewtab();
      if (!tab) throw new Error('newtab page lost after attach; pages=' + ctx.pages().map(p => p.url()).join(' | '));
      await tab.evaluate(q => { const i = document.getElementById('sinput'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }, QUESTION);
      await pause(300);
      await tab.evaluate(() => document.getElementById('sgo')?.click());
    }

    let timeline = null;
    let lastState = null;
    await until(async () => {
      try {
        const status = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('agent_status'));
        lastState = status?.state ?? JSON.stringify(status).slice(0, 80);
        timeline = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('agent_timeline_list')) ?? [];
      } catch (e) { lastState = 'EVAL_ERR ' + String(e).slice(0, 80); }
      return ['IDLE', 'DONE', 'FAILED', 'STOPPED', 'WAITING_FOR_HUMAN'].includes(lastState)
        || Array.isArray(timeline) && timeline.some(e => e.kind === 'final_answer');
    }, 90000, [
      'run did not finish',
      'lastState=' + lastState,
      'fixtureRequests=' + fixtureServer.observations.requests.join(',').slice(-160),
      'timelineNull=' + (timeline === null),
    ].join(' | '));
    await pause(800);
    const finalTimeline = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('agent_timeline_list'));
    const finalEntry = [...(finalTimeline ?? timeline ?? [])].reverse().find(e => e.kind === 'final_answer');
    const report = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('agent_research_report'));
    const answer = String(finalEntry?.fullText ?? finalEntry?.full_text ?? finalEntry?.summary ?? JSON.stringify(report ?? ''));

    const verdict = {
      combo: combo.id, doc: combo.doc, ui: combo.ui,
      answer: answer.slice(0, 160),
      contentVerified: answer.includes('7319 AMD') && answer.includes('Москва') && !answer.includes('DOCUMENT_CONTENT_MISSING'),
    };
    results.push(verdict);
    console.log(`[N04] RESULT ${JSON.stringify(verdict)}`);
    writeFileSync(path.join(evidenceDir, `n04-${combo.id}.json`), JSON.stringify(verdict, null, 2) + '\n');
  } catch (e) {
    const verdict = { combo: combo.id, error: String(e).slice(0, 220) };
    results.push(verdict);
    writeFileSync(path.join(evidenceDir, `n04-${combo.id}.json`), JSON.stringify(verdict, null, 2) + '\n');
    console.log(`[N04] ERROR ${combo.id}: ${verdict.error}`);
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    const { execSync } = await import('node:child_process');
    try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ }
    await stopFixtures().catch(() => {});
    await pause(1500);
    rmSync(dataRoot, { recursive: true, force: true });
  }
}
writeFileSync(path.join(evidenceDir, 'n04-summary.json'), JSON.stringify({ results, allVerified: results.every(r => r.contentVerified === true) }, null, 2) + '\n');
console.log('[N04] DONE allVerified=' + [...seen, ...results].every(r => r.contentVerified === true));
process.exit(0);
