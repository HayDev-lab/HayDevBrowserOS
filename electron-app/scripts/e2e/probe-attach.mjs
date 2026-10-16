import { chromium } from 'playwright-core';
const chrome = await chromium.connectOverCDP('http://127.0.0.1:9220');
const shell = chrome.contexts()[0].pages().find(p => /tauri\.localhost/.test(p.url()));
const r = await shell.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /attach a file/i.test(x.getAttribute('aria-label') ?? x.textContent ?? ''));
  if (!b) return 'BUTTON_NOT_FOUND';
  b.click();
  return 'CLICKED';
});
console.log(r);
await chrome.close(); process.exit(0);
