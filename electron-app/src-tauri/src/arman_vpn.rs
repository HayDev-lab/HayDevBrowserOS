//! Browser-only attachment to Arman VPN's local core API. The provider
//! handles Mozilla sign-in and account storage in its own local dashboard.

use crate::error::{AppError, AppResult};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Ipv6Addr, Shutdown, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Webview, WebviewUrl, WebviewWindowBuilder, Wry};

pub const PROFILE: &str = "arman-vpn";
const DASHBOARD_LABEL: &str = "haydev-vpn-provider";
const LOCAL_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_STREAMS: usize = 48;

fn error(code: &str) -> AppError {
    AppError::new(code, "HayDevVPN could not complete the operation")
}

#[derive(Deserialize)]
struct Config {
    dashboard: Dashboard,
    proxy: Option<ProxyConfig>,
}

#[derive(Clone, Deserialize)]
struct ProxyConfig {
    listen: String,
    #[serde(default)]
    username: String,
}

#[derive(Deserialize)]
struct Dashboard {
    listen: String,
}

#[derive(Deserialize)]
struct Status {
    data_dir: PathBuf,
    system_proxy: String,
    state: EngineState,
    proxy: Option<Proxy>,
    accounts: Option<AccountCounts>,
    #[serde(default)]
    selection: String,
    #[serde(default)]
    exit: Option<ExitCountry>,
    #[serde(default)]
    exit_mismatch: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct ExitCountry {
    country_code: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct VpnLocation {
    code: String,
    name: String,
}

#[derive(Deserialize)]
struct Locations {
    #[serde(default)]
    locations: Vec<VpnLocation>,
}

#[derive(Deserialize)]
struct AccountCounts {
    total: usize,
    #[serde(default)]
    disabled: usize,
}

#[derive(Deserialize)]
struct EngineState {
    phase: String,
}

#[derive(Deserialize)]
struct Proxy {
    listen: String,
    login_required: bool,
}

#[derive(Deserialize)]
struct Routing {
    enabled: bool,
    active: bool,
}

#[derive(Deserialize)]
struct TunnelTest {
    ok: bool,
}

#[derive(Deserialize)]
struct DashboardLink {
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    data_dir: PathBuf,
}

fn settings_store() -> AppResult<crate::atomic_store::Transaction> {
    crate::atomic_store::transaction(&crate::lib_app_data_dir().join("haydev-vpn.json"))
}

#[derive(Clone)]
struct Companion {
    dir: PathBuf,
    api: SocketAddrV4,
    configured_proxy: Option<ProxyConfig>,
}

fn local_folder(path: &Path) -> AppResult<PathBuf> {
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(p))
        if matches!(p.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(error("ARMAN_VPN_DATA_FOLDER"));
    }
    if !path.is_absolute() {
        return Err(error("ARMAN_VPN_DATA_FOLDER"));
    }
    let folder = path
        .canonicalize()
        .map_err(|_| error("ARMAN_VPN_DATA_FOLDER"))?;
    if !folder.is_dir() {
        return Err(error("ARMAN_VPN_DATA_FOLDER"));
    }
    #[cfg(windows)]
    if !matches!(folder.components().next(), Some(std::path::Component::Prefix(p))
        if matches!(p.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(error("ARMAN_VPN_DATA_FOLDER"));
    }
    Ok(folder)
}

fn bounded_file(dir: &Path, name: &str, limit: u64) -> AppResult<Vec<u8>> {
    let path = dir
        .join(name)
        .canonicalize()
        .map_err(|_| error("ARMAN_VPN_DATA_FOLDER"))?;
    if !path.starts_with(dir) || !path.is_file() {
        return Err(error("ARMAN_VPN_DATA_FOLDER"));
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(error("ARMAN_VPN_DATA_FOLDER"));
    }
    Ok(bytes)
}

fn loopback(value: &str) -> AppResult<SocketAddrV4> {
    value
        .parse::<SocketAddrV4>()
        .ok()
        .filter(|addr| *addr.ip() == Ipv4Addr::LOCALHOST && addr.port() != 0)
        .ok_or_else(|| error("ARMAN_VPN_LOOPBACK_REQUIRED"))
}

impl Companion {
    fn load(path: &Path) -> AppResult<Self> {
        let dir = local_folder(path)?;
        let config: Config =
            serde_json::from_slice(&bounded_file(&dir, "config.json", 512 * 1024)?)
                .map_err(|_| error("ARMAN_VPN_DATA_FOLDER"))?;
        Ok(Self {
            dir,
            api: loopback(&config.dashboard.listen)?,
            configured_proxy: config.proxy,
        })
    }

    fn configured() -> AppResult<Self> {
        let settings: Settings = settings_store()?
            .read_json()?
            .ok_or_else(|| error("ARMAN_VPN_DATA_FOLDER"))?;
        Self::load(&settings.data_dir)
    }

    fn request<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> AppResult<T> {
        self.request_method(if body.is_some() { "POST" } else { "GET" }, path, body)
    }

    fn request_method<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> AppResult<T> {
        let test = path == "/api/test";
        let token_bytes = bounded_file(&self.dir, "local-api.token", 128)
            .map_err(|_| error("ARMAN_VPN_CORE_UNAVAILABLE"))?;
        let token = std::str::from_utf8(&token_bytes)
            .map_err(|_| error("ARMAN_VPN_CORE_UNAVAILABLE"))?
            .trim();
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
        }
        let client = ureq::AgentBuilder::new()
            .redirects(0)
            .try_proxy_from_env(false)
            .timeout_connect(LOCAL_TIMEOUT)
            .timeout(if test || path == "/api/locations" {
                Duration::from_secs(35)
            } else {
                LOCAL_TIMEOUT
            })
            .build();
        let url = format!("http://{}{path}", self.api);
        let request = client.request(method, &url).set("X-Local-Token", token);
        let response = if let Some(body) = body {
            request.send_json(body)
        } else {
            request.call()
        }
        .map_err(|_| {
            error(if test {
                "ARMAN_VPN_TUNNEL_CHECK"
            } else {
                "ARMAN_VPN_CORE_UNAVAILABLE"
            })
        })?;
        if response.status() != 200 {
            return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
        }
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(512 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error("ARMAN_VPN_CORE_UNAVAILABLE"))?;
        if bytes.len() > 512 * 1024 {
            return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
        }
        serde_json::from_slice(&bytes).map_err(|_| error("ARMAN_VPN_CORE_UNAVAILABLE"))
    }

    fn status(&self) -> AppResult<Status> {
        let status: Status = self.request("/api/status", None)?;
        if local_folder(&status.data_dir)? != self.dir {
            return Err(error("ARMAN_VPN_DATA_FOLDER"));
        }
        Ok(status)
    }

    fn check_policy(&self, status: &Status) -> AppResult<()> {
        let routing: Routing = self.request("/api/routing", None)?;
        if status.system_proxy != "clear" || routing.enabled || routing.active {
            return Err(error("ARMAN_VPN_ROUTING_POLICY"));
        }
        Ok(())
    }

    fn browser_manages_data(&self) -> bool {
        local_folder(&crate::lib_app_data_dir().join("vpn/provider"))
            .is_ok_and(|managed| managed == self.dir)
    }

    fn proxy(&self) -> AppResult<SocketAddrV4> {
        let status = self.status()?;
        self.check_policy(&status)?;
        if status.exit_mismatch.is_some() {
            return Err(error("ARMAN_VPN_COUNTRY_MISMATCH"));
        }
        status.proxy_addr()
    }

    fn dashboard_url(&self) -> AppResult<url::Url> {
        self.status()?;
        let link: DashboardLink = self.request("/api/session/link", Some(serde_json::json!({})))?;
        let code = link.path.strip_prefix("/app/login/").unwrap_or_default();
        if code.len() != 64 || !code.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
        }
        Ok(url::Url::parse(&format!(
            "http://{}/app/login/{code}#accounts",
            self.api
        ))?)
    }

    fn start_proxy_if_off(&self) -> AppResult<()> {
        let status = self.status()?;
        if status.has_no_enabled_account() {
            return Err(error("ARMAN_VPN_ACCOUNT_REQUIRED"));
        }
        self.check_policy(&status)?;
        // Validate the on-disk bind address before asking the core to listen.
        let proxy = self
            .configured_proxy
            .as_ref()
            .ok_or_else(|| error("ARMAN_VPN_PROXY_CONFIG"))?;
        loopback(&proxy.listen)?;
        if !proxy.username.is_empty() {
            return Err(error("ARMAN_VPN_PROXY_AUTH"));
        }
        if status.state.phase == "off" {
            if !self.browser_manages_data() {
                return Err(error("ARMAN_VPN_PROXY_OFF"));
            }
            self.request::<serde_json::Value>("/api/power", Some(serde_json::json!({"on": true})))?;
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let current = self.status()?;
            self.check_policy(&current)?;
            if current.state.phase == "running" {
                current.proxy_addr()?;
                return Ok(());
            }
            if current.state.phase == "error" || Instant::now() >= deadline {
                return Err(error("ARMAN_VPN_PROXY_OFF"));
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }
}

impl Status {
    fn has_no_enabled_account(&self) -> bool {
        self.accounts
            .as_ref()
            .is_some_and(|counts| counts.total <= counts.disabled)
    }

    fn proxy_addr(&self) -> AppResult<SocketAddrV4> {
        let proxy = self
            .proxy
            .as_ref()
            .filter(|_| self.state.phase == "running")
            .ok_or_else(|| error("ARMAN_VPN_PROXY_OFF"))?;
        if proxy.login_required {
            return Err(error("ARMAN_VPN_PROXY_AUTH"));
        }
        loopback(&proxy.listen)
    }
}

// The private browser listener owns its port while the lease exists. The
// endpoint is fixed, and each new TCP stream rechecks the companion policy.
// No destination is dialled directly and active sockets are closed on drop.
pub(crate) struct Relay {
    pub(crate) port: u16,
    streams: Arc<Mutex<Option<ActiveStreams>>>,
    listener_thread: Option<std::thread::JoinHandle<()>>,
}

type ActiveStreams = HashMap<SocketAddr, (TcpStream, TcpStream)>;

impl Relay {
    pub(crate) fn start(
        upstream: impl Fn() -> Option<TcpStream> + Send + Sync + 'static,
    ) -> AppResult<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let streams = Arc::new(Mutex::new(Some(HashMap::new())));
        let relay_streams = Arc::clone(&streams);
        let upstream = Arc::new(upstream);
        let listener_thread = std::thread::Builder::new()
            .name("tab-socks-relay".into())
            .spawn(move || {
                let mut workers: Vec<std::thread::JoinHandle<()>> = Vec::new();
                while relay_streams.lock().is_ok_and(|state| state.is_some()) {
                    workers.retain(|worker| !worker.is_finished());
                    match listener.accept() {
                        Ok((client, _)) if workers.len() < MAX_STREAMS => {
                            let upstream = Arc::clone(&upstream);
                            let streams = Arc::clone(&relay_streams);
                            workers.push(std::thread::spawn(move || {
                                let _ = relay_socks(&streams, &*upstream, client);
                            }));
                        }
                        Ok(_) => {}
                        Err(err) if err.kind() == io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(30));
                        }
                        Err(_) => break,
                    }
                }
            })?;
        Ok(Self {
            port,
            streams,
            listener_thread: Some(listener_thread),
        })
    }
}

fn allowed_host(host: &str) -> bool {
    match url::Host::parse(host) {
        Ok(url::Host::Ipv4(ip)) => !crate::netguard::banned(ip.into()),
        Ok(url::Host::Ipv6(ip)) => {
            !crate::netguard::banned(std::net::IpAddr::from(ip).to_canonical())
        }
        Ok(url::Host::Domain(name)) => {
            let lower = name.to_ascii_lowercase();
            let name = lower.trim_end_matches('.');
            name.contains('.')
                && name != "home.arpa"
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.'))
                && ![
                    ".localhost",
                    ".local",
                    ".localdomain",
                    ".internal",
                    ".home.arpa",
                    ".onion",
                ]
                .iter()
                .any(|suffix| name.ends_with(suffix))
                && name != "mtalk.google.com"
                && !name.ends_with("-mtalk.google.com")
        }
        Err(_) => false,
    }
}

fn socks_connect_request(client: &mut TcpStream) -> io::Result<Vec<u8>> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, "Unsupported SOCKS5 request");
    let mut greeting = [0; 2];
    client.read_exact(&mut greeting)?;
    if greeting[0] != 5 || greeting[1] == 0 {
        return Err(invalid());
    }
    let mut methods = vec![0; greeting[1] as usize];
    client.read_exact(&mut methods)?;
    if !methods.contains(&0) {
        client.write_all(&[5, 255])?;
        return Err(invalid());
    }
    client.write_all(&[5, 0])?;
    let mut head = [0; 4];
    client.read_exact(&mut head)?;
    if head[..3] != [5, 1, 0] {
        return Err(invalid());
    }
    let mut request = head.to_vec();
    let host = match head[3] {
        1 => {
            let mut ip = [0; 4];
            client.read_exact(&mut ip)?;
            request.extend(ip);
            Ipv4Addr::from(ip).to_string()
        }
        4 => {
            let mut ip = [0; 16];
            client.read_exact(&mut ip)?;
            request.extend(ip);
            format!("[{}]", Ipv6Addr::from(ip))
        }
        3 => {
            let mut size = [0];
            client.read_exact(&mut size)?;
            let mut domain = vec![0; size[0] as usize];
            client.read_exact(&mut domain)?;
            if !domain
                .iter()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.'))
            {
                return Err(invalid());
            }
            request.extend(size);
            request.extend(&domain);
            String::from_utf8(domain).map_err(|_| invalid())?
        }
        _ => return Err(invalid()),
    };
    let mut port = [0; 2];
    client.read_exact(&mut port)?;
    // Arman VPN has built-in direct routes for LAN addresses and Google
    // Push, even with custom routing off. Keep them out of this profile.
    if port == [0, 0] || !allowed_host(&host) {
        client.write_all(&[5, 2, 0, 1, 0, 0, 0, 0, 0, 0])?;
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "VPN destination denied",
        ));
    }
    request.extend(port);
    Ok(request)
}

fn relay_socks(
    streams: &Mutex<Option<ActiveStreams>>,
    upstream: &impl Fn() -> Option<TcpStream>,
    mut client: TcpStream,
) -> io::Result<()> {
    // Winsock may inherit nonblocking mode from the listener. The SOCKS
    // handshake uses blocking reads with a timeout on each accepted socket.
    client.set_nonblocking(false)?;
    client.set_read_timeout(Some(LOCAL_TIMEOUT))?;
    client.set_write_timeout(Some(LOCAL_TIMEOUT))?;
    let request = socks_connect_request(&mut client)?;
    let Some(mut server) = upstream() else {
        client.write_all(&[5, 1, 0, 1, 0, 0, 0, 0, 0, 0])?;
        return Ok(());
    };
    server.set_read_timeout(Some(LOCAL_TIMEOUT))?;
    server.set_write_timeout(Some(LOCAL_TIMEOUT))?;
    server.write_all(&[5, 1, 0])?;
    let mut reply = [0; 2];
    server.read_exact(&mut reply)?;
    if reply != [5, 0] {
        return Err(io::Error::other("Upstream proxy rejected SOCKS5 greeting"));
    }
    server.set_read_timeout(None)?;
    client.set_read_timeout(None)?;
    client.set_write_timeout(None)?;
    relay_stream(streams, client, server, &request)
}

fn relay_stream(
    streams: &Mutex<Option<ActiveStreams>>,
    mut client: TcpStream,
    mut server: TcpStream,
    request: &[u8],
) -> io::Result<()> {
    let client_id = client.peer_addr()?;
    let mut client_reader = client.try_clone()?;
    let mut server_writer = server.try_clone()?;
    {
        let mut active = streams
            .lock()
            .map_err(|_| io::Error::other("VPN relay lock poisoned"))?;
        let Some(active) = active.as_mut() else {
            return Ok(());
        };
        let sockets = (client.try_clone()?, server.try_clone()?);
        server.write_all(request)?;
        server.set_write_timeout(None)?;
        active.insert(client_id, sockets);
    }
    std::thread::scope(|scope| {
        scope.spawn(|| {
            if io::copy(&mut client_reader, &mut server_writer).is_ok() {
                let _ = server_writer.shutdown(Shutdown::Write);
            } else {
                let _ = server_writer.shutdown(Shutdown::Both);
                let _ = client_reader.shutdown(Shutdown::Both);
            }
        });
        if io::copy(&mut server, &mut client).is_ok() {
            let _ = client.shutdown(Shutdown::Write);
        } else {
            let _ = server.shutdown(Shutdown::Both);
            let _ = client.shutdown(Shutdown::Both);
        }
    });
    if let Ok(mut active) = streams.lock() {
        if let Some(active) = active.as_mut() {
            active.remove(&client_id);
        }
    }
    Ok(())
}

impl Drop for Relay {
    fn drop(&mut self) {
        let streams = self
            .streams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(streams) = streams {
            for (client, server) in streams.into_values() {
                let _ = client.shutdown(Shutdown::Both);
                let _ = server.shutdown(Shutdown::Both);
            }
        }
        if let Some(listener) = self.listener_thread.take() {
            let _ = listener.join();
        }
    }
}

struct Lease {
    companion: Companion,
    upstream: SocketAddrV4,
    relay: Relay,
}

static LEASE: Mutex<Option<Lease>> = Mutex::new(None);

fn lease() -> AppResult<MutexGuard<'static, Option<Lease>>> {
    LEASE.try_lock().map_err(|_| error("ARMAN_VPN_BUSY"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserVpnStatus {
    state: &'static str,
    data_dir: Option<PathBuf>,
    issue: Option<String>,
    selection: String,
    locations: Vec<VpnLocation>,
    locations_issue: Option<String>,
    exit_country: Option<String>,
}

static LOCATIONS: Mutex<Option<(PathBuf, Vec<VpnLocation>)>> = Mutex::new(None);

fn cached_locations(dir: &Path) -> Vec<VpnLocation> {
    LOCATIONS
        .lock()
        .ok()
        .and_then(|cache| {
            cache
                .as_ref()
                .filter(|(path, _)| path == dir)
                .map(|(_, items)| items.clone())
        })
        .unwrap_or_default()
}

// Only the child started here is owned by the browser. Existing providers
// are attached to without acquiring ownership of their process.
static MANAGED_CORE: Mutex<Option<Child>> = Mutex::new(None);
const CORE_SHA256: &str = "1927c5ad92f814f0127aa3582ac1e72150c69ce520d95c9aecbe8736c7037b3a";

fn isolated_qa() -> bool {
    std::env::var("HAYDEV_QA_MODE").as_deref() == Ok("1")
        && std::env::var_os("HAYDEV_DATA_DIR").is_some_and(|path| Path::new(&path).is_absolute())
}

fn bundled_core(app: &AppHandle<Wry>) -> AppResult<PathBuf> {
    use sha2::{Digest, Sha256};
    let mut candidates = vec![];
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("resources/vpn/arman-vpn-core.exe"));
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/vpn/arman-vpn-core.exe"),
        );
    }
    for path in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            if format!("{:x}", Sha256::digest(&bytes)) == CORE_SHA256 {
                return Ok(path);
            }
        }
    }
    Err(error("ARMAN_VPN_CORE_MISSING"))
}

fn automatic_companion(app: &AppHandle<Wry>) -> AppResult<Companion> {
    if let Ok(companion) = Companion::configured() {
        return Ok(companion);
    }
    let managed_dir = crate::lib_app_data_dir().join("vpn/provider");
    let mut candidates = vec![managed_dir.clone()];
    if !isolated_qa() {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(parent.join("user-data"));
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/Arman VPN/user-data"));
        }
        if let Some(programs) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(programs).join("Arman VPN/user-data"));
        }
        if cfg!(debug_assertions) {
            candidates.push(
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
                    "../../artifacts/upstream/arman-vpn-v1.0.13/portable/Arman VPN/user-data",
                ),
            );
        }
    }
    for dir in candidates {
        if let Ok(companion) = Companion::load(&dir) {
            settings_store()?.write_json(&Settings {
                data_dir: companion.dir.clone(),
            })?;
            return Ok(companion);
        }
    }
    // Tests never discover or start a provider outside their isolated root.
    if isolated_qa() && std::env::var("HAYDEV_QA_VPN_CORE").as_deref() != Ok("1") {
        return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
    }
    bundled_core(app)?;
    std::fs::create_dir_all(&managed_dir)?;
    let dashboard = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let proxy = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let config = serde_json::json!({
        "dashboard": {"listen": dashboard.local_addr()?.to_string()},
        "proxy": {"listen": proxy.local_addr()?.to_string()},
        "routing": {"enabled": false}, "system_proxy": {"mode": "clear"}
    });
    // Allocation races fail closed when the core binds; never use another
    // process without its private token and matching canonical data folder.
    crate::atomic_store::transaction(&managed_dir.join("config.json"))?.write_json(&config)?;
    let companion = Companion::load(&managed_dir)?;
    settings_store()?.write_json(&Settings {
        data_dir: companion.dir.clone(),
    })?;
    Ok(companion)
}

fn ensure_core(app: &AppHandle<Wry>, companion: &Companion) -> AppResult<()> {
    if companion.status().is_ok() {
        return Ok(());
    }
    if !companion.browser_manages_data() {
        return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
    }
    if isolated_qa() && std::env::var("HAYDEV_QA_VPN_CORE").as_deref() != Ok("1") {
        return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
    }
    let mut child = MANAGED_CORE.lock().map_err(|_| error("ARMAN_VPN_BUSY"))?;
    if let Some(current) = child.as_mut() {
        if current.try_wait()?.is_some() {
            *child = None;
        }
    }
    if child.is_none() {
        // No shell, inherited credentials, visible console or system proxy.
        let mut command = Command::new(bundled_core(app)?);
        command
            .args(["-app", "-data-dir"])
            .arg(&companion.dir)
            .current_dir(&companion.dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env_clear();
        for name in [
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "APPDATA",
            "LOCALAPPDATA",
            "USERPROFILE",
            "PATH",
        ] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        *child = Some(command.spawn()?);
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if companion.status().is_ok() {
            return Ok(());
        }
        if child
            .as_mut()
            .is_some_and(|core| core.try_wait().ok().flatten().is_some())
            || Instant::now() >= deadline
        {
            return Err(error("ARMAN_VPN_CORE_UNAVAILABLE"));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

pub fn shutdown() {
    // An RPC may be waiting for the main thread. Never block that thread
    // on its lease during exit; process teardown closes the remaining pipe.
    if let Ok(mut lease) = LEASE.try_lock() {
        *lease = None;
    }
    if let Ok(mut owned) = MANAGED_CORE.try_lock() {
        if let Some(mut child) = owned.take() {
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub async fn arman_vpn_prepare(
    webview: Webview<Wry>,
    app: AppHandle<Wry>,
) -> AppResult<BrowserVpnStatus> {
    trusted(&webview)?;
    blocking(move || {
        let lease = lease()?;
        if lease.is_some() {
            return read_browser_status(lease.as_ref());
        }
        let companion = automatic_companion(&app)?;
        ensure_core(&app, &companion)?;
        let locations: AppResult<Locations> = companion.request("/api/locations", None);
        let mut result = read_browser_status(None)?;
        match locations {
            Ok(list) => {
                let mut items: Vec<_> = list
                    .locations
                    .into_iter()
                    .filter(|item| {
                        item.code.len() == 2
                            && item.code.bytes().all(|byte| byte.is_ascii_uppercase())
                    })
                    .collect();
                items.sort_by(|a, b| a.name.cmp(&b.name));
                items.dedup_by(|a, b| a.code == b.code);
                *LOCATIONS.lock().map_err(|_| error("ARMAN_VPN_BUSY"))? =
                    Some((companion.dir, items.clone()));
                result.locations = items;
            }
            Err(_) => result.locations_issue = Some("ARMAN_VPN_LOCATIONS_UNAVAILABLE".into()),
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn arman_vpn_set_location(
    webview: Webview<Wry>,
    country: String,
) -> AppResult<BrowserVpnStatus> {
    trusted(&webview)?;
    blocking(move || {
        let lease = lease()?;
        if lease.is_some() {
            return Err(error("ARMAN_VPN_ALREADY_ATTACHED"));
        }
        let companion = Companion::configured()?;
        if companion.status()?.system_proxy != "clear" {
            return Err(error("ARMAN_VPN_ROUTING_POLICY"));
        }
        if !country.is_empty()
            && country != "fastest"
            && !cached_locations(&companion.dir)
                .iter()
                .any(|location| location.code == country)
        {
            return Err(error("ARMAN_VPN_LOCATION"));
        }
        companion.request::<serde_json::Value>(
            "/api/location",
            Some(serde_json::json!({"country": country})),
        )?;
        let result = read_browser_status(None)?;
        if result.selection != country {
            return Err(error("ARMAN_VPN_LOCATION"));
        }
        Ok(result)
    })
    .await
}

fn read_browser_status(lease: Option<&Lease>) -> AppResult<BrowserVpnStatus> {
    let settings: Option<Settings> = settings_store()?.read_json()?;
    let mut result = BrowserVpnStatus {
        state: "off",
        data_dir: settings.map(|settings| settings.data_dir),
        issue: None,
        selection: String::new(),
        locations: vec![],
        locations_issue: None,
        exit_country: None,
    };
    if let Some(lease) = lease {
        result.state = "blocked";
        match lease.companion.proxy() {
            Ok(upstream) if upstream == lease.upstream => result.state = "ready",
            Ok(_) => result.issue = Some("ARMAN_VPN_PROXY_CHANGED".into()),
            Err(error) => result.issue = Some(error.code),
        }
    } else if let Some(dir) = &result.data_dir {
        let check = || {
            let companion = Companion::load(dir)?;
            let status = companion.status()?;
            if status.has_no_enabled_account() {
                return Err(error("ARMAN_VPN_ACCOUNT_REQUIRED"));
            }
            if status.system_proxy != "clear" {
                return Err(error("ARMAN_VPN_ROUTING_POLICY"));
            }
            Ok(())
        };
        result.issue = check().err().map(|error| error.code);
    }
    if let Some(dir) = &result.data_dir {
        result.locations = cached_locations(dir);
        if let Ok(companion) = Companion::load(dir) {
            if let Ok(status) = companion.status() {
                result.selection = status.selection;
                result.exit_country = status.exit.map(|exit| exit.country_code);
                if status.exit_mismatch.is_some() {
                    result.issue = Some("ARMAN_VPN_COUNTRY_MISMATCH".into());
                    if lease.is_some() {
                        result.state = "blocked";
                    }
                }
            }
        }
    }
    Ok(result)
}

pub(crate) fn trusted(webview: &Webview<Wry>) -> AppResult<()> {
    if webview.label() != "main" {
        return Err(error("ARMAN_VPN_CHROME_ONLY"));
    }
    let url = webview.url().map_err(|_| error("ARMAN_VPN_CHROME_ONLY"))?;
    let local_shell = matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("http" | "https", Some("tauri.localhost"), None) | ("tauri", Some("localhost"), None)
    );
    let dev_shell = cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(5180);
    if local_shell || dev_shell {
        Ok(())
    } else {
        Err(error("ARMAN_VPN_CHROME_ONLY"))
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .map_err(|_| error("ARMAN_VPN_WORKER"))?
}

#[tauri::command]
pub async fn arman_vpn_status(webview: Webview<Wry>) -> AppResult<BrowserVpnStatus> {
    trusted(&webview)?;
    blocking(|| {
        let lease = lease()?;
        read_browser_status(lease.as_ref())
    })
    .await
}

#[tauri::command]
pub async fn arman_vpn_pick_folder(
    webview: Webview<Wry>,
    app: AppHandle<Wry>,
) -> AppResult<Option<PathBuf>> {
    trusted(&webview)?;
    blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|path| path.into_path().map_err(|_| error("ARMAN_VPN_DATA_FOLDER")))
            .transpose()
    })
    .await
}

#[tauri::command]
pub async fn arman_vpn_save_settings(
    webview: Webview<Wry>,
    data_dir: PathBuf,
) -> AppResult<BrowserVpnStatus> {
    trusted(&webview)?;
    blocking(move || {
        let lease = lease()?;
        if lease.is_some() {
            return Err(error("ARMAN_VPN_ALREADY_ATTACHED"));
        }
        let companion = Companion::load(&data_dir)?;
        settings_store()?.write_json(&Settings {
            data_dir: companion.dir,
        })?;
        read_browser_status(None)
    })
    .await
}

#[tauri::command]
pub async fn arman_vpn_open_settings(webview: Webview<Wry>, app: AppHandle<Wry>) -> AppResult<()> {
    trusted(&webview)?;
    blocking(move || {
        let lease = lease()?;
        if lease.is_some() {
            return Err(error("ARMAN_VPN_ALREADY_ATTACHED"));
        }
        check_webview_overrides()?;
        let companion = Companion::configured()?;
        ensure_core(&app, &companion)?;
        let origin = url::Url::parse(&format!("http://{}", companion.api))?.origin();
        if let Some(window) = app.get_webview_window(DASHBOARD_LABEL) {
            if window.url()?.origin() == origin {
                window.set_focus()?;
                return Ok(());
            }
            window.destroy()?;
        }
        let url = companion.dashboard_url()?;
        let request_origin = origin.clone();
        let dir = crate::lib_app_data_dir()
            .join("profiles")
            .join(DASHBOARD_LABEL);
        std::fs::create_dir_all(&dir)?;
        // Separate storage, remote origin, no capabilities and no opener.
        let window = WebviewWindowBuilder::new(
            &app,
            DASHBOARD_LABEL,
            WebviewUrl::External(url::Url::parse("about:blank")?),
        )
        .title("HayDevVPN")
        .inner_size(1060.0, 760.0)
        .data_directory(dir)
        .incognito(true)
        .general_autofill_enabled(false)
        .devtools(false)
        .disable_drag_drop_handler()
        .on_download(|_, _| false)
        .on_navigation(move |url| {
            url.as_str() == "about:blank"
                || (url.origin() == origin && url.username().is_empty() && url.password().is_none())
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()?;
        let ready = (|| {
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            window.with_webview(move |native| {
                let _ = sender.send(crate::native_webview::restrict_provider_dashboard(
                    &native,
                    request_origin,
                ));
            })?;
            receiver
                .recv_timeout(LOCAL_TIMEOUT)
                .map_err(|_| error("ARMAN_VPN_WORKER"))??;
            window.navigate(url)?;
            Ok(())
        })();
        if ready.is_err() {
            let _ = window.destroy();
        }
        ready
    })
    .await
}

pub(crate) fn check_webview_overrides() -> AppResult<()> {
    // WebView2 appends process-wide flags to per-profile settings.
    if [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_USER_DATA_FOLDER",
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER",
    ].iter().any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty())) {
        return Err(error("ARMAN_VPN_WEBVIEW_OVERRIDE"));
    }
    Ok(())
}

#[tauri::command]
pub async fn arman_vpn_connect(
    webview: Webview<Wry>,
    app: AppHandle<Wry>,
    data_dir: Option<PathBuf>,
) -> AppResult<BrowserVpnStatus> {
    trusted(&webview)?;
    blocking(move || {
        check_webview_overrides()?;
        let mut lease = lease()?;
        if lease.is_some() {
            return Err(error("ARMAN_VPN_ALREADY_ATTACHED"));
        }
        let companion = match data_dir {
            Some(dir) => Companion::load(&dir)?,
            None => Companion::configured()?,
        };
        ensure_core(&app, &companion)?;
        companion.start_proxy_if_off()?;
        let upstream = companion.proxy()?;
        if !companion
            .request::<TunnelTest>("/api/test", Some(serde_json::json!({})))?
            .ok
        {
            return Err(error("ARMAN_VPN_TUNNEL_CHECK"));
        }
        if let Some(window) = app.get_webview_window(DASHBOARD_LABEL) {
            window.destroy()?;
        }
        if companion.proxy()? != upstream {
            return Err(error("ARMAN_VPN_TUNNEL_CHECK"));
        }
        let relay_companion = companion.clone();
        let relay = Relay::start(move || {
            let address = relay_companion.proxy().ok().filter(|address| *address == upstream)?;
            TcpStream::connect_timeout(&address.into(), LOCAL_TIMEOUT).ok()
        })?;
        *lease = Some(Lease {
            companion,
            upstream,
            relay,
        });
        read_browser_status(lease.as_ref())
    })
    .await
}

pub(crate) fn on_main<T: Send + 'static>(
    app: &AppHandle<Wry>,
    run: impl FnOnce(&AppHandle<Wry>) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(run(&handle));
    })?;
    receiver.recv().map_err(|_| error("ARMAN_VPN_WORKER"))?
}

pub fn navigation_allowed(url: &url::Url) -> bool {
    url.as_str() == "about:blank"
        || (matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && !matches!(url.host_str(), Some("tauri.localhost" | "pab.localhost")))
}

#[tauri::command]
pub async fn arman_vpn_open_tab(
    webview: Webview<Wry>,
    app: AppHandle<Wry>,
    url: String,
) -> AppResult<String> {
    trusted(&webview)?;
    let target = url::Url::parse(url.trim()).map_err(|_| error("ARMAN_VPN_URL"))?;
    if !navigation_allowed(&target) || target.scheme() == "about" {
        return Err(error("ARMAN_VPN_URL"));
    }
    blocking(move || {
        let lease = lease()?;
        let lease = lease.as_ref().ok_or_else(|| error("ARMAN_VPN_PROXY_OFF"))?;
        if lease.companion.proxy()? != lease.upstream {
            return Err(error("ARMAN_VPN_PROXY_OFF"));
        }
        let port = lease.relay.port;
        on_main(&app, move |app| {
            crate::core::open_proxy_tab(app, target.as_str(), crate::profiles::ProfileKind::ArmanVpn, port)
        })
    })
    .await
}

#[tauri::command]
pub async fn arman_vpn_disconnect(
    webview: Webview<Wry>,
    app: AppHandle<Wry>,
) -> AppResult<BrowserVpnStatus> {
    trusted(&webview)?;
    blocking(move || {
        let mut lease = lease()?;
        on_main(&app, |app| {
            for tab in crate::core::list_tabs(app)?
                .into_iter()
                .filter(|tab| tab.profile == PROFILE)
            {
                crate::core::close_tab(app, &tab.id)?;
            }
            Ok(())
        })?;
        *lease = None;
        read_browser_status(None)
    })
    .await
}
