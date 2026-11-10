(() => {
  if (window.top !== window || location.protocol !== 'https:' ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(location.hostname)) return;
  if (window.__haydevYoutubeShield) return;

  let enabled = false;
  let observer = null;
  let interval = null;
  let pending = null;
  let style = null;

  function inspectPlayer() {
    pending = null;
    if (!enabled) return;
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!player || (!player.classList.contains('ad-showing') &&
        !player.classList.contains('ad-interrupting'))) return;

    const skip = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skip && !skip.disabled && skip.getAttribute('aria-disabled') !== 'true' && skip.getClientRects().length) {
      skip.click();
      return;
    }
    const video = player.querySelector('video');
    if (video && Number.isFinite(video.duration) && video.duration > 0 &&
        video.currentTime + 0.25 < video.duration) {
      try { video.currentTime = video.duration; } catch { /* Wait for seekable media. */ }
    }
  }

  function schedule() {
    if (pending === null) pending = setTimeout(inspectPlayer, 100);
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    clearInterval(interval);
    clearTimeout(pending);
    interval = null;
    pending = null;
    style?.remove();
    style = null;
  }

  function start() {
    if (!enabled || observer || !document.documentElement) return;
    style = document.createElement('style');
    style.textContent = 'ytd-ad-slot-renderer, ytd-display-ad-renderer, ' +
      'ytd-promoted-sparkles-web-renderer, ytd-in-feed-ad-layout-renderer, ' +
      '#player-ads, .ytp-ad-overlay-container { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['class'] });
    interval = setInterval(inspectPlayer, 500);
    inspectPlayer();
  }

  Object.defineProperty(window, '__haydevYoutubeShield', { value: {
    setEnabled(value) {
      enabled = value === true;
      if (enabled) start(); else stop();
    },
  }, configurable: true });
  addEventListener('pagehide', stop);
  addEventListener('pageshow', start);
})();
