/**
 * Matrix digital-rain background — shared canvas snippet for pab:// pages.
 *
 * A fixed full-screen <canvas> behind the page content painting a SUBDUED
 * variant of the classic falling-glyph rain: the Matrix NTP spec asks for
 * "существенно темнее классической Matrix" (noticeably darker than the
 * classic), so the glyph greens are dimmed, trails are shorter, and only
 * rare head glyphs flare bright. Three depth tiers (slow+dim, mid, faster
 * + brighter heads) give parallax without extra canvases.
 *
 * Self-contained: no external resources, no libraries. Respects
 * prefers-reduced-motion (renders a single static frame instead of
 * animating) and caps the frame rate to ~30fps to stay light.
 *
 * Pure — template strings only, no Electron imports.
 */

export const MATRIX_RAIN_CANVAS = `<canvas id="matrix-rain" aria-hidden="true" style="position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;"></canvas>`;

export function buildMatrixRainScript(): string {
  return `(function () {
  if (window.__matrixRain) return;
  window.__matrixRain = true;
  var canvas = document.getElementById('matrix-rain');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFXYZ$#@+=*';
  var FONT = 15;
  // Depth tiers: dim slow rain in the back, brighter heads up front.
  // The concept art rains TEAL/CYAN (matching the #00FFD1 accent), darker
  // than classic Matrix green; rare bright heads flare.
  var TIERS = [
    { alpha: 0.28, speed: 0.55, color: '#0d5560', bright: '#39d8c8', brightP: 0.008 },
    { alpha: 0.40, speed: 0.80, color: '#0e7480', bright: '#5fffe0', brightP: 0.014 },
    { alpha: 0.52, speed: 1.00, color: '#00a08e', bright: '#8dffe9', brightP: 0.020 }
  ];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    paintBase();
  }
  function paintBase() {
    ctx.fillStyle = '#03070b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  var drops, tiers, cols;
  function seed() {
    cols = Math.ceil(canvas.width / FONT);
    drops = [];
    tiers = [];
    for (var i = 0; i < cols; i++) {
      drops[i] = Math.floor(Math.random() * -60);
      tiers[i] = Math.floor(Math.random() * TIERS.length);
    }
  }

  function glyph() {
    return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
  }

  function step() {
    // Translucent page-black over the frame → short fading trails that
    // dissolve into the dark Matrix background instead of persisting.
    ctx.fillStyle = 'rgba(3, 7, 11, 0.14)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = FONT + 'px monospace';
    for (var i = 0; i < cols; i++) {
      var t = TIERS[tiers[i]];
      var x = i * FONT;
      var y = drops[i] * FONT;
      if (Math.random() < t.brightP) {
        ctx.fillStyle = t.bright;
        ctx.globalAlpha = Math.min(1, t.alpha + 0.25);
      } else {
        ctx.fillStyle = t.color;
        ctx.globalAlpha = t.alpha;
      }
      ctx.fillText(glyph(), x, y);
      ctx.globalAlpha = 1;
      if (y > canvas.height && Math.random() < 0.03) drops[i] = Math.floor(Math.random() * -40);
      else drops[i] += t.speed;
    }
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  resize();
  seed();
  if (reduced) {
    // Static frame — no animation for reduced-motion users.
    for (var k = 0; k < 90; k++) step();
  } else {
    var last = 0;
    (function loop(ts) {
      if (ts - last >= 33) { step(); last = ts; }   // ~30fps cap
      requestAnimationFrame(loop);
    })(0);
  }
  window.addEventListener('resize', function () { resize(); seed(); });
})();`;
}
