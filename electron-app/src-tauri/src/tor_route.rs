//! Stable loopback SOCKS endpoint for onion tabs and their search provider.
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Wry};

use crate::error::{AppError, AppResult};
use crate::runtime_manager::with_manager;

const LOCAL_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_STREAMS: usize = 64;
static RELAY: OnceLock<Mutex<Option<Relay>>> = OnceLock::new();

pub(crate) fn managed_endpoint(app: &AppHandle<Wry>) -> AppResult<(String, u16)> {
    let mut relay = RELAY.get_or_init(Default::default).lock()
        .map_err(|_| AppError::new("TOR_RELAY", "Tor relay is unavailable"))?;
    if relay.is_none() {
        let handle = app.clone();
        *relay = Some(Relay::start(move || {
            let (address, pid) = with_manager(&handle, |manager| manager.managed_tor_proxy()).flatten()?;
            let stream = TcpStream::connect_timeout(&address.into(), LOCAL_TIMEOUT).ok()?;
            crate::windows_routes::tcp_peer_is_owned(&stream, pid).then_some(stream)
        })?);
    }
    Ok(("127.0.0.1".into(), relay.as_ref().expect("Tor relay initialized").port))
}

pub(crate) fn validate_webview_environment() -> AppResult<()> {
    // WebView2 appends process-wide overrides to per-profile proxy settings.
    if [
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "WEBVIEW2_USER_DATA_FOLDER",
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
        "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER",
    ].iter().any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty())) {
        return Err(AppError::new("TOR_WEBVIEW_OVERRIDE", "WebView2 overrides are incompatible with onion routing"));
    }
    Ok(())
}

// The relay keeps its port while the browser runs. Each new stream validates
// the connected Tor process, so a restarted service can safely change ports.
struct Relay {
    port: u16,
    streams: Arc<Mutex<Option<ActiveStreams>>>,
    listener_thread: Option<std::thread::JoinHandle<()>>,
}

type ActiveStreams = HashMap<SocketAddr, (TcpStream, TcpStream)>;

impl Relay {
    fn start(
        upstream: impl Fn() -> Option<TcpStream> + Send + Sync + 'static,
    ) -> AppResult<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let streams = Arc::new(Mutex::new(Some(HashMap::new())));
        let relay_streams = Arc::clone(&streams);
        let upstream = Arc::new(upstream);
        let listener_thread = std::thread::Builder::new()
            .name("onion-socks-relay".into())
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
    if head != [5, 1, 0, 3] {
        client.write_all(&[5, 8, 0, 1, 0, 0, 0, 0, 0, 0])?;
        return Err(invalid());
    }
    let mut size = [0];
    client.read_exact(&mut size)?;
    let mut domain = vec![0; size[0] as usize];
    client.read_exact(&mut domain)?;
    let host = std::str::from_utf8(&domain).map_err(|_| invalid())?;
    let mut port = [0; 2];
    client.read_exact(&mut port)?;
    let port_number = u16::from_be_bytes(port);
    let host = host.to_ascii_lowercase();
    let allowed = crate::darkweb::is_v3_onion_host(&host)
        || (host == crate::darkweb::VORMWEB_HOST && port_number == 443);
    if port_number == 0 || !allowed {
        client.write_all(&[5, 2, 0, 1, 0, 0, 0, 0, 0, 0])?;
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "Tor destination denied"));
    }
    let mut request = head.to_vec();
    request.extend(size);
    request.extend(domain);
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
            .map_err(|_| io::Error::other("Tor relay lock poisoned"))?;
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
