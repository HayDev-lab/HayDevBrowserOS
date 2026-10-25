//! BrowserCore (Rust) — webview lifecycle orchestration.
//!
//! Owns the pure state (registry, nav stacks, stores, downloads) and applies
//! registry events to real child webviews of the main window. Tab webviews
//! use deterministic labels `browser-tab-{id}` and are looked up through the
//! app manager — no raw handles are stored.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, Runtime, Size, State,
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
    pub target_ids: HashMap<String, String>,
    pub ready_tabs: std::collections::HashSet<String>,
    pub creation_errors: HashMap<String, AppError>,
    pub history: HistoryStore,
    pub bookmarks: BookmarksStore,
    pub session: SessionStore,
    pub downloads: DownloadRegistry,
    /// Challenge handoff state per tab (Phase F — see challenge.rs).
    pub challenges: HashMap<String, crate::challenge::ChallengeHandoff>,
    /// Whether the renderer's docked agent panel occupies the right rail.
    pub agent_panel_open: bool,
}

impl BrowserState {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            registry: TabRegistry::new(),
            navstacks: HashMap::new(),
            target_ids: HashMap::new(), ready_tabs: std::collections::HashSet::new(), creation_errors: HashMap::new(),
            history: HistoryStore::new(data_dir.join("history.json")),
            bookmarks: BookmarksStore::new(data_dir.join("bookmarks.json")),
            session: SessionStore::new(data_dir.join("session.json")),
            downloads: DownloadRegistry::new(),
            challenges: HashMap::new(),
            agent_panel_open: true,
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

fn content_bounds<R: Runtime>(app: &AppHandle<R>, win: &tauri::Window<R>) -> Rect {
    let (w, h) = window_logical_size(win);
    let agent_panel_open = with_state(app, |state| state.agent_panel_open).unwrap_or(true);
    let (x, y, cw, ch) = layout::content_rect(w, h, agent_panel_open);
    Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(cw, ch)),
    }
}

/// The ONE automation/debug port (loopback only) for the SHARED default
/// WebView2 environment: shell + Default-profile tabs use identical
/// environment options (same data_directory, same args), so WebView2 keeps
/// ONE browser process for both — and one DevTools endpoint serves all
/// targets. Agent/Private/DarkWeb keep their own environments (proxy/egress
/// args differ); with automation on, their port value collides exactly as
/// before this change (only the first environment binds it).
pub fn automation_debug_port() -> u16 {
    static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    *PORT.get_or_init(|| crate::runtime_manager::find_free_port(9220))
}

/// Tab-environment automation port. Since the shell/default-environment
/// merge (N01/N02) this is the SAME shared port as the shell's — kept as a
/// named alias for the BrowserAutomationBridge diagnostic command.
pub fn tab_debug_port() -> u16 {
    automation_debug_port()
}

/// Chrome(shell)-environment automation port — shared default environment
/// alias of `automation_debug_port`.
pub fn chrome_debug_port() -> u16 {
    automation_debug_port()
}

/// Production automation uses in-process WebView2 APIs. The unauthenticated
/// DevTools listener is available only in development or explicit isolated QA.
pub fn automation_debug_enabled() -> bool {
    cfg!(debug_assertions) || (std::env::var("HAYDEV_AUTOMATION_DEBUG").as_deref() == Ok("1")
        && std::env::var_os("HAYDEV_DATA_DIR").is_some())
}
pub fn debug_args(port: u16) -> String {
    if automation_debug_enabled() { format!(" --remote-debugging-port={port}") } else { String::new() }
}

/// The site-facing User-Agent applied to TAB webviews (anti-detect parity
/// with the Electron runtime's site-user-agent.ts): the engine's real UA
/// with embedding-shell tokens stripped. Resolved once from the chrome
/// environment's CDP /json/version; when unresolvable the engine default
/// is used unchanged (honest — no spoofing).
pub fn site_user_agent() -> Option<&'static str> {
    if !automation_debug_enabled() { return None; }
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
    if !automation_debug_enabled() { return; }
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


    let mut builder = tauri::WebviewBuilder::new(label.clone(), WebviewUrl::External(url::Url::parse("about:blank")?))
        .initialization_script(crate::run_host::INIT)
        .on_navigation(urlnorm::navigation_allowed)
        .on_page_load(move |_wv, payload| {
            on_page_load(&handle_for_load, &tab_for_load, &payload);
        })
        .on_document_title_changed(move |_wv, title| {
            on_title_changed(&handle_for_title, &tab_for_title, &title);
        });

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
    } else if with_state(app, |s| s.registry.get(tab_id).is_some_and(|t| t.profile == "agent"))? {
        crate::profiles::ProfileKind::Agent
    } else {
        crate::profiles::ProfileKind::Default
    };
    let privacy_cfg = crate::privacy::global().clone();
    // A WebView2 environment has immutable proxy arguments. Resolve exactly
    // once per profile; the displayed route and actual environment share it.
    static ROUTES: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, Option<crate::privacy::SocksEndpoint>>>> = std::sync::OnceLock::new();
    let route = {
        let mut routes = ROUTES.get_or_init(Default::default).lock().unwrap_or_else(|p| p.into_inner());
        if let Some(route) = routes.get(profile.dir_name()) { route.clone() } else {
            let egress = match profile {
                crate::profiles::ProfileKind::Default => crate::privacy::Egress::Direct,
                crate::profiles::ProfileKind::Agent => privacy_cfg.agent_egress.clone(),
                crate::profiles::ProfileKind::Private => privacy_cfg.private_egress.clone(),
                crate::profiles::ProfileKind::DarkWeb => crate::privacy::Egress::TorStrict,
            };
            let tor = if matches!(egress, crate::privacy::Egress::TorStrict | crate::privacy::Egress::TorIfAvailable) {
                crate::darkweb::tor_endpoint(app, &crate::darkweb::config_of(app)).map(|(host,port)| crate::privacy::SocksEndpoint {host,port})
            } else { None };
            let route = crate::privacy::resolve_egress(&egress, tor).map_err(|m| AppError::new("EGRESS_UNAVAILABLE",m))?;
            routes.insert(profile.dir_name().into(), route.clone()); route
        }
    };
    let proxy_args = route.as_ref().map(|ep| format!(" --proxy-server=socks5://{}:{} --proxy-bypass-list=<-loopback>",ep.host,ep.port)).unwrap_or_default();
    let manager = crate::profiles::BrowserProfileManager::new(&crate::lib_app_data_dir());

    // Anonymity hardening (privacy.rs): WebRTC must never bypass proxies
    // (real-IP leak), no component updates / domain-reliability pings /
    // crash-reporter phoning home. SmartScreen stays off (wry default).
    use crate::privacy::PRIVACY_BROWSER_ARGS as PRIVACY_ARGS;

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
            // Single-source args builder (privacy.rs, unit-tested): the
            // egress proxy RIDES IN the args string — wry drops a separately
            // set proxy_url when additional_browser_args exists — and a
            // strict egress without Tor fails closed.
            let args = format!("{PRIVACY_ARGS}{proxy_args}");
            log::info!(
                "[PRIVACY] private tab egress: {}",
                if args.contains("--proxy-server") { "proxied (see args)" } else { "direct" }
            );
            builder = builder.additional_browser_args(&args);
            // Fingerprint-noise layer: stable for the profile lifetime.
            // Toggleable (privacy_set_fingerprint_noise): applies to newly
            // created webviews — an OFF switch means no init script at all.
            if privacy_cfg.fingerprint_noise {
                let seed = u64::from_le_bytes(
                    uuid::Uuid::new_v4().into_bytes()[..8].try_into().unwrap(),
                );
                builder = builder.initialization_script(crate::privacy_init::script(
                    seed,
                    privacy_cfg.private_timezone.as_deref(),
                    privacy_cfg.private_locale.as_deref(),
                ));
            }
        }
        crate::profiles::ProfileKind::DarkWeb => {
            manager
                .ensure(profile)
                .map_err(|e| AppError::new("PROFILE_DIR_FAILED", e.to_string()))?;
            if let Some(dir) = manager.data_dir(profile) {
                builder = builder.data_directory(dir);
            }
            builder = builder.additional_browser_args(&format!("{PRIVACY_ARGS}{proxy_args}"));
        }
        kind => {
            manager
                .ensure(kind)
                .map_err(|e| AppError::new("PROFILE_DIR_FAILED", e.to_string()))?;
            if let Some(dir) = manager.data_dir(kind) {
                builder = builder.data_directory(dir);
            }
            // The Default profile shares its environment options (folder +
            // args, including the SAME automation port) with the shell
            // webview — one browser process serves both. Agent keeps its own
            // egress args and therefore its own environment.
            let args = format!("{PRIVACY_ARGS}{proxy_args}{}", debug_args(automation_debug_port()));
            builder = builder.additional_browser_args(&args);
        }
    }

    with_state(app, |s| { if let Some(tab) = s.registry.get_mut(tab_id) { tab.egress = route.map(|r| format!("socks5://{}:{}",r.host,r.port)).unwrap_or_else(|| "direct".into()); } })?;

    let (x, y, cw, ch) = {
        let (w, h) = window_logical_size(win);
        let agent_panel_open =
            with_state(app, |state| state.agent_panel_open).unwrap_or(true);
        let rect = layout::content_rect(w, h, agent_panel_open);
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

    let handle = app.clone(); let id = tab_id.to_owned();
    let destination = crate::urlnorm::to_webview_display_url(parsed.as_str())?;
    webview.with_webview(move |native| {
        let result = unsafe {
            crate::native_webview::install(&handle, &native, &id).and_then(|_| {
                native.controller().CoreWebView2().and_then(|wv| wv.Navigate(&windows::core::HSTRING::from(destination)))
                    .map_err(|_| AppError::new("WEBVIEW_CREATE_FAILED", "Initial navigation failed"))
            })
        };
        let failed = result.is_err();
        let _ = with_state(&handle, |s| match result {
            Ok(()) => { if s.registry.get(&id).is_some() { s.ready_tabs.insert(id.clone()); } },
            Err(e) => { s.registry.close(&id, ActivateAfterClose::Right); s.creation_errors.insert(id.clone(), e); },
        });
        if failed || with_state(&handle, |s| s.registry.get(&id).is_none()).unwrap_or(true) {
            if let Some(wv) = handle.get_webview(&BrowserState::tab_label(&id)) { let _ = wv.close(); }
            let active = with_state(&handle, |s| s.registry.active_id().map(str::to_owned)).unwrap_or_default();
            apply_activation(&handle, active.as_deref());
        }
    })?;
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
    let bounds = content_bounds(app, &win);
    if let Err(err) = wv.set_bounds(bounds) {
        log::error!("[TAB] relayout failed: {err}");
    }
}

/// Keep the native tab webview aligned with the renderer's agent rail.
pub fn set_agent_panel_open<R: Runtime>(app: &AppHandle<R>, open: bool) {
    let _ = with_state(app, |state| state.agent_panel_open = open);
    relayout(app);
}

// ---------------------------------------------------------------------------
// Event handlers (called from webview callbacks)
// ---------------------------------------------------------------------------

fn on_page_load<R: Runtime>(
    app: &AppHandle<R>,
    tab_id: &str,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    if payload.url().as_str() == "about:blank" { return; }
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
                if let Err(e) = state.history.add(&entry) { log::error!("[HISTORY] {}", e.code); report_storage_error(app, &e); }
            }
        }
    });
    if matches!(event, tauri::webview::PageLoadEvent::Finished) { persist_session(app); }
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

#[allow(dead_code)]
fn on_download_event(
    app: &AppHandle<Wry>,
    event: tauri::webview::DownloadEvent<'_>,
    webview_label: &str,
) -> bool {
    log::info!("[DOWNLOAD] event on {webview_label}");
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
    if req.agent == Some(true) && (req.incognito == Some(true) || req.darkweb == Some(true)) { return Err(AppError::new("PROFILE_CONFLICT", "Choose exactly one profile")); }
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
            agent: req.agent,
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
    if let Err(e) = create_tab_webview(app, &win, tab_id, target, incognito, darkweb, activated) {
        let _ = with_state(app, |s| { s.registry.close(tab_id, ActivateAfterClose::Right); s.creation_errors.insert(tab_id.to_owned(), e.clone()); });
        return Err(e);
    }

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

/// A routed agent must use its own WebView environment, never a direct human tab.
pub fn ensure_agent_tab(app: &AppHandle<Wry>, active: &str, lease: &crate::run_guard::RunGuard) -> AppResult<String> {
    let existing = with_state(app, |s| s.registry.get(active).cloned())?
        .ok_or_else(|| AppError::new("TAB_NOT_FOUND", "Active tab is gone"))?;
    if existing.profile == "agent" { return Ok(existing.id); }
    lease.check()?;
    let req = OpenTabRequest { url: if existing.url.is_empty() { existing.pending_url } else { existing.url },
        activate: Some(true), incognito: None, darkweb: None, background: None, agent: Some(true), id: None, title: None };
    let (id, active, private, _, target) = prepare_open_tab(app, &req)?;
    let handle = app.clone(); let created = id.clone(); let guard = lease.clone();
    app.run_on_main_thread(move || {
        if guard.check().is_err() { let _ = close_tab(&handle, &created); return; }
        let _ = materialize_open_tab(&handle, &created, &target, private, active);
    })?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        lease.check()?;
        if with_state(app, |s| {
            if let Some(error) = s.creation_errors.remove(&id) { return Err(error); }
            Ok(s.ready_tabs.contains(&id))
        })?? { return Ok(id); }
        if std::time::Instant::now() >= deadline { return Err(AppError::new("WEBVIEW_CREATE_TIMEOUT", "Agent tab did not initialize")); }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
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
        state.target_ids.remove(&tab_id); state.ready_tabs.remove(&tab_id);
        if let Some(shield) = app.try_state::<crate::shield::SharedShield>() { shield.attached.lock().unwrap_or_else(|p| p.into_inner()).remove(&tab_id); }
        let tabs = state.registry.list();
        let order = state.registry.order().to_vec();
        let active = state.registry.active_id().map(str::to_string);
        if let Err(e) = state.session.save(&tabs, &state.navstacks, &order, active.as_deref()) { log::error!("[SESSION] {}", e.code); report_storage_error(app, &e); }
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
    #[cfg(windows)]
    if let Some(guard) = crate::run_guard::current() {
        return crate::bridge::navigate_guarded(app, &req.tab_id, parsed.as_str(), guard);
    }


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

/// Shift the stack for a native history hop and report whether the landing
/// entry lies outside this webview instance's native history (restored from
/// a previous session) — such hops need an explicit URL navigation instead.
fn nav_direction(app: &AppHandle<Wry>, tab_id: &str, forward: bool) -> AppResult<Option<String>> {
    with_state(app, |state| {
        let direct = {
            let stack = state.navstack_mut(tab_id);
            let target = if forward { stack.forward_target() } else { stack.back_target() };
            let direct = target.filter(|(i, _)| !stack.native_reachable(*i)).map(|(_, url)| url.to_string());
            match direct {
                Some(url) => { stack.begin_explicit(&url); Some(url) }
                None => {
                    let moved = if forward { stack.can_go_forward() } else { stack.can_go_back() };
                    if moved { if forward { stack.go_forward(); } else { stack.go_back(); } }
                    None
                }
            }
        };
        if let Some(tab) = state.registry.get_mut(tab_id) {
            let stack = state.navstacks.get(tab_id);
            tab.can_go_back = stack.map(|s| s.can_go_back()).unwrap_or(false);
            tab.can_go_forward = stack.map(|s| s.can_go_forward()).unwrap_or(false);
        }
        direct
    })
}

/// history.back()/forward() via page-context script — Tauri's webview API
/// has no native go_back/go_forward on WebView2. Entries restored from a
/// previous session navigate by URL: a fresh webview's native history cannot
/// reach them, and an explicit navigation reorders the joint history, so the
/// stack records it as a fresh navigation (navstack.rs begin_explicit).
pub fn nav_back(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    let direct = nav_direction(app, tab_id, false)?;
    let script = direct.map_or_else(
        || "history.back();".to_string(),
        |url| format!("location.href = {};", serde_json::to_string(&url).unwrap_or_else(|_| "\"about:blank\"".into())),
    );
    eval_script(app, tab_id, &script)?;
    Ok(true)
}

pub fn nav_forward(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<bool> {
    let direct = nav_direction(app, tab_id, true)?;
    let script = direct.map_or_else(
        || "history.forward();".to_string(),
        |url| format!("location.href = {};", serde_json::to_string(&url).unwrap_or_else(|_| "\"about:blank\"".into())),
    );
    eval_script(app, tab_id, &script)?;
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

static STORAGE_ERRORS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
fn report_storage_error<R: Runtime>(app: &AppHandle<R>, error: &AppError) {
    let mut errors = STORAGE_ERRORS.lock().unwrap_or_else(|p| p.into_inner());
    if !errors.contains(&error.code) { errors.push(error.code.clone()); }
    let _ = app.emit("storage:error", &error.code);
}
pub fn list_tabs(app: &AppHandle<Wry>) -> AppResult<Vec<TabState>> {
    // Replay startup failures after the renderer subscribes; polling cannot
    // accidentally turn an unreadable session into a silent empty session.
    for code in STORAGE_ERRORS.lock().unwrap_or_else(|p| p.into_inner()).iter() { let _ = app.emit("storage:error", code); }
    with_state(app, |state| state.registry.list())
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/// Restore persisted session on startup; open the new-tab page when empty
/// (mirrors BrowserCore.attachToWindow).
pub fn bootstrap_session(app: &AppHandle<Wry>) {
    let snapshot = match with_state(app, |state| state.session.load()).and_then(|v| v) { Ok(v) => v, Err(e) => { log::error!("[SESSION] {}", e.code); report_storage_error(app, &e); None } };
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
            agent: Some(tab.agent),
                id: Some(tab.id.clone()),
                title: Some(tab.title.clone()),
            };
            if open_tab(app, &req).is_ok() {
                // Parity with the TS runtime: restore the tab's navigation
                // stack so back/forward survive a restart.
                let nav = &tab.navigation;
                if !nav.back_stack.is_empty() || nav.current.is_some() || !nav.forward_stack.is_empty() {
                let _ = with_state(app, |state| {
                    state.navstacks.insert(tab.id.clone(), crate::navstack::NavStack::from_session(nav));
                });
                }
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
            agent: None,
            id: None,
            title: None,
        };
        if let Err(err) = open_tab(app, &req) {
            log::error!("[SESSION] initial new-tab open failed: {err}");
        }
    }
}

/// Save the current session (called on quit and on window_close).
pub fn persist_session<R: Runtime>(app: &AppHandle<R>) {
    let _ = with_state(app, |state| {
        let tabs = state.registry.list();
        let order = state.registry.order().to_vec();
        let active = state.registry.active_id().map(str::to_string);
        if let Err(e) = state.session.save(&tabs, &state.navstacks, &order, active.as_deref()) { log::error!("[SESSION] {}", e.code); report_storage_error(app, &e); }
    });
}

/// Wire window resize to both native layers. The chrome/shell webview is a
/// child webview too, so Tauri does not resize it automatically with the
/// frameless host window.
pub fn watch_window_events(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_window("main") {
        let handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Resized(_) = event {
                if let (Some(win), Some(chrome)) =
                    (handle.get_window("main"), handle.get_webview("main"))
                {
                    let (width, height) = window_logical_size(&win);
                    let bounds = Rect {
                        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                        size: Size::Logical(LogicalSize::new(width, height)),
                    };
                    if let Err(err) = chrome.set_bounds(bounds) {
                        log::error!("[CHROME] resize failed: {err}");
                    }
                }
                relayout(&handle);
            }
        });
    }
}

// Convenience passthroughs used by commands -------------------------------

pub fn query_history(app: &AppHandle<Wry>, q: &HistoryQuery) -> AppResult<Vec<HistoryEntry>> {
    with_state(app, |state| state.history.query(q))?
}

pub fn add_history(app: &AppHandle<Wry>, req: &HistoryAddRequest) -> AppResult<HistoryEntry> {
    with_state(app, |state| state.history.add(req))?
}

pub fn delete_history(app: &AppHandle<Wry>, id: &str) -> AppResult<bool> {
    with_state(app, |state| state.history.delete(id))?
}

pub fn clear_history(app: &AppHandle<Wry>) -> AppResult<()> {
    with_state(app, |state| state.history.clear())?
}

pub fn list_bookmarks(app: &AppHandle<Wry>) -> AppResult<Vec<Bookmark>> {
    with_state(app, |state| state.bookmarks.list())?
}

pub fn add_bookmark(app: &AppHandle<Wry>, req: &BookmarkAddRequest) -> AppResult<Bookmark> {
    with_state(app, |state| state.bookmarks.add(req))?
}

pub fn delete_bookmark(app: &AppHandle<Wry>, id: &str) -> AppResult<bool> {
    with_state(app, |state| state.bookmarks.delete(id))?
}

pub fn list_downloads(app: &AppHandle<Wry>) -> AppResult<Vec<DownloadItemState>> {
    with_state(app, |state| state.downloads.list())
}
