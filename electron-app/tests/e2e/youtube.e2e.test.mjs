import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';

const fixture = `<!doctype html><title>YouTube fixture</title>
  <ytd-ad-slot-renderer id="banner">Advertisement</ytd-ad-slot-renderer>
  <div id="movie_player" class="html5-video-player"><video></video></div>
  <script>
    const video = document.querySelector('video');
    let position = 4;
    Object.defineProperty(video, 'duration', { get: () => 30 });
    Object.defineProperty(video, 'currentTime', { get: () => position, set: value => { position = value; } });
  </script>`;

const invoke = (page, command, args = {}) => page.evaluate(
  ([command, args]) => window.__TAURI_INTERNALS__.invoke(command, args), [command, args],
);

test('YouTube opens immediately and its Shield respects playback and site exceptions', { timeout: 90_000 }, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await app.launch();
  const shell = app.chromePage();
  await shell.waitForSelector('.commandbar__input');
  await shell.evaluate(() => localStorage.setItem('haydev.invidious.origin', 'https://obsolete.invalid/'));
  await app.chrome.contexts()[0].route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  assert.equal(await shell.getByRole('button', { name: 'HayDevVPN', exact: true }).count(), 1);
  assert.equal(await shell.getByRole('button', { name: /HDRezka|Invidious/i }).count(), 0);
  const pin = shell.getByRole('button', { name: 'Open YouTube', exact: true });
  await pin.evaluate(button => { for (let i = 0; i < 10; i += 1) button.click(); });
  const page = await app.waitTabPage(/^https:\/\/www\.youtube\.com\//);
  await page.waitForFunction(() => !!window.__haydevYoutubeShield);
  assert.equal(await shell.getByRole('region', { name: 'Invidious' }).count(), 0);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 4);
  assert.equal(await page.locator('#banner').evaluate(node => getComputedStyle(node).display), 'none');
  await pin.click();
  let tabs = await invoke(shell, 'browser_tabs_list');
  assert.equal(tabs.filter(tab => tab.url.startsWith('https://www.youtube.com/') || tab.pendingUrl.startsWith('https://www.youtube.com/')).length, 1);
  const pinnedTab = tabs.find(tab => tab.url.startsWith('https://www.youtube.com/'));
  assert.equal(await shell.locator(`.tab[data-tab-id="${pinnedTab.id}"]`).count(), 0);
  assert.equal(await pin.getAttribute('aria-pressed'), 'true');

  await page.locator('#movie_player').evaluate(player => player.classList.add('ad-showing'));
  await page.waitForFunction(() => document.querySelector('video').currentTime === 30);
  await invoke(shell, 'shield_set_enabled', { enabled: false });
  await page.locator('video').evaluate(video => { video.currentTime = 4; });
  await page.waitForTimeout(700);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 4);
  assert.notEqual(await page.locator('#banner').evaluate(node => getComputedStyle(node).display), 'none');
  await invoke(shell, 'shield_allow_site', { host: 'youtube.com' });
  await invoke(shell, 'shield_set_enabled', { enabled: true });
  await page.waitForTimeout(700);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 4);
  await invoke(shell, 'shield_disallow_site', { host: 'youtube.com' });
  await page.waitForFunction(() => document.querySelector('video').currentTime === 30);

  await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    player.classList.remove('ad-showing');
    document.querySelector('video').currentTime = 4;
    const skip = document.createElement('button');
    skip.className = 'ytp-skip-ad-button';
    skip.textContent = 'Skip';
    skip.onclick = () => { player.classList.remove('ad-showing'); window.skipped = true; };
    player.appendChild(skip);
    player.classList.add('ad-showing');
  });
  await page.waitForFunction(() => window.skipped === true);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 4);
  await shell.getByRole('button', { name: 'Close YouTube', exact: true }).click();
  await shell.waitForFunction(async id => {
    const tabs = await window.__TAURI_INTERNALS__.invoke('browser_tabs_list');
    return !tabs.some(tab => tab.id === id);
  }, pinnedTab.id);
  await pin.evaluate(button => { for (let i = 0; i < 10; i += 1) button.click(); });
  await shell.getByRole('button', { name: 'Close YouTube', exact: true }).waitFor();
  tabs = await invoke(shell, 'browser_tabs_list');
  assert.equal(tabs.filter(tab => tab.url.startsWith('https://www.youtube.com/') || tab.pendingUrl.startsWith('https://www.youtube.com/')).length, 1);
  writeFileSync(path.join(app.evidenceDir, 'youtube-fixture.json'), JSON.stringify({
    realWebView2: true, fixture: true, noConfiguration: true, singleTab: true,
    repeatedClicks: 10, singleVisibleEntry: true, closeAndReopen: true,
    normalPlaybackPreserved: true, adSkipped: true, shieldToggleRespected: true,
    siteExceptionRespected: true, vpnName: 'HayDevVPN',
  }, null, 2));
});

test('YouTube public video plays in WebView2', {
  timeout: 150_000, skip: process.env.HAYDEV_E2E_YOUTUBE_LIVE !== '1',
}, async t => {
  const app = new AppHandle();
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) {
      const observed = await page.evaluate(() => ({
        title: document.title,
        playerMessage: document.querySelector('#error-screen, #player-error-message-container')?.textContent?.trim(),
        hasVideo: !!document.querySelector('video'),
      })).catch(() => ({}));
      writeFileSync(path.join(app.evidenceDir, 'youtube-live-observed.json'), JSON.stringify(observed, null, 2));
      await page.screenshot({ path: path.join(app.evidenceDir, 'youtube-live.png') }).catch(() => {});
    }
    await app.stop();
  });
  await app.launch({ envOverrides: { GEMINI_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '' } });
  const shell = app.chromePage();
  await shell.getByRole('button', { name: 'Open YouTube', exact: true }).click();
  page = await app.waitTabPage(/youtube\.com/);
  await page.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const reject = page.getByRole('button', { name: /Reject all|Отклонить все/i }).first();
  if (await reject.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) await reject.click();
  const mainVideo = page.locator('#movie_player video.html5-main-video');
  await mainVideo.waitFor({ state: 'attached', timeout: 45_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('#movie_player video.html5-main-video');
    return video && video.readyState >= 2 && !video.error;
  }, undefined, { timeout: 45_000 });
  if (await mainVideo.evaluate(video => video.paused)) {
    await page.locator('#movie_player .ytp-play-button').click();
  }
  const before = await mainVideo.evaluate(video => video.currentTime);
  await page.waitForFunction(start => {
    const video = document.querySelector('#movie_player video.html5-main-video');
    return video && !video.paused && video.currentTime > start + 2 &&
      !document.querySelector('#movie_player')?.classList.contains('ad-showing');
  }, before, { timeout: 45_000 });
  const playback = await mainVideo.evaluate(video => ({
    currentTime: video.currentTime, readyState: video.readyState, width: video.videoWidth,
  }));
  writeFileSync(path.join(app.evidenceDir, 'youtube-live.json'), JSON.stringify({
    live: true, videoId: 'aqz-KE-bpKQ', realWebView2: true, playback,
  }, null, 2));
});
