//! Typed Tauri commands — the Rust counterparts of the Electron IPC
//! channels. Browser core, agent loop (provider-agnostic LLM), control
//! authorization, vault (DPAPI + login capture), dark-web search and the
//! managed engines are REAL implementations; the few remaining gaps
//! (attachments, memory prompts, download cancel) answer with honest
//! FEATURE_NOT_AVAILABLE errors — never fake success.

use serde::Deserialize;
use serde_json::Value;

use tauri::{AppHandle, Manager};

use crate::bridge;
use crate::core;
use crate::error::{AppError, AppResult};
use crate::types;

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn app_version() -> types::AppVersionInfo {
    types::AppVersionInfo {
        electron: "tauri-2".into(),
        chrome: "webview2".into(),
        node: "none".into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
    }
}

#[tauri::command]
pub fn foundation_ping(payload: types::FoundationPingPayload) -> types::FoundationPingResult {
    types::FoundationPingResult {
        received_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        echoed: payload,
    }
}

/// Runtime status of the Perplexica backend: managed endpoint FIRST,
/// external env URL as dev-adopt fallback, honest `reachable:false` else.
/// `state` tells the footer chip whether an unreachable probe is a real
/// outage ("offline") or just the boot window ("starting").
#[tauri::command]
pub async fn app_runtime_status(app: AppHandle<tauri::Wry>) -> AppResult<types::RuntimeStatus> {
    let perplexica_state =
        crate::runtime_manager::with_manager(&app, |s| s.service_state("perplexica")).flatten();
    let managed = crate::runtime_manager::with_manager(&app, |s| s.perplexica_endpoint()).flatten();
    let endpoint = managed
        .or_else(|| {
            std::env::var("PAB_PERPLEXICA_URL")
                .ok()
                .filter(|v| !v.trim().is_empty())
        })
        .unwrap_or_else(|| "http://127.0.0.1:3000".to_string());
    let endpoint_for_probe = endpoint.clone();
    let reachable =
        tauri::async_runtime::spawn_blocking(move || probe_http_endpoint(&endpoint_for_probe))
            .await
            .map_err(|e| AppError::new("RUNTIME_PROBE_FAILED", e.to_string()))?;
    use crate::runtime_manager::ServiceState;
    let state = match perplexica_state {
        Some(ServiceState::Ready) if reachable => "ready",
        Some(ServiceState::Starting) | Some(ServiceState::Bootstrapping) => "starting",
        _ if reachable => "ready",
        _ => "offline",
    }
    .to_string();
    Ok(types::RuntimeStatus {
        endpoint,
        reachable,
        state,
    })
}

// ---------------------------------------------------------------------------
// Managed engines (perplexica / searxng / tor) — Phase 7
// ---------------------------------------------------------------------------

/// Full managed-engine status (state/endpoint/source/pid per engine).
#[tauri::command]
pub fn runtime_manager_status(app: AppHandle<tauri::Wry>) -> AppResult<serde_json::Value> {
    crate::runtime_manager::with_manager(&app, |s| s.status_json())
        .ok_or_else(|| AppError::new("STATE_NOT_INITIALIZED", "runtime manager missing"))
}

/// Re/kick the managed-engine start sequence (non-blocking).
#[tauri::command]
pub fn runtime_manager_start(app: AppHandle<tauri::Wry>) -> AppResult<bool> {
    let manager = app
        .try_state::<crate::runtime_manager::SharedRuntimeManager>()
        .ok_or_else(|| AppError::new("STATE_NOT_INITIALIZED", "runtime manager missing"))?;
    let manager = manager.inner().clone();
    std::thread::spawn(move || crate::runtime_manager::start_all(&manager));
    Ok(true)
}

/// Stop managed engines (tree-kill); adopted external endpoints untouched.
#[tauri::command]
pub fn runtime_manager_stop(app: AppHandle<tauri::Wry>) -> AppResult<bool> {
    let manager = app
        .try_state::<crate::runtime_manager::SharedRuntimeManager>()
        .ok_or_else(|| AppError::new("STATE_NOT_INITIALIZED", "runtime manager missing"))?;
    crate::runtime_manager::stop_all(manager.inner());
    Ok(true)
}

/// The tab-environment automation/debug port (loopback only). Diagnostic
/// surface for the BrowserAutomationBridge and E2E tooling.
#[tauri::command]
pub fn browser_debug_port() -> u16 {
    core::tab_debug_port()
}

// ---------------------------------------------------------------------------
// BrowserAutomationBridge (Phase D) — agent-facing page control
// ---------------------------------------------------------------------------

/// Evaluate an arbitrary expression in the tab; returns the JSON value.
#[tauri::command]
pub async fn browser_evaluate(
    app: AppHandle<tauri::Wry>,
    req: types::BridgeEvalRequest,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        bridge::evaluate(&handle, &req.tab_id, &req.expression)
    })
    .await
    .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Click the first element matching `selector` (real DOM click after focus).
#[tauri::command]
pub async fn browser_click(
    app: AppHandle<tauri::Wry>,
    req: types::BridgeSelectorRequest,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || bridge::click(&handle, &req.tab_id, &req.selector))
        .await
        .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Type into an input/textarea (React-safe native setter + input event).
#[tauri::command]
pub async fn browser_type_text(
    app: AppHandle<tauri::Wry>,
    req: types::BridgeTypeRequest,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        bridge::r#type(&handle, &req.tab_id, &req.selector, &req.text, req.clear)
    })
    .await
    .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Dispatch a key (down+up) on the active element.
#[tauri::command]
pub async fn browser_press_key(
    app: AppHandle<tauri::Wry>,
    req: types::BridgeKeyRequest,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || bridge::press_key(&handle, &req.tab_id, &req.key))
        .await
        .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Scroll the page by (dx, dy) logical pixels.
#[tauri::command]
pub async fn browser_scroll_by(
    app: AppHandle<tauri::Wry>,
    req: types::BridgeScrollRequest,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        bridge::scroll(&handle, &req.tab_id, req.dx, req.dy)
    })
    .await
    .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Bounded a11y-ish DOM snapshot (interactive nodes with rects).
#[tauri::command]
pub async fn browser_dom_snapshot(
    app: AppHandle<tauri::Wry>,
    req: types::TabIdRequest,
    max: Option<usize>,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    let max = max.unwrap_or(120).min(400);
    tauri::async_runtime::spawn_blocking(move || bridge::dom_snapshot(&handle, &req.tab_id, max))
        .await
        .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Page-side wait for a selector (MutationObserver-free 150ms poll, in-page).
#[tauri::command]
pub async fn browser_wait_selector(
    app: AppHandle<tauri::Wry>,
    req: types::BridgeSelectorRequest,
    timeout_ms: Option<u64>,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    let tmo = timeout_ms.unwrap_or(10_000).min(30_000);
    tauri::async_runtime::spawn_blocking(move || {
        bridge::wait_for_selector(&handle, &req.tab_id, &req.selector, tmo)
    })
    .await
    .map_err(|e| AppError::new("BRIDGE_JOIN_FAILED", e.to_string()))?
}

/// Real page PNG via the tab CDP port; saved under userData/screenshots.
#[tauri::command]
pub async fn browser_screenshot(
    app: AppHandle<tauri::Wry>,
    req: types::TabIdRequest,
) -> AppResult<serde_json::Value> {
    // Needle = the tab's committed URL (display form matching in cdp.rs).
    let (needle, tab_id) = core::with_state(&app, |state| {
        state
            .registry
            .get(&req.tab_id)
            .map(|t| (t.url.clone(), t.id.clone()))
            .unwrap_or_default()
    })?;
    if needle.is_empty() {
        return Err(AppError::new(
            "TAB_NOT_FOUND",
            format!("no tab {}", req.tab_id),
        ));
    }
    let port = core::tab_debug_port();
    let dir = crate::lib_app_data_dir().join("screenshots");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("{tab_id}-{stamp}.png"));
    tauri::async_runtime::spawn_blocking(move || {
        // Port retries: the tab browser process may attach its debugger on a
        // neighbouring port if 9330 was taken at creation time. Every failed
        // port's step-trace is preserved for the final error.
        let mut trace: Vec<String> = Vec::new();
        let mut last: Option<AppError> = None;
        for p in port..=port + 30 {
            match crate::cdp::capture_screenshot(p, &needle, &path) {
                Ok(saved) => return Ok(saved),
                Err(mut e) => {
                    if let Some(serde_json::Value::Object(map)) = &mut e.details {
                        if let Some(serde_json::Value::Array(steps)) = map.get_mut("steps") {
                            steps.insert(0, serde_json::json!(format!("TRY PORT {p}")));
                        }
                    }
                    let transport_err =
                        matches!(e.code.as_str(), "CDP_CONNECT_FAILED" | "CDP_LIST_FAILED");
                    trace.push(format!("port {p}: {}", e.message));
                    if transport_err {
                        last = Some(e);
                        continue;
                    }
                    e.details = Some(serde_json::json!({ "steps": trace }));
                    return Err(e);
                }
            }
        }
        let mut err = last.unwrap_or_else(|| AppError::new("CDP_SHOT_FAILED", "no port answered"));
        err.details = Some(serde_json::json!({ "steps": trace }));
        Err(err)
    })
    .await
    .map_err(|e| AppError::new("SHOT_JOIN_FAILED", e.to_string()))?
    .map(|p| {
        serde_json::json!({
            "ok": true,
            "path": p.to_string_lossy(),
        })
    })
}

// ---------------------------------------------------------------------------
// Challenge detection + same-session human handoff (Phase F)
// ---------------------------------------------------------------------------

/// Detect a challenge (CAPTCHA/Turnstile/reCAPTCHA/hCaptcha/2FA/login/
/// rate-limit/denied) in a tab. NO retry loop, NO identity rotation — on a
/// challenge the caller must pause and hand off to the human.
#[tauri::command]
pub async fn browser_challenge_detect(
    app: AppHandle<tauri::Wry>,
    req: types::TabIdRequest,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        crate::challenge::detect_and_record(&handle, &req.tab_id)
    })
    .await
    .map_err(|e| AppError::new("DETECT_JOIN_FAILED", e.to_string()))??;
    serde_json::to_value(info).map_err(|e| AppError::new("SERIALIZATION_ERROR", e.to_string()))
}

/// Current handoff state for a tab (NONE/WAITING_FOR_HUMAN/RESUMED/CANCELLED).
#[tauri::command]
pub fn browser_challenge_handoff(
    app: AppHandle<tauri::Wry>,
    req: types::TabIdRequest,
) -> serde_json::Value {
    serde_json::to_value(crate::challenge::handoff_of(&app, &req.tab_id))
        .unwrap_or(serde_json::Value::Null)
}

/// Resolve a handoff: proceed=true re-detects in the SAME session (still
/// challenged → stays WAITING_FOR_HUMAN; cleared → RESUMED); false cancels.
#[tauri::command]
pub async fn browser_challenge_resolve(
    app: AppHandle<tauri::Wry>,
    req: types::TabIdRequest,
    proceed: bool,
) -> AppResult<serde_json::Value> {
    let handle = app.clone();
    let handoff = tauri::async_runtime::spawn_blocking(move || {
        crate::challenge::resolve(&handle, &req.tab_id, proceed)
    })
    .await
    .map_err(|e| AppError::new("RESOLVE_JOIN_FAILED", e.to_string()))??;
    serde_json::to_value(handoff).map_err(|e| AppError::new("SERIALIZATION_ERROR", e.to_string()))
}

// ---------------------------------------------------------------------------
// Browser profiles (Phase B)
// ---------------------------------------------------------------------------

/// List profile kinds + whether their persistent data exists on disk.
#[tauri::command]
pub fn profile_status() -> AppResult<serde_json::Value> {
    let manager = crate::profiles::BrowserProfileManager::new(&crate::lib_app_data_dir());
    Ok(serde_json::json!([{
        "kind": "default", "persistent": true,
        "dataDir": manager.data_dir(crate::profiles::ProfileKind::Default),
        "exists": manager.data_dir(crate::profiles::ProfileKind::Default).is_some_and(|d| d.exists()),
    }, {
        "kind": "agent", "persistent": true,
        "dataDir": manager.data_dir(crate::profiles::ProfileKind::Agent),
        "exists": manager.data_dir(crate::profiles::ProfileKind::Agent).is_some_and(|d| d.exists()),
    }, {
        "kind": "private", "persistent": false, "dataDir": null, "exists": false,
    }]))
}

/// Wipe a persistent profile's data. Refused while any live tab uses it
/// (PRIVATE keeps nothing on disk — clearing it is a no-op returning false).
#[tauri::command]
pub fn profile_clear(app: AppHandle<tauri::Wry>, kind: String) -> AppResult<bool> {
    let profile = match kind.as_str() {
        "default" => crate::profiles::ProfileKind::Default,
        "agent" => crate::profiles::ProfileKind::Agent,
        "private" => crate::profiles::ProfileKind::Private,
        other => {
            return Err(AppError::new(
                "UNKNOWN_PROFILE",
                format!("unknown profile kind: {other}"),
            ))
        }
    };
    if profile == crate::profiles::ProfileKind::Private {
        return Ok(false);
    }
    // Live-tab guard: refuse while tabs reference this profile.
    let in_use = core::with_state(&app, |state| {
        state
            .registry
            .list()
            .iter()
            .any(|t| !t.is_incognito == (profile == crate::profiles::ProfileKind::Default))
    })?;
    if in_use {
        return Err(AppError::new(
            "PROFILE_IN_USE",
            "close the tabs using this profile before clearing it",
        ));
    }
    let manager = crate::profiles::BrowserProfileManager::new(&crate::lib_app_data_dir());
    manager
        .clear(profile)
        .map_err(|e| AppError::new("PROFILE_CLEAR_FAILED", e.to_string()))
}

fn probe_http_endpoint(endpoint: &str) -> bool {
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    let host = url.host_str().unwrap_or("127.0.0.1").to_string();
    let port = url.port_or_known_default().unwrap_or(80);
    let addrs: Vec<std::net::SocketAddr> =
        match format!("{host}:{port}").parse::<std::net::SocketAddr>() {
            Ok(addr) => vec![addr],
            Err(_) => {
                use std::net::ToSocketAddrs;
                (host.as_str(), port)
                    .to_socket_addrs()
                    .map(|it| it.collect())
                    .unwrap_or_default()
            }
        };
    addrs.iter().any(|addr| {
        std::net::TcpStream::connect_timeout(addr, std::time::Duration::from_millis(300)).is_ok()
    })
}

// ---------------------------------------------------------------------------
// Browser — tabs & navigation (REAL)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn browser_tabs_list(app: AppHandle<tauri::Wry>) -> AppResult<Vec<types::TabState>> {
    core::list_tabs(&app)
}

#[tauri::command]
pub async fn browser_tabs_open(
    app: AppHandle<tauri::Wry>,
    req: types::OpenTabRequest,
) -> AppResult<String> {
    // Registry state updates immediately; the webview itself is created on
    // the NEXT event-loop tick — creating a WebView2 controller from inside
    // the invoke callback deadlocks the message pump (verified live).
    let (tab_id, activated, incognito, _darkweb, target) = core::prepare_open_tab(&app, &req)?;
    let handle = app.clone();
    let tab_for_create = tab_id.clone();
    app.run_on_main_thread(move || {
        if let Err(err) =
            core::materialize_open_tab(&handle, &tab_for_create, &target, incognito, activated)
        {
            log::error!("[TAB] deferred webview create failed: {err}");
        }
    })
    .map_err(|e| AppError::new("RUN_ON_MAIN_FAILED", e.to_string()))?;
    Ok(tab_id)
}

#[tauri::command]
pub fn browser_tabs_close(app: AppHandle<tauri::Wry>, req: types::TabIdRequest) -> AppResult<bool> {
    core::close_tab(&app, &req.tab_id)
}

#[tauri::command]
pub fn browser_tabs_activate(
    app: AppHandle<tauri::Wry>,
    req: types::TabIdRequest,
) -> AppResult<bool> {
    core::activate_tab(&app, &req.tab_id)
}

#[tauri::command]
pub fn browser_navigate(
    app: AppHandle<tauri::Wry>,
    req: types::NavigateRequest,
) -> AppResult<bool> {
    core::navigate(&app, &req)
}

#[tauri::command]
pub fn browser_back(app: AppHandle<tauri::Wry>, req: types::TabIdRequest) -> AppResult<bool> {
    core::nav_back(&app, &req.tab_id)
}

#[tauri::command]
pub fn browser_forward(app: AppHandle<tauri::Wry>, req: types::TabIdRequest) -> AppResult<bool> {
    core::nav_forward(&app, &req.tab_id)
}

#[tauri::command]
pub fn browser_reload(app: AppHandle<tauri::Wry>, req: types::TabIdRequest) -> AppResult<bool> {
    core::reload_tab(&app, &req.tab_id)
}

#[tauri::command]
pub fn browser_stop(app: AppHandle<tauri::Wry>, req: types::TabIdRequest) -> AppResult<bool> {
    core::stop_tab(&app, &req.tab_id)
}

// ---------------------------------------------------------------------------
// Browser — history & bookmarks (REAL, same files as Electron)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn browser_history_query(
    app: AppHandle<tauri::Wry>,
    query: types::HistoryQuery,
) -> AppResult<Vec<types::HistoryEntry>> {
    core::query_history(&app, &query)
}

#[tauri::command]
pub fn browser_history_delete(app: AppHandle<tauri::Wry>, id: String) -> AppResult<bool> {
    core::delete_history(&app, &id)
}

#[tauri::command]
pub fn browser_history_clear(app: AppHandle<tauri::Wry>) -> AppResult<()> {
    core::clear_history(&app)
}

#[tauri::command]
pub fn browser_history_add(
    app: AppHandle<tauri::Wry>,
    req: types::HistoryAddRequest,
) -> AppResult<types::HistoryEntry> {
    core::add_history(&app, &req)
}

#[tauri::command]
pub fn browser_bookmarks_list(app: AppHandle<tauri::Wry>) -> AppResult<Vec<types::Bookmark>> {
    core::list_bookmarks(&app)
}

#[tauri::command]
pub fn browser_bookmarks_add(
    app: AppHandle<tauri::Wry>,
    req: types::BookmarkAddRequest,
) -> AppResult<types::Bookmark> {
    core::add_bookmark(&app, &req)
}

#[tauri::command]
pub fn browser_bookmarks_delete(app: AppHandle<tauri::Wry>, id: String) -> AppResult<bool> {
    core::delete_bookmark(&app, &id)
}

// ---------------------------------------------------------------------------
// Browser — downloads (REAL registry; cancel honestly unsupported)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn browser_downloads_list(
    app: AppHandle<tauri::Wry>,
) -> AppResult<Vec<types::DownloadItemState>> {
    core::list_downloads(&app)
}

#[tauri::command]
pub fn browser_downloads_cancel(_app: AppHandle<tauri::Wry>, _id: String) -> AppResult<bool> {
    // WebView2's download bridge (Tauri 2.11) exposes no cancel handle.
    Err(AppError::new(
        "DOWNLOAD_CANCEL_UNSUPPORTED",
        "WebView2 downloads cannot be cancelled through the current Tauri download bridge; \
         the file save itself is real.",
    ))
}

#[tauri::command]
pub fn browser_downloads_remove(app: AppHandle<tauri::Wry>, id: String) -> AppResult<bool> {
    core::with_state(&app, |state| state.downloads.remove(&id))
}

// ---------------------------------------------------------------------------
// Subsystems retained on the Electron runtime — honest NOT_AVAILABLE
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent runtime (REAL: Rust LLM loop over the BrowserAutomationBridge)
// ---------------------------------------------------------------------------

/// Run the agent task. The loop runs on a worker thread; this command waits
/// for its completion (bounded by max_steps) and returns the final snapshot
/// in the Electron AgentRunResult contract.
#[tauri::command]
pub async fn agent_run(
    app: AppHandle<tauri::Wry>,
    req: crate::agent::AgentRunRequest,
) -> AppResult<Value> {
    let shared = app
        .try_state::<crate::agent::SharedAgent>()
        .ok_or_else(|| AppError::new("STATE_NOT_INITIALIZED", "agent state missing"))?
        .inner()
        .clone();
    // Refuse double-runs honestly.
    {
        let snap = shared.snapshot.lock().unwrap_or_else(|p| p.into_inner());
        if snap.state == crate::agent::AgentStatus::Running
            || snap.state == crate::agent::AgentStatus::WaitingForHuman
        {
            return Ok(serde_json::json!({
                "status": "error",
                "message": "agent already running (or waiting for human) — stop it first"
            }));
        }
    }
    // Control gate (parity: canStartAgentRun) — runs start in AGENT mode only.
    let control = app
        .try_state::<crate::control::SharedControl>()
        .ok_or_else(|| AppError::new("STATE_NOT_INITIALIZED", "control state missing"))?
        .inner()
        .clone();
    {
        let mut cs = control.lock().unwrap_or_else(|p| p.into_inner());
        if !cs.mark_run_started() {
            return Ok(serde_json::json!({
                "status": "error",
                "state": cs.mode.as_str(),
                "message": "switch to AGENT mode first (the run is refused in HUMAN mode)",
            }));
        }
    }
    let profile = req.profile.clone().unwrap_or_else(|| "STANDARD".to_string());
    let is_research = profile == "DEEP_RESEARCH";
    let default_steps = if is_research {
        crate::agent::RESEARCH_MAX_STEPS_DEFAULT
    } else {
        crate::agent::MAX_STEPS_DEFAULT
    };
    let max_steps = req
        .max_steps
        .unwrap_or(default_steps)
        .clamp(1, crate::agent::MAX_STEPS_HARD_CAP);
    let task = req.command.clone();
    // Direct agent:run has no attachment channel yet (the research path via
    // pab://newtab is the only vision seed — Electron parity).
    let images: Vec<String> = Vec::new();
    let control_for_loop = control.clone();
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::agent::run_loop(handle, shared, &control_for_loop, task, max_steps, &profile, images)
    })
    .await
    .map_err(|e| AppError::new("AGENT_JOIN_FAILED", e.to_string()));
    control.lock().unwrap_or_else(|p| p.into_inner()).mark_run_ended();
    let snap = result?;
    let ok = snap.state == crate::agent::AgentStatus::Done;
    let state = snap.state.ui_state();
    Ok(serde_json::json!({
        "status": if ok { "ok" } else if snap.state == crate::agent::AgentStatus::WaitingForHuman { "waiting_for_human" } else { "error" },
        "state": state,
        "stepCount": snap.steps_executed,
        "answer": snap
            .timeline
            .iter()
            .rev()
            .find(|e| e.kind == "final_answer")
            .map(|e| serde_json::Value::String(e.full_text.clone().unwrap_or_else(|| e.summary.clone())))
            .unwrap_or(serde_json::Value::Null),
        "reason": snap.reason,
        "error": snap.error,
    }))
}

#[tauri::command]
pub fn agent_stop(app: AppHandle<tauri::Wry>, _reason: Option<String>) -> Value {
    let Some(shared) = app.try_state::<crate::agent::SharedAgent>() else {
        return serde_json::json!({ "accepted": false });
    };
    shared.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    serde_json::json!({ "accepted": true })
}

/// Full AgentStatusSnapshot (Electron contract) — state, control mode,
/// provider config (no key material).
#[tauri::command]
pub fn agent_status(app: AppHandle<tauri::Wry>) -> Value {
    let Some(shared) = app.try_state::<crate::agent::SharedAgent>() else {
        return serde_json::json!({ "state": "IDLE", "stepCount": 0 });
    };
    crate::agent::status_payload(&app, shared.inner())
}

/// Timeline entries in the Electron AgentTimelineEntry shape.
#[tauri::command]
pub fn agent_timeline_list(app: AppHandle<tauri::Wry>) -> Vec<Value> {
    let Some(shared) = app.try_state::<crate::agent::SharedAgent>() else {
        return Vec::new();
    };
    let shared = shared.inner();
    let snap = shared.snapshot.lock().unwrap_or_else(|p| p.into_inner());
    snap.timeline
        .iter()
        .enumerate()
        .map(|(i, e)| e.to_payload(&format!("t_{:?}_{}", e.at, i)))
        .collect()
}

#[tauri::command]
pub fn agent_research_report(app: AppHandle<tauri::Wry>) -> Option<Value> {
    let shared = app.try_state::<crate::agent::SharedAgent>()?;
    let report = shared.last_research_report.lock().unwrap_or_else(|p| p.into_inner());
    report.clone()
}

#[tauri::command]
pub fn agent_pick_attachment(
    app: tauri::AppHandle<tauri::Wry>,
    kind: Option<String>,
) -> AppResult<Value> {
    // Sync command → runs on the command thread pool, so the modal dialog is
    // safe here (never the main thread). Same pick core as the newtab
    // bridge; the descriptor lands in the SAME registry the research run
    // consumes. Electron parity shape: { attachment: null | {...} }.
    let kind = kind.as_deref().unwrap_or("file");
    Ok(serde_json::json!({
        "attachment": crate::attachments::blocking_pick(&app, kind),
    }))
}

// ---------------------------------------------------------------------------
// Control mode (REAL — control.rs state machine + control:mode:update push)
// ---------------------------------------------------------------------------

fn emit_mode_update(app: &AppHandle<tauri::Wry>, mode: &str, takeover: bool, reason: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "control:mode:update",
        serde_json::json!({ "mode": mode, "takeover": takeover, "reason": reason }),
    );
}

#[tauri::command]
pub fn control_set_mode(app: AppHandle<tauri::Wry>, mode: String) -> Value {
    let mode = mode.trim().to_uppercase();
    if mode != "HUMAN" && mode != "AGENT" {
        return serde_json::json!({ "accepted": false, "reason": "UNKNOWN_MODE" });
    }
    let Some(control) = app.try_state::<crate::control::SharedControl>() else {
        return serde_json::json!({ "accepted": false, "reason": "STATE_NOT_INITIALIZED" });
    };
    let mut cs = control
        .inner()
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    if mode == "AGENT" {
        if !cs.switch_to_agent() {
            return serde_json::json!({ "accepted": false, "reason": "run_already_active" });
        }
        emit_mode_update(&app, "AGENT", false, "user_request");
        return serde_json::json!({ "accepted": true, "mode": "AGENT" });
    }
    // HUMAN: stop any running agent (takeover semantics without the latch).
    if let Some(shared) = app.try_state::<crate::agent::SharedAgent>() {
        shared.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    cs.switch_to_human();
    emit_mode_update(&app, "HUMAN", false, "user_request");
    serde_json::json!({ "accepted": true, "mode": "HUMAN" })
}

#[tauri::command]
pub fn control_take_control(app: AppHandle<tauri::Wry>, reason: Option<String>) -> Value {
    let Some(control) = app.try_state::<crate::control::SharedControl>() else {
        return serde_json::json!({ "accepted": false });
    };
    // The human takes over: stop the agent, latch the takeover.
    if let Some(shared) = app.try_state::<crate::agent::SharedAgent>() {
        shared.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    control
        .inner()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take_control();
    let reason = reason.unwrap_or_else(|| "user_request".to_string());
    emit_mode_update(&app, "HUMAN", true, &reason);
    serde_json::json!({ "accepted": true })
}

#[tauri::command]
pub fn control_get_mode(app: AppHandle<tauri::Wry>) -> String {
    app.try_state::<crate::control::SharedControl>()
        .map(|c| c.inner().lock().unwrap_or_else(|p| p.into_inner()).mode.as_str().to_string())
        .unwrap_or_else(|| "HUMAN".to_string())
}

// ---------------------------------------------------------------------------
// Credential vault (Phase H — REAL: DPAPI, Electron-format credentials.vault)
// ---------------------------------------------------------------------------

fn vault_instance() -> crate::vault::Vault {
    crate::vault::Vault::new(&crate::lib_app_data_dir())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSaveRequest {
    pub domain: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultHasRequest {
    pub domain: String,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultGenerateRequest {
    pub domain: String,
    pub username: String,
    /// Generated password length, clamped 16..=64 (default 20).
    pub length: Option<usize>,
}

fn generate_password(len: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        | 1;
    // xorshift64 — fine for password-ish entropy on a desktop app.
    let mut out = String::with_capacity(len);
    for _ in 0..len {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        out.push(ALPHABET[(seed % ALPHABET.len() as u64) as usize] as char);
    }
    out
}

#[tauri::command]
pub fn vault_save(req: VaultSaveRequest) -> AppResult<Value> {
    let rec = vault_instance().save(&req.domain, &req.username, &req.password, || {
        uuid::Uuid::new_v4().to_string()
    })?;
    Ok(serde_json::json!({
        "success": true,
        "record": {
            "id": rec.id, "domain": rec.domain, "username": rec.username,
            "createdAt": rec.created_at, "updatedAt": rec.updated_at,
        }
    }))
}

#[tauri::command]
pub fn vault_has(req: VaultHasRequest) -> AppResult<Value> {
    let has = vault_instance().has(&req.domain, req.username.as_deref())?;
    Ok(serde_json::json!({ "has": has }))
}

#[tauri::command]
pub fn vault_list() -> AppResult<Value> {
    let records = vault_instance().list()?;
    Ok(serde_json::json!({ "credentials": records }))
}

#[tauri::command]
pub fn vault_generate_and_store(req: VaultGenerateRequest) -> AppResult<Value> {
    let len = req.length.unwrap_or(20).clamp(16, 64);
    let password = generate_password(len);
    let rec = vault_instance().save(&req.domain, &req.username, &password, || {
        uuid::Uuid::new_v4().to_string()
    })?;
    Ok(serde_json::json!({
        "success": true,
        "generated": password,
        "record": { "id": rec.id, "domain": rec.domain, "username": rec.username }
    }))
}

/// Fill login fields of the ACTIVE tab from a vault record, via the bridge.
/// The decrypted password exists only inside this command's stack — it is
/// never logged, persisted, or returned to the renderer.
#[tauri::command]
pub async fn vault_fill(app: AppHandle<tauri::Wry>, input: Value) -> AppResult<Value> {
    let Some(id) = input.get("id").and_then(|v| v.as_str()).map(str::to_string) else {
        return Err(AppError::new(
            "INVALID_ARGS",
            "vault_fill: missing input.id",
        ));
    };
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = vault_instance();
        // Decrypt stays server-side (Rust) — the bridge sees field values only.
        let password = vault.decrypt_password(&id)?;
        let record = vault
            .list()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::new("VAULT_RECORD_NOT_FOUND", id.clone()))?;
        // Which tab? The active one.
        let tab_id = crate::core::with_state(&handle, |s| {
            s.registry
                .list()
                .into_iter()
                .find(|t| t.is_active)
                .map(|t| t.id)
        })
        .unwrap_or_default()
        .ok_or_else(|| AppError::new("NO_ACTIVE_TAB", "open the site first"))?;
        let page_url = crate::core::with_state(&handle, |s| {
            s.registry
                .get(&tab_id)
                .map(|t| t.url.clone())
                .unwrap_or_default()
        })
        .unwrap_or_default();
        if !page_url.contains(&record.domain) {
            return Err(AppError::new(
                "VAULT_DOMAIN_MISMATCH",
                format!(
                    "record is for {:?} but the active tab is {:?}",
                    record.domain, page_url
                ),
            ));
        }
        let mut filled: Vec<&str> = Vec::new();
        // Login pages differ: password-only, username-only, or both. Fill
        // what exists; require at least ONE recognized field.
        let pw_field = crate::bridge::r#type(
            &handle,
            &tab_id,
            "input[type=\"password\"],input[name*=\"pass\" i]",
            &password,
            true,
        );
        if pw_field.is_ok() {
            filled.push("password");
        }
        let user_field = crate::bridge::r#type(
            &handle,
            &tab_id,
            "input[type=\"email\"],input[name*=\"user\" i],input[name*=\"login\" i],input[name*=\"email\" i]",
            &record.username,
            true,
        );
        if user_field.is_ok() {
            filled.push("username");
        }
        if filled.is_empty() {
            return Err(AppError::new(
                "VAULT_NO_LOGIN_FIELDS",
                "no username/password field found on this page",
            ));
        }
        Ok(serde_json::json!({ "success": true, "filled": filled }))
    })
    .await
    .map_err(|e| AppError::new("VAULT_FILL_JOIN", e.to_string()))?
}

#[tauri::command]
pub fn vault_delete(id: String) -> AppResult<Value> {
    let removed = vault_instance().delete(&id)?;
    Ok(serde_json::json!({ "success": removed }))
}

/// Current save-password prompt (renderer-visible fields only — the
/// captured password NEVER crosses this boundary).
#[tauri::command]
pub fn vault_prompt_current(app: AppHandle<tauri::Wry>) -> Option<Value> {
    let state = app.try_state::<crate::vault_capture::SharedCapture>()?;
    let cs = state.lock().unwrap_or_else(|p| p.into_inner());
    cs.pending.as_ref().map(|p| {
        serde_json::json!({
            "id": p.id,
            "tabId": p.tab_id,
            "domain": p.domain,
            "username": p.username,
            "createdAt": p.created_at,
        })
    })
}

/// Resolve the prompt: {promptId, save} — save=true stores into the DPAPI
/// vault; any answer clears the prompt (parity: vault:prompt:resolve).
#[tauri::command]
pub fn vault_prompt_resolve(app: AppHandle<tauri::Wry>, answer: Value) -> AppResult<Value> {
    let prompt_id = answer
        .get("promptId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let save = answer.get("save").and_then(|v| v.as_bool()).unwrap_or(false);
    crate::vault_capture::resolve(&app, &prompt_id, save)
        .map_err(|e| AppError::new("VAULT_PROMPT_RESOLVE_FAILED", e))
}

#[tauri::command]
pub fn memory_prompt_current(app: tauri::AppHandle<tauri::Wry>) -> Option<Value> {
    // Electron shape: the prompt object or null.
    crate::memory::current(&app).map(|p| serde_json::to_value(&p).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn memory_prompt_resolve(app: tauri::AppHandle<tauri::Wry>, answer: Value) -> AppResult<Value> {
    // Electron: resolveMemoryPrompt(promptId, save) -> {success}.
    let prompt_id = answer.get("promptId").and_then(|v| v.as_str()).unwrap_or("");
    let save = answer.get("save").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(serde_json::json!({ "success": crate::memory::resolve(&app, prompt_id, save) }))
}

// ---------------------------------------------------------------------------
// Window controls (REAL)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn window_minimize(app: AppHandle<tauri::Wry>) {
    if let Some(win) = app.get_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle<tauri::Wry>) {
    if let Some(win) = app.get_window("main") {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle<tauri::Wry>) {
    core::persist_session(&app);
    if let Some(win) = app.get_window("main") {
        let _ = win.close();
    }
}
