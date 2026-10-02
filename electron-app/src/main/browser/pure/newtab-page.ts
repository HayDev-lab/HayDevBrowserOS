/**
 * New Tab Page — pure template builder for the internal pab://newtab page.
 *
 * MATRIX NTP (1:1 with the agreed concept): the page is the real New Tab of
 * PAB (startup, "+", Ctrl+T — all routes load pab://newtab). Layout:
 *
 *   matrix rain (z0) → CSS sphere body (z1) → WebGL planet (z2, bottom
 *   anchored, large) → readability gradient (z3) → hero UI (z4):
 *     HAYDEV BROWSER OS / SAME INTERNET. DEEPER INTELLIGENCE.
 *     big clock + date → glass universal search (icon · input · attach ·
 *     image · submit) → engine CARDS (title + subtitle) → category chips →
 *     corner mottos → TODAY IN TECH news strip (real Hacker News top
 *     stories fetched MAIN-side; offline → quiet empty state).
 *
 * Engine routing is REAL:
 *   - HayDev Search      → pab://search?q=…   (Perplexica runtime)
 *   - Perplexity Search  → pab://search?q=…   (same engine, alt branding)
 *   - Deep/Dark Web      → pab://darkweb?q=…  (Tor-gated Ahmia/Tor66)
 *   - attachments        → always the agent pipeline (only engine that can
 *                          consume files/images); Deep Research runs there.
 *
 * SECURITY:
 *   - Top-site URLs/titles and news items are HTML-escaped plain links;
 *     news titles come from HN and never touch script context.
 *   - No query-string reflection; the template takes no user input.
 *   - The optional __pabNewTab bridge is injected by the tab preload ONLY
 *     on pab://newtab documents and re-validated in main.
 *
 * Pure — no Electron imports.
 */
import type { HistoryEntry } from '@shared/browser-types';
import type { TechNewsItem } from './tech-news';
import {
  MATRIX_RAIN_CANVAS,
  buildMatrixRainScript,
} from './matrix-rain';
import { PLANET_CANVAS, buildPlanetScript } from './planet';

export interface TopSite {
  url: string;
  title: string;
}

const MAX_TITLE_LENGTH = 40;

/** HayDev logo mark — data-URIs keep the generated page self-contained
 * (byte-identical output shared by the Electron and Tauri runtimes). */
const HERO_LOGO_DATA_URI = 'data:image/png;base64,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';
const FAVICON_DATA_URI = 'data:image/png;base64,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';

/** HTML-escape a string for safe interpolation into the template. */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compute the top sites from history: http(s) URLs only, grouped by
 * hostname (visit counts summed, most recent title wins), sorted by
 * total visits. Internal pages (pab://) and about: pages are excluded.
 */
export function computeTopSites(history: HistoryEntry[], limit = 8): TopSite[] {
  const byHost = new Map<string, { url: string; title: string; visits: number; last: number }>();
  for (const entry of history) {
    if (!/^https?:\/\//i.test(entry.url)) continue;
    let host: string;
    try {
      host = new URL(entry.url).hostname;
    } catch {
      continue;
    }
    if (!host) continue;
    const current = byHost.get(host);
    if (!current) {
      byHost.set(host, {
        url: entry.url,
        title: entry.title || host,
        visits: entry.visitCount,
        last: entry.visitedAt,
      });
    } else {
      current.visits += entry.visitCount;
      if (entry.visitedAt >= current.last) {
        current.last = entry.visitedAt;
        current.url = entry.url;
        current.title = entry.title || host;
      }
    }
  }
  return [...byHost.values()]
    .sort((a, b) => b.visits - a.visits || b.last - a.last)
    .slice(0, Math.max(1, limit))
    .map((s) => ({
      url: s.url,
      title: s.title.length > MAX_TITLE_LENGTH ? s.title.slice(0, MAX_TITLE_LENGTH - 1) + '…' : s.title,
    }));
}

/** Build the complete self-contained Matrix New Tab HTML. */
export function buildNewTabHtml(topSites: TopSite[], news: TechNewsItem[] = []): string {
  const tiles = topSites
    .map(
      (s) => `        <a class="tile" href="${escapeHtml(s.url)}" title="${escapeHtml(s.url)}">
          <span class="tile__host">${escapeHtml(hostOf(s.url))}</span>
          <span class="tile__title">${escapeHtml(s.title)}</span>
        </a>`
    )
    .join('\n');

  const tilesBlock =
    topSites.length > 0
      ? `      <div class="sites">\n        <div class="sites__label">FREQUENT SITES</div>\n        <div class="grid">\n${tiles}\n        </div>\n      </div>`
      : '';

  const newsCards = news
    .map(
      (n) => `      <a class="news__card" href="${escapeHtml(n.url)}" title="${escapeHtml(n.title)}">
        <span class="news__rank">${escapeHtml(n.rank)}</span>
        <span class="news__tile" aria-hidden="true">${escapeHtml(n.sourceKey)}</span>
        <span class="news__body">
          <span class="news__title">${escapeHtml(n.title)}</span>
          ${n.age ? `<span class="news__age">${escapeHtml(n.age)}</span>` : ''}
        </span>
      </a>`
    )
    .join('\n');

  const newsBlock =
    news.length > 0
      ? `  <a class="news__card news__card--lead" href="pab://search" >
    <span class="news__lead-dot" aria-hidden="true"></span>
    <span class="news__body">
      <span class="news__lead-title">Today in Tech</span>
      <span class="news__lead-sub">Latest updates for your workflow</span>
    </span>
  </a>
${newsCards}`
      : `  <div class="news__card news__card--lead news__card--static">
    <span class="news__lead-dot" aria-hidden="true"></span>
    <span class="news__body">
      <span class="news__lead-title">Today in Tech</span>
      <span class="news__lead-sub">No connection — headlines will appear when online.</span>
    </span>
  </div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<title>New Tab</title>
<style>
  :root {
    color-scheme: dark;
    --mx-bg: #03070b;
    --mx-panel: #071019;
    --mx-panel-2: #09141d;
    --mx-text: #dce7ee;
    --mx-text-2: #8195a6;
    --mx-text-3: #556a80;
    --mx-teal: #00ffd1;
    --mx-green: #00e89d;
    --mx-line: rgba(38, 66, 90, 0.55);
    --mx-glass: rgba(9, 20, 29, 0.62);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: #03070b;
    color: #dce7ee;
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    overflow: hidden;
  }
  :focus-visible { outline: 2px solid rgba(0, 255, 209, 0.65); outline-offset: 2px; }

  /* ---- planet layers (bottom anchored, like the concept) -------------- */
  #planet-shell {
    position: absolute; left: 50%; top: 78%;
    width: 300px; height: 300px;            /* sized by JS */
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle at 34% 26%,
      rgba(10, 30, 40, 0.94) 0%, rgba(5, 14, 21, 0.9) 55%, rgba(2, 8, 12, 0.96) 100%);
    box-shadow:
      inset 0 0 80px rgba(0, 255, 209, 0.06),
      inset -30px -18px 110px rgba(0, 0, 0, 0.62),
      0 0 110px rgba(0, 190, 160, 0.10);
    z-index: 1; pointer-events: none;
  }
  #planet-canvas {
    position: absolute; left: 50%; top: 78%;
    transform: translate(-50%, -50%);
    z-index: 2; pointer-events: none;
  }
  .readability {
    position: fixed; inset: 0; z-index: 3; pointer-events: none;
    background: radial-gradient(ellipse 56% 50% at 50% 42%,
      rgba(3, 7, 11, 0.82) 0%, rgba(3, 7, 11, 0.38) 55%, rgba(3, 7, 11, 0) 78%);
  }

  /* ---- page column ----------------------------------------------------- */
  .page {
    position: relative; z-index: 4;
    min-height: 100vh;
    display: flex; flex-direction: column;
  }
  .content {
    flex: 1;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 26px; padding: 34px 32px 10px;
  }
  .hero { text-align: center; }
  .hero__logo img {
    width: clamp(44px, 4.4vw, 62px); height: auto; display: block;
    margin: 0 auto 10px; filter: drop-shadow(0 0 18px rgba(0, 255, 209, 0.22));
  }
  .hero__brand {
    font-size: clamp(22px, 2.9vw, 40px);
    font-weight: 700; letter-spacing: 0.34em; text-indent: 0.34em;
    text-transform: uppercase; color: #dce7ee;
    text-shadow: 0 0 28px rgba(0, 255, 209, 0.16);
    white-space: nowrap;
  }
  .hero__tag {
    margin-top: 12px;
    font-size: clamp(10px, 0.95vw, 13px);
    font-weight: 600; letter-spacing: 0.44em; text-indent: 0.44em;
    text-transform: uppercase; color: #00ffd1; opacity: 0.92;
    white-space: nowrap;
  }
  .clock { text-align: center; }
  .clock__time {
    font-size: clamp(58px, 8.6vw, 116px); font-weight: 600; letter-spacing: 0.05em;
    font-variant-numeric: tabular-nums; color: #dce7ee;
    text-shadow: 0 0 40px rgba(0, 255, 209, 0.14);
  }
  .clock__date {
    margin-top: 4px; font-size: 13px; letter-spacing: 0.30em; text-indent: 0.30em;
    text-transform: uppercase; color: #8195a6;
  }

  /* ---- universal search ------------------------------------------------ */
  .search-wrap { width: min(760px, 90vw); display: flex; flex-direction: column; gap: 10px; }
  .search {
    display: flex; align-items: center; gap: 4px;
    height: 58px; padding: 0 8px 0 18px;
    border-radius: 999px;
    background: rgba(9, 20, 29, 0.62);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(0, 255, 209, 0.22);
    box-shadow: 0 10px 44px rgba(0, 0, 0, 0.45);
    transition: border-color 160ms ease-out, box-shadow 160ms ease-out;
  }
  .search:focus-within {
    border-color: rgba(0, 255, 209, 0.55);
    box-shadow: 0 0 0 1px rgba(0, 255, 209, 0.22),
      0 0 30px rgba(0, 255, 209, 0.14),
      0 10px 44px rgba(0, 0, 0, 0.45);
  }
  .search__icon {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; color: #556a80; cursor: pointer;
    background: none; border: none; flex: none;
  }
  .search input {
    flex: 1; min-width: 0; height: 100%;
    background: transparent; border: none; outline: none;
    color: #dce7ee; font-size: 15px; letter-spacing: 0.01em;
  }
  .search input::placeholder { color: #556a80; }
  .search__btn {
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 50%;
    color: #8195a6; background: transparent;
    border: 1px solid transparent; cursor: pointer; flex: none;
    transition: color 140ms ease-out, background 140ms ease-out,
      border-color 140ms ease-out;
  }
  .search__btn:hover, .search__btn:focus-visible {
    color: #00ffd1; background: rgba(0, 255, 209, 0.08);
    border-color: rgba(0, 255, 209, 0.30);
  }
  .search__submit {
    width: 44px; height: 44px;
    color: #00ffd1; background: rgba(0, 232, 157, 0.10);
    border: 1px solid rgba(0, 232, 157, 0.45);
    box-shadow: 0 0 18px rgba(0, 232, 157, 0.22);
  }
  .search__submit:hover, .search__submit:focus-visible {
    background: rgba(0, 232, 157, 0.20); color: #b8ffe9;
    border-color: rgba(0, 232, 157, 0.7);
  }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chips:empty { display: none; }
  .chip {
    display: inline-flex; align-items: center; gap: 8px;
    max-width: 320px; padding: 5px 8px 5px 6px;
    border-radius: 999px;
    background: rgba(9, 20, 29, 0.85);
    border: 1px solid rgba(38, 66, 90, 0.7);
    font-size: 11px; color: #8195a6;
  }
  .chip img { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex: none; }
  .chip__dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(0, 232, 157, 0.6); flex: none; margin: 0 4px; }
  .chip__name { color: #dce7ee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip__meta { flex: none; }
  .chip__remove {
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%; flex: none;
    color: #8195a6; background: none; border: none; cursor: pointer;
    font-size: 13px; line-height: 1;
  }
  .chip__remove:hover { color: #ff8fa3; background: rgba(255, 77, 109, 0.12); }

  .status {
    min-height: 16px; font-size: 11.5px; letter-spacing: 0.04em;
    color: #8195a6; text-align: center;
  }
  .status--err { color: #ff9d7a; }

  /* ---- engine cards ----------------------------------------------------- */
  .engines { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
  .engine {
    display: flex; align-items: center; gap: 12px;
    width: 232px; padding: 12px 14px; border-radius: 12px;
    text-align: left; color: #8195a6;
    background: rgba(9, 20, 29, 0.5);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(38, 66, 90, 0.55);
    cursor: pointer;
    transition: color 140ms ease-out, border-color 140ms ease-out,
      background 140ms ease-out;
  }
  .engine:hover { color: #b8cbd9; border-color: rgba(60, 96, 128, 0.7); }
  .engine__icon {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; flex: none; color: currentColor;
  }
  .engine__title { display: block; font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em; }
  .engine__sub { display: block; margin-top: 2px; font-size: 10.5px; color: #556a80; }
  .engine[aria-checked="true"] {
    color: #00ffd1; border-color: rgba(0, 255, 209, 0.5);
    background: rgba(0, 232, 157, 0.08);
    box-shadow: inset 0 0 24px rgba(0, 255, 209, 0.05),
      0 0 22px rgba(0, 232, 157, 0.10);
  }
  .engine[aria-checked="true"] .engine__sub { color: rgba(0, 255, 209, 0.6); }

  /* ---- category chips ----------------------------------------------------- */
  .cats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .cat {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 999px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
    color: #8195a6; background: rgba(9, 20, 29, 0.45);
    border: 1px solid rgba(38, 66, 90, 0.5);
    cursor: pointer;
    transition: color 140ms ease-out, border-color 140ms ease-out;
  }
  .cat:hover { color: #b8cbd9; }
  .cat[aria-pressed="true"] {
    color: #00ffd1; border-color: rgba(0, 255, 209, 0.45);
    background: rgba(0, 232, 157, 0.07);
  }

  /* ---- frequent sites ------------------------------------------------------ */
  .sites { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .sites__label {
    font-size: 10px; font-weight: 600; letter-spacing: 0.30em; text-indent: 0.30em;
    text-transform: uppercase; color: #556a80;
  }
  .grid { display: grid; grid-template-columns: repeat(4, 160px); gap: 10px; justify-content: center; }
  .tile {
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px 12px; border-radius: 10px; text-decoration: none;
    background: rgba(9, 20, 29, 0.55);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(38, 66, 90, 0.5);
    transition: border-color 150ms ease-out, box-shadow 150ms ease-out,
      transform 150ms ease-out;
  }
  .tile:hover {
    border-color: rgba(0, 255, 209, 0.4);
    box-shadow: 0 0 18px rgba(0, 255, 209, 0.14);
    transform: translateY(-2px);
  }
  .tile__host {
    font-size: 12px; font-weight: 600; color: #00ffd1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tile__title {
    font-size: 10.5px; color: #8195a6; line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; min-height: 2.7em;
  }

  /* ---- corner mottos -------------------------------------------------------- */
  .motto { position: fixed; bottom: 96px; z-index: 4; pointer-events: none; }
  .motto--left {
    left: 26px; text-align: left;
    font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase;
    color: #556a80; line-height: 1.8;
  }
  .motto--left em { font-style: normal; color: #556a80; }
  .motto--right {
    right: 26px; text-align: right;
    font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase;
    color: #556a80; line-height: 1.8;
  }
  .motto__bar { display: inline-block; margin-top: 6px; width: 34px; height: 2px; background: rgba(0, 232, 157, 0.6); }

  /* ---- today in tech strip ---------------------------------------------------- */
  .news {
    position: relative; z-index: 4;
    display: grid;
    grid-template-columns: minmax(200px, 1.1fr) repeat(4, 1fr);
    gap: 10px;
    padding: 10px 14px 12px;
  }
  .news__card {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border-radius: 10px; text-decoration: none;
    background: rgba(9, 20, 29, 0.6);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(38, 66, 90, 0.5);
    transition: border-color 150ms ease-out;
    min-width: 0;
  }
  .news__card:hover { border-color: rgba(0, 255, 209, 0.4); }
  .news__card--lead { border-color: rgba(38, 66, 90, 0.65); }
  .news__lead-dot {
    width: 9px; height: 9px; border-radius: 50%; flex: none;
    background: #00e89d; box-shadow: 0 0 10px rgba(0, 232, 157, 0.7);
  }
  .news__lead-title { display: block; font-size: 12.5px; font-weight: 700; color: #dce7ee; }
  .news__lead-sub { display: block; margin-top: 2px; font-size: 10.5px; color: #556a80; }
  .news__rank { flex: none; font-size: 15px; font-weight: 700; color: #556a80; }
  .news__tile {
    flex: none; width: 44px; height: 44px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700; color: rgba(0, 255, 209, 0.85);
    background:
      radial-gradient(circle at 30% 30%, rgba(0, 232, 157, 0.30), transparent 65%),
      radial-gradient(circle at 70% 75%, rgba(0, 160, 210, 0.22), transparent 60%),
      #0a1a24;
    border: 1px solid rgba(38, 66, 90, 0.6);
  }
  .news__body { min-width: 0; }
  .news__title {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 11.5px; font-weight: 600; color: #dce7ee; line-height: 1.35;
  }
  .news__age { display: block; margin-top: 3px; font-size: 10px; color: #556a80; }

  @media (max-width: 1120px) {
    .news { grid-template-columns: repeat(2, 1fr); }
    .news__card--lead { grid-column: 1 / -1; }
  }
  @media (max-height: 760px) {
    .content { gap: 14px; padding: 18px 24px 6px; }
    .clock__time { font-size: 52px; }
    .grid { grid-template-columns: repeat(4, 140px); }
    .tile { padding: 9px 10px; }
    .motto { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tile, .search, .engine, .cat, .news__card, .search__btn { transition: none; }
  }
</style>
</head>
<body>
  ${MATRIX_RAIN_CANVAS}
  ${PLANET_CANVAS}
  <div class="readability" aria-hidden="true"></div>
  <div class="page">
    <main class="content">
      <header class="hero">
        <div class="hero__logo" aria-hidden="true"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAABDjSURBVHhe7ZsHrGdFFYfpSO+99957770XQUCaCKiACBI6SBMUQUApQQyCIqGpgKIgQpQmRYyADY1BkCKCdKTv+n1nz0zu/Zf33r7dh6vxl/xyppy5Ze6UM2fmTvR/TAAYPXr0xBkMEJ88gxWdOv8TGDVq1KJwc/gpeBI8F14AvwW/Ds+Hp8Ej4B5wBSpiJuSUeYn/LvDgs8GN4THwJ/AZ+B4vNSjQE8/DX0ArahuSF8xLT7jgISfnYZeCX4C/jrdJEI+XR/4LvgZfgs9H5ujRrxB+OcM9Qf4j8HCCC+ftJgzwQBPDj8B1ecAr4RuEK4i/DR+HP4X3wu/Cb8Oz4DnwO/A8aDe4nCJXIH8PX4StawnS/gZPJDhnPsJ/FjyMX/z6MY83BsTfgm/CdzP+AXwP/hgeBveH28JPwpVQ2RB5AHIV5PJwVcIHIS9F/hz5LLIF0h6FexCcLB/lwwU3npgHcMD6K/SL+TV3givA+eDc6CyMXAceCC+Gd0Ob8pfh6nAtaP7y6sI5CTtYzpxlt4BebzN4EXyC9BZI+yacOR/rwwE3XAJemFwrkwcFzzs1+tsij4WnEN4OrgTnJT4TtCtNQXxuOAvhaSXheeAacE1oRbxOegXxe+CieZuRBTeyiX4M+gXn4v7DaoJZ/hDolGcFzIicCk5D2MF0SuSk0EqbElohTosLwNPhc8QriP8RrpSXH//gHjb5hZALIhdA2m+nz+xBgb4v02XgkObg6XiwGuFpM7noyymgA+0k3g9phcwLD4BXE68g/iRcOS8x/sC1bZpLwhmMc5NdTYtMQNiHcnS/hXDPaYr0eImMtkC56eHacCPDpqE7aWQmsnzMOOhM5bWQtsZrCFcQtyUsk8XGHVzTfrgunCnjvuxOGY4vijyWtMfgw/AW03qh6PcDZReHe8Id0I3WgKxdjHBUCtJKcOC0SziIOhC+TzxA+A44SxQaF3AtB6Ctkd4ovgxyWdNCIUHcEd6ZwEo4O5N7gmvZmqaGPVuD4Bp2ia/CQ9FrVYA0TN6ihDdFzoG0W96IrCB+ThQaLriGTcyXrwYHced8p7SoXfImI2xf3AHuA33gAb8y+fZpW9HScBHotOd1ldL+7UC4JFJj6VZ4TMZnhrOknCblPOTNDx2T7kMGCGuDbJq3HXtwgZ25gAOUD+MAaP/cF06V+bPDz8EBp0HK1i+NrvaBc/9meW0rwTRHeGcBx4LpjBvOMptAjR7N5+9n3Jd3xpiOcrMirQjjexOvIG6XHPuuQCFf1q85CfRrOe3tkNnmLwePJK/vAoU8m3q0BnSXgRpJW8LFzQulBtQ1nXwrvNU9iDstuop8GWplan84TtgqlkJaCQ6MVuptyArix+RlhgYKaIRok88IZyB8MKxfmXAsacmrU1YnyJtCid5ccHe4C5w7MvuAMlEB0JdZDC5L2KbdbEF+ac3jAOE7ocvobeByJFkhjh8vjNEIHVeh8+UlBgb6NvWjoH1yDngIaTGtIR0TPg53C+UesHxKxwatPCtvWBYa17DybWleZ/VMDhC3GzX7uwsnzezPQ+/5eGYFiJ+KGHBsCqDo1z0wwzbZqDkKTw73I76e8YGAnjOHzXW7TKoVMxxQ1m5h1zme8IqZHCDNhdVrpFcQdxH2LHwnk0x7EjFrFusNlByAvghjYYF0EAx3FXJ+4tsb7gXyS1+31RwOl4+M8Qiu6Yyh9+j4TAoQXwj+gGcYEOgckUV6AwWXljtCu4Ej6i6ZZZ4WV8+vr76SfG10m+BckTEC4F4ulDR6bocLZXKA+N6wOFi6QN79qdoN8rX2tOacViZF+iXrFye8HoyFBvlOV1shqzMz9XV9zZFJIwruczXU7m+1SuLaED1bA+nvpFo3yLSPxeCGri3AQXCjyASEHWVdADkdfQ/+DF5pHml+lZPND+UPAdzLleKvkPoN/TjTZVaA+Gfgm+i0kNltkO7ornWnSRkDBWHX3XVpSVg7QAPFrvEg1PS9L/OcNdYOReD1MlhB2rAHwX7gnna51+FDXH9DGGuVAtJ1pDxGekVmtYGSc275+mGgEN+T8PwZtjXsQ1yjyBH+MujKz4WLLedo9QrQsZWY5wPo2tbT09fuL0BnrCuJ6x9MOXEF1H7wI9ZVJ3E/2g0qiCjUCRS041fNqHHdTzGFIX0RnRbTZFxTM6w/pDf8EVKDqcwWVpJd4pfIgDrmDQZUY+zJ6KBAX1vDsecB+DZxB3ANJxdaLd8D+RcS764A0sK4QU5tnLBWVCx1kb78J2DY/uisSHhnw4LwtaQdlNEAaXpuZNNI+WFmDwrUv4T+kRketEWog/5ueR89zvoUtsw8P0b4EIyTHmNWC2T6FcPGtyDcPdM1KTVmystrjNjcoosgtbmfgNrtzeWqpqy6dyMDhG/K7EGB7leyzCbGCQ7YdcifDOpI/S3U8+zYpMvdFWKnQ6Vr/eENVybDZeQiyP0yzSXpgcRLq3Dgc8m7uHFB+D54QUYrKGPzV3+4FaDJapl/QtcCQ/I3ontylnsK2iUOy6wKsrsrE8UtydDbswoMM5M07f2y5NU9rX9+CeNCPejNuhyQJNuP7QL3qCMIj00FnJbFLPc7GEvxzO4L9NbIMq4Ur4cPEI0P2BdeGMUtkC46dEiWCghvD3ENHjcu5jVeQPwa+Cr5vXZ1HXycBe5FBgjrqTE9PEHEw6GRReI5Mui1zyAeIKxDY9DdH3R8D1eJf8lyvrzS/cT+lUemD2oLsNnqc1/WdGSpAMeBOr8L4k4r78JbM6kFbwgdWJuDoJaZXiArWv/9c/BpeBvcIMuVaet0ywjCOkBmN30woO64c3OWczywG1yWeb0rAQWbqt5dH3hVuHSmb5XSsWANwwXEd8mbnJtJPUF+swL04ngvNzeeyuQAcbfLNiYYfZ3woBVAVtcLmYbu+VnO7Tf9BLaI1kDYApl+EW16+63TR7iSTUtpBaxpuIC4jhJv0jJ+OkF+Zwuwtekc6VqskPYgolRAswu0KoAkpzWf2b2Brkog3Q3TuB+0At6BrQVTC2Q6Wm+RYV3LpQVsk7JVAT4A8T/kTQ7N5J4gv1kBZQwoThKn16cjExB2+lokyzUHwVoBROOFiWuk7W24E6TrOLWcZwqOhgM7RVFw/V++tttUS2W4WIGayLULcDF9AmW394RM7gny71dPEL7BNIL1q5H22TG5tQJi4YU8IZNNd6CNtQlSh4x7h+4Ua3+48Vpd5IK00gLcsHX32TVLfMyeINMK2IgyDlzhoc30WGIi3QDd2LAgvIk3EIQvyeSeIP+uVFX3z1DPb3hyM3/3zC4VEIMtMl4i8QqcFdq/dY3dHqmA8CMIp+9qJ5DmPoLQtHf20qUeH7gnLIyCfn+b9vqwjAH7Zr4jq06GMICI7wcDpN1lWj+Qf0GqBojrzXV0nifz98os80T4/JBh0AjCr8LZTCfqGOIgqgH2AtQT3JqGSXPwe4l0zxi44+wSfnvivWcBMqwA3V7Oz7aAMg3qFwxvkIVhOEVJiz4mCPtCPacosn1YW49NuBOxkCKvZwUQPWVMarsCCoj7UodntAJ17Yu/Q40gd4zcKdI42jBVukGmX97mYtNcDcYYIAjvDL2ZHpbYWECeRJkmdgzlDpBetq4cWB8do1pRKrOzAmKsQYYpLAi3KoAkZysPXrmJ0mnn2x0so11TDlpo2wy8XY6CD+mSUuXlMjlA3F0fFxYuJV00HZU3+SClx2LqaqsJ0kolOP/bvVyxfRSG04J4rYDEKpnenAa7WgDJca8iC9C7FHryRENtdvJtEbaAJVOlN1BaBiXXAZq9n0bG9rcgbgs4O+mM4AmtZgXocnLLvHcf6wF0i8XXrwLOyrjXH5IliKrP7rrBI3lu6thKHOB15FYzHr3uxVAWjmmPsGdynJ6ahxR0lJ5mGGkF+WAec3srw98IxbEE5Tq7QNgbyDMzecgVgI4uOVuqL6+x5RaZu9kevqrvQnzPDLZBxk4oFveXX9rdoOIaswmXKcrFhQ+mI1IPjOH34Wrmjw0os7/lC4ivk+nnZVKA+IAeIvJ9ad1zSo/ZuK6ZLaXL6WidhLeGo6JQJ0jXDLa5lDnaEXzfvIirrFgcIZ16fKg3oOvuf2TcA5HdzoY+QNdZws1XTVbpyL2YeUin3VvgTfAqdGuX7AV0dMWvjp6OEU1l3XOGNZnLlOtU6HPeE4U6QYZ9Jiwm9IoTRIemX9yHLeayraGYsLqknZNfNIIc0DBqAvUuJwdp4b7KaAVpXUvuAu7pNrmtVytRhi8i88JNjgyLE2l36r+tR+Ze0OmljrLENZJsBVEBgnBZcup/s+9dBYt5fFKqjTi4ly3WbuQyOxygysyOCoAXkxYgrInd372GgmsBX9gLWZsaSZunrMdhCDs+eMG7oK2knPZ8JtNPT9URQ97X/cfosoJb19ZDus/0G59HEPaEiafbWrZDC2RakwfBGaCVEOaxYWS1pwlr0wu3otcm39F2CeSOyIuQ4jo4YN8dLriHJq7nCls7QYI0jba6ByCIezZAO6RLvwsouRu0V0aNu/ixAjyJ0axhNyY9AO2FnW8dgd2qCs8x1CR1xVa3x8cVXhtqrsds0QRpNvcTYIxHHfDDDO1/A5Qd8NwECQcoMtxVSFdizVagH9Ha9cjqfJaDvnzM2Ujn4hOhZ4hdoKwfBYcBrmsXtIL1WLVOmBD3i3uf6ltowrxUHTq8CTyO8g5+ayLL4sVK0IVe5tU/Qf1uOlVsBc4kfgnN6uLE0MjyvIEDpk4Ru9hAZ4rset7X1qR0jeLAXKdY4h7M8sjNDXAUeYFmOHEdSXWMGCtQ0Dk6/OpIrakZM+zucLHlHTC98QYIv1LMIMjoCtDFSDxAprvo8veYG6Ezx6nQEyh6o+eEbmfZirQ7dHa4mtMe8SiMG7NnQg8/WvE6VT0B4g61Byb8R6HuBBPW8ep6oGtaHRIo6ACoR6V4i3zxsiPUnGr8AUIjyLMFvkAsjKBzuosR9xSsnOZobTfzpfTauIvjPr9GjxWj87QYRoavhf5McUnS4zDrcA3XLo4HDoi7wjuIBwg/jBj3Hym4kEaPpz2Kq0rzslWjpLn95E3j6AlBxwJfPk6ICcJWjF2hb3Mkz1bjbOLYYRd027vV9AnHvfNaTtm2EsP+ZVLWJTpcwqIcZ3A9rSr79vGw7BNoYnZWgs3T9YDjhQaJFRBWWaoEiLuc9qVsLer0s/zCmjMPep2oVPNIt8JdsLlbpJ62QPw3gHTe1w8wvGbfC16MCzvIOTMUD1GXNUWef3+4lxdNXh3LduoSj9kioxWk+TIezbFywkxG1hchz9boAak4e0SereUMWJbldoG+g+s4g4v7gI68h0IftOugM+mXwztJDwMIGeNBZDbQmeZ1KOcXLxUX1y16SF92MWQsawl7Iqz58pepY96Ig5s5F3v2xsGnq0+T5uktt7vKef+uVlBgOuz62k1wnZgNMmpcEzcOXiA9GuNR3YHP/o1vcEOXm1pX9v2us4CkHQedHZr7CTb9+pKEfXlnA/tymT3qmEFYs9xpsByWdnCMcwOCsNcfb1bmsMBzuEniClIPcqfn1p+iXC7rl4+jNYK0GBxTRssgX++NdkNUANKRPXaOCTsGeUIlLD2klqWn0WwZQ/Y/jCh4mPh3SBKup8CR2gH6Et2j82R39Tg3gV5zY0NL0gFvZejWVllhuqBxoHXRVc8jTVDIB/MMkQsk5+k4Y4z0f4CvwYegnluP4OvCtolryzuo6a7Ss2OL8QyiZ311YNwMnYFcb9gteo4VQ8dEE/0b0w8gL7VtEOQAAAAASUVORK5CYII="></div>
        <h1 class="hero__brand">HayDev Browser OS</h1>
        <p class="hero__tag">Same Internet. Deeper Intelligence.</p>
      </header>
      <div class="clock">
        <div class="clock__time" id="time">--:--</div>
        <div class="clock__date" id="date"></div>
      </div>
      <form class="search-wrap" id="sform" action="pab://search/" method="get">
        <div class="search">
          <button type="button" class="search__icon" id="sicon" aria-label="Focus search" tabindex="-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line>
            </svg>
          </button>
          <input id="sinput" name="q" placeholder="Спроси HayDev Search…" autocomplete="off" spellcheck="false" aria-label="Universal search — ask HayDev Search">
          <button type="button" class="search__btn" id="sattach" aria-label="Attach file" title="Attach file (PDF, DOC, TXT, CSV, JSON…)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
          <button type="button" class="search__btn" id="simage" aria-label="Attach image" title="Attach image (PNG, JPG, WEBP…)">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </button>
          <button type="submit" class="search__btn search__submit" id="sgo" aria-label="Run search" title="Search (Enter)">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="4" y1="12" x2="19" y2="12"></line><polyline points="13 6 19 12 13 18"></polyline>
            </svg>
          </button>
        </div>
        <div class="chips" id="schips" aria-label="Attachments"></div>
        <p class="status" id="sstatus" role="status" aria-live="polite"></p>
      </form>
      <div class="engines" role="radiogroup" aria-label="Search engine">
        <button type="button" class="engine" id="engine-haydev" role="radio" aria-checked="true" data-engine="haydev" title="HayDev flagship — Deep Research agent pipeline (switches to AGENT mode automatically for the run)">
          <span class="engine__icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M12 2l7 4v6c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-4z"></path>
              <circle cx="12" cy="10" r="2.2"></circle>
              <path d="M12 12.2V17"></path>
            </svg>
          </span>
          <span class="engine__text">
            <span class="engine__title">HayDev Search</span>
            <span class="engine__sub">Deep Research agent</span>
          </span>
        </button>
        <button type="button" class="engine" id="engine-perplexity" role="radio" aria-checked="false" data-engine="perplexity" title="Instant AI + Web answers via Perplexica (pab://search, web mode)">
          <span class="engine__icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="12" y1="3" x2="12" y2="21"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="5.6" y1="5.6" x2="18.4" y2="18.4"></line>
              <line x1="18.4" y1="5.6" x2="5.6" y2="18.4"></line>
            </svg>
          </span>
          <span class="engine__text">
            <span class="engine__title">Perplexity Search</span>
            <span class="engine__sub">AI + Web answers</span>
          </span>
        </button>
        <button type="button" class="engine" id="engine-darkweb" role="radio" aria-checked="false" data-engine="darkweb" title="Beyond the surface (pab://darkweb via Tor)">
          <span class="engine__icon" aria-hidden="true">
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <circle cx="12" cy="8" r="4"></circle>
              <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"></path>
              <line x1="9.5" y1="7" x2="10.8" y2="9.6"></line>
              <line x1="14.5" y1="7" x2="13.2" y2="9.6"></line>
            </svg>
          </span>
          <span class="engine__text">
            <span class="engine__title">Deep/Dark Web Search</span>
            <span class="engine__sub">Beyond the surface</span>
          </span>
        </button>
      </div>
      <div class="cats" role="group" aria-label="Search category">
        <button type="button" class="cat" data-cat="AI" aria-pressed="false">✳ AI</button>
        <button type="button" class="cat" data-cat="Research" aria-pressed="false">⚙ Research</button>
        <button type="button" class="cat" data-cat="Code" aria-pressed="false">&lt;/&gt; Code</button>
        <button type="button" class="cat" data-cat="Legal" aria-pressed="false">☰ Legal</button>
        <button type="button" class="cat" data-cat="Business" aria-pressed="false">▦ Business</button>
        <button type="button" class="cat" data-cat="Tech" aria-pressed="false">⚙ Tech</button>
        <button type="button" class="cat" data-cat="More" aria-pressed="false">•••</button>
      </div>
${tilesBlock}
    </main>
    <div class="motto motto--left" aria-hidden="true">"A more capable<br>you, every day."<br><em>— HayDev</em></div>
    <div class="motto motto--right" aria-hidden="true">Intelligence<br>without limits<span class="motto__bar"></span></div>
    <nav class="news" aria-label="Today in Tech">
${newsBlock}
    </nav>
  </div>
<script>
  ${buildMatrixRainScript()}
</script>
<script>
  ${buildPlanetScript()}
</script>
<script>
  (function () {
    var t = document.getElementById('time');
    var d = document.getElementById('date');
    function tick() {
      var n = new Date();
      t.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      d.textContent = n.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    }
    tick();
    setInterval(tick, 15000);

    // The scoped preload bridge — present ONLY on pab://newtab documents
    // (attachments + Deep Research). Feature-detected: without it the page
    // still works as a pure search entry.
    var bridge = window.__pabNewTab || null;
    // TAURI 2 ONLY (per project decision 2026-10-02): WebView2 serves the
    // internal pages on virtual hosts (http://pab.<page>/) and silently
    // drops script navigations to the raw pab:// scheme — internal links
    // ALWAYS use the vhost form, derived from this document's protocol.
    function pabNav(page, qs) { return location.protocol + '//pab.' + page + '/' + qs; }
    // Single-search-home policy (2026-10-03): every search reuses the open
    // pab search/darkweb tab (or the active tab on first use) — the backend
    // NEVER opens a new tab. location.href stays as the no-API fallback.
    function searchNavigate(page, qs) {
      var url = 'pab://' + page + '/' + qs;
      fetch('/api/navigate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url })
      }).then(function (r) { return r.json(); })
        .then(function (j) { if (!j || !j.navigated) location.href = pabNav(page, qs); })
        .catch(function () { location.href = pabNav(page, qs); });
    }
    // Never fail silently: surface script errors on the status line so
    // "nothing happens" is always explainable.
    window.addEventListener('error', function (e) {
      var el = document.getElementById('sstatus');
      if (el) el.textContent = 'Page error: ' + (e.message || 'unknown');
    });
    var ENGINE_KEY = 'pab.newtab.engine';
    var ENGINES = ['haydev', 'perplexity', 'darkweb'];
    var MAX_CHIPS = 4;
    var engine = 'haydev';
    try {
      var stored = sessionStorage.getItem(ENGINE_KEY);
      if (ENGINES.indexOf(stored) >= 0) engine = stored;
    } catch (e) { /* storage unavailable — per-tab default */ }

    var form = document.getElementById('sform');
    // Align the no-JS GET fallback with the detected runtime (the static
    // attribute stays pab:// for Electron; JS submits use pabNav anyway).
    if (form) form.action = pabNav('search', '');
    var input = document.getElementById('sinput');
    var attachBtn = document.getElementById('sattach');
    var imageBtn = document.getElementById('simage');
    var chipsBox = document.getElementById('schips');
    var statusEl = document.getElementById('sstatus');
    var chips = [];
    var category = null;

    if (!bridge) { attachBtn.style.display = 'none'; imageBtn.style.display = 'none'; }

    function status(msg, err) {
      statusEl.textContent = msg || '';
      statusEl.className = 'status' + (err ? ' status--err' : '');
    }
    function fmtSize(b) {
      if (!isFinite(b) || b < 0) return '?';
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(1) + ' MB';
    }

    function renderEngines() {
      for (var i = 0; i < ENGINES.length; i++) {
        var key = ENGINES[i];
        var btn = document.getElementById('engine-' + key);
        if (btn) btn.setAttribute('aria-checked', key === engine ? 'true' : 'false');
      }
    }
    for (var k = 0; k < ENGINES.length; k++) {
      (function (key) {
        var btn = document.getElementById('engine-' + key);
        if (!btn) return;
        btn.addEventListener('click', function () {
          engine = key;
          try { sessionStorage.setItem(ENGINE_KEY, key); } catch (e) { /* per-tab only */ }
          renderEngines();
        });
      })(ENGINES[k]);
    }

    var cats = document.querySelectorAll('.cat');
    for (var c = 0; c < cats.length; c++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-cat');
          category = category === name ? null : name;
          for (var j = 0; j < cats.length; j++) {
            cats[j].setAttribute('aria-pressed', cats[j].getAttribute('data-cat') === category ? 'true' : 'false');
          }
        });
      })(cats[c]);
    }

    function renderChips() {
      chipsBox.textContent = '';
      for (var i = 0; i < chips.length; i++) {
        (function (c) {
          var chip = document.createElement('span');
          chip.className = 'chip';
          if (c.thumbnail) {
            var img = document.createElement('img');
            img.src = c.thumbnail;
            img.alt = '';
            chip.appendChild(img);
          } else {
            var dot = document.createElement('span');
            dot.className = 'chip__dot';
            chip.appendChild(dot);
          }
          var name = document.createElement('span');
          name.className = 'chip__name';
          name.textContent = c.name;
          name.title = c.name;
          var meta = document.createElement('span');
          meta.className = 'chip__meta';
          meta.textContent = fmtSize(c.size);
          var rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'chip__remove';
          rm.setAttribute('aria-label', 'Remove attachment ' + c.name);
          rm.textContent = '×';
          rm.addEventListener('click', function () {
            chips = chips.filter(function (x) { return x.id !== c.id; });
            renderChips();
          });
          chip.appendChild(name);
          chip.appendChild(meta);
          chip.appendChild(rm);
          chipsBox.appendChild(chip);
        })(chips[i]);
      }
    }

    function pick(kind) {
      if (!bridge) return;
      if (chips.length >= MAX_CHIPS) {
        status('Up to ' + MAX_CHIPS + ' attachments per query.', true);
        return;
      }
      bridge.pickAttachment(kind).then(function (r) {
        var a = r && r.attachment;
        if (!a) return;                       // cancelled
        chips.push(a);
        renderChips();
        status('Attached ' + a.name + ' — will be analyzed by Deep Research.');
      }).catch(function () {
        status('Could not open the file picker.', true);
      });
    }
    attachBtn.addEventListener('click', function () { pick('file'); });
    imageBtn.addEventListener('click', function () { pick('image'); });

    function runResearch(q) {
      if (!bridge) {
        status('Deep Research is unavailable on this page.', true);
        return;
      }
      status('Starting Deep Research…');
      bridge.runResearch({
        query: q,
        attachmentIds: chips.map(function (c) { return c.id; })
      }).then(function (r) {
        if (r && r.started) {
          status('Deep Research started — follow the AGENT panel.');
          input.value = '';
          chips = [];
          renderChips();
        } else {
          status((r && r.error) || 'Deep Research could not start.', true);
        }
      }).catch(function () {
        status('Deep Research request failed.', true);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      // Empty query is a LOUD no-op — a silent one reads as "the button
      // is broken" (user-reported confusion).
      if (!v) {
        status('Type a query first — then press Search or Enter.', true);
        input.focus();
        return;
      }
      if (category && category !== 'More') v = v + ' [' + category + ']';
      // Attachments can only be consumed by the agent pipeline — route
      // there explicitly (the only honest engine for files/images).
      if (chips.length > 0) {
        runResearch(v);
        return;
      }
      if (engine === 'darkweb') {
        status('Opening Dark Web search…');
        searchNavigate('darkweb', '?q=' + encodeURIComponent(v));
        return;
      }
      if (engine === 'perplexity') {
        // Perplexity chip = instant AI + Web answers (Perplexica, web mode).
        status('Searching — Perplexity (AI + Web)…');
        searchNavigate('search', '?q=' + encodeURIComponent(v) + '&src=web');
        return;
      }
      // HayDev chip = the flagship: Deep Research agent pipeline (src=research
      // auto-launches on the search page and auto-switches to AGENT mode).
      status('Starting Deep Research (HayDev agent)…');
      searchNavigate('search', '?q=' + encodeURIComponent(v) + '&src=research');
    });

    document.getElementById('sicon').addEventListener('click', function () {
      input.focus();
    });

    // Cold-boot retry: if the strip has no headlines (network raced the
    // main-process fetch at startup), pull the server-side JSON endpoint
    // with a widening retry schedule and render real cards client-side
    // (textContent only — the same escaped-rendering guarantees as the
    // server template).
    var newsNav = document.querySelector('.news');
    function loadNews(delay) {
      setTimeout(function () {
        fetch('api/news').then(function (r) { return r.json(); }).then(function (j) {
          var items = (j && j.items) || [];
          if (!items.length) {
            if (delay < 15000) loadNews(delay < 4000 ? 10000 : 20000);
            return;
          }
          newsNav.textContent = '';
          var lead = document.createElement('div');
          lead.className = 'news__card news__card--lead news__card--static';
          var leadDot = document.createElement('span');
          leadDot.className = 'news__lead-dot';
          var leadBody = document.createElement('span');
          leadBody.className = 'news__body';
          var leadTitle = document.createElement('span');
          leadTitle.className = 'news__lead-title';
          leadTitle.textContent = 'Today in Tech';
          var leadSub = document.createElement('span');
          leadSub.className = 'news__lead-sub';
          leadSub.textContent = 'Latest updates for your workflow';
          leadBody.appendChild(leadTitle);
          leadBody.appendChild(leadSub);
          lead.appendChild(leadDot);
          lead.appendChild(leadBody);
          newsNav.appendChild(lead);
          items.forEach(function (n) {
            var a = document.createElement('a');
            a.className = 'news__card';
            a.href = n.url;
            a.title = n.title;
            var rank = document.createElement('span');
            rank.className = 'news__rank';
            rank.textContent = n.rank;
            var tile = document.createElement('span');
            tile.className = 'news__tile';
            tile.textContent = n.sourceKey;
            var body = document.createElement('span');
            body.className = 'news__body';
            var title = document.createElement('span');
            title.className = 'news__title';
            title.textContent = n.title;
            body.appendChild(title);
            if (n.age) {
              var age = document.createElement('span');
              age.className = 'news__age';
              age.textContent = n.age;
              body.appendChild(age);
            }
            a.appendChild(rank);
            a.appendChild(tile);
            a.appendChild(body);
            newsNav.appendChild(a);
          });
        }).catch(function () {
          if (delay < 15000) loadNews(delay < 4000 ? 10000 : 20000);
        });
      }, delay);
    }
    if (newsNav && !document.querySelector('.news__title')) {
      loadNews(2500);
    }

    renderEngines();
  })();
</script>
</body>
</html>`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
