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

export interface SearchPageOptions {
  /** Base URL of the local Perplexica instance. */
  perplexicaURL: string;
  /** Default chat model key on the Ollama provider. */
  modelKey: string;
  /** Bounded network budgets for the page's own fetches (spec §5). */
  providersTimeoutMs?: number;
  searchTimeoutMs?: number;
}

/** Central page-side bounds — no magic numbers in the script (spec §5/§37). */
export const SEARCH_PAGE_BOUNDS = {
  providersTimeoutMs: 10_000,
  searchTimeoutMs: 150_000,
} as const;

export function buildSearchPageHtml(opts: SearchPageOptions): string {
  const apiBase = JSON.stringify(opts.perplexicaURL.replace(/\/$/, ''));
  const modelKey = JSON.stringify(opts.modelKey);
  const providersTimeout = opts.providersTimeoutMs ?? SEARCH_PAGE_BOUNDS.providersTimeoutMs;
  const searchTimeout = opts.searchTimeoutMs ?? SEARCH_PAGE_BOUNDS.searchTimeoutMs;

  return `<!doctype html>
<html>
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
    <div class="brand">HayDev Search</div>
    <form class="search" id="form">
      <input id="input" placeholder="Спроси что угодно — поиск с ИИ-ответом…" autocomplete="off" spellcheck="false" aria-label="HayDev Search query">
    </form>
  </div>
  <div class="modes" id="modes" role="radiogroup" aria-label="Search mode"></div>
  <p class="mode-note" id="mode-note" role="status" aria-live="polite"></p>
  <div id="chat" aria-live="polite"></div>
<script>
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
    d.appendChild(document.createTextNode('Searching the web and generating an answer…'));
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
      fb.appendChild(document.createTextNode('AI search is unavailable. Web search instead: '));
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
      if (!candidates.length) { throw new Error('No usable chat model is configured.'); }

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
          if (!j || j.error) throw new Error(j && j.error && j.error.code ? String(j.error.code) : (j && j.message === undefined ? 'Empty response' : 'Search error'));
          if (j.message === undefined) throw new Error('Empty response');
          st.remove();
          addAnswer(j.message || '(empty answer)');
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
      throw lastErr || new Error('Search failed.');
    } catch (err) {
      st.remove();
      showError('Search unavailable (' + String(err && err.message ? err.message : err) + ').', q);
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
  var MODES = [
    { id: 'web', label: 'AI + Web', source: 'web' },
    { id: 'discussions', label: 'Discussions', source: 'discussions' },
    { id: 'academic', label: 'Academic', source: 'academic' },
    { id: 'research', label: 'Deep Research', source: null },
    { id: 'darkweb', label: 'Dark Web', source: null }
  ];
  var VALID = { web: 1, discussions: 1, academic: 1 };
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
      b.title = m.id === 'web' ? 'General AI + web search'
        : m.id === 'discussions' ? 'Community discussions and forums'
        : m.id === 'academic' ? 'Papers and academic sources'
        : m.id === 'research' ? 'Run this query through the Deep Research agent pipeline'
        : 'Search the deep/dark web via Tor';
      b.textContent = m.label;
      b.addEventListener('click', function () { selectMode(m.id); });
      modesBox.appendChild(b);
    });
  }

  function selectMode(id) {
    if (id === mode && id !== 'research' && id !== 'darkweb') return;
    if (id === 'web' || id === 'discussions' || id === 'academic') {
      mode = id;
      renderModes();
      modeNoteMsg('Mode: ' + id.toUpperCase());
      // Re-run the current query in the freshly selected mode.
      var cur = (new URLSearchParams(location.search).get('q') || '').trim();
      if (cur) {
        location.href = 'pab://search/?q=' + encodeURIComponent(cur) + '&src=' + encodeURIComponent(id);
      }
      return;
    }
    if (id === 'darkweb') {
      var dq = (new URLSearchParams(location.search).get('q') || input.value || '').trim();
      if (!dq) { modeNoteMsg('Type a query first — Dark Web search will use it.', true); return; }
      location.href = 'pab://darkweb/?q=' + encodeURIComponent(dq);
      return;
    }
    if (id === 'research') {
      if (!bridge) { modeNoteMsg('Deep Research is unavailable on this page.', true); return; }
      var rq = (new URLSearchParams(location.search).get('q') || input.value || '').trim();
      if (!rq) { modeNoteMsg('Type a query first — Deep Research will use it.', true); return; }
      modeNoteMsg('Starting Deep Research — follow the AGENT panel…');
      bridge.runResearch({ query: rq, attachmentIds: [] }).then(function (r) {
        if (r && r.started) modeNoteMsg('Deep Research started — follow the AGENT panel.');
        else modeNoteMsg((r && r.error) || 'Deep Research could not start.', true);
      }).catch(function () { modeNoteMsg('Deep Research request failed.', true); });
    }
  }

  renderModes();
  if (mode !== 'web') modeNoteMsg('Mode: ' + mode.toUpperCase());

  if (q) ask(q); else input.focus();
})();
</script>
<script>
  ${buildMatrixRainScript()}
</script>
</body>
</html>`;
}
