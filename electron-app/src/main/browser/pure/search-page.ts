/**
 * HayDev Search — internal chat/search page (pab://search).
 *
 * Pure template builder. The page is served by the main process; its
 * script talks to the local Perplexica instance (/api/search) and renders
 * a conversation: user question bubbles + AI answers with web sources.
 * Follow-up questions reuse the in-page history (multi-turn).
 *
 * SECURITY:
 *   - The query is read client-side from location.search / the input and
 *     inserted via textContent only — never interpolated into HTML.
 *   - Source URLs/titles from the API are set via textContent.
 *   - Source objects carry embeddings in metadata — never serialized.
 *
 * Pure — no Electron imports.
 */

import { MATRIX_RAIN_CANVAS, buildMatrixRainScript } from './matrix-rain';
import type { AppLocale } from '../../../shared/app-locale';

export interface SearchPageOptions {
  /** Base URL of the local Perplexica instance. */
  perplexicaURL: string;
  /** Default chat model key on the Ollama provider. */
  modelKey: string;
  /** Bounded network budgets for the page's own fetches (spec §5). */
  providersTimeoutMs?: number;
  searchTimeoutMs?: number;
  /** Brand hero image as a `data:image/*` URL injected by the build script
   * from a repo asset — a build-time constant, never user input. */
  logoDataUrl?: string;
  /** UI language for every user-visible string on the page (default 'en';
   * omitting it keeps the historical output unchanged). */
  lang?: AppLocale;
}

/** Central page-side bounds — no magic numbers in the script (spec §5/§37). */
export const SEARCH_PAGE_BOUNDS = {
  providersTimeoutMs: 10_000,
  searchTimeoutMs: 150_000,
} as const;

/** User-visible strings per locale. `en` values are the historical page
 * strings verbatim (so the default output is unchanged); keys are resolved
 * server-side via tr() and client-side via window.__PAB_STRINGS__. Brand
 * names (HayDev, Perplexica, Tor, DuckDuckGo, Deep Research) stay as-is. */
const STRINGS: Record<AppLocale, Record<string, string>> = {
  en: {
    'logo.alt': 'HayDev Browser — Search logo',
    'search.placeholder': 'Спроси что угодно — поиск с ИИ-ответом…',
    'input.aria': 'HayDev Search query',
    'modes.aria': 'Search mode',
    'status.searching': 'Searching the web and generating an answer…',
    'answer.empty': '(empty answer)',
    'error.aiUnavailable': 'AI search is unavailable. Web search instead: ',
    'error.noModel': 'No usable chat model is configured.',
    'error.emptyResponse': 'Empty response',
    'error.search': 'Search error',
    'error.searchFailed': 'Search failed.',
    'error.unavailable': 'Search unavailable ({detail}).',
    'mode.web': 'AI + Web',
    'mode.discussions': 'Discussions',
    'mode.academic': 'Academic',
    'mode.research': 'Deep Research',
    'mode.darkweb': 'Dark Web',
    'tooltip.web': 'General AI + web search',
    'tooltip.discussions': 'Community discussions and forums',
    'tooltip.academic': 'Papers and academic sources',
    'tooltip.research': 'Run this query through the Deep Research agent pipeline',
    'tooltip.darkweb': 'Search the deep/dark web via Tor',
    'note.mode': 'Mode: {mode}',
    'note.darkwebNeedQuery': 'Type a query first — Dark Web search will use it.',
    'note.researchUnavailable': 'Deep Research is unavailable on this page.',
    'note.researchNeedQuery': 'Type a query first — Deep Research will use it.',
    'note.researchStarting': 'Starting Deep Research — the answer will appear here…',
    'note.researchRunningSteps': 'Deep Research running — steps shown below…',
    'note.researchCouldNotStart': 'Deep Research could not start.',
    'note.researchFailed': 'Deep Research request failed.',
    'note.researchComplete': 'Deep Research complete — answer above, sources below.',
    'research.progress': 'Deep Research running…',
    'research.step': 'Deep Research running — step {n}… (invisible page fetches, your tabs are untouched)',
    'research.finished': 'finished',
    'research.noAnswer': 'Deep Research {state} — no answer was produced.',
    'sources.head': 'SOURCES ({n})',
  },
  ru: {
    'logo.alt': 'HayDev Browser — логотип поиска',
    'search.placeholder': 'Спроси что угодно — поиск с ИИ-ответом…',
    'input.aria': 'Поисковый запрос HayDev Search',
    'modes.aria': 'Режим поиска',
    'status.searching': 'Ищу в интернете и формирую ответ…',
    'answer.empty': '(пустой ответ)',
    'error.aiUnavailable': 'ИИ-поиск недоступен. Поиск в интернете вместо него: ',
    'error.noModel': 'Ни одна пригодная чат-модель не настроена.',
    'error.emptyResponse': 'Пустой ответ',
    'error.search': 'Ошибка поиска',
    'error.searchFailed': 'Поиск не удался.',
    'error.unavailable': 'Поиск недоступен ({detail}).',
    'mode.web': 'ИИ + Веб',
    'mode.discussions': 'Обсуждения',
    'mode.academic': 'Академический',
    'mode.research': 'Глубокое исследование',
    'mode.darkweb': 'Дарквеб',
    'tooltip.web': 'Общий ИИ-поиск и поиск в интернете',
    'tooltip.discussions': 'Обсуждения и форумы сообществ',
    'tooltip.academic': 'Научные статьи и академические источники',
    'tooltip.research': 'Прогнать этот запрос через конвейер агента Deep Research',
    'tooltip.darkweb': 'Поиск в глубокой/тёмной сети через Tor',
    'note.mode': 'Режим: {mode}',
    'note.darkwebNeedQuery': 'Сначала введите запрос — поиск в Дарквебе будет использовать его.',
    'note.researchUnavailable': 'Deep Research недоступен на этой странице.',
    'note.researchNeedQuery': 'Сначала введите запрос — Deep Research будет использовать его.',
    'note.researchStarting': 'Запуск Deep Research — ответ появится здесь…',
    'note.researchRunningSteps': 'Deep Research выполняется — шаги показаны ниже…',
    'note.researchCouldNotStart': 'Не удалось запустить Deep Research.',
    'note.researchFailed': 'Запрос Deep Research не удался.',
    'note.researchComplete': 'Deep Research завершён — ответ выше, источники ниже.',
    'research.progress': 'Deep Research выполняется…',
    'research.step': 'Deep Research выполняется — шаг {n}… (невидимые запросы страницы, ваши вкладки не затрагиваются)',
    'research.finished': 'завершён',
    'research.noAnswer': 'Deep Research {state} — ответ не получен.',
    'sources.head': 'ИСТОЧНИКИ ({n})',
  },
  hy: {
    'logo.alt': 'HayDev Browser — որոնման լոգո',
    'search.placeholder': 'Հարցրեք ցանկացած բան — որոնում ԱԻ-պատասխանով…',
    'input.aria': 'HayDev Search հարցում',
    'modes.aria': 'Որոնման ռեժիմ',
    'status.searching': 'Որոնում եմ համացանցում և պատասխան եմ կազմում…',
    'answer.empty': '(դատարկ պատասխան)',
    'error.aiUnavailable': 'ԱԻ որոնումը հասանելի չէ։ Փոխարենը որոնել համացանցում՝ ',
    'error.noModel': 'Օգտագործելի չաթ-մոդել չի կազմաձևված։',
    'error.emptyResponse': 'Դատարկ պատասխան',
    'error.search': 'Որոնման սխալ',
    'error.searchFailed': 'Որոնումը ձախողվեց։',
    'error.unavailable': 'Որոնումը հասանելի չէ ({detail})։',
    'mode.web': 'ԱԻ + Վեբ',
    'mode.discussions': 'Քննարկումներ',
    'mode.academic': 'Ակադեմիական',
    'mode.research': 'Խորը հետազոտություն',
    'mode.darkweb': 'Դարք վեբ',
    'tooltip.web': 'Ընդհանուր ԱԻ և համացանցային որոնում',
    'tooltip.discussions': 'Համայնքի քննարկումներ և ֆորումներ',
    'tooltip.academic': 'Գիտական հոդվածներ և ակադեմիական աղբյուրներ',
    'tooltip.research': 'Անցկացնել այս հարցումը Deep Research գործակալի խողովակաշարով',
    'tooltip.darkweb': 'Որոնում խորը/մութ ցանցում Tor-ի միջոցով',
    'note.mode': 'Ռեժիմ՝ {mode}',
    'note.darkwebNeedQuery': 'Նախ մուտքագրեք հարցումը — Դարք վեբի որոնումը կօգտագործի այն։',
    'note.researchUnavailable': 'Deep Research-ը հասանելի չէ այս էջում։',
    'note.researchNeedQuery': 'Նախ մուտքագրեք հարցումը — Deep Research-ը կօգտագործի այն։',
    'note.researchStarting': 'Մեկնարկում է Deep Research-ը — պատասխանը կհայտնվի այստեղ…',
    'note.researchRunningSteps': 'Deep Research-ը աշխատում է — քայլերը ցուցադրվում են ստորև…',
    'note.researchCouldNotStart': 'Deep Research-ը չհաջողվեց մեկնարկել։',
    'note.researchFailed': 'Deep Research հարցումը ձախողվեց։',
    'note.researchComplete': 'Deep Research-ն ավարտված է — պատասխանը վերևում, աղբյուրները՝ ստորև։',
    'research.progress': 'Deep Research-ը աշխատում է…',
    'research.step': 'Deep Research-ը աշխատում է — քայլ {n}… (էջի անտեսանելի հարցումներ, ձեր ներդիրները անփոփոխ են)',
    'research.finished': 'ավարտված',
    'research.noAnswer': 'Deep Research {state} — պատասխան չի ստացվել։',
    'sources.head': 'ԱՂԲՅՈՒՐՆԵՐ ({n})',
  },
};

/** Resolve a UI string for `lang`, with `{var}` interpolation. */
function tr(lang: AppLocale, key: string, vars?: Record<string, string | number>): string {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function buildSearchPageHtml(opts: SearchPageOptions): string {
  const lang: AppLocale = opts.lang ?? 'en';
  const apiBase = JSON.stringify(opts.perplexicaURL.replace(/\/$/, ''));
  const modelKey = JSON.stringify(opts.modelKey);
  const providersTimeout = opts.providersTimeoutMs ?? SEARCH_PAGE_BOUNDS.providersTimeoutMs;
  const searchTimeout = opts.searchTimeoutMs ?? SEARCH_PAGE_BOUNDS.searchTimeoutMs;
  // en strings merged under the locale so the page script always has a full
  // key set; `</` escaped so a translation can never close the <script> tag.
  const stringsJson = JSON.stringify({ ...STRINGS.en, ...STRINGS[lang] }).replace(/<\//g, '<\\/');

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<title>HayDev Search</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background:
      radial-gradient(ellipse 60% 30% at 50% 0%, rgba(0,240,212,0.05) 0%, transparent 60%),
      #02040a;
    color: #eef5ff;
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    display: flex; flex-direction: column;
    padding: 24px clamp(20px, 6vw, 120px) 0;
  }
  body > *:not(#matrix-rain) { position: relative; z-index: 1; }
  .head { text-align: center; padding: 8px 0 20px; }
  .brand-logo {
    display: block; margin: 0 auto 10px;
    max-height: clamp(130px, 22vh, 200px); max-width: min(86vw, 420px); height: auto;
    filter: drop-shadow(0 10px 30px rgba(56,130,246,0.35)) drop-shadow(0 0 18px rgba(0,240,212,0.18));
  }
  .brand {
    font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase;
    color: #00f0d4; opacity: 0.85; margin-bottom: 14px;
  }
  .search { width: min(620px, 90vw); margin: 0 auto; }
  .search input {
    width: 100%; height: 44px; padding: 0 18px;
    background: rgba(8,14,28,0.72);
    border: 1px solid rgba(42,72,120,0.55); border-radius: 999px;
    color: #eef5ff; font-size: 14px; outline: none;
    transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  }
  .search input:focus {
    border-color: rgba(0,240,212,0.55);
    box-shadow: 0 0 22px rgba(0,240,212,0.2);
  }
  .search input::placeholder { color: #5f789c; }
  #chat {
    flex: 1; overflow-y: auto; margin-top: 26px;
    display: flex; flex-direction: column; gap: 22px;
    padding-bottom: 32px;
  }
  .turn { display: flex; flex-direction: column; gap: 12px; }
  .q {
    align-self: flex-end; max-width: 80%;
    background: rgba(0,240,212,0.14); border: 1px solid rgba(0,240,212,0.3);
    border-radius: 12px 12px 3px 12px; padding: 10px 16px;
    font-size: 14px; line-height: 1.5; color: #eef5ff;
  }
  .a {
    align-self: flex-start; max-width: 100%;
    background: rgba(8,14,28,0.72); border: 1px solid rgba(42,72,120,0.4);
    border-radius: 12px 12px 12px 3px; padding: 16px 20px;
    font-size: 14px; line-height: 1.75; color: #eef5ff; white-space: pre-wrap;
  }
  .a.error { color: #ff8fa3; border-color: rgba(255,77,109,0.4); }
  .srcs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .src {
    display: inline-block; max-width: 260px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
    padding: 4px 12px; border-radius: 999px; text-decoration: none;
    font-size: 11px; color: #9cc3ff;
    background: rgba(92,168,255,0.1); border: 1px solid rgba(92,168,255,0.25);
  }
  .src:hover { border-color: rgba(0,240,212,0.5); color: #00f0d4; }
  .status { font-size: 12px; color: #5f789c; }
  .status .dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: #00f0d4; margin-right: 8px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: .3 } 50% { opacity: 1 } }
  .fallback { margin-top: 8px; font-size: 12px; }
  .fallback a { color: #9cc3ff; }
  .home-hint { text-align: center; font-size: 13px; color: #5f789c; }

  /* ---- deep research result (answer above, sources below) -------------- */
  .research-progress {
    margin: 10px auto 0; width: min(760px, 92vw);
    font-size: 13px; color: #7fd4b0; animation: pulse 1.6s ease-in-out infinite;
  }
  .sources { margin: 12px auto 0; width: min(760px, 92vw); }
  .sources__head {
    font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
    color: #5f789c; margin-bottom: 6px;
  }
  .sources__link {
    display: block; font-size: 13px; color: #9cc3ff; text-decoration: none;
    padding: 3px 0; word-break: break-all;
  }
  .sources__link:hover { text-decoration: underline; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }

  /* ---- search mode switcher (above the chat) --------------------------- */
  .modes {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;
    margin: 0 auto 16px; padding: 0; width: min(760px, 92vw);
  }
  .mode {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 13px; border-radius: 999px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
    color: #8195a6; background: rgba(9, 20, 29, 0.55);
    border: 1px solid rgba(38, 66, 90, 0.55);
    cursor: pointer;
    transition: color 140ms ease-out, border-color 140ms ease-out,
      background 140ms ease-out;
  }
  .mode:hover { color: #b8cbd9; border-color: rgba(60, 96, 128, 0.7); }
  .mode[aria-checked="true"] {
    color: #00ffd1; border-color: rgba(0, 255, 209, 0.5);
    background: rgba(0, 232, 157, 0.08);
    box-shadow: inset 0 0 18px rgba(0, 255, 209, 0.05);
  }
  .mode[disabled] { opacity: 0.45; cursor: default; }
  .mode-note { text-align: center; font-size: 11px; color: #8195a6; min-height: 16px; margin: -8px 0 8px; }
  .mode-note--err { color: #ff9d7a; }
</style>
</head>
<body>
  ${MATRIX_RAIN_CANVAS}
  <div class="head">
    ${opts.logoDataUrl ? `<img class="brand-logo" src="${opts.logoDataUrl}" alt="${tr(lang, 'logo.alt')}">` : ''}
    <div class="brand">HayDev Search</div>
    <form class="search" id="form">
      <input id="input" placeholder="${tr(lang, 'search.placeholder')}" autocomplete="off" spellcheck="false" aria-label="${tr(lang, 'input.aria')}">
    </form>
  </div>
  <div class="modes" id="modes" role="radiogroup" aria-label="${tr(lang, 'modes.aria')}"></div>
  <p class="mode-note" id="mode-note" role="status" aria-live="polite"></p>
  <div id="chat" aria-live="polite"></div>
<script>
  window.__PAB_STRINGS__ = ${stringsJson};
(function () {
  var API = ${apiBase};
  var MODEL = ${modelKey};
  var PROVIDERS_TIMEOUT = ${providersTimeout};
  var SEARCH_TIMEOUT = ${searchTimeout};
  var chat = document.getElementById('chat');
  var form = document.getElementById('form');
  var input = document.getElementById('input');
  var history = [];   // [ [human, assistant], … ] for the API
  var busy = false;
  var providersCache = null;   // /api/providers payload for this session
  var S = window.__PAB_STRINGS__ || {};   // UI strings for the current locale
  function L(key, vars) {
    var s = S[key] || key;
    if (vars) for (var k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }
  function addUser(text) { chat.appendChild(el('div', 'q', text)); }
  function addAnswer(text, isError) {
    var d = el('div', 'a' + (isError ? ' error' : ''), text);
    chat.appendChild(d);
    return d;
  }
  function addStatus() {
    var d = el('div', 'status');
    d.innerHTML = '<span class="dot"></span>';
    d.appendChild(document.createTextNode(L('status.searching')));
    chat.appendChild(d);
    return d;
  }
  function addSources(items) {
    var box = el('div', 'srcs');
    items.slice(0, 10).forEach(function (s) {
      var title = (s.metadata && s.metadata.title) || s.title || '';
      var url = (s.metadata && s.metadata.url) || s.url || '#';
      var a = document.createElement('a');
      a.className = 'src';
      a.href = url;
      a.textContent = title || url;
      box.appendChild(a);
    });
    chat.appendChild(box);
  }
  function scroll() { chat.scrollTop = chat.scrollHeight; }
  function fetchTimeout(url, init, timeoutMs) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, timeoutMs);
    var p = fetch(url, init ? Object.assign({}, init, { signal: c.signal }) : { signal: c.signal });
    return p.finally(function () { clearTimeout(t); });
  }

  // ---- provider/model selection (root-cause fix, spec §8) ----------------
  // A 404 from a dead model (e.g. models/gemini-2.5-flash for new accounts)
  // makes Perplexica's non-stream /api/search promise NEVER settle — so the
  // model must be chosen deliberately, never "first in the list".
  var DEAD_MODEL = /(2\\.5-flash$|-preview|-tts|-image|-omni|computer-use|robot|lyria|transcri|-embed|content-safety|guard)/i;
  var AUTO_PREFS = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.6-flash'];

  function keyMatches(key, pref) {
    return key === pref || key === 'models/' + pref || key.endsWith('/' + pref);
  }
  function pickChatCandidates(providers) {
    var out = [];
    var seen = {};
    function push(p, key) {
      var id = p.id + '|' + key;
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ providerId: p.id, key: key, label: p.name });
    }
    // Order: auto-preferred Gemini models first, then any other healthy
    // non-Ollama provider, then the configured MODEL pin LAST — a rate-/
    // credit-limited provider must never be tried before live ones (spec §8).
    var prefs = AUTO_PREFS;
    for (var i = 0; i < prefs.length; i++) {
      for (var j = 0; j < providers.length; j++) {
        var p = providers[j];
        if (!p.chatModels || !p.chatModels.length) continue;
        for (var k = 0; k < p.chatModels.length; k++) {
          if (keyMatches(p.chatModels[k].key, prefs[i])) { push(p, p.chatModels[k].key); }
        }
      }
    }
    // Secondary: other providers' sensible models (skip Ollama here — it is
    // appended last so a limited/exhausted backend never blocks the answer).
    for (var j2 = 0; j2 < providers.length && out.length < 4; j2++) {
      var p2 = providers[j2];
      if (!p2.chatModels || !p2.chatModels.length) continue;
      if (/ollama/i.test(p2.name)) continue;
      if (candidatesIncludeProvider(out, p2.id)) continue;
      for (var k2 = 0; k2 < p2.chatModels.length; k2++) {
        var key2 = p2.chatModels[k2].key;
        if (!DEAD_MODEL.test(key2)) { push(p2, key2); break; }
      }
    }
    // Last resort: the configured MODEL pin (e.g. Ollama) — kept in the list
    // so it is still usable, but never ahead of live providers.
    for (var j3 = 0; j3 < providers.length; j3++) {
      var p3 = providers[j3];
      if (!p3.chatModels || !p3.chatModels.length) continue;
      for (var k3 = 0; k3 < p3.chatModels.length; k3++) {
        if (p3.chatModels[k3].key === MODEL) { push(p3, MODEL); break; }
      }
    }
    return out;
  }
  function candidatesIncludeProvider(list, providerId) {
    for (var i = 0; i < list.length; i++) if (list[i].providerId === providerId) return true;
    return false;
  }
  function pickEmbedModel(providers) {
    var best = null;
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      if (!p.embeddingModels || !p.embeddingModels.length) continue;
      for (var j = 0; j < p.embeddingModels.length; j++) {
        var key = p.embeddingModels[j].key;
        if (DEAD_MODEL.test(key)) continue;
        // Prefer explicit embedding models; local transformers are fine too.
        if (/embedding/i.test(key)) return { providerId: p.id, key: key };
        if (!best) best = { providerId: p.id, key: key };
      }
    }
    return best;
  }

  function showError(msg, q) {
    addAnswer(msg, true);
    if (q) {
      var fb = el('div', 'fallback');
      var a = document.createElement('a');
      a.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(q);
      a.textContent = q + ' — DuckDuckGo';
      fb.appendChild(document.createTextNode(L('error.aiUnavailable')));
      fb.appendChild(a);
      chat.appendChild(fb);
    }
    scroll();
  }

  async function ask(q) {
    if (busy || !q) return;
    busy = true;
    input.value = '';
    addUser(q);
    var st = addStatus();
    scroll();
    try {
      if (!providersCache) {
        providersCache = await fetchTimeout(API + '/api/providers', null, PROVIDERS_TIMEOUT)
          .then(function (r) { return r.json(); });
      }
      var providers = providersCache.providers || [];
      var candidates = pickChatCandidates(providers);
      var embedModel = pickEmbedModel(providers);
      if (!candidates.length) { throw new Error(L('error.noModel')); }

      var lastErr = null;
      // Bounded provider fallback: at most 2 distinct providers (spec §10).
      var tried = {};
      for (var ci = 0; ci < candidates.length; ci++) {
        var cand = candidates[ci];
        if (tried[cand.providerId]) continue;
        tried[cand.providerId] = 1;
        var body = {
          optimizationMode: 'balanced',
          // Real Perplexica search modes (SearchSources): 'web' |
          // 'discussions' | 'academic' — chosen by the mode switcher.
          sources: SOURCES_FOR_MODE(mode),
          query: q,
          history: history,
          stream: false,
          chatModel: { providerId: cand.providerId, key: cand.key },
          embeddingModel: embedModel
            ? { providerId: embedModel.providerId, key: embedModel.key }
            : { providerId: cand.providerId, key: cand.key },
        };
        try {
          var j = await fetchTimeout(API + '/api/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }, SEARCH_TIMEOUT).then(function (r) { return r.json(); });
          // Controlled provider failure (HTTP 502 + {message, error:{code}}):
          // treat as failure so the NEXT candidate provider is tried instead
          // of rendering the error text as the answer.
          if (!j || j.error) throw new Error(j && j.error && j.error.code ? String(j.error.code) : (j && j.message === undefined ? L('error.emptyResponse') : L('error.search')));
          if (j.message === undefined) throw new Error(L('error.emptyResponse'));
          st.remove();
          addAnswer(j.message || L('answer.empty'));
          var sources = j.sources || [];
          if (sources.length) addSources(sources);
          history.push([q, j.message || '']);
          busy = false;
          scroll();
          return;
        } catch (err) {
          lastErr = err;
          providersCache = null; // provider list may have changed server-side
        }
      }
      throw lastErr || new Error(L('error.searchFailed'));
    } catch (err) {
      st.remove();
      showError(L('error.unavailable', { detail: String(err && err.message ? err.message : err) }), q);
      busy = false;
      scroll();
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ask(input.value.trim());
    input.focus();
  });

  var params = new URLSearchParams(location.search);
  var q = (params.get('q') || '').trim();

  // ---- search mode switcher (above the chat) ------------------------------
  var bridge = window.__pabNewTab || null;
  // TAURI 2 ONLY (per project decision 2026-10-02): WebView2 serves this
  // page on a virtual host (http://pab.search/) and drops script navigations
  // to the raw pab:// scheme — internal links always use the vhost form.
  function pabNav(page, qs) { return location.protocol + '//pab.' + page + '/' + qs; }
  // Single-search-home policy: reuse the open darkweb tab via the backend
  // (never a new tab); location.href is the no-API fallback.
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
  var MODES = [
    { id: 'web', label: 'AI + Web', source: 'web' },
    { id: 'discussions', label: 'Discussions', source: 'discussions' },
    { id: 'academic', label: 'Academic', source: 'academic' },
    { id: 'research', label: 'Deep Research', source: null },
    { id: 'darkweb', label: 'Dark Web', source: null }
  ];
  var VALID = { web: 1, discussions: 1, academic: 1, research: 1 };
  var paramsMode = (params.get('src') || '').trim();
  var mode = VALID[paramsMode] ? paramsMode : 'web';
  var modesBox = document.getElementById('modes');
  var modeNote = document.getElementById('mode-note');

  function SOURCES_FOR_MODE(m) {
    var found = null;
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === m) found = MODES[i];
    return found && found.source ? [found.source] : ['web'];
  }

  function modeNoteMsg(msg, err) {
    if (!modeNote) return;
    modeNote.textContent = msg || '';
    modeNote.className = 'mode-note' + (err ? ' mode-note--err' : '');
  }

  function renderModes() {
    if (!modesBox) return;
    modesBox.textContent = '';
    MODES.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mode';
      b.setAttribute('role', 'radio');
      var active = m.id === mode;
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      if (m.id === 'research' && !bridge) b.disabled = true;
      b.title = L('tooltip.' + m.id);
      b.textContent = S['mode.' + m.id] || m.label;
      b.addEventListener('click', function () { selectMode(m.id); });
      modesBox.appendChild(b);
    });
  }

  function selectMode(id) {
    if (id === mode && id !== 'research' && id !== 'darkweb') return;
    if (id === 'web' || id === 'discussions' || id === 'academic') {
      mode = id;
      renderModes();
      modeNoteMsg(L('note.mode', { mode: id.toUpperCase() }));
      // Re-run the current query in the freshly selected mode.
      var cur = (new URLSearchParams(location.search).get('q') || '').trim();
      if (cur) {
        location.href = pabNav('search', '?q=' + encodeURIComponent(cur) + '&src=' + encodeURIComponent(id));
      }
      return;
    }
    if (id === 'darkweb') {
      var dq = (new URLSearchParams(location.search).get('q') || input.value || '').trim();
      if (!dq) { modeNoteMsg(L('note.darkwebNeedQuery'), true); return; }
      searchNavigate('darkweb', '?q=' + encodeURIComponent(dq));
      return;
    }
    if (id === 'research') {
      var rq = (new URLSearchParams(location.search).get('q') || input.value || '').trim();
      startResearch(rq);
    }
  }

  /** Launch the Deep Research agent (mode chip OR src=research autoload). */
  function startResearch(rq) {
    if (!bridge) { modeNoteMsg(L('note.researchUnavailable'), true); return; }
    if (!rq) { modeNoteMsg(L('note.researchNeedQuery'), true); return; }
    input.value = rq;
    addUser(rq);
    modeNoteMsg(L('note.researchStarting'));
    bridge.runResearch({ query: rq, attachmentIds: [] }).then(function (r) {
      if (r && r.started) {
        modeNoteMsg(L('note.researchRunningSteps'));
        pollResearch();
      } else {
        modeNoteMsg((r && r.error) || L('note.researchCouldNotStart'), true);
      }
    }).catch(function () { modeNoteMsg(L('note.researchFailed'), true); });
  }

  /* Poll the run and render the RESULT ON THIS PAGE: answer block first,
     sources list below (user decision 2026-10-03 — no more answers living
     only in the AGENT side panel). */
  function pollResearch() {
    var tries = 0;
    var statusBox = null;
    (function tick() {
      fetch('/api/research/status', { signal: AbortSignal.timeout(8000) })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          tries++;
          if (s.state === 'RUNNING' || s.state === 'STARTING' || s.state === 'WAITING_FOR_HUMAN') {
            if (!statusBox) {
              statusBox = el('div', 'research-progress');
              statusBox.textContent = L('research.progress');
              chat.appendChild(statusBox);
            }
            statusBox.textContent = L('research.step', { n: s.stepCount || 0 });
            scroll();
            if (tries < 600) setTimeout(tick, 2000);
            return;
          }
          if (statusBox && statusBox.parentNode) statusBox.parentNode.removeChild(statusBox);
          renderResearchResult(s);
        })
        .catch(function () { if (tries < 600) { tries++; setTimeout(tick, 3000); } });
    })();
  }

  function renderResearchResult(s) {
    var answer = (s.answer && String(s.answer).trim()) ||
      (s.report && s.report.summary && String(s.report.summary).trim()) || '';
    if (!answer) {
      modeNoteMsg(L('research.noAnswer', { state: s.state || L('research.finished') }), true);
      return;
    }
    addAnswer(answer);
    var srcs = (s.report && s.report.sources) || [];
    if (srcs.length) {
      var box = el('div', 'sources');
      var head = document.createElement('div');
      head.className = 'sources__head';
      head.textContent = L('sources.head', { n: srcs.length });
      box.appendChild(head);
      srcs.forEach(function (src) {
        var a = document.createElement('a');
        a.href = String(src.url || '');
        a.textContent = String(src.title || src.url || '');
        a.className = 'sources__link';
        a.rel = 'noreferrer noopener';
        box.appendChild(a);
      });
      chat.appendChild(box);
    }
    modeNoteMsg(L('note.researchComplete'));
    scroll();
  }

  renderModes();
  if (mode !== 'web') modeNoteMsg(L('note.mode', { mode: mode.toUpperCase() }));

  if (q) {
    // src=research (the HayDev engine chip): auto-launch the agent pipeline.
    if (mode === 'research') startResearch(q);
    else ask(q);
  } else input.focus();
})();
</script>
<script>
  ${buildMatrixRainScript()}
</script>
</body>
</html>`;
}
