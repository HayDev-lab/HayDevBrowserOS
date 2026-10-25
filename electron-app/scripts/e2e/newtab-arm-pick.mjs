import { chromium } from 'playwright-core';
const chrome = await chromium.connectOverCDP('http://127.0.0.1:9220');
const tab = chrome.contexts()[0].pages().find(p => /pab\.newtab|pab\.localhost\/newtab/i.test(p.url()));
console.log('tab url:', tab.url());
tab.evaluate(() => document.getElementById('sattach')?.click()).then(
  () => console.log('sattach clicked'),
  (e) => console.log('click err', String(e).slice(0, 80)),
);
setTimeout(() => process.exit(0), 1500);
