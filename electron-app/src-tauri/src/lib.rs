//! HayDevBrowser — Tauri 2 runtime.
//!
//! Architecture parity with the Electron runtime (`src/main/index.ts`):
//! - main window = frameless React chrome (config in tauri.conf.json)
//! - tab content = child webviews (`browser-tab-{uuid}` labels)
//! - data dir = the OS app-data dir; SAME JSON store files as Electron
//! - pab:// internal pages served by `pab::handle_pab` (newtab, search,
//!   darkweb + its JSON mini-API)
//! - AI providers (Ollama Cloud / Gemini / NVIDIA) resolved per run (llm.rs)
//! - control authorization HUMAN/AGENT (control.rs) with renderer pushes
//! - dark-web search over the Tor SOCKS gateway (socks_http.rs + darkweb.rs)
//! - bounded onion crawler + local index (crawl.rs) + download quarantine
//!   (downloads.rs, wiped at exit)
//! - login capture → DPAPI vault prompts (vault_capture.rs)
//! - memory facts + confirmation prompts (memory.rs, memory.save tool)
//! - vision attachments via the __pabNewTab bridge (attachments.rs)
//! - local MCP server with the darkweb tool surface (mcp.rs, port 27301)
//!
//! Honest remaining gaps (FEATURE_NOT_AVAILABLE, never fake success):
//! download cancel mid-flight (wry exposes no cancel handle — verified).

pub mod agent;
pub mod atomic_store;
pub mod run_guard;
pub mod attachments;
pub mod bridge;
pub mod cdp;
pub mod challenge;
pub mod commands;
pub mod control;
pub mod core;
pub mod crawl;
pub mod darkweb;
pub mod domain_policy;
pub mod downloads;
pub mod documents;
pub mod error;
pub mod extract;
pub mod layout;
pub mod llm;
pub mod mcp;
pub mod memory;
pub mod navstack;
#[cfg(windows)]
pub mod native_webview;
pub mod netguard;
pub mod pab;
pub mod privacy;
pub mod privacy_init;
pub mod profiles;
pub mod registry;
pub mod runtime_manager;
pub mod shield;
pub mod site_ua;
pub mod socks_http;
pub mod stores;
pub mod types;
pub mod urlnorm;
pub mod vault;
pub mod vault_capture;

use tauri::{Manager, RunEvent, WebviewUrl};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // FIRST: log every panic to %APPDATA%\com.haydev.browser\panic.log.
    // Release builds must never die silently — a panicking provider/agent
    // thread leaves a trace we can read after the fact.
    install_panic_logger();
    // One shared local-index instance for BOTH the crawler and the pab/API
    // state lookups (Arc clone — same store everywhere).
    let darkweb_index: crawl::SharedIndex = std::sync::Arc::new(std::sync::Mutex::new(
        crawl::LocalIndex::default(),
    ));
    tauri::Builder::default()
        // Native file dialogs for the __pabNewTab attachment bridge (Rust
        // API only — no JS-side permissions are granted by this plugin).
        .plugin(tauri_plugin_dialog::init())
        // Single instance: a second launch focuses the existing window instead
        // of forking a second browser state (Electron had this; parity).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
          use tauri::Manager;
          if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.set_focus();
          }
          log::info!("[TAURI] second-instance signal — focused existing window");
        }))
        // ASYNC protocol handler (UI-freeze fix, 2026-10-01): WebView2 raises
        // WebResourceRequested on the UI thread — the SYNC variant made every
        // slow pab endpoint (darkweb preview/fetch over Tor, up to ~25 s)
        // freeze the whole window. Heavy work now runs on a worker thread and
        // replies through UriSchemeResponder.
        .register_asynchronous_uri_scheme_protocol("pab", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let owner = ctx.webview_label().to_string();
            std::thread::spawn(move || {
                let response = pab::handle_pab(&app, &request, &owner);
                responder.respond(response);
            });
        })
        .manage(runtime_manager::new_manager())
        .manage(agent::new_agent())
        .manage(attachments::SharedAttachments::default())
        .manage(control::SharedControl::default())
        .manage(memory::SharedMemory::default())
        .manage(darkweb::SharedDarkWeb::new(darkweb::DarkWebService::new(
            &darkweb_data_dir(),
        )))
        .manage(vault_capture::new_capture())
        .manage(darkweb_index.clone())
        .manage(crawl::CrawlRegistry::new(darkweb_index))
        .manage(downloads::SharedQuarantine::default())
        .manage(shield::new_shield(crate::privacy::global().shield_enabled))
        .manage(core::shared(initial_state()))
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::build_identity,
            commands::foundation_ping,
            commands::app_runtime_status,
            commands::runtime_manager_status,
            commands::runtime_manager_start,
            commands::runtime_manager_stop,
            commands::profile_status,
            commands::profile_clear,
            commands::browser_debug_port,
            commands::browser_challenge_detect,
            commands::browser_challenge_handoff,
            commands::browser_challenge_resolve,
            commands::browser_evaluate,
            commands::browser_click,
            commands::browser_type_text,
            commands::browser_press_key,
            commands::browser_scroll_by,
            commands::browser_dom_snapshot,
            commands::browser_wait_selector,
            commands::browser_screenshot,
            commands::browser_tabs_list,
            commands::browser_tabs_open,
            commands::browser_tabs_close,
            commands::browser_tabs_activate,
            commands::browser_navigate,
            commands::browser_back,
            commands::browser_forward,
            commands::browser_reload,
            commands::browser_stop,
            commands::browser_history_query,
            commands::browser_history_delete,
            commands::browser_history_clear,
            commands::browser_history_add,
            commands::browser_bookmarks_list,
            commands::browser_bookmarks_add,
            commands::browser_bookmarks_delete,
            commands::browser_downloads_list,
            commands::browser_downloads_cancel,
            commands::browser_downloads_remove,
            commands::agent_run,
            commands::agent_stop,
            commands::agent_status,
            commands::agent_timeline_list,
            commands::agent_research_report,
            commands::agent_pick_attachment,
            commands::agent_release_attachment,
            commands::control_set_mode,
            commands::control_take_control,
            commands::control_get_mode,
            commands::privacy_status,
            commands::privacy_set_fingerprint_noise,
            commands::set_locale,
            commands::ui_locale,
            commands::shield_status,
            commands::shield_set_enabled,
            commands::shield_allow_site,
            commands::shield_disallow_site,
            commands::vault_save,
            commands::vault_has,
            commands::vault_list,
            commands::vault_generate_and_store,
            commands::vault_fill,
            commands::vault_delete,
            commands::vault_prompt_current,
            commands::vault_prompt_resolve,
            commands::memory_prompt_current,
            commands::memory_prompt_resolve,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_set_agent_panel_open,
            commands::window_close,
        ])
        .setup(|app| {
            // Logging in BOTH debug and release. Release diagnostics go to
            // the OS log dir (rotated); stdout is invisible in a GUI app but
            // harmless. Without this, "works on my machine" is unprovable.
            {
                use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};
                let mut targets = vec![
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: Some("haydev.log".into()) }),
                ];
                if cfg!(debug_assertions) {
                    targets.push(Target::new(TargetKind::Webview));
                }
                app.handle().plugin(
                    LogBuilder::default()
                        .level(log::LevelFilter::Info)
                        .max_file_size(2_000_000)
                        .rotation_strategy(RotationStrategy::KeepOne)
                        .targets(targets)
                        .build(),
                )?;
            }
            let handle = app.handle().clone();
            // Load dev .env (no dotenv dependency): KEY=VALUE lines only,
            // real environment variables take precedence.
            load_dev_env();
            // Memory facts store (file path resolution; lazy file load).
            memory::init(&handle);
            // Local MCP server with the darkweb tool surface (loopback only;
            // failure to bind degrades honestly to offline).
            mcp::start(handle.clone());

            // Dark-web environment privacy (parity with Electron's
            // memory:darkweb- partitions): the isolated Tor profile keeps
            // NOTHING across launches.
            wipe_ephemeral_profiles();

            // DevTools is opt-in for isolated release QA. Runtime automation
            // uses the concrete native WebView and requires no TCP listener.
            let chrome_port = core::chrome_debug_port();
            let window = tauri::WindowBuilder::new(&handle, "main")
                .title("HayDev Browser OS")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .decorations(false)
                .resizable(true)
                .build()?;
            // The shell must NOT use the engine's global user-data folder:
            // it shares the DEFAULT profile's folder (inside the selected
            // data-root) so WebView2 keeps one environment for shell +
            // default tabs. Remote tabs keep zero invoke capability (IPC is
            // per-webview); Agent/Private/DarkWeb keep their own
            // environments and egress. A directory failure aborts startup —
            // falling back to the global profile is not allowed.
            let shell_profile_dir = {
                let manager = crate::profiles::BrowserProfileManager::new(&crate::lib_app_data_dir());
                manager
                    .ensure(crate::profiles::ProfileKind::Default)
                    .and_then(|()| manager.data_dir(crate::profiles::ProfileKind::Default).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "profile dir unavailable")))
                    .map_err(|e| format!("shell profile directory failed: {e}"))?
            };
            let chrome_webview = tauri::WebviewBuilder::new(
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .data_directory(shell_profile_dir)
            .additional_browser_args(&format!(
                "{}{}", crate::privacy::PRIVACY_BROWSER_ARGS, core::debug_args(chrome_port)
            ));
            window.add_child(
                chrome_webview,
                tauri::LogicalPosition::new(0.0, 0.0),
                window.inner_size()?,
            )?;
            log::info!("[TAURI] chrome window ready (debug port {chrome_port}, tab port {})", core::tab_debug_port());

            // Tab webview layout follows window resizes.
            core::watch_window_events(&handle);
            // Restore the previous session (or open the new-tab page).
            core::bootstrap_session(&handle);
            // Anti-detect: resolve the cleaned site UA from the engine's
            // real UA (worker thread; tab webviews pick it up once ready).
            core::warm_site_user_agent();
            // Verify the Perplexica chat model against the live Gemini API
            // (worker thread) so pab://search serves a model that actually
            // answers — never one that 404s and hangs the search promise.
            crate::llm::warm_preferred_chat_model();
            // Login capture poller (bridge-based; prompts push to the chrome).
            vault_capture::start_poller(handle.clone());
            // Managed backend engines (Perplexica/SearXNG/Tor) start ASYNC —
            // the window never waits for backends (parity with the Electron
            // runtime's runtimeManager.start()). Stale children from a hard-
            // killed previous run are swept first so they never hold ports.
            let manager = handle
                .state::<runtime_manager::SharedRuntimeManager>()
                .inner()
                .clone();
            if std::env::var("HAYDEV_NO_ENGINES").is_ok_and(|v| v.trim() == "1") {
                // QA/E2E isolation: no bundled engines spawn at all (the
                // suite drives its own local fixtures). Never set by the
                // app itself; production always starts engines.
                log::info!("[TAURI] HAYDEV_NO_ENGINES=1 — managed engines skipped (QA)");
            } else {
                std::thread::spawn(move || runtime_manager::start_all(&manager));
            }
            log::info!("[TAURI] browser core ready");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Persist the open tabs for the next launch (parity with the
                // Electron runtime's before-quit session save).
                core::persist_session(app);
                // Tree-kill managed engines FIRST — no orphan tor/python/node
                // children survive HayDevBrowser (parity: engines→sweep order).
            if let Some(manager) = app.try_state::<runtime_manager::SharedRuntimeManager>() {
                runtime_manager::stop_all(manager.inner());
            }
            // Quarantine wipe (Electron parity): nothing from an onion tab
            // survives the exit unless explicitly saved.
            if let Some(q) = app.try_state::<downloads::SharedQuarantine>() {
                q.lock().unwrap_or_else(|p| p.into_inner()).wipe_all();
            }
                log::info!("[TAURI] session persisted; engines stopped; exiting");
            }
        });
}

/// App-data dir WITHOUT the create_dir_all side effect (for optional reads
/// like the user .env lookup).
fn app_data_dir_opt() -> Option<std::path::PathBuf> {
    let ident = "com.haydev.browser";
    if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(|base| std::path::PathBuf::from(base).join(ident))
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| {
            std::path::PathBuf::from(h)
                .join("Library/Application Support")
                .join(ident)
        })
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config"))
            })
            .map(|base| base.join(ident))
    }
}

fn initial_state() -> core::BrowserState {    let dir = app_data_dir();
    if let Err(err) = std::fs::create_dir_all(&dir) {
        log::error!("[TAURI] cannot create data dir {}: {err}", dir.display());
    }
    core::BrowserState::new(&dir)
}

/// Global panic hook: append every panic (message + thread + payload) to
/// `<data-dir>/panic.log`. Runs even under `panic=unwind` for thread panics
/// that would otherwise vanish without a trace.
fn install_panic_logger() {
    let dir = app_data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let log_path = dir.join("panic.log");
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>").to_string();
        let msg = format!(
            "[{}] thread {name}: {info}\n",
            chrono_like_timestamp()
        );
        eprint!("{msg}");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            use std::io::Write;
            let _ = file.write_all(msg.as_bytes());
        }
    }));
}

/// Local time "YYYY-MM-DD HH:MM:SS" without pulling a chrono dependency.
fn chrono_like_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Days since epoch → civil date (Howard Hinnant's algorithm).
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{d:02} {h:02}:{m:02}:{s:02}")
}

/// Data dir for the dark-web service (config/history JSON files).
pub fn darkweb_data_dir() -> std::path::PathBuf {
    let dir = app_data_dir().join("darkweb");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Wipe the isolated Tor webview profile (privacy parity with Electron's
/// in-memory darkweb partitions — nothing survives a restart). Runs BEFORE
/// session restore, so no live darkweb tab can exist yet.
fn wipe_ephemeral_profiles() {
    let manager = crate::profiles::BrowserProfileManager::new(&lib_app_data_dir());
    for kind in [
        crate::profiles::ProfileKind::DarkWeb,
        // PRIVATE hosts an isolated InPrivate environment; wipe guarantees
        // nothing from a previous session survives (privacy.rs contract).
        crate::profiles::ProfileKind::Private,
    ] {
        if let Some(dir) = manager.data_dir(kind) {
            if dir.exists() {
                if let Err(err) = std::fs::remove_dir_all(&dir) {
                    log::warn!("[PRIVACY] {:?} profile wipe failed: {err}", kind);
                } else {
                    log::info!("[PRIVACY] {:?} profile wiped for a fresh session", kind);
                }
            }
        }
    }
}

/// The OS app-data directory for this identifier.
/// Matches the Tauri path resolver (identifier from tauri.conf.json).
pub fn lib_app_data_dir() -> std::path::PathBuf {
    app_data_dir()
}

fn app_data_dir() -> std::path::PathBuf {
    // QA/E2E isolation: an explicit absolute data root (temp profile dir)
    // keeps automated runs off the real user profile. Unset in production —
    // the OS default below applies (never set by the app itself).
    if let Some(dir) = std::env::var_os("HAYDEV_DATA_DIR") {
        if !dir.is_empty() {
            return std::path::PathBuf::from(dir);
        }
    }
    // %APPDATA%\<identifier> on Windows; XDG on Linux; Library on macOS.
    let ident = "com.haydev.browser";
    if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(|base| std::path::PathBuf::from(base).join(ident))
            .unwrap_or_else(|| std::path::PathBuf::from(".haydev-browser"))
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME")
            .map(|h| {
                std::path::PathBuf::from(h)
                    .join("Library/Application Support")
                    .join(ident)
            })
            .unwrap_or_else(|| std::path::PathBuf::from(".haydev-browser"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config"))
            })
            .map(|base| base.join(ident))
            .unwrap_or_else(|| std::path::PathBuf::from(".haydev-browser"))
    }
}

/// Minimal .env loader — the Electron runtime loads `electron-app/.env` via
/// dotenv; parity for AI/search endpoint configuration without adding a
/// dependency. Existing environment variables always win.
fn load_dev_env() {
    let mut candidates = vec![
        std::path::PathBuf::from(".env"),
        std::path::PathBuf::from("../.env"),
    ];
    // Installed builds have no project .env in CWD (Program Files) — the
    // user-configured location is the app-data dir:
    //   %APPDATA%\com.haydev.browser\.env
    if let Some(data_env) = app_data_dir_opt().map(|d| d.join(".env")) {
        candidates.insert(0, data_env);
    }
    for path in candidates {
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            let mut value = value.trim().to_string();
            if let Some(stripped) = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
                value = stripped.to_string();
            } else if let Some(stripped) =
                value.strip_prefix('\'').and_then(|v| v.strip_suffix('\''))
            {
                value = stripped.to_string();
            }
            if std::env::var_os(key).is_none() && !key.is_empty() {
                std::env::set_var(key, &value);
            }
        }
        break;
    }
}

#[cfg(windows)]
mod run_host;
