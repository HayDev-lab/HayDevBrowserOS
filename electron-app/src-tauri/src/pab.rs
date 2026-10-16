//! pab:// internal pages — Rust replacement for Electron's
//! `protocol.handle('pab', …)`.
//!
//! Serves the SAME generated HTML the Electron runtime serves:
//! `scripts/build-internal-pages.mjs` renders the TS builders
//! (`buildNewTabHtml` / `buildSearchPageHtml`) into
//! `.vite/build/internal/{newtab,search}.html` at build time; this handler
//! serves those files and answers the live JSON endpoints:
//! - `pab://newtab/api/news`     → Today-in-Tech (real HN top stories)
//! - `pab://newtab/api/topsites` → top sites from the real history store
//! - `pab://search?q=…`          → search page (Perplexica endpoint and
//!   verified-model placeholders substituted at serve time)

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::http::{self, Uri};
use tauri::AppHandle;

use crate::core;
use crate::types::HistoryQuery;

/// Where the build step writes the rendered internal pages, relative to the
/// electron-app working directory (dev) — resolved via candidates below.
const INTERNAL_PAGES_RELATIVE: &str = ".vite/build/internal";

fn internal_pages_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join(INTERNAL_PAGES_RELATIVE));
        out.push(cwd.join("..").join(INTERNAL_PAGES_RELATIVE));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // dev: target/{debug,release}/../../.vite/build/internal
            out.push(dir.join("../../../.vite/build/internal"));
            // packaged NSIS: <install>/internal (bundled via bundle.resources)
            out.push(dir.join("internal"));
            out.push(dir.join("resources/internal"));
        }
    }
    out
}

fn read_internal_page(name: &str) -> Option<String> {
    for base in internal_pages_candidates() {
        let path = base.join(name);
        if let Ok(html) = std::fs::read_to_string(&path) {
            return Some(html);
        }
    }
    None
}

/// Read a page in the USER'S language: the build step emits
/// `newtab.{en,ru,hy}.html` / `search.{en,ru,hy}.html` next to the plain
/// (English) fallbacks. Unknown/missing locale falls back to the plain
/// file — never a 404 (PROMPT 05 locale delivery).
fn read_internal_page_localed(base_name: &str) -> Option<String> {
    let locale = crate::commands::ui_locale();
    if locale != "en" {
        let dot = base_name.rfind('.')?; // "newtab.html" → "newtab" + ".html"
        let (stem, ext) = base_name.split_at(dot);
        if let Some(html) = read_internal_page(&format!("{stem}.{locale}{ext}")) {
            return Some(html);
        }
    }
    read_internal_page(base_name)
}

fn html_response(body: String) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .header(http::header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(http::header::CACHE_CONTROL, "no-store")
        .body(body.into_bytes())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn json_response(body: String) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .header(
            http::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .header(http::header::CACHE_CONTROL, "no-store")
        .body(body.into_bytes())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn not_found(what: &str) -> http::Response<Vec<u8>> {
    // Honest failure page — never a fake success.
    html_response(format!(
        "<!doctype html><meta charset='utf-8'><title>Internal page unavailable</title>\
         <body style=\"background:#02040a;color:#e8f0ff;font-family:system-ui;display:grid;\
         place-items:center;height:100vh;margin:0\">\
         <div style='max-width:34rem'><h2>{what} not available</h2>\
         <p>Run <code>npm run build:internal-pages</code> in <code>electron-app/</code> to \
         generate the internal page bundle for the Tauri runtime.</p></div></body>"
    ))
}

/// Cache the rendered news payload briefly so every new-tab open does not
/// hit HN afresh (the TS runtime re-fetches per request with retries; here a
/// 2-minute cache keeps parity of content without the traffic).
static NEWS_CACHE: Mutex<Option<(u64, String)>> = Mutex::new(None);
const NEWS_CACHE_TTL_MS: u64 = 120_000;

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Today-in-Tech port of `tech-news.ts` — real HN top stories, honest
/// empty array on any failure.
pub fn fetch_tech_news(limit: usize) -> String {
    let now = now_millis();
    let cache = NEWS_CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((ts, cached)) = cache.as_ref() {
        if now.saturating_sub(*ts) < NEWS_CACHE_TTL_MS {
            return cached.clone();
        }
    }
    drop(cache);

    let items = fetch_tech_news_uncached(limit, now);
    let payload = serde_json::json!({ "items": items }).to_string();
    *NEWS_CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some((now, payload.clone()));
    payload
}

fn fetch_tech_news_uncached(limit: usize, now: u64) -> serde_json::Value {
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_millis(2500))
        .build();
    let ids: Vec<i64> = match agent
        .get("https://hacker-news.firebaseio.com/v0/topstories.json")
        .call()
    {
        Ok(resp) => resp.into_json().unwrap_or_default(),
        Err(_) => return serde_json::json!([]),
    };
    let mut items = Vec::new();
    for id in ids.iter().take(limit * 3) {
        if items.len() >= limit {
            break;
        }
        let Ok(resp) = agent
            .get(&format!(
                "https://hacker-news.firebaseio.com/v0/item/{id}.json"
            ))
            .call()
        else {
            continue;
        };
        let Ok(story) = resp.into_json::<serde_json::Value>() else {
            continue;
        };
        let item_type = story.get("type").and_then(|v| v.as_str());
        let title = story.get("title").and_then(|v| v.as_str());
        if item_type != Some("story") {
            continue;
        }
        let Some(title) = title else { continue };
        let hn_id = story.get("id").and_then(|v| v.as_i64()).unwrap_or(*id);
        let url = story
            .get("url")
            .and_then(|v| v.as_str())
            .filter(|u| !u.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("https://news.ycombinator.com/item?id={hn_id}"));
        let age = story
            .get("time")
            .and_then(|v| v.as_i64())
            .map(|t| {
                let age_min = ((now as i64 - t * 1000) / 60_000).max(1);
                age_label(age_min)
            })
            .unwrap_or_default();
        let display_title = if title.chars().count() > 90 {
            let cut: String = title.chars().take(89).collect();
            format!("{cut}…")
        } else {
            title.to_string()
        };
        items.push(serde_json::json!({
            "rank": format!("{:02}", items.len() + 1),
            "title": display_title,
            "url": url,
            "discussionUrl": format!("https://news.ycombinator.com/item?id={hn_id}"),
            "age": age,
            "sourceKey": source_key_of(&url),
        }));
    }
    serde_json::json!(items)
}

fn age_label(min: i64) -> String {
    if min < 60 {
        return format!("{min}m ago");
    }
    let h = ((min as f64) / 60.0).round() as i64;
    if h < 24 {
        return format!("{h}h ago");
    }
    format!("{}d ago", ((h as f64) / 24.0).round() as i64)
}

fn source_key_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .map(|host| {
            let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
            let parts: Vec<&str> = host.split('.').collect();
            let key = if parts.len() >= 2 {
                parts[parts.len() - 2]
            } else {
                host.as_str()
            };
            let key = if key.is_empty() { host.as_str() } else { key };
            key.chars().take(2).flat_map(|c| c.to_uppercase()).collect()
        })
        .unwrap_or_else(|| "WW".to_string())
}

/// Top sites from the real history store (port of computeTopSites inputs).
/// The generated newtab page fetches this when rendered in the Tauri runtime.
fn topsites_payload(app: &AppHandle<tauri::Wry>) -> String {
    let entries = core::query_history(
        app,
        &HistoryQuery {
            limit: Some(200),
            since: None,
            search: None,
        },
    )
    .unwrap_or_default();
    let sites = compute_top_sites(&entries, 8);
    serde_json::json!({ "topSites": sites }).to_string()
}

/// Port of `computeTopSites` (newtab-page.ts): most-visited hosts with
/// best titles.
fn compute_top_sites(entries: &[crate::types::HistoryEntry], limit: usize) -> serde_json::Value {
    use std::collections::HashMap;
    let mut by_host: HashMap<String, (u64, String, String)> = HashMap::new(); // host → (score, url, title)
    for e in entries {
        let Ok(u) = url::Url::parse(&e.url) else {
            continue;
        };
        let Some(host) = u.host_str() else { continue };
        if host.is_empty() {
            continue;
        }
        let entry = by_host
            .entry(host.to_string())
            .or_insert((0, e.url.clone(), e.title.clone()));
        entry.0 += e.visit_count;
        if !e.title.is_empty() {
            entry.2 = e.title.clone();
        }
    }
    let mut sites: Vec<_> = by_host.into_iter().collect();
    sites.sort_by_key(|(_, (score, _, _))| std::cmp::Reverse(*score));
    serde_json::json!(sites
        .into_iter()
        .take(limit)
        .map(|(host, (score, url, title))| serde_json::json!({
            "host": host,
            "url": url,
            "title": title,
            "score": score,
        }))
        .collect::<Vec<_>>())
}

/// The `__pabNewTab` bridge API (Electron parity: isBridgeDocumentUrl allows
/// BOTH the newtab and the search document to call it — the mode switcher's
/// Deep Research button lives on the search page). Served from whichever
/// pab page received the request; `None` = not a bridge route.
fn bridge_api(
    app: &AppHandle<tauri::Wry>,
    path: &str,
    uri: &Uri,
    method: &str,
    body: &serde_json::Value,
    owner: &str,
) -> Option<http::Response<Vec<u8>>> {
    let respond = |v: serde_json::Value, status: u16| -> http::Response<Vec<u8>> {
        let mut resp = json_response(v.to_string());
        *resp.status_mut() = http::StatusCode::from_u16(status).unwrap_or(http::StatusCode::OK);
        resp
    };
    match (path, method) {
        ("/api/attachment/cancel", "POST") => {
            crate::attachments::cancel_owner_parsing(app, owner);
            Some(respond(serde_json::json!({"accepted":true}),200))
        }
        ("/api/attachment/release", "POST") => {
            let result = crate::attachments::release(app, body["id"].as_str().unwrap_or(""), owner);
            Some(match result { Ok(()) => respond(serde_json::json!({"released":true}),200), Err(e) => respond(serde_json::json!({"error":e.code}),400) })
        }
        ("/api/attachment/pick", "POST") => {
            let kind = body.get("kind").and_then(|v| v.as_str()).unwrap_or("file");
            let pick_id = crate::attachments::start_pick(app, kind, owner);
            Some(respond(serde_json::json!({ "pickId": pick_id }), 200))
        }
        ("/api/attachment/poll", "GET") => {
            let id = uri
                .query()
                .and_then(|q| q.split('&').find(|p| p.starts_with("id=")))
                .map(|p| urldecode(&p[3..]));
            Some(match id {
                Some(id) => match crate::attachments::poll_pick(app, &id, owner) {
                    Some(v) => respond(v, 200),
                    None => respond(serde_json::json!({ "error": "NOT_FOUND" }), 404),
                },
                None => respond(serde_json::json!({ "error": "invalid_request" }), 400),
            })
        }
        ("/api/research/run", "POST") => {
            let Some(query) = body.get("query").and_then(|v| v.as_str()) else {
                return Some(respond(serde_json::json!({ "started": false, "error": "invalid_request" }), 400));
            };
            let ids: Vec<String> = body
                .get("attachmentIds")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            Some(respond(start_research_run(app, query, &ids, owner), 200))
        }
        ("/api/navigate", "POST") => {
            let Some(url) = body.get("url").and_then(|v| v.as_str()) else {
                return Some(respond(serde_json::json!({ "error": "invalid_request" }), 400));
            };
            Some(navigate_in_existing_tab(app, url, &respond))
        }
        ("/api/research/status", "GET") => {
            use tauri::Manager;
            let Some(shared) = app.try_state::<crate::agent::SharedAgent>() else {
                return Some(respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500));
            };
            let shared = shared.inner().clone();
            let (state, steps, answer) = {
                let s = shared.snapshot.lock().unwrap_or_else(|p| p.into_inner());
                (
                    s.state.ui_state().to_string(),
                    s.steps_executed,
                    s.timeline
                        .iter()
                        .rev()
                        .find(|e| e.kind == "final_answer")
                        .and_then(|e| e.full_text.clone()),
                )
            };
            let report = shared
                .last_research_report
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .clone();
            Some(respond(
                serde_json::json!({ "state": state, "stepCount": steps, "answer": answer, "report": report }),
                200,
            ))
        }
        _ => None,
    }
}

/// Single-search-home policy (user decision 2026-10-03): a search NEVER
/// opens a new tab — it reuses an already-open tab of the target pab page
/// (navigating + activating it), or, if none exists yet, drives the ACTIVE
/// tab (the first search converts the current newtab). Bridge-only endpoint,
/// and only pab://search / pab://darkweb targets are accepted.
fn navigate_in_existing_tab(
    app: &AppHandle<tauri::Wry>,
    url: &str,
    respond: &dyn Fn(serde_json::Value, u16) -> http::Response<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let page = if url.starts_with("pab://search") || url.contains("//pab.search") {
        "pab://search"
    } else if url.starts_with("pab://darkweb") || url.contains("//pab.darkweb") {
        "pab://darkweb"
    } else {
        return respond(serde_json::json!({ "navigated": false, "error": "invalid_target" }), 400);
    };
    let existing = crate::core::with_state(app, |s| {
        s.registry
            .list()
            .into_iter()
            .find(|t| t.url.starts_with(page))
            .map(|t| t.id)
    })
    .unwrap_or(None);
    let target = existing.clone().or_else(|| {
        crate::core::with_state(app, |s| {
            s.registry
                .list()
                .into_iter()
                .find(|t| t.is_active)
                .map(|t| t.id)
        })
        .unwrap_or(None)
    });
    let Some(tab_id) = target else {
        return respond(serde_json::json!({ "navigated": false, "error": "no_active_tab" }), 500);
    };
    let nav = crate::core::navigate(
        app,
        &crate::types::NavigateRequest { tab_id: tab_id.clone(), url: url.to_string() },
    );
    let _ = crate::core::activate_tab(app, &tab_id);
    match nav {
        Ok(_) => respond(
            serde_json::json!({ "navigated": true, "tabId": tab_id, "reused": existing.is_some() }),
            200,
        ),
        Err(e) => respond(serde_json::json!({ "navigated": false, "error": e.message }), 500),
    }
}

/// Serve `pab://newtab` — the generated page plus live JSON endpoints
/// (news/topsites) and the attachment/research bridge API that backs
/// `window.__pabNewTab` (see attachments::BRIDGE_INIT_SCRIPT).
fn serve_newtab(
    app: &AppHandle<tauri::Wry>,
    path: &str,
    uri: &Uri,
    request: &tauri::http::Request<Vec<u8>>,
    owner: &str,
) -> http::Response<Vec<u8>> {
    let path = path.trim_end_matches('/');
    let method = request.method().as_str();
    let body: serde_json::Value = if method == "POST" {
        serde_json::from_slice(request.body()).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };
    if let Some(resp) = bridge_api(app, path, uri, method, &body, owner) {
        return resp;
    }
    match (path, method) {
        ("", "GET") | ("/", "GET") | ("/index.html", "GET") => match read_internal_page_localed("newtab.html") {
            Some(html) => html_response(html),
            None => not_found("pab://newtab"),
        },
        ("/api/news", "GET") => json_response(fetch_tech_news(4)),
        ("/api/topsites", "GET") => json_response(topsites_payload(app)),
        _ => not_found("pab://newtab"),
    }
}

/// Fire-and-forget DEEP_RESEARCH start (Electron `newtab:runResearch`
/// parity): validates the control gates synchronously, then runs the agent
/// loop on a worker thread — the page gets {started, error?} immediately
/// and follows progress through the agent timeline pushes.
fn start_research_run(
    app: &AppHandle<tauri::Wry>,
    query: &str,
    attachment_ids: &[String],
    owner: &str,
) -> serde_json::Value {
    use tauri::Manager;
    let query = query.trim();
    if query.is_empty() {
        return serde_json::json!({ "started": false, "error": "query is empty" });
    }
    if query.chars().count() > crate::attachments::NEWTAB_RESEARCH_QUERY_MAX {
        return serde_json::json!({ "started": false, "error": "query too long" });
    }
    let Some(shared) = app.try_state::<crate::agent::SharedAgent>() else {
        return serde_json::json!({ "started": false, "error": "agent state missing" });
    };
    let shared = shared.inner().clone();
    {
        let snap = shared.snapshot.lock().unwrap_or_else(|p| p.into_inner());
        if snap.state == crate::agent::AgentStatus::Running
            || snap.state == crate::agent::AgentStatus::WaitingForHuman
        {
            return serde_json::json!({
                "started": false,
                "error": "agent already running (or waiting for human) — stop it first"
            });
        }
    }
    let Some(control) = app.try_state::<crate::control::SharedControl>() else {
        return serde_json::json!({ "started": false, "error": "control state missing" });
    };
    let control = control.inner().clone();
    // AUTO-ESCALATION (user decision 2026-10-03): clicking the HayDev chip
    // IS the explicit authorization — a HUMAN-mode refusal here escalates
    // to AGENT for the duration of the run and reverts automatically when
    // it settles. Honest refusals remain: a run is already active, or TAKE
    // CONTROL is latched mid-run and switch_to_agent() declines.
    let mut escalated = false;
    let shared = {
        let mut cs = control.lock().unwrap_or_else(|p| p.into_inner());
        if !cs.mark_run_started() {
            if cs.switch_to_agent() && cs.mark_run_started() {
                escalated = true;
            } else {
                return serde_json::json!({
                    "started": false,
                    "error": "agent already running (or waiting for human) — stop it first"
                });
            }
        }
            crate::agent::begin_run(&shared)
    };
    if escalated {
        use tauri::Emitter;
        let _ = app.emit(
            "control:mode:update",
            serde_json::json!({ "mode": "AGENT", "takeover": false, "reason": "deep_research_autostart" }),
        );
        log::info!("[CONTROL] HUMAN -> AGENT auto-escalation for Deep Research");
    }
    let attachments = match crate::attachments::for_run(app, attachment_ids, owner, shared.lease.as_ref().unwrap().id) {
        Ok(a) => a,
        Err(e) => { control.lock().unwrap_or_else(|p| p.into_inner()).mark_run_ended(); return serde_json::json!({"started":false,"error":e.code}); }
    };
    let digests = &attachments.digests;
    let images = attachments.images.clone();
    let command = crate::attachments::compose_research_command(query, &digests);
    let handle = app.clone();
    std::thread::spawn(move || {
        let _attachments = attachments;
        let profile = "DEEP_RESEARCH".to_string();
        let _ = crate::agent::run_loop(
            handle.clone(),
            shared.clone(),
            &control,
            command,
            crate::agent::RESEARCH_MAX_STEPS_DEFAULT,
            &profile,
            images,
        );
        {
            let mut cs = control.lock().unwrap_or_else(|p| p.into_inner());
            if !shared.is_current() { return; }
            cs.mark_run_ended();
            // Revert the auto-escalation, but only if WE still own AGENT and
            // no new run started meanwhile (a manual HUMAN switch already
            // landed, or the user re-ran research — leave those untouched).
            if escalated
                && cs.mode == crate::control::ControlMode::Agent
                && !cs.agent_run_active
            {
                cs.switch_to_human();
                use tauri::Emitter;
                let _ = handle.emit(
                    "control:mode:update",
                    serde_json::json!({ "mode": "HUMAN", "takeover": false, "reason": "deep_research_finished" }),
                );
                log::info!("[CONTROL] AGENT -> HUMAN auto-revert after Deep Research");
            }
        }
    });
    serde_json::json!({ "started": true })
}

/// Serve `pab://search` — the generated page with runtime placeholders
/// (Perplexica endpoint + model key) substituted.
fn serve_search(
    app: &AppHandle<tauri::Wry>,
    uri: &Uri,
    request: &tauri::http::Request<Vec<u8>>,
    owner: &str,
) -> http::Response<Vec<u8>> {
    // The search page is a BRIDGE document (Electron isBridgeDocumentUrl):
    // its Deep Research mode calls the same attachment/research API as the
    // newtab page. Requests reach this handler attributed to page=search —
    // serve the bridge routes before the page itself.
    let method = request.method().as_str();
    if method == "POST" {
        let body: serde_json::Value =
            serde_json::from_slice(request.body()).unwrap_or(serde_json::Value::Null);
        if let Some(resp) = bridge_api(app, uri.path(), uri, method, &body, owner) {
            return resp;
        }
    } else if let Some(resp) = bridge_api(app, uri.path(), uri, method, &serde_json::Value::Null, owner) {
        return resp;
    }
    let Some(mut html) = read_internal_page_localed("search.html") else {
        return not_found("pab://search");
    };
    // Endpoint resolution order (parity with the Electron runtime):
    // managed engine → external env URL → default dev port.
    let managed = crate::runtime_manager::with_manager(app, |s| s.perplexica_endpoint()).flatten();
    let endpoint = managed
        .or_else(|| {
            std::env::var("PAB_PERPLEXICA_URL")
                .ok()
                .filter(|v| !v.trim().is_empty())
        })
        .unwrap_or_else(|| "http://127.0.0.1:3000".to_string());
    // Model preference (parity with Electron): live-verified model →
    // PAB_PERPLEXICA_MODEL → default. The verified model is read from the
    // probe CACHE (filled at startup by llm::warm_preferred_chat_model) —
    // this serve path never blocks on the network probe.
    let model = crate::llm::cached_preferred_chat_model()
        .or_else(|| {
            std::env::var("PAB_PERPLEXICA_MODEL")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_else(|| "deepseek-v4-pro:0813".to_string());
    let query = uri
        .query()
        .and_then(|q| q.split('&').find(|p| p.starts_with("q=")))
        .map(|p| urldecode(&p[2..]))
        .unwrap_or_default();
    html = html
        .replace("__PAB_PERPLEXICA_URL__", &endpoint)
        .replace("__PAB_PERPLEXICA_MODEL__", &model)
        .replace("__PAB_SEARCH_QUERY__", &query);
    html_response(html)
}

fn urldecode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The pab:// protocol handler registered in `lib.rs`. The Tauri runtime is
/// Wry (the only desktop runtime compiled here), so the handler is concrete.
///
/// URL FORMS: on Windows, WebView2 surfaces custom-scheme requests as
/// `http://pab.localhost/<page>/<path>` (host becomes `pab.localhost`, the
/// pab "host" becomes the first path segment). On platforms with true custom
/// schemes the URI stays `pab://<page>/<path>`. The split below handles both.
///
/// Relative `/api/*` fetches from a page resolve to `http://pab.localhost/api/…`
/// — they are attributed to the calling page via the Referer header
/// (newtab vs darkweb both use `/api/*` namespaces).
pub fn handle_pab(app: &AppHandle<tauri::Wry>, request: &tauri::http::Request<Vec<u8>>, owner: &str) -> http::Response<Vec<u8>> {
    let uri = request.uri().clone();
    let raw_host = uri.host().unwrap_or("");
    let raw_path = uri.path();
    let referer = request
        .headers()
        .get(http::header::REFERER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // Relative fetches inside a page at http://pab.localhost/<page> resolve
    // to http://pab.localhost/api/... — attribute /api/* to the calling page
    // via Referer (default: the newtab page, the historical behavior).
    let from_darkweb = referer.contains("darkweb");
    let (page, sub_path) =
        if raw_host == "pab.localhost" && raw_path.trim_start_matches('/').starts_with("api/") {
            if from_darkweb {
                ("darkweb".to_string(), raw_path.to_string())
            } else {
                ("newtab".to_string(), raw_path.to_string())
            }
        } else if raw_host == "pab.localhost" || raw_host == "pab" {
            let mut segs = raw_path.trim_start_matches('/').splitn(2, '/');
            let page = segs.next().unwrap_or("newtab").to_string();
            let rest = segs.next().unwrap_or("");
            (page, format!("/{rest}"))
        } else {
            (raw_host.to_string(), raw_path.to_string())
        };
    log::info!("[WEBVIEW] pab request page={page} path={sub_path}");
    match page.as_str() {
        "newtab" => serve_newtab(app, &sub_path, &uri, request, owner),
        "search" => serve_search(app, &uri, request, owner),
        "darkweb" => serve_darkweb(app, &sub_path, &uri, request, owner),
        _ => not_found("pab:// page"),
    }
}

// ---------------------------------------------------------------------------
// pab://darkweb — the search page + its JSON mini-API (port of
// darkweb-pab-api.ts; search/fetch/preview/status/settings/history are
// served from the Rust DarkWebService, crawl/index/quarantine answer
// honestly NOT_IMPLEMENTED).
// ---------------------------------------------------------------------------

fn serve_darkweb(
    app: &AppHandle<tauri::Wry>,
    path: &str,
    uri: &Uri,
    request: &tauri::http::Request<Vec<u8>>,
    _owner: &str,
) -> http::Response<Vec<u8>> {
    use tauri::Manager;
    let Some(service) = app.try_state::<crate::darkweb::SharedDarkWeb>() else {
        return not_found("pab://darkweb (service missing)");
    };
    let service = service.inner().clone();
    let path = path.trim_end_matches('/');
    let method = request.method().as_str();
    let body: serde_json::Value = if method == "POST" {
        serde_json::from_slice(request.body()).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    // GET / → the generated page.
    if (path.is_empty() || path == "/") && method == "GET" {
        return match read_internal_page_localed("darkweb.html") {
            Some(html) => html_response(html),
            None => not_found("pab://darkweb (run npm run build:internal-pages)"),
        };
    }

    // GET /open?url=<onion> → open an isolated Tor tab (parity).
    if path == "/open" && method == "GET" {
        let target = uri
            .query()
            .and_then(|q| q.split('&').find(|p| p.starts_with("url=")))
            .map(|p| urldecode(&p[4..]))
            .unwrap_or_default();
        let ok = crate::darkweb::is_onion_url(&target)
            && crate::core::prepare_open_tab(
                app,
                &crate::types::OpenTabRequest {
                    url: target.clone(),
                    activate: Some(true),
                    incognito: Some(false),
                    darkweb: Some(true),
                    background: None,
            agent: None,
                    id: None,
                    title: None,
                },
            )
            .map(|(tab_id, _, _, _, _)| {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Err(err) =
                        crate::core::materialize_open_tab(&handle, &tab_id, &target, false, true)
                    {
                        log::error!("[DARKWEB] tab create failed: {err}");
                    }
                });
                true
            })
            .is_ok();
        return html_response(format!(
            "<!doctype html><meta charset='utf-8'><title>Opening…</title>\
             <body style=\"background:#02040a;color:#9fb4d0;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0\"><p>{}</p>\
             <script>setTimeout(function(){{history.back()}},600)</script></body>",
            if ok { "Opening in an isolated Tor tab…" } else { "Could not open: URL is not a valid .onion address, or the Tor gateway is down." }
        ));
    }

    let api: &str = path.trim_start_matches('/');
    let respond = |v: serde_json::Value, status: u16| -> http::Response<Vec<u8>> {
        let mut resp = json_response(v.to_string());
        *resp.status_mut() = http::StatusCode::from_u16(status).unwrap_or(http::StatusCode::OK);
        resp
    };

    match (api, method) {
        ("api/status", "GET") => respond(service.ui_status(app), 200),
        ("api/providers", "GET") => {
            let status = service.ui_status(app);
            respond(status.get("providers").cloned().unwrap_or(serde_json::json!([])), 200)
        }
        ("api/settings", "GET") => respond(service.config().to_json(), 200),
        ("api/settings", "POST") => {
            {
                let mut cfg = service.config.lock().unwrap_or_else(|p| p.into_inner());
                cfg.apply_patch(&body);
                cfg.save(&service.data_dir);
            }
            respond(serde_json::json!({ "ok": true, "config": service.config().to_json() }), 200)
        }
        ("api/search", "POST") => {
            let Some(query) = body.get("query").and_then(|v| v.as_str()) else {
                return respond(serde_json::json!({ "error": "invalid_json" }), 400);
            };
            let providers = body.get("providers").and_then(|v| v.as_array()).map(|a| {
                a.iter().filter_map(|p| p.as_str().map(str::to_string)).collect::<Vec<_>>()
            });
            match service.search(app, query, providers) {
                Ok(v) => respond(v, 200),
                Err(code) => respond(serde_json::json!({ "error": code }), 400),
            }
        }
        (_, "GET") if api.starts_with("api/search/") => {
            let id = api.trim_start_matches("api/search/").trim_end_matches("/cancel");
            match service.get_search(id) {
                Some(v) => respond(v, 200),
                None => respond(serde_json::json!({ "error": "NOT_FOUND" }), 404),
            }
        }
        (_, "POST") if api.ends_with("/cancel") && api.starts_with("api/search/") => {
            let id = api.trim_start_matches("api/search/").trim_end_matches("/cancel");
            respond(serde_json::json!({ "ok": service.cancel_search(id) }), 200)
        }
        ("api/preview", "POST") => {
            let Some(url) = body.get("url").and_then(|v| v.as_str()) else {
                return respond(serde_json::json!({ "error": "invalid_json" }), 400);
            };
            // Electron parity: sanitized HTML fragment ({title, html, …}) —
            // the page renders it via srcdoc in a sandboxed iframe.
            let config = service.config();
            match crate::darkweb::fetch_preview_html(app, &config, url) {
                Ok(v) => respond(v, 200),
                Err(code) => respond(serde_json::json!({ "error": code }), 502),
            }
        }
        ("api/fetch", "POST") => {
            let Some(url) = body.get("url").and_then(|v| v.as_str()) else {
                return respond(serde_json::json!({ "error": "invalid_json" }), 400);
            };
            let mode = if body.get("mode").and_then(|v| v.as_str()) == Some("text") {
                "text"
            } else {
                "metadata"
            };
            let config = service.config();
            match crate::darkweb::fetch_page(app, &config, url, mode) {
                Ok(v) => respond(v, 200),
                Err(code) => respond(serde_json::json!({ "error": code }), 502),
            }
        }
        ("api/history", "GET") => respond(service.history_entries(), 200),
        ("api/history/clear", "POST") => {
            service.clear_history();
            respond(serde_json::json!({ "ok": true }), 200)
        }
        // Crawler + local index + quarantined downloads (Electron parity).
        ("api/crawl", "POST") => {
            use tauri::Manager;
            let Some(url) = body.get("url").and_then(|v| v.as_str()) else {
                return respond(serde_json::json!({ "error": "invalid_json" }), 400);
            };
            let get_u32 = |k: &str| body.get(k).and_then(|v| v.as_u64()).map(|v| v as u32);
            let Some(crawler) = app.try_state::<crate::crawl::CrawlRegistry>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            let config = service.config();
            match crawler.crawl(app, &config, url, get_u32("maxDepth"), get_u32("maxPages"), body.get("sameHostOnly").and_then(|v| v.as_bool())) {
                Ok(job_id) => respond(serde_json::json!({ "jobId": job_id }), 200),
                Err(code) => respond(serde_json::json!({ "error": code }), 400),
            }
        }
        (_, "GET") if api.starts_with("api/crawl/") && !api.ends_with("/cancel") => {
            use tauri::Manager;
            let id = api.trim_start_matches("api/crawl/");
            let Some(crawler) = app.try_state::<crate::crawl::CrawlRegistry>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            match crawler.status(id) {
                Some(s) => respond(serde_json::to_value(&s).unwrap_or_default(), 200),
                None => respond(serde_json::json!({ "error": "NOT_FOUND" }), 404),
            }
        }
        ("api/crawls", "GET") => {
            use tauri::Manager;
            let Some(crawler) = app.try_state::<crate::crawl::CrawlRegistry>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            respond(serde_json::json!({ "jobs": crawler.list() }), 200)
        }
        (_, "POST") if api.starts_with("api/crawl/") && api.ends_with("/cancel") => {
            use tauri::Manager;
            let id = api.trim_start_matches("api/crawl/").trim_end_matches("/cancel");
            let Some(crawler) = app.try_state::<crate::crawl::CrawlRegistry>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            respond(serde_json::json!({ "ok": crawler.cancel(id) }), 200)
        }
        ("api/index/add", "POST") => {
            use tauri::Manager;
            let (Some(url), Some(text)) = (
                body.get("url").and_then(|v| v.as_str()),
                body.get("text").and_then(|v| v.as_str()),
            ) else {
                return respond(serde_json::json!({ "error": "invalid_json" }), 400);
            };
            if !crate::darkweb::is_onion_url(url) {
                return respond(serde_json::json!({ "error": "ONION_ONLY" }), 400);
            }
            let Some(index) = app.try_state::<crate::crawl::SharedIndex>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            let mut index = index.lock().unwrap_or_else(|p| p.into_inner());
            let host = url.split("//").nth(1).and_then(|r| r.split('/').next()).unwrap_or("").to_string();
            let title = body.get("title").and_then(|v| v.as_str()).unwrap_or(url);
            let out = index.add(&crate::lib_app_data_dir().join("darkweb"), url, &host, title, text, crate::darkweb::now_ms(), None);
            respond(serde_json::json!({ "added": out.added, "reason": out.reason, "id": out.id }), 200)
        }
        ("api/index/search", "GET") => {
            use tauri::Manager;
            let q = uri
                .query()
                .and_then(|s| s.split('&').find(|p| p.starts_with("q=")).map(|p| urldecode(&p[2..])))
                .unwrap_or_default();
            let limit = uri
                .query()
                .and_then(|s| s.split('&').find(|p| p.starts_with("limit=")).and_then(|p| p[6..].parse::<usize>().ok()))
                .unwrap_or(20);
            let Some(index) = app.try_state::<crate::crawl::SharedIndex>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            let index = index.lock().unwrap_or_else(|p| p.into_inner());
            respond(serde_json::json!({ "hits": index.search(&q, limit) }), 200)
        }
        ("api/index/clear", "POST") => {
            use tauri::Manager;
            let Some(index) = app.try_state::<crate::crawl::SharedIndex>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            index.lock().unwrap_or_else(|p| p.into_inner()).clear(&crate::lib_app_data_dir().join("darkweb"));
            respond(serde_json::json!({ "ok": true }), 200)
        }
        ("api/downloads", "GET") => {
            use tauri::Manager;
            let Some(q) = app.try_state::<crate::downloads::SharedQuarantine>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            respond(serde_json::json!({ "downloads": q.lock().unwrap_or_else(|p| p.into_inner()).list() }), 200)
        }
        (_, "POST") if api.starts_with("api/downloads/") => {
            use tauri::Manager;
            let rest = api.trim_start_matches("api/downloads/");
            let (id, action) = match rest.rsplit_once('/') {
                Some(v) => v,
                None => return respond(serde_json::json!({ "error": "NOT_FOUND" }), 404),
            };
            let Some(q) = app.try_state::<crate::downloads::SharedQuarantine>() else {
                return respond(serde_json::json!({ "error": "STATE_NOT_INITIALIZED" }), 500);
            };
            let mut q = q.lock().unwrap_or_else(|p| p.into_inner());
            match action {
                "save" => match q.save(app, &crate::lib_app_data_dir().join("darkweb"), id) {
                    Ok(()) => respond(serde_json::json!({ "ok": true }), 200),
                    Err(reason) => respond(serde_json::json!({ "ok": false, "reason": reason }), 200),
                },
                "discard" => respond(serde_json::json!({ "ok": q.discard(id) }), 200),
                _ => respond(serde_json::json!({ "error": "NOT_FOUND" }), 404),
            }
        }
        _ => respond(serde_json::json!({ "error": "NOT_FOUND" }), 404),
    }
}
