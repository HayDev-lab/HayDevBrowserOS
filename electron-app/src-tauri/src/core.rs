//! BrowserCore (Rust) — webview lifecycle orchestration.
//!
//! Owns the pure state (registry, nav stacks, stores, downloads) and applies
//! registry events to real child webviews of the main window. Tab webviews
//! use deterministic labels `browser-tab-{id}` and are looked up through the
//! app manager — no raw handles are stored.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Runtime, Size, State,
    WebviewUrl, WindowEvent, Wry,
};

use crate::downloads::DownloadRegistry;
use crate::error::{AppError, AppResult};
use crate::layout;
use crate::navstack::NavStack;
use crate::registry::{ActivateAfterClose, RegistryEvent, TabRegistry};
use crate::stores::{BookmarksStore, HistoryStore, SessionStore};
use crate::types::{
    Bookmark, BookmarkAddRequest, DownloadItemState, HistoryAddRequest, HistoryEntry, HistoryQuery,
    NavigateRequest, OpenTabRequest, TabLoadState, TabState,
};
use crate::urlnorm;

pub struct BrowserState {
    pub registry: TabRegistry,
    pub navstacks: HashMap<String, NavStack>,
    pub history: HistoryStore,
    pub bookmarks: BookmarksStore,
    pub session: SessionStore,
    pub downloads: DownloadRegistry,
    /// Challenge handoff state per tab (Phase F — see challenge.rs).
    pub challenges: HashMap<String, crate::challenge::ChallengeHandoff>,
}

impl BrowserState {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            registry: TabRegistry::new(),
            navstacks: HashMap::new(),
            history: HistoryStore::new(data_dir.join("history.json")),
            bookmarks: BookmarksStore::new(data_dir.join("bookmarks.json")),
            session: SessionStore::new(data_dir.join("session.json")),
            downloads: DownloadRegistry::new(),
            challenges: HashMap::new(),
        }
    }

    pub fn tab_label(tab_id: &str) -> String {
        format!("browser-tab-{tab_id}")
    }

    pub fn navstack_mut(&mut self, tab_id: &str) -> &mut NavStack {
        self.navstacks.entry(tab_id.to_string()).or_default()
    }
}

/// Managed state handle.
pub type SharedBrowser = Mutex<BrowserState>;

pub fn shared(state: BrowserState) -> SharedBrowser {
    Mutex::new(state)
}

/// Acquire the managed state container (guard borrows the returned State).
pub fn state_handle<R: Runtime>(app: &AppHandle<R>) -> AppResult<State<'_, SharedBrowser>> {
    app.try_state::<SharedBrowser>()
        .ok_or_else(|| AppError::new("STATE_NOT_INITIALIZED", "browser state missing"))
}

/// Run a closure with the state locked. `f` receives `&mut BrowserState`.
pub fn with_state<R: Runtime, T>(
    app: &AppHandle<R>,
    f: impl FnOnce(&mut BrowserState) -> T,
) -> AppResult<T> {
    let state = state_handle(app)?;
    let mut guard: MutexGuard<'_, BrowserState> = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(f(&mut guard))
}

// ---------------------------------------------------------------------------
// Webview lifecycle
// ---------------------------------------------------------------------------

/// The main window handle. NOTE: in multi-webview mode (`unstable` feature)
/// the config-created window registers as a plain `Window` — it is NOT in
/// the `webview_windows()` map, so `get_webview_window("main")` returns
/// None. `get_window("main")` is the correct lookup (verified live).
fn main_window<R: Runtime>(app: &AppHandle<R>) -> AppResult<tauri::Window<R>> {
    app.get_window("main").ok_or_else(|| {
        AppError::new(
            "WINDOW_NOT_FOUND",
            format!(
                "main window is not available (windows: [{:?}], webviews: [{:?}])",
                app.windows().keys().collect::<Vec<_>>(),
                app.webviews().keys().collect::<Vec<_>>()
            ),
        )
    })
}

/// Logical size of the main window's content area.
fn window_logical_size<R: Runtime>(win: &tauri::Window<R>) -> (f64, f64) {
    let scale = win.scale_factor().unwrap_or(1.0);
    let phys = win
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(1440, 900));
    (phys.width as f64 / scale, phys.height as f64 / scale)
}

fn content_bounds<R: Runtime>(win: &tauri::Window<R>) -> Rect {
    let (w, h) = window_logical_size(win);
    let (x, y, cw, ch) = layout::content_rect(w, h);
    Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(cw, ch)),
    }
}

/// Debug/automation port for the TAB WebView2 environment (loopback only).
/// Tab webviews live in a dedicated user-data folder (profile), i.e. a
/// SEPARATE browser process from the chrome webview — it needs its own
/// remote-debugging port. This port is ALSO the BrowserAutomationBridge
/// attach point (Phase D): click/type/extract/screenshot run over it.
pub fn tab_debug_port() -> u16 {
    static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    *PORT.get_or_init(|| crate::runtime_manager::find_free_port(9330))
}

/// Debug/automation port for the CHROME WebView2 environment (the React
/// shell, default user-data folder). Separate from the tab environment's
/// port — env-var args and per-webview args CONCAT, and two different
/// --remote-debugging-port switches silently kill debugging (verified live).
pub fn chrome_debug_port() -> u16 {
    static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    *PORT.get_or_init(|| crate::runtime_manager::find_free_port(9220))
}

/// The site-facing User-Agent applied to TAB webviews (anti-detect parity
/// with the Electron runtime's site-user-agent.ts): the engine's real UA
/// with embedding-shell tokens stripped. Resolved once from the chrome
/// environment's CDP /json/version; when unresolvable the engine default
/// is used unchanged (honest — no spoofing).
pub fn site_user_agent() -> Option<&'static str> {
    static SITE_UA: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    SITE_UA
        .get_or_init(|| {
            let port = chrome_debug_port();
            let version = crate::cdp::http_get_json_version(port).ok()?;
            let raw = version.get("User-Agent").and_then(|v| v.as_str())?;
            let cleaned = crate::site_ua::build_site_user_agent(raw);
            if cleaned.is_empty() {
                None
            } else {
                log::info!("[UA] site user-agent: {cleaned}");
                Some(cleaned)
            }
        })
        .as_deref()
}

/// Resolve the site UA on a worker thread at startup (CDP connect is
/// blocking); tab webviews created before resolution use the engine default.
pub fn warm_site_user_agent() {
    std::thread::spawn(|| {
        // Small grace period: the chrome webview must attach its debugger
        // before /json/version answers.
        for _ in 0..20 {
            if site_user_agent().is_some() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

/// Create the child webview for a tab.
fn create_tab_webview(
    app: &AppHandle<Wry>,
    win: &tauri::Window<Wry>,
    tab_id: &str,
    url: &str,
    incognito: bool,
    darkweb: bool,
    active: bool,
) -> AppResult<()> {
    let label = BrowserState::tab_label(tab_id);
    let parsed = url::Url::parse(url)
        .map_err(|e| AppError::new("INVALID_URL", format!("cannot open tab: {e}")))?;

    let handle_for_load = app.clone();
    let tab_for_load = tab_id.to_string();
    let handle_for_title = app.clone();
    let tab_for_title = tab_id.to_string();
    let handle_for_download = app.clone();

    let mut builder = tauri::WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed))
        .on_navigation(urlnorm::navigation_allowed)
        .on_page_load(move |_wv, payload| {
            on_page_load(&handle_for_load, &tab_for_load, &payload);
        })
        .on_document_title_changed(move |_wv, title| {
            on_title_changed(&handle_for_title, &tab_for_title, &title);
        })
        .on_download(move |wv, event| on_download_event(&handle_for_download, event, wv.label()));

    // Anti-detect (Electron parity, site-user-agent.ts): tab webviews
    // present the ENGINE's UA with embedding-shell tokens removed.
    if let Some(ua) = site_user_agent() {
        builder = builder.user_agent(ua);
    }

    // Login capture (Electron parity, tab-preload.ts): normal tabs get the
    // form-submit hook; incognito/darkweb tabs never capture.
    if !incognito && !darkweb {
        builder = builder.initialization_script(crate::vault_capture::CAPTURE_INIT_SCRIPT);
    }

    // __pabNewTab bridge (Electron tab-preload parity): fetch()-backed
    // attachment/research bridge for pab://newtab + pab://search documents.
    // Injected into every tab webview but SELF-GATED by document URL, so
    // remote pages never see it — and tab webviews still have ZERO invoke
    // capability (migration contract §9).
    builder = builder.initialization_script(crate::attachments::BRIDGE_INIT_SCRIPT);

    // Profile mapping: PRIVATE → ephemeral InPrivate webview in its OWN
    // user-data folder (own WebView2 environment so proxy/privacy args
    // cannot clash with the chrome/default environment); DEFAULT/AGENT →
    // dedicated persistent user-data folder; DARKWEB → its OWN environment
    // routed through the Tor SOCKS proxy so onion traffic (and ONLY onion
    // tab traffic) enters the Tor network.
    let profile = if incognito {
        crate::profiles::ProfileKind::Private
    } else if darkweb {
        crate::profiles::ProfileKind::DarkWeb
    } else {
        crate::profiles::ProfileKind::Default
    };
    let privacy_cfg = crate::privacy::global().clone();
    let tor_endpoint = crate::darkweb::tor_endpoint(app, &crate::darkweb::config_of(app))
        .map(|(host, port)| crate::privacy::SocksEndpoint { host, port });
    let manager = crate::profiles::BrowserProfileManager::new(&crate::lib_app_data_dir());

    // Anonymity hardening (privacy.rs): WebRTC must never bypass proxies
    // (real-IP leak), no component updates / domain-reliability pings /
    // crash-reporter phoning home. SmartScreen stays off (wry default).
    const PRIVACY_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force-webrtc-ip-handling-policy=disable_non_proxied_udp --disable-component-update --disable-domain-reliability --disable-breakpad";

    match profile {
        crate::profiles::ProfileKind::Private => {
            manager
                .ensure(profile)
                .map_err(|e| AppError::new("PROFILE_DIR_FAILED", e.to_string()))?;
            if let Some(dir) = manager.data_dir(profile) {
                builder = builder.data_directory(dir);
            }
            // InPrivate keeps browsing data off disk; the folder itself is
            // wiped at every startup (lib.rs wipe_ephemeral_profiles).
            builder = builder.incognito(true);
            builder = builder.additional_browser_args(PRIVACY_ARGS);
            // Egress (Tor-when-up by default, user SOCKS5, or direct).
            match crate::privacy::resolve_egress(&privacy_cfg.private_egress, tor_endpoint.clone())
            {
                Ok(Some(ep)) => {
                    let proxy = url::Url::parse(&format!("socks5://{}:{}", ep.host, ep.port))
                        .map_err(|e| {
                            AppError::new("INVALID_URL", format!("privacy socks url: {e}"))
                        })?;
                    builder = builder.proxy_url(proxy);
                    log::info!(
                        "[PRIVACY] private tab egress: socks5://{}:{}",
                        ep.host,
                        ep.port
                    );
                }
                Ok(None) => log::info!("[PRIVACY] private tab egress: direct"),
                Err(msg) => return Err(AppError::new("TOR_UNAVAILABLE", msg)),
            }
            // Fingerprint-noise layer: stable for the profile lifetime.
            let seed = u64::from_le_bytes(
                uuid::Uuid::new_v4().into_bytes()[..8].try_into().unwrap(),
            );
            builder = builder.initialization_script(crate::privacy_init::script(
                seed,
                privacy_cfg.private_timezone.as_deref(),
                privacy_cfg.private_locale.as_deref(),
            ));
        }
        crate::profiles::ProfileKind::DarkWeb => {
            manager
                .ensure(profile)
                .map_err(|e| AppError::new("PROFILE_DIR_FAILED", e.to_string()))?;
            if let Some(dir) = manager.data_dir(profile) {
                builder = builder.data_directory(dir);
            }
            // FAIL CLOSED: no Tor endpoint → no darkweb tab (never leak
            // onion traffic outside Tor).
            let socks = tor_endpoint.ok_or_else(|| {
                AppError::new(
                    "TOR_UNAVAILABLE",
                    "the Tor gateway is not running — open pab://darkweb and start it first",
                )
            })?;
            // Explicit args INCLUDING the proxy: wry only appends
            // --proxy-server when additional_browser_args is unset, and the
            // privacy flags must live in the same environment definition.
            builder = builder.additional_browser_args(&format!(
                "{PRIVACY_ARGS} --proxy-server=socks5://{}:{}",
                socks.host, socks.port
            ));
        }
        kind => {
            manager
                .ensure(kind)
                .map_err(|e| AppError::new("PROFILE_DIR_FAILED", e.to_string()))?;
            if let Some(dir) = manager.data_dir(kind) {
                builder = builder.data_directory(dir);
            }
            // Dedicated browser process (own UDF) → keep the automation /
            // debug port + the privacy hardening flags. AGENT tabs honor a
            // custom egress from privacy.json (strict Tor unreachable →
            // logged and ignored, the agent identity stays honest/direct).
            let mut args = format!(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={} --disable-component-update --disable-domain-reliability --disable-breakpad",
                tab_debug_port()
            );
            if kind == crate::profiles::ProfileKind::Agent {
                match crate::privacy::resolve_egress(&privacy_cfg.agent_egress, tor_endpoint.clone())
                {
                    Ok(Some(ep)) => {
                        args.push_str(&format!(
                            " --proxy-server=socks5://{}:{}",
                            ep.host, ep.port
                        ));
                    }
                    Ok(None) => {}
                    Err(msg) => log::warn!("[PRIVACY] agent egress unavailable: {msg}"),
                }
            }
            builder = builder.additional_browser_args(&args);
        }
    }

    let (x, y, cw, ch) = {
        let (w, h) = window_logical_size(win);
        let rect = layout::content_rect(w, h);
        (rect.0, rect.1, rect.2, rect.3)
    };
    let window = win;
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(cw, ch),
        )
        .map_err(|e| AppError::new("WEBVIEW_CREATE_FAILED", e.to_string()))?;

    if active {
        webview.show().ok();
    } else {
        webview.hide().ok();
    }
    log::info!(
        "[TAB] webview created label={label} url={url} active={active} profile={}",
        profile.dir_name()
    );
    Ok(())
}

/// Apply registry activation changes to webviews (show/hide + relayout).
fn apply_activation<R: Runtime>(app: &AppHandle<R>, active_id: Option<&str>) {
    let labels_to_hide: Vec<String> = with_state(app, |state| {
        state
            .registry
            .list()
            .into_iter()
            .filter(|t| Some(t.id.as_str()) != active_id)
            .map(|t| BrowserState::tab_label(&t.id))
            .collect()
    })
    .unwrap_or_default();
    for label in labels_to_hide {
        if let Some(wv) = app.get_webview(&label) {
            wv.hide().ok();
        }
    }
    if let Some(active) = active_id {
        if let Some(wv) = app.get_webview(&BrowserState::tab_label(active)) {
            wv.show().ok();
        }
    }
    relayout(app);
}

/// Reposition the active tab webview to the chrome content rect.
pub fn relayout<R: Runtime>(app: &AppHandle<R>) {
    let Ok(win) = main_window(app) else {
        return;
    };
    let active_id =
        with_state(app, |state| state.registry.active_id().map(str::to_string)).unwrap_or_default();
    let Some(active_id) = active_id else {
        return;
    };
    let label = format!("browser-tab-{active_id}");
    let Some(wv) = app.get_webview(&label) else {
        return;
    };
    let bounds = content_bounds(&win);
    if let Err(err) = wv.set_bounds(bounds) {
        log::error!("[TAB] relayout failed: {err}");
    }
}

// ---------------------------------------------------------------------------
// Event handlers (called from webview callbacks)
// ---------------------------------------------------------------------------

fn on_page_load<R: Runtime>(
    app: &AppHandle<R>,
    tab_id: &str,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    let event = payload.event();
    // WebView2 reports custom-scheme pages in display form (http://pab.newtab/)
    // — canonicalize back to pab://newtab for state/session/history.
    let url = urlnorm::canonicalize_internal_url(payload.url().as_ref());
    let _ = with_state(app, |state| match event {
        tauri::webview::PageLoadEvent::Started => {
            if let Some(tab) = state.registry.get_mut(tab_id) {
                tab.load_state = TabLoadState::Loading;
                tab.pending_url = url.clone();
                tab.error = None;
            }
        }
        tauri::webview::PageLoadEvent::Finished => {
            let mut history_entry: Option<HistoryAddRequest> = None;
            if let Some(tab) = state.registry.get_mut(tab_id) {
                tab.load_state = TabLoadState::Committed;
                tab.url = url.clone();
                if tab.title.is_empty() || tab.title == tab.pending_url {
                    tab.title = url.clone();
                }
                // History policy mirrors incognito-policy.ts: incognito and
                // dark-web tabs never record; internal (pab:) and loopback
                // URLs are not real visits either.
                if !tab.is_incognito
                    && !tab.is_dark_web.unwrap_or(false)
                    && urlnorm::should_persist_history(&url)
                {
                    history_entry = Some(HistoryAddRequest {
                        url: url.clone(),
                        title: tab.title.clone(),
                        visited_at: None,
                    });
                }
            }
            let (can_back, can_fwd) = {
                let stack = state.navstack_mut(tab_id);
                stack.commit(&url);
                (stack.can_go_back(), stack.can_go_forward())
            };
            if let Some(tab) = state.registry.get_mut(tab_id) {
                tab.can_go_back = can_back;
                tab.can_go_forward = can_fwd;
            }
            if let Some(entry) = history_entry {
                state.history.add(&entry);
            }
        }
    });
}

fn on_title_changed<R: Runtime>(app: &AppHandle<R>, tab_id: &str, raw_title: &str) {
    let _ = with_state(app, |state| {
        let Some(tab) = state.registry.get_mut(tab_id) else {
            return;
        };
        let (unread, title) = urlnorm::parse_unread_title(raw_title);
        tab.unread_count = unread;
        if !title.is_empty() {
            tab.title = title;
        }
    });
}

fn on_download_event(
    app: &AppHandle<Wry>,
    event: tauri::webview::DownloadEvent<'_>,
    webview_label: &str,
) -> bool {
    // Which tab fired? Labels look like browser-tab-{uuid}. Dark-web tabs
    // quarantine their downloads (spec §14) instead of the OS Downloads
    // folder — nothing auto-runs, Save/Discard is explicit.
    let tab_id = webview_label.strip_prefix("browser-tab-").map(str::to_string);
    let is_darkweb_tab = tab_id
        .as_deref()
        .and_then(|id| {
            with_state(app, |s| {
                s.registry.get(id).and_then(|t| t.is_dark_web).unwrap_or(false)
            })
            .ok()
        })
        .unwrap_or(false);
    match event {
        tauri::webview::DownloadEvent::Requested { url, destination } => {
            if is_darkweb_tab {
                use tauri::Manager;
                let Some(q) = app.try_state::<crate::downloads::SharedQuarantine>() else {
                    return false;
                };
                let mut q = q.lock().unwrap_or_else(|p| p.into_inner());
                let (id, dest) = q.intercept(
                    &crate::lib_app_data_dir().join("darkweb"),
                    url.as_str(),
                    &*destination,
                );
                log::info!("[DOWNLOAD] quarantined {url} -> {} ({id})", dest.display());
                *destination = dest;
                return true;
            }
            let dest = with_state(app, |state| {
                let dest = state.downloads.destination_for(url.as_str(), &*destination);
                state.downloads.started(url.as_str(), &dest);
                dest
            });
            match dest {
                Ok(dest) => {
                    log::info!("[DOWNLOAD] start {} -> {}", url, dest.display());
                    *destination = dest;
                    true
                }
                Err(_) => false,
            }
        }
        tauri::webview::DownloadEvent::Finished { url, path, success } => {
            log::info!("[DOWNLOAD] finished {} success={success}", url);
            if is_darkweb_tab {
                use tauri::Manager;
                if let Some(q) = app.try_state::<crate::downloads::SharedQuarantine>() {
                    if let Some(p) = path.as_ref() {
                        q.lock().unwrap_or_else(|p| p.into_inner()).finished(p, success);
                    }
                }
                return true;
            }
            let _ = with_state(app, |state| {
                state
                    .downloads
                    .finished(url.as_str(), path.as_ref(), success);
            });
            true
        }
        _ => true,
    }
}

// ---------------------------------------------------------------------------
// Public operations (called from commands)
// ---------------------------------------------------------------------------

/// Phase 1 of open: validate + mutate registry state. Safe from any thread.
/// Returns (tab_id, activated, incognito, darkweb, target_url).
pub fn prepare_open_tab(
    app: &AppHandle<Wry>,
    req: &OpenTabRequest,
) -> AppResult<(String, bool, bool, bool, String)> {
    let darkweb = req.darkweb.unwrap_or(false);
    if darkweb {
        // Only .onion addresses and the darkweb internal page may open in
        // the isolated Tor environment (fail closed on anything else).
        let ok = crate::darkweb::is_onion_url(&req.url)
            || req.url.trim_start_matches('/').starts_with("pab://darkweb")
            || req.url.contains("pab.localhost/darkweb");
        if !ok {
            return Err(AppError::new(
                "URL_REJECTED",
                "dark-web tabs accept .onion addresses only",
            ));
        }
    }
    let normalized = urlnorm::normalize_address_bar_input(&req.url);
    let target = urlnorm::canonicalize_internal_url(&normalized.url.ok_or_else(|| {
        AppError::new(
            "URL_REJECTED",
            format!(
                "address-bar input rejected ({})",
                normalized.reason.unwrap_or_else(|| "unknown".to_string())
            ),
        )
    })?);

    let (tab_id, events, incognito) = with_state(app, |state| {
        let normalized_req = OpenTabRequest {
            url: target.clone(),
            activate: req.activate,
            incognito: req.incognito,
            darkweb: req.darkweb,
            background: req.background,
            id: req.id.clone(),
            title: req.title.clone(),
        };
        let (tab_id, events) = state
            .registry
            .open(&normalized_req)
            .map_err(|e| AppError::new("TAB_OPEN_FAILED", e))?;
        let incognito = state
            .registry
            .get(&tab_id)
            .map(|t| t.is_incognito)
            .unwrap_or(false);
        AppResult::Ok((tab_id, events, incognito))
    })??;

    let activated = events
        .iter()
        .any(|e| matches!(e, RegistryEvent::Activated { .. }));
    Ok((tab_id, activated, incognito, darkweb, target))
}

/// Phase 2 of open: create the webview + apply activation. MUST run on the
/// main thread OUTSIDE an event-loop callback (i.e. via `run_on_main_thread`
/// from commands) — creating a WebView2 controller from inside the invoke
/// callback deadlocks the message pump.
pub fn materialize_open_tab(
    app: &AppHandle<Wry>,
    tab_id: &str,
    target: &str,
    incognito: bool,
    activated: bool,
) -> AppResult<()> {
    let darkweb = with_state(app, |state| {
        state
            .registry
            .get(tab_id)
            .map(|t| t.is_dark_web.unwrap_or(false))
            .unwrap_or(false)
    })
    .unwrap_or(false);
    let win = main_window(app)?;
    create_tab_webview(app, &win, tab_id, target, incognito, darkweb, activated)?;

    let active_id =
        with_state(app, |state| state.registry.active_id().map(str::to_string)).unwrap_or_default();
    apply_activation(app, active_id.as_deref());
    log::info!("[TAB] opened id={tab_id} url={target} darkweb={darkweb}");
    Ok(())
}

/// Synchronous open (used from `setup`, where the event loop is not yet
/// pumping — no deadlock risk).
pub fn open_tab(app: &AppHandle<Wry>, req: &OpenTabRequest) -> AppResult<String> {
    let (tab_id, activated, incognito, _darkweb, target) = prepare_open_tab(app, req)?;
    materialize_open_tab(app, &tab_id, &target, incognito, activated)?;
    Ok(tab_id)
}

pub fn close_tab(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    let event = with_state(app, |state| {
        state.registry.close(tab_id, ActivateAfterClose::Right)
    })?;
    let Some(RegistryEvent::Closed {
        tab_id,
        next_active,
    }) = event
    else {
        return Ok(false);
    };
    if let Some(wv) = app.get_webview(BrowserState::tab_label(&tab_id).as_str()) {
        wv.close().ok();
    }
    with_state(app, |state| {
        state.navstacks.remove(&tab_id);
        let tabs = state.registry.list();
        let order = state.registry.order().to_vec();
        let active = state.registry.active_id().map(str::to_string);
        state.session.save(&tabs, &order, active.as_deref());
    })?;
    apply_activation(app, next_active.as_deref());
    log::info!("[TAB] closed id={tab_id} next={:?}", next_active);
    Ok(true)
}

pub fn activate_tab(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    let event = with_state(app, |state| state.registry.activate(tab_id))?;
    if event.is_none() {
        // Not found, or already active — TS returns true when already active.
        return with_state(app, |state| state.registry.get(tab_id).is_some());
    }
    apply_activation(app, Some(tab_id));
    Ok(true)
}

pub fn navigate(app: &AppHandle<Wry>, req: &NavigateRequest) -> AppResult<bool> {
    let normalized = urlnorm::normalize_address_bar_input(&req.url);
    let target = urlnorm::canonicalize_internal_url(&normalized.url.ok_or_else(|| {
        AppError::new(
            "URL_REJECTED",
            format!(
                "navigation rejected ({})",
                normalized.reason.unwrap_or_else(|| "unknown".to_string())
            ),
        )
    })?);
    // WebView2's Navigate() silently ignores custom-scheme URIs (verified
    // live: pab://search → true, page never moves) — translate to the
    // display form it understands (http://pab.<page>/…).
    let navigate_url = urlnorm::to_webview_display_url(&target)?;
    let parsed = url::Url::parse(&navigate_url)?;

    let label = BrowserState::tab_label(&req.tab_id);
    let wv = app
        .get_webview(label.as_str())
        .ok_or_else(|| AppError::new("TAB_NOT_FOUND", format!("no tab {}", req.tab_id)))?;

    with_state(app, |state| {
        if let Some(tab) = state.registry.get_mut(&req.tab_id) {
            tab.pending_url = target.clone();
            tab.load_state = TabLoadState::Loading;
            tab.error = None;
        }
    })?;
    wv.navigate(parsed)
        .map_err(|e| AppError::new("NAVIGATE_FAILED", e.to_string()))?;
    Ok(true)
}

/// Execute a script in the tab's page context.
fn eval_script(app: &AppHandle<Wry>, tab_id: &str, script: &str) -> AppResult<()> {
    let label = BrowserState::tab_label(tab_id);
    let wv = app
        .get_webview(label.as_str())
        .ok_or_else(|| AppError::new("TAB_NOT_FOUND", format!("no tab {tab_id}")))?;
    wv.eval(script)
        .map_err(|e| AppError::new("EVAL_FAILED", e.to_string()))
}

fn shift_nav_stack(app: &AppHandle<Wry>, tab_id: &str, forward: bool) -> AppResult<()> {
    with_state(app, |state| {
        let (moved, can_back, can_fwd) = {
            let stack = state.navstack_mut(tab_id);
            let moved = if forward {
                stack.can_go_forward()
            } else {
                stack.can_go_back()
            };
            if moved {
                if forward {
                    stack.go_forward();
                } else {
                    stack.go_back();
                }
            }
            (moved, stack.can_go_back(), stack.can_go_forward())
        };
        if let Some(tab) = state.registry.get_mut(tab_id) {
            tab.can_go_back = can_back;
            tab.can_go_forward = can_fwd;
        }
        moved
    })
    .map(|_| ())
}

/// history.back()/forward() via page-context script — Tauri's webview API
/// has no native go_back/go_forward on WebView2.
pub fn nav_back(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    shift_nav_stack(app, tab_id, false)?;
    eval_script(app, tab_id, "history.back();")?;
    Ok(true)
}

pub fn nav_forward(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    shift_nav_stack(app, tab_id, true)?;
    eval_script(app, tab_id, "history.forward();")?;
    Ok(true)
}

pub fn reload_tab(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    eval_script(app, tab_id, "location.reload();")?;
    Ok(true)
}

pub fn stop_tab(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    eval_script(app, tab_id, "window.stop();")?;
    Ok(true)
}

pub fn list_tabs(app: &AppHandle<Wry>) -> AppResult<Vec<TabState>> {
    with_state(app, |state| state.registry.list())
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/// Restore persisted session on startup; open the new-tab page when empty
/// (mirrors BrowserCore.attachToWindow).
pub fn bootstrap_session(app: &AppHandle<Wry>) {
    let snapshot = with_state(app, |state| state.session.load()).unwrap_or_default();
    let mut count = 0;
    if let Some(snap) = snapshot {
        for tab in &snap.tabs {
            let url = if tab.url.is_empty() {
                tab.pending_url.clone()
            } else {
                tab.url.clone()
            };
            if url.is_empty() {
                continue;
            }
            let req = OpenTabRequest {
                url,
                activate: Some(snap.active_id.as_deref() == Some(tab.id.as_str())),
                incognito: Some(false), // session never persists incognito
                darkweb: Some(false),
                background: None,
                id: Some(tab.id.clone()),
                title: Some(tab.title.clone()),
            };
            if open_tab(app, &req).is_ok() {
                count += 1;
            }
        }
    }

    if count == 0 {
        // Fresh profile → new-tab page (the TS runtime's fallback).
        let req = OpenTabRequest {
            url: "pab://newtab".to_string(),
            activate: None,
            incognito: None,
            darkweb: None,
            background: None,
            id: None,
            title: None,
        };
        if let Err(err) = open_tab(app, &req) {
            log::error!("[SESSION] initial new-tab open failed: {err}");
        }
    }
}

/// Save the current session (called on quit and on window_close).
pub fn persist_session(app: &AppHandle<Wry>) {
    let _ = with_state(app, |state| {
        let tabs = state.registry.list();
        let order = state.registry.order().to_vec();
        let active = state.registry.active_id().map(str::to_string);
        state.session.save(&tabs, &order, active.as_deref());
    });
}

/// Wire the window resize → tab relayout.
pub fn watch_window_events(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_window("main") {
        let handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Resized(_) = event {
                relayout(&handle);
            }
        });
    }
}

// Convenience passthroughs used by commands -------------------------------

pub fn query_history(app: &AppHandle<Wry>, q: &HistoryQuery) -> AppResult<Vec<HistoryEntry>> {
    with_state(app, |state| state.history.query(q))
}

pub fn add_history(app: &AppHandle<Wry>, req: &HistoryAddRequest) -> AppResult<HistoryEntry> {
    with_state(app, |state| state.history.add(req))
}

pub fn delete_history(app: &AppHandle<Wry>, id: &str) -> AppResult<bool> {
    with_state(app, |state| state.history.delete(id))
}

pub fn clear_history(app: &AppHandle<Wry>) -> AppResult<()> {
    with_state(app, |state| state.history.clear())
}

pub fn list_bookmarks(app: &AppHandle<Wry>) -> AppResult<Vec<Bookmark>> {
    with_state(app, |state| state.bookmarks.list())
}

pub fn add_bookmark(app: &AppHandle<Wry>, req: &BookmarkAddRequest) -> AppResult<Bookmark> {
    with_state(app, |state| state.bookmarks.add(req))
}

pub fn delete_bookmark(app: &AppHandle<Wry>, id: &str) -> AppResult<bool> {
    with_state(app, |state| state.bookmarks.delete(id))
}

pub fn list_downloads(app: &AppHandle<Wry>) -> AppResult<Vec<DownloadItemState>> {
    with_state(app, |state| state.downloads.list())
}
