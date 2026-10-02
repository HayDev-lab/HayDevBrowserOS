//! Rust ProcessManager — managed backend engines (migration Phase 7).
//!
//! Faithful port of the Node `HayDevRuntimeManager` orchestration contract:
//! - endpoint resolution: EXTERNAL healthy URL from env (adopted, no spawn)
//!   → BUNDLED managed runtime (resources/runtimes) → honest FAILED;
//! - allowlist: exactly three services (searxng, perplexica, tor) with
//!   fixed, bundled executables — no generic shell execution, ever;
//! - start(): async, non-blocking; a crashing engine never takes the
//!   browser down (bounded restart ≤3 attempts, 1s/2s/4s backoff);
//! - health: SearXNG = REAL functional JSON query; Perplexica = HTTP probe
//!   (<500); Tor = end-to-end SOCKS5 CONNECT through the proxy (remote DNS);
//! - stop(): tree-kill every child we spawned (external endpoints are
//!   adopted and NEVER killed).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use std::time::{Duration, Instant};
use tauri::Manager;

use serde::Serialize;

const PREFERRED_PERPLEXICA: u16 = 3000;
const PREFERRED_SEARXNG: u16 = 8888;
const PREFERRED_TOR_SOCKS: u16 = 9050;
const PREFERRED_TOR_CONTROL: u16 = 9051;
/// Tor bootstrap can take a while on a cold network.
const TOR_START_TIMEOUT: Duration = Duration::from_secs(90);
const SEARXNG_START_TIMEOUT: Duration = Duration::from_secs(90);
const PERPLEXICA_START_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RESTARTS: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceState {
    Stopped,
    Starting,
    Bootstrapping,
    Ready,
    Degraded,
    Failed,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub state: ServiceState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    /// "managed" | "external" | "not-started"
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// Tor bootstrap percent (0..100) from the control port — present only
    /// while BOOTSTRAPPING/READY (Electron followBootstrap parity).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u32>,
}

impl ServiceStatus {
    fn not_started() -> Self {
        Self {
            state: ServiceState::Stopped,
            endpoint: None,
            source: "not-started".into(),
            error_code: None,
            pid: None,
            progress: None,
        }
    }
}

#[derive(Default)]
struct Svc {
    status: Option<ServiceStatus>,
    child_pid: Option<u32>,
    restarts: u32,
}

#[derive(Default)]
pub struct RuntimeManagerState {
    svcs: HashMap<&'static str, Svc>,
    started_at: Option<u64>,
}

impl RuntimeManagerState {
    pub fn status_json(&self) -> serde_json::Value {
        let g = |k: &str| self.svcs.get(k).and_then(|s| s.status.clone());
        serde_json::json!({
            "perplexica": g("perplexica").unwrap_or_else(ServiceStatus::not_started),
            "searxng": g("searxng").unwrap_or_else(ServiceStatus::not_started),
            "tor": g("tor").unwrap_or_else(ServiceStatus::not_started),
            "startedAt": self.started_at,
        })
    }

    /// Raw service state (footer-chip phase reporting).
    pub fn service_state(&self, key: &str) -> Option<ServiceState> {
        self.svcs
            .get(key)
            .and_then(|s| s.status.as_ref())
            .map(|st| st.state)
    }

    pub fn perplexica_endpoint(&self) -> Option<String> {
        self.svcs
            .get("perplexica")
            .and_then(|s| s.status.as_ref())
            .and_then(|s| s.endpoint.clone())
    }

    /// Managed Tor SOCKS endpoint (socks5://host:port) when READY/adopted.
    pub fn tor_socks_endpoint(&self) -> Option<String> {
        self.svcs
            .get("tor")
            .and_then(|s| s.status.as_ref())
            .and_then(|s| s.endpoint.clone())
    }
}

pub type SharedRuntimeManager = Arc<Mutex<RuntimeManagerState>>;

pub fn new_manager() -> SharedRuntimeManager {
    Arc::new(Mutex::new(RuntimeManagerState::default()))
}

/// State-access helper (same pattern as core::with_state — the State handle
/// must outlive the MutexGuard).
pub fn with_manager<R: tauri::Runtime, T>(
    app: &tauri::AppHandle<R>,
    f: impl FnOnce(&RuntimeManagerState) -> T,
) -> Option<T> {
    let state = app.try_state::<SharedRuntimeManager>()?;
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    Some(f(&guard))
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

fn app_data_dir() -> PathBuf {
    crate::lib_app_data_dir()
}

fn runtimes_root() -> Option<PathBuf> {
    let mut candidates = vec![
        // dev: electron-app/resources/runtimes (cwd = electron-app or src-tauri)
        PathBuf::from("resources/runtimes"),
        PathBuf::from("../resources/runtimes"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // packaged NSIS: <install>/resources/runtimes (bundle.resources)
            candidates.push(dir.join("resources/runtimes"));
            candidates.push(dir.join("../../../resources/runtimes"));
        }
    }
    for c in &candidates {
        if c.join("tor").exists() || c.join("searxng").exists() {
            // ALWAYS absolute — children resolve argv/cwd against it.
            // The \\?\ verbatim prefix from canonicalize BREAKS node's module
            // resolution (verified live: node EISDIR 'D:') — strip it.
            return std::fs::canonicalize(c).ok().map(strip_verbatim);
        }
    }
    None
}

/// Remove the Windows verbatim-path prefix (`\\?\C:\...` → `C:\...`),
/// preserving UNC shares (`\\?\UNC\server\share` → `\\server\share`).
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

fn logs_dir() -> PathBuf {
    let d = app_data_dir().join("runtime").join("logs");
    let _ = std::fs::create_dir_all(&d);
    d
}

// ---------------------------------------------------------------------------
// Port allocation — bind-probe + CONNECT-probe (port of the TS PortManager).
// On Windows a specific-address bind (127.0.0.1) can succeed even when a
// wildcard 0.0.0.0 holder exists on the same port; the connect-probe catches
// those holders (verified live: an external Next server on 0.0.0.0:3000).
// ---------------------------------------------------------------------------

pub(crate) fn find_free_port(preferred: u16) -> u16 {
    let mut port = preferred;
    loop {
        if port == 0 {
            return preferred; // wrapped — caller will fail honestly
        }
        // Bind-probe (dropped immediately), THEN connect-probe — connecting
        // to our own live listener would always succeed.
        let bind_ok = TcpListener::bind(("127.0.0.1", port)).map(drop).is_ok();
        if bind_ok {
            // Wildcard-holder check: if anything ACCEPTS a connection on the
            // port, it is taken even though our specific bind succeeded.
            let taken = TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}").parse().unwrap(),
                Duration::from_millis(250),
            )
            .is_ok();
            if !taken {
                return port;
            }
        }
        port += 1;
    }
}

// ---------------------------------------------------------------------------
// Spawning (allowlisted executables ONLY)
// ---------------------------------------------------------------------------

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn spawn_service(
    command: &Path,
    args: &[&str],
    cwd: &Path,
    envs: &[(&str, String)],
    log_name: &str,
) -> std::io::Result<Child> {
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir().join(log_name))?;
    let err_file = log_file.try_clone()?;
    let mut cmd = Command::new(command);
    cmd.args(args)
        .current_dir(cwd)
        .env_clear_off(envs)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(err_file));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

trait EnvClearOff {
    fn env_clear_off(&mut self, envs: &[(&str, String)]) -> &mut Self;
}

impl EnvClearOff for Command {
    fn env_clear_off(&mut self, envs: &[(&str, String)]) -> &mut Self {
        for (k, v) in envs {
            self.env(k, v);
        }
        self
    }
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags_if_windows()
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

#[cfg(windows)]
trait CreationFlagsExt {
    fn creation_flags_if_windows(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl CreationFlagsExt for Command {
    fn creation_flags_if_windows(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }
}

// ---------------------------------------------------------------------------
// Service starters
// ---------------------------------------------------------------------------

fn set_status(m: &SharedRuntimeManager, key: &'static str, f: impl FnOnce(&mut ServiceStatus)) {
    let mut guard = m.lock().unwrap_or_else(|p| p.into_inner());
    let svc = guard.svcs.entry(key).or_default();
    let status = svc.status.get_or_insert_with(ServiceStatus::not_started);
    f(status);
}

/// SearXNG managed spawn — portable Python + runner, generated settings.yml
/// (same engine policy as the TS service: keep_only bing/google, JSON on).
fn start_searxng(m: SharedRuntimeManager, external_url: Option<String>) {
    std::thread::spawn(move || {
        // External adopt (env-configured, healthy) — never spawn, never kill.
        if let Some(url) = external_url {
            if probe_searxng_healthy(&url) {
                set_status(&m, "searxng", |s| {
                    *s = ServiceStatus {
                        state: ServiceState::Ready,
                        endpoint: Some(url),
                        source: "external".into(),
                        error_code: None,
                        pid: None,
                        progress: None,
                    }
                });
                log::info!("[PROCESS] searxng READY via external adopt");
                return;
            }
        }
        let Some(root) = runtimes_root() else {
            set_status(&m, "searxng", |s| {
                *s = fail("RUNTIME_NOT_BUNDLED");
            });
            log::error!("[PROCESS] searxng FAILED: runtime bundle not found");
            return;
        };
        let base = root.join("searxng");
        let python_exe = base.join("python").join("python.exe");
        let runner = base.join("searxng-runner.py");
        let app_dir = base.join("app");
        if !(python_exe.exists() && runner.exists() && app_dir.exists()) {
            set_status(&m, "searxng", |s| *s = fail("RUNTIME_NOT_BUNDLED"));
            return;
        }

        let port = find_free_port(PREFERRED_SEARXNG);
        let config_dir = app_data_dir().join("runtime").join("searxng");
        let settings = write_searxng_settings(&config_dir, port);

        set_status(&m, "searxng", |s| {
            s.state = ServiceState::Starting;
            s.source = "managed".into();
        });
        match spawn_service(
            &python_exe,
            &[runner.to_string_lossy().as_ref()],
            &app_dir,
            &[
                (
                    "SEARXNG_SETTINGS_PATH",
                    settings.to_string_lossy().to_string(),
                ),
                ("SEARXNG_PORT", port.to_string()),
                ("PYTHONPATH", app_dir.to_string_lossy().to_string()),
                (
                    "PYTHONHOME",
                    base.join("python").to_string_lossy().to_string(),
                ),
            ],
            "searxng.log",
        ) {
            Ok(child) => {
                let pid = child.id();
                set_status(&m, "searxng", |s| s.pid = Some(pid));
                log::info!("[PROCESS] searxng spawned pid={pid} port={port}");
                watch_until_ready(
                    &m,
                    "searxng",
                    child,
                    pid,
                    &format!("http://127.0.0.1:{port}"),
                    SEARXNG_START_TIMEOUT,
                    probe_searxng_healthy,
                    restart_searxng,
                );
            }
            Err(err) => set_status(&m, "searxng", |s| {
                *s = fail(&format!("SPAWN_FAILED: {err}"));
            }),
        }
    });
}

fn write_searxng_settings(config_dir: &Path, port: u16) -> PathBuf {
    let _ = std::fs::create_dir_all(config_dir);
    // Engine policy (2026-10-01 revision, Electron parity): the original
    // keep_only [bing, google] died in the field — google CAPTCHA (engine
    // suspended 3600 s), bing timeouts. Multi-engine redundancy: SearXNG
    // merges results and merely lists dead engines in unresponsive_engines.
    // limiter: false — loopback-only instance; Perplexica sends no
    // X-Forwarded-For, which botdetection otherwise rejects.
    let reliable_engines = [
        "bing", "google", "duckduckgo", "brave", "qwant",
        "startpage", "mojeek", "wikipedia", "ecosia", "marginalia",
    ];
    let mut yaml = String::from("use_default_settings:\n  engines:\n    keep_only:\n");
    for e in reliable_engines {
        yaml.push_str(&format!("      - {e}\n"));
    }
    yaml.push_str("engines:\n");
    for e in reliable_engines {
        yaml.push_str(&format!("  - name: {e}\n    disabled: false\n"));
    }
    // Per-instance random secret (regenerated on every spawn).
    let secret = uuid::Uuid::new_v4().to_string().replace('-', "");
    yaml.push_str(&format!(
        "server:\n  secret_key: \"{secret}\"\n  bind_address: \"127.0.0.1\"\n  port: {port}\n  limiter: false\noutgoing:\n  request_timeout: 10.0\nsearch:\n  formats:\n    - html\n    - json\n"
    ));
    let file = config_dir.join("settings.yml");
    let _ = std::fs::write(&file, yaml);
    file
}

fn restart_searxng(m: SharedRuntimeManager) {
    start_searxng(m, None);
}

fn probe_searxng_healthy(endpoint: &str) -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(4))
        .build();
    match agent
        .get(&format!("{endpoint}/search?q=haydev+health&format=json"))
        .set("X-Forwarded-For", "127.0.0.1")
        .call()
    {
        Ok(resp) => {
            let mut body = String::new();
            resp.into_reader()
                .take(64 * 1024)
                .read_to_string(&mut body)
                .is_ok_and(|_| body.contains("\"results\""))
        }
        Err(_) => false,
    }
}

fn fail(code: &str) -> ServiceStatus {
    ServiceStatus {
        state: ServiceState::Failed,
        endpoint: None,
        source: "managed".into(),
        error_code: Some(code.to_string()),
        pid: None,
        progress: None,
    }
}

/// Health-poll until READY or timeout; watch for unexpected exit with
/// bounded restarts. `restart` is only called while the process DIED
/// unexpectedly (not on probe timeout — that stays STARTING→FAILED).
#[allow(clippy::too_many_arguments)]
fn watch_until_ready(
    m: &SharedRuntimeManager,
    key: &'static str,
    mut child: Child,
    pid: u32,
    endpoint: &str,
    timeout: Duration,
    probe: fn(&str) -> bool,
    restart: fn(SharedRuntimeManager),
) {
    let started = Instant::now();
    let deadline = started + timeout;
    loop {
        // Exit detection first (expected stop sets STOPPING/STOPPED upstream).
        match child.try_wait() {
            Ok(Some(exit)) => {
                let (restarts, should_restart) = {
                    let mut guard = m.lock().unwrap_or_else(|p| p.into_inner());
                    let svc = guard.svcs.entry(key).or_default();
                    svc.restarts += 1;
                    (svc.restarts, svc.restarts <= MAX_RESTARTS)
                };
                log::error!("[PROCESS] {key} exited unexpectedly ({exit:?}) — attempt {restarts}/{MAX_RESTARTS}");
                if !should_restart {
                    set_status(m, key, |s| {
                        *s = fail("RESTARTS_EXHAUSTED");
                    });
                    return;
                }
                let backoff = Duration::from_secs(1 << (restarts - 1));
                std::thread::sleep(backoff);
                let m2 = m.clone();
                restart(m2);
                return;
            }
            Ok(None) => {}
            Err(err) => {
                log::error!("[PROCESS] {key} wait error: {err}");
                return;
            }
        }
        if probe(endpoint) {
            set_status(m, key, |s| {
                s.state = ServiceState::Ready;
                s.endpoint = Some(endpoint.to_string());
                s.error_code = None;
            });
            // Fresh lease of life: the bounded-restart budget is per-run.
            if let Ok(mut guard) = m.lock() {
                if let Some(svc) = guard.svcs.get_mut(key) {
                    svc.restarts = 0;
                }
            }
            log::info!("[PROCESS] {key} READY at {endpoint}");
            // READY — keep watching for unexpected exit (crash detection).
            loop {
                match child.try_wait() {
                    Ok(Some(exit)) => {
                        log::error!("[PROCESS] {key} crashed after READY ({exit:?})");
                        let should = {
                            let mut guard = m.lock().unwrap_or_else(|p| p.into_inner());
                            let svc = guard.svcs.entry(key).or_default();
                            svc.restarts += 1;
                            svc.restarts <= MAX_RESTARTS
                        };
                        if should {
                            let backoff =
                                Duration::from_secs(1 << (restarts_of(m, key).saturating_sub(1)));
                            std::thread::sleep(backoff);
                            restart(m.clone());
                        } else {
                            set_status(m, key, |s| *s = fail("RESTARTS_EXHAUSTED"));
                        }
                        return;
                    }
                    Ok(None) => {
                        std::thread::sleep(Duration::from_secs(2));
                    }
                    Err(_) => return,
                }
            }
        }
        if Instant::now() > deadline {
            log::error!(
                "[PROCESS] {key} FAILED: not healthy after {}s",
                timeout.as_secs()
            );
            set_status(m, key, |s| {
                s.state = ServiceState::Failed;
                s.error_code = Some("START_TIMEOUT".into());
            });
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status();
            return;
        }
        std::thread::sleep(Duration::from_millis(750));
    }
}

fn restarts_of(m: &SharedRuntimeManager, key: &str) -> u32 {
    m.lock()
        .unwrap_or_else(|p| p.into_inner())
        .svcs
        .get(key)
        .map(|s| s.restarts)
        .unwrap_or(0)
}

/// Perplexica managed spawn — Next standalone via system node.
fn start_perplexica(
    m: SharedRuntimeManager,
    external_url: Option<String>,
    searxng_url: Option<String>,
) {
    std::thread::spawn(move || {
        if let Some(url) = external_url {
            if probe_http_ok(&format!("{url}/")) {
                set_status(&m, "perplexica", |s| {
                    *s = ServiceStatus {
                        state: ServiceState::Ready,
                        endpoint: Some(url),
                        source: "external".into(),
                        error_code: None,
                        pid: None,
                        progress: None,
                    }
                });
                log::info!("[PROCESS] perplexica READY via external adopt");
                return;
            }
        }
        let Some(root) = runtimes_root() else {
            set_status(&m, "perplexica", |s| *s = fail("RUNTIME_NOT_BUNDLED"));
            return;
        };
        let standalone = root.join("perplexica");
        if !standalone.join("server.js").exists() {
            set_status(&m, "perplexica", |s| *s = fail("RUNTIME_NOT_BUNDLED"));
            return;
        }
        // Tauri ships no Node: use the system node. Missing → honest FAILED.
        let Some(node_exe) = find_node() else {
            set_status(&m, "perplexica", |s| *s = fail("NODE_RUNTIME_REQUIRED"));
            log::error!(
                "[PROCESS] perplexica FAILED: no Node runtime on PATH (Tauri does not bundle Node)"
            );
            return;
        };

        let port = find_free_port(PREFERRED_PERPLEXICA);
        let data_dir = app_data_dir().join("runtime").join("perplexica");
        seed_perplexica_data(&standalone, &data_dir, searxng_url.as_deref());

        set_status(&m, "perplexica", |s| {
            s.state = ServiceState::Starting;
            s.source = "managed".into();
        });
        let server_js = standalone.join("server.js").to_string_lossy().to_string();
        match spawn_service(
            &node_exe,
            &[server_js.as_str()],
            &standalone,
            &[
                ("PORT", port.to_string()),
                ("HOSTNAME", "127.0.0.1".into()),
                ("DATA_DIR", data_dir.to_string_lossy().to_string()),
                ("NODE_ENV", "production".into()),
            ],
            "perplexica.log",
        ) {
            Ok(child) => {
                let pid = child.id();
                set_status(&m, "perplexica", |s| s.pid = Some(pid));
                log::info!("[PROCESS] perplexica spawned pid={pid} port={port}");
                watch_until_ready(
                    &m,
                    "perplexica",
                    child,
                    pid,
                    &format!("http://127.0.0.1:{port}"),
                    PERPLEXICA_START_TIMEOUT,
                    probe_http_ok,
                    restart_perplexica,
                );
            }
            Err(err) => set_status(&m, "perplexica", |s| {
                *s = fail(&format!("SPAWN_FAILED: {err}"));
            }),
        }
    });
}

fn restart_perplexica(m: SharedRuntimeManager) {
    start_perplexica(m, None, None);
}

fn find_node() -> Option<PathBuf> {
    // BUNDLED runtime first (Phase I — no system prerequisites): the
    // installer ships node.exe under resources/runtimes/node/.
    if let Some(root) = runtimes_root() {
        let bundled = root.join("node").join("node.exe");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    for candidate in ["node.exe", "node"] {
        if let Ok(out) = Command::new("where").arg(candidate).output() {
            if out.status.success() {
                let first = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !first.is_empty() {
                    return Some(PathBuf::from(first));
                }
            }
        }
    }
    None
}

fn probe_http_ok(url: &str) -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(4))
        .build();
    match agent.get(url).set("X-Forwarded-For", "127.0.0.1").call() {
        Ok(resp) => resp.status() < 500,
        // ureq 2 turns HTTP errors into Err(Status(code, _)); any 4xx still
        // proves the server answers (Perplexica / may redirect or 404).
        Err(ureq::Error::Status(code, _)) => code < 500,
        Err(_) => false,
    }
}

/// DATA_DIR seeding — port of PerplexicaService.seedDataDir: drizzle copy,
/// minimal config bootstrap, searxngURL patch, gemini/nvidia provider
/// injection from env (keys never leave the isolated userData config).
fn seed_perplexica_data(standalone: &Path, data_dir: &Path, searxng_url: Option<&str>) {
    let _ = std::fs::create_dir_all(data_dir);
    let drizzle_dst = data_dir.join("drizzle");
    if !drizzle_dst.exists() {
        let _ = copy_dir(&standalone.join("drizzle"), &drizzle_dst);
    }
    let target_config = data_dir.join("data").join("config.json");
    let _ = std::fs::create_dir_all(data_dir.join("data"));
    if !target_config.exists() {
        let minimal = serde_json::json!({
            "version": 1,
            "setupComplete": true,
            "preferences": {},
            "personalization": {},
            "modelProviders": [],
            "search": { "searxngURL": searxng_url.unwrap_or("") },
        });
        let _ = std::fs::write(
            &target_config,
            serde_json::to_string_pretty(&minimal).unwrap_or_default(),
        );
    }
    let Ok(raw) = std::fs::read_to_string(&target_config) else {
        return;
    };
    let Ok(mut cfg) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    if let Some(url) = searxng_url {
        cfg["search"]["searxngURL"] = serde_json::json!(url);
    }
    // Provider injection helpers need a real array; bootstrap one if the
    // config predates this code or was seeded without it.
    if !cfg["modelProviders"].is_array() {
        cfg["modelProviders"] = serde_json::json!([]);
    }
    // Gemini provider (Web Search / Research LLM) — same shape/hash as TS.
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        let key = key.trim().to_string();
        if !key.is_empty() {
            let chat = std::env::var("GEMINI_MODEL")
                .ok()
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| "models/gemini-2.5-flash".into());
            let entry = serde_json::json!({
                "id": "gemini",
                "name": "Gemini",
                "type": "gemini",
                "chatModels": [
                    { "name": "Gemini Flash (preferred)", "key": chat },
                    { "name": "Gemini Flash Lite (cheapest)", "key": "models/gemini-2.5-flash-lite" },
                ],
                "embeddingModels": [{ "name": "Gemini Embedding", "key": "models/gemini-embedding-001" }],
                "config": { "apiKey": key },
                "hash": perplexica_hash(&serde_json::json!({ "apiKey": key })),
            });
            if let Some(arr) = cfg["modelProviders"].as_array_mut() {
                arr.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some("gemini"));
                arr.insert(0, entry);
            }
        }
    }
    // NVIDIA NIM provider (OpenAI-compatible) — alternative Web Search LLM.
    // Parity with Electron's ensureOpenAiCompatProvider: the Perplexica
    // registry maps id `openai` → its OpenAI provider class, which sends
    // config.baseURL + config.apiKey verbatim. Runs AFTER the gemini insert
    // so nvidia lands first in the list (same order as Electron).
    if let Ok(key) = std::env::var("NVIDIA_API_KEY") {
        let key = key.trim().to_string();
        if !key.is_empty() {
            let base = std::env::var("NVIDIA_BASE_URL")
                .ok()
                .map(|b| b.trim().to_string())
                .filter(|b| !b.is_empty())
                .unwrap_or_else(|| "https://integrate.api.nvidia.com/v1".into());
            let model = std::env::var("NVIDIA_MODEL")
                .ok()
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| "openai/gpt-oss-20b".into());
            let config = serde_json::json!({ "apiKey": key, "baseURL": base });
            let entry = serde_json::json!({
                "id": "openai",
                "name": "NVIDIA NIM",
                "type": "openai",
                "chatModels": [{ "name": "GPT-OSS 20B (NVIDIA NIM)", "key": model }],
                "embeddingModels": [],
                "config": config,
                "hash": perplexica_hash(&config),
            });
            if let Some(arr) = cfg["modelProviders"].as_array_mut() {
                arr.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some("openai"));
                arr.insert(0, entry);
            }
        }
    }
    let _ = std::fs::write(
        &target_config,
        serde_json::to_string_pretty(&cfg).unwrap_or_default(),
    );
}

/// Mirrors Perplexica's hashObj: sha256 over JSON with sorted top-level keys.
fn perplexica_hash(value: &serde_json::Value) -> String {
    use sha2::{Digest, Sha256};
    let sorted = if let serde_json::Value::Object(map) = value {
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        let mut ordered = serde_json::Map::new();
        for k in keys {
            ordered.insert(k.clone(), map[k].clone());
        }
        serde_json::Value::Object(ordered)
    } else {
        value.clone()
    };
    let digest = Sha256::digest(sorted.to_string().as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            let _ = std::fs::copy(entry.path(), dst.join(entry.file_name()));
        }
    }
    Ok(())
}

/// Tor managed spawn — bundled tor.exe on dynamic SOCKS/control ports.
fn start_tor(m: SharedRuntimeManager) {
    std::thread::spawn(move || {
        if std::env::var("PAB_TOR_MODE").ok().as_deref() == Some("external") {
            let port = std::env::var("PAB_TOR_SOCKS_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9050);
            if socks_probe("127.0.0.1", port) {
                set_status(&m, "tor", |s| {
                    *s = ServiceStatus {
                        state: ServiceState::Ready,
                        endpoint: Some(format!("socks5://127.0.0.1:{port}")),
                        source: "external".into(),
                        error_code: None,
                        pid: None,
                        progress: None,
                    }
                });
            } else {
                set_status(&m, "tor", |s| *s = fail("TOR_UNAVAILABLE"));
            }
            return;
        }
        let Some((tor_exe, provenance)) = find_tor_binary() else {
            set_status(&m, "tor", |s| *s = fail("RUNTIME_NOT_BUNDLED"));
            return;
        };
        log::info!("[PROCESS] tor binary resolved: {provenance} ({})", tor_exe.display());
        let tor_cwd = tor_exe.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let socks_port = find_free_port(PREFERRED_TOR_SOCKS);
        let control_port = find_free_port(PREFERRED_TOR_CONTROL);
        let data_dir = app_data_dir().join("runtime").join("tor").join("data");
        let _ = std::fs::create_dir_all(&data_dir);

        set_status(&m, "tor", |s| {
            s.state = ServiceState::Bootstrapping;
            s.source = "managed".into();
        });
        let socks_arg = format!("127.0.0.1:{socks_port}");
        let ctrl_arg = format!("127.0.0.1:{control_port}");
        let data_arg = data_dir.to_string_lossy().to_string();
        match spawn_service(
            &tor_exe,
            &[
                "--SocksPort",
                &socks_arg,
                "--ControlPort",
                &ctrl_arg,
                "--CookieAuthentication",
                "1",
                "--DataDirectory",
                &data_arg,
                "--SocksPolicy",
                "accept 127.0.0.1",
                "--SocksPolicy",
                "reject *",
            ],
            &tor_cwd,
            &[],
            "tor.log",
        ) {
            Ok(child) => {
                let pid = child.id();
                set_status(&m, "tor", |s| s.pid = Some(pid));
                log::info!(
                    "[PROCESS] tor spawned pid={pid} socks={socks_port} control={control_port}"
                );
                // Bootstrap percent via the control port (best-effort; the
                // SOCKS probe below remains the READY source of truth).
                follow_tor_bootstrap(m.clone(), control_port, data_dir.clone());
                // Tor READY = end-to-end SOCKS5 CONNECT through the proxy
                // (remote DNS) — the port accepting alone is NOT enough.
                let endpoint = format!("socks5://127.0.0.1:{socks_port}");
                let started = Instant::now();
                let deadline = started + TOR_START_TIMEOUT;
                let (mut child, pid) = (child, pid);
                loop {
                    if let Ok(Some(exit)) = child.try_wait() {
                        log::error!("[PROCESS] tor exited during bootstrap ({exit:?})");
                        set_status(&m, "tor", |s| *s = fail("TOR_EXITED_DURING_BOOTSTRAP"));
                        return;
                    }
                    if socks_probe("127.0.0.1", socks_port) {
                        set_status(&m, "tor", |s| {
                            s.state = ServiceState::Ready;
                            s.endpoint = Some(endpoint.clone());
                            s.error_code = None;
                            s.progress = Some(100);
                        });
                        log::info!("[PROCESS] tor READY (SOCKS end-to-end probe ok)");
                        loop {
                            match child.try_wait() {
                                Ok(Some(_)) => {
                                    log::error!("[PROCESS] tor exited after READY");
                                    set_status(&m, "tor", |s| {
                                        s.state = ServiceState::Failed;
                                        s.error_code = Some("TOR_EXITED".into());
                                    });
                                    return;
                                }
                                Ok(None) => std::thread::sleep(Duration::from_secs(3)),
                                Err(_) => return,
                            }
                        }
                    }
                    if Instant::now() > deadline {
                        log::error!("[PROCESS] tor FAILED: bootstrap timeout");
                        set_status(&m, "tor", |s| {
                            s.state = ServiceState::Failed;
                            s.error_code = Some("START_TIMEOUT".into());
                        });
                        let _ = Command::new("taskkill")
                            .args(["/PID", &pid.to_string(), "/T", "/F"])
                            .status();
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(1500));
                }
            }
            Err(err) => set_status(&m, "tor", |s| *s = fail(&format!("SPAWN_FAILED: {err}"))),
        }
    });
}

/// Port of findTorBinary: PAB_TOR_PATH → Tor Browser installs → system
/// dirs → bundled runtime. Returns (path, provenance) for honest logging.
fn find_tor_binary() -> Option<(PathBuf, &'static str)> {
    if let Ok(p) = std::env::var("PAB_TOR_PATH") {
        let p = PathBuf::from(p.trim());
        if !p.as_os_str().is_empty() && p.is_file() {
            return Some((p, "PAB_TOR_PATH"));
        }
    }
    if cfg!(target_os = "windows") {
        for base in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(dir) = std::env::var_os(base) {
                let cand = Path::new(&dir).join("Tor Browser").join("Browser").join("tor.exe");
                if cand.is_file() {
                    return Some((cand, "tor-browser"));
                }
            }
        }
    } else {
        for cand in ["/usr/bin/tor", "/usr/local/bin/tor", "/opt/homebrew/bin/tor", "/usr/sbin/tor"] {
            let p = Path::new(cand);
            if p.is_file() {
                return Some((p.to_path_buf(), "system"));
            }
        }
    }
    if let Some(root) = runtimes_root() {
        for name in ["tor.exe", "tor"] {
            let cand = root.join("tor").join(name);
            if cand.is_file() {
                return Some((cand, "bundled"));
            }
        }
    }
    None
}

/// Read one CRLF-terminated control-protocol line. ASCII protocol — byte
/// accumulation is exact; the 8 KB bound guards a garbage stream.
fn read_control_line(stream: &mut TcpStream, buf: &mut String) -> Option<String> {
    let mut byte = [0u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) => return None,
            Ok(_) => {
                buf.push(byte[0] as char);
                if buf.ends_with("\r\n") {
                    let line = buf.trim_end_matches("\r\n").to_string();
                    buf.clear();
                    return Some(line);
                }
                if buf.len() > 8192 {
                    return None;
                }
            }
            Err(_) => return None,
        }
    }
}

/// Control-port bootstrap follower (Electron followBootstrap parity):
/// cookie AUTHENTICATE + SETEVENTS STATUS_CLIENT, surface PROGRESS=n.
/// Strictly best-effort — every failure simply stops updating the percent
/// (the SOCKS end-to-end probe remains the source of truth for READY).
fn follow_tor_bootstrap(m: SharedRuntimeManager, control_port: u16, data_dir: PathBuf) {
    std::thread::spawn(move || {
        let Ok(addr) = format!("127.0.0.1:{control_port}").parse::<std::net::SocketAddr>() else {
            return;
        };
        // The control port appears a moment after spawn — retry briefly.
        let mut stream = None;
        for _ in 0..10 {
            if let Ok(s) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) {
                stream = Some(s);
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let Some(mut stream) = stream else { return };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        let mut buf = String::new();
        // Greeting must be a 250 line.
        if !matches!(read_control_line(&mut stream, &mut buf), Some(l) if l.starts_with("250")) {
            return;
        }
        // Cookie auth (hex); a control port without a cookie still accepts a
        // bare AUTHENTICATE — parity with the Electron fallback.
        let auth = match std::fs::read(data_dir.join("control_cookie")) {
            Ok(cookie) => format!(
                "AUTHENTICATE {}\r\n",
                cookie.iter().map(|b| format!("{b:02x}")).collect::<String>()
            ),
            Err(_) => "AUTHENTICATE\r\n".to_string(),
        };
        if stream.write_all(auth.as_bytes()).is_err() {
            return;
        }
        if !matches!(read_control_line(&mut stream, &mut buf), Some(l) if l.starts_with("250")) {
            return;
        }
        if stream.write_all(b"SETEVENTS STATUS_CLIENT\r\n").is_err() {
            return;
        }
        if !matches!(read_control_line(&mut stream, &mut buf), Some(l) if l.starts_with("250")) {
            return;
        }
        // Event lines look like: 650 STATUS_CLIENT NOTICE BOOTSTRAP PROGRESS=45 ...
        let deadline = Instant::now() + Duration::from_secs(120);
        while Instant::now() < deadline {
            match read_control_line(&mut stream, &mut buf) {
                Some(line) => {
                    let Some(idx) = line.find("PROGRESS=") else { continue };
                    let tail = &line[idx + "PROGRESS=".len()..];
                    let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if let Ok(pct) = digits.parse::<u32>() {
                        set_status(&m, "tor", |s| s.progress = Some(pct.min(100)));
                        if pct >= 100 {
                            return;
                        }
                    }
                }
                None => return,
            }
        }
    });
}

/// On-demand Tor start (Electron `tor.spawnIfAvailable` parity). Rate-
/// limited so a UI polling loop cannot fork tor bombs; start_tor itself is
/// idempotent (is_active guard) and runs on its own thread.
pub fn request_tor_start(m: &SharedRuntimeManager) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST_TRY: AtomicU64 = AtomicU64::new(0);
    if is_active(m, "tor") {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_TRY.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 15_000 {
        return;
    }
    LAST_TRY.store(now, Ordering::Relaxed);
    log::info!("[PROCESS] tor offline — on-demand start requested (spawnIfAvailable)");
    start_tor(m.clone());
}

/// Minimal SOCKS5 client: greeting (no-auth) + CONNECT with a DOMAIN-name
/// target (forces remote DNS through Tor — spec §39/§46 semantics).
fn socks_probe(host: &str, port: u16) -> bool {
    let Ok(addr) = format!("{host}:{port}").parse::<std::net::SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_secs(3)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(8)));
    // Greeting: VER=5, 1 method, NO AUTH.
    if stream.write_all(&[0x05, 0x01, 0x00]).is_err() {
        return false;
    }
    let mut buf = [0u8; 2];
    if stream.read_exact(&mut buf).is_err() || buf[0] != 0x05 {
        return false;
    }
    // CONNECT www.google.com:80 (domain address → remote DNS).
    let target = b"www.google.com";
    let mut req = vec![0x05, 0x01, 0x00, 0x03, target.len() as u8];
    req.extend_from_slice(target);
    req.extend_from_slice(&80u16.to_be_bytes());
    if stream.write_all(&req).is_err() {
        return false;
    }
    let mut head = [0u8; 4];
    if stream.read_exact(&mut head).is_err() {
        return false;
    }
    head[1] == 0x00 // REP 0 = succeeded
}

// ---------------------------------------------------------------------------
// Orchestration (mirrors HayDevRuntimeManager.start order)
// ---------------------------------------------------------------------------

fn is_active(m: &SharedRuntimeManager, key: &str) -> bool {
    m.lock()
        .unwrap_or_else(|p| p.into_inner())
        .svcs
        .get(key)
        .and_then(|s| s.status.as_ref())
        .is_some_and(|st| {
            matches!(
                st.state,
                ServiceState::Starting | ServiceState::Bootstrapping | ServiceState::Ready
            )
        })
}

pub fn start_all(m: &SharedRuntimeManager) {
    {
        let mut guard = m.lock().unwrap_or_else(|p| p.into_inner());
        guard.started_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        );
    }
    let external_searxng = std::env::var("PAB_SEARXNG_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let external_perplexica = std::env::var("PAB_PERPLEXICA_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    // Idempotent re-kick: engines already up/coming up are left alone.
    // Tor in parallel (independent).
    if is_active(m, "tor") {
        log::info!("[PROCESS] tor already active — skip");
    } else {
        start_tor(m.clone());
    }

    // SearXNG first (Perplexica's config wants its URL).
    if is_active(m, "searxng") {
        log::info!("[PROCESS] searxng already active — skip");
    } else {
        start_searxng(m.clone(), external_searxng);
    }

    // Bounded wait for the searxng endpoint (≤50s like the TS manager).
    let mut searxng_url: Option<String> = None;
    let deadline = Instant::now() + Duration::from_secs(50);
    while Instant::now() < deadline {
        {
            let guard = m.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(st) = guard.svcs.get("searxng").and_then(|s| s.status.as_ref()) {
                if st.state == ServiceState::Failed {
                    break; // don't block Perplexica on a failed engine
                }
                if st.state == ServiceState::Ready {
                    searxng_url = st.endpoint.clone();
                    break;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    if is_active(m, "perplexica") {
        log::info!("[PROCESS] perplexica already active — skip");
    } else {
        start_perplexica(m.clone(), external_perplexica, searxng_url);
    }
}

/// Stop every MANAGED child (tree-kill); adopted external endpoints are
/// never touched. Called on app exit.
pub fn stop_all(m: &SharedRuntimeManager) {
    let pids: Vec<(String, u32)> = {
        let guard = m.lock().unwrap_or_else(|p| p.into_inner());
        guard.pids()
    };
    for (key, pid) in pids {
        log::info!("[PROCESS] stopping {key} (tree-kill pid={pid})");
        kill_tree(pid);
    }
    sweep_orphans();
}

/// Kill stray engine processes from PREVIOUS runs (e.g. the app was killed
/// hard during dev hot-reload so ExitRequested never fired). Matches ONLY
/// processes whose command line points into THIS APP's bundled runtimes tree
/// (marker = the repository/product directory segment before
/// `resources\runtimes`) — foreign projects with the same folder layout,
/// system tor, docker and other Next servers are NEVER touched.
pub fn sweep_orphans() {
    #[cfg(windows)]
    {
        // SAFETY MARKER: match the full '*<product>*resources\runtimes*'
        // shape. Verified live: a bare '*resources\runtimes*' marker killed
        // an unrelated project's engine tree that shares the layout.
        const MARKER: &str = "BrowserHayDev";
        let filter = format!(
            "Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{MARKER}*resources\\runtimes*' -and ($_.Name -eq 'tor.exe' -or $_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe') }} | ForEach-Object {{ \"$($_.ProcessId) $($_.Name)\" }}"
        );
        let Ok(out) = Command::new("powershell")
            .args(["-NoProfile", "-Command", &filter])
            .output()
        else {
            return;
        };
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
            let Some((pid, name)) = line.split_once(' ') else {
                continue;
            };
            let Ok(pid) = pid.parse::<u32>() else {
                continue;
            };
            log::info!("[PROCESS] sweeping orphan {name} pid={pid}");
            kill_tree(pid);
        }
    }
}

impl RuntimeManagerState {
    fn pids(&self) -> Vec<(String, u32)> {
        self.svcs
            .iter()
            .filter(|(_, s)| s.child_pid.is_some())
            .map(|(k, s)| ((*k).to_string(), s.child_pid.unwrap()))
            .collect()
    }
}
