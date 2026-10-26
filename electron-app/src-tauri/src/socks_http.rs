//! Minimal HTTP client with a SOCKS5 transport — the darkweb fetch port.
//!
//! Tor speaks SOCKS5 (no-auth by default for the managed instance) and
//! resolves `.onion` hostnames itself, so the client never touches DNS for
//! onion traffic: CONNECT carries the raw hostname.
//!
//! Plain HTTP/1.1 over the tunnel is enough for onion sites (no TLS on
//! .onion); clearnet HTTPS goes through ureq instead (this module does NOT
//! implement TLS). Sizes are capped and redirects followed — mirroring the
//! Electron fetcher's bounds (fetch.maxBytes / fetch.maxRedirects).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_REDIRECTS: usize = 4;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct SimpleResponse {
    pub status: u16,
    pub content_type: Option<String>,
    /// Body decoded as UTF-8 (lossy), size-capped by the caller's max_bytes.
    pub text: String,
    /// URL after redirects.
    pub final_url: String,
}

#[derive(Debug)]
pub enum FetchError {
    /// Tor gateway refused / not listening.
    TorUnavailable(String),
    /// Target did not answer.
    Unreachable(String),
    /// HTTP-level anomaly (bad status line etc.).
    Protocol(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::TorUnavailable(m) => write!(f, "tor gateway unavailable: {m}"),
            FetchError::Unreachable(m) => write!(f, "unreachable: {m}"),
            FetchError::Protocol(m) => write!(f, "protocol error: {m}"),
        }
    }
}

impl FetchError {
    /// Safe machine code for UI diagnostics (parity: safeError()).
    pub fn code(&self) -> &'static str {
        match self {
            FetchError::TorUnavailable(_) => "TOR_UNAVAILABLE",
            FetchError::Unreachable(_) => "ONION_UNREACHABLE",
            FetchError::Protocol(_) => "FETCH_FAILED",
        }
    }
}

/// GET `url` through the SOCKS5 proxy at `proxy_host:proxy_port`.
/// `max_bytes` caps the decoded body; `timeout_ms` bounds each socket op.
pub fn get_via_socks5(
    proxy_host: &str,
    proxy_port: u16,
    url: &str,
    timeout_ms: u64,
    max_bytes: usize,
) -> Result<SimpleResponse, FetchError> {
    let mut current = url.to_string();
    for _hop in 0..=MAX_REDIRECTS {
        let parsed = parse_http_url(&current)
            .ok_or_else(|| FetchError::Protocol(format!("not a plain-http URL: {current}")))?;
        let resp = fetch_once_via_socks5(proxy_host, proxy_port, &parsed, timeout_ms, max_bytes)?;
        if (300..400).contains(&resp.status) {
            if let Some(loc) = header_lookup(&resp.headers, "location") {
                current = resolve_redirect(&current, &loc);
                continue;
            }
        }
        return Ok(SimpleResponse {
            status: resp.status,
            content_type: header_lookup(&resp.headers, "content-type"),
            text: resp.body,
            final_url: current,
        });
    }
    Err(FetchError::Protocol("too many redirects".to_string()))
}

struct ParsedHttpUrl {
    host: String,
    port: u16,
    path: String,
}

/// Accept only `http://` URLs (onion traffic is plain HTTP; TLS-over-SOCKS
/// is intentionally not implemented — clearnet HTTPS uses ureq).
fn parse_http_url(url: &str) -> Option<ParsedHttpUrl> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let authority = authority.rsplit('@').next()?; // strip creds if echoed
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().ok()?),
        None => (authority.to_string(), 80u16),
    };
    if host.is_empty() {
        return None;
    }
    Some(ParsedHttpUrl { host, port, path: path.to_string() })
}

fn fetch_once_via_socks5(
    proxy_host: &str,
    proxy_port: u16,
    target: &ParsedHttpUrl,
    timeout_ms: u64,
    max_bytes: usize,
) -> Result<ParsedResponse, FetchError> {
    let timeout = Duration::from_millis(timeout_ms);
    let mut stream = TcpStream::connect((proxy_host, proxy_port))
        .map_err(|e| FetchError::TorUnavailable(format!("tcp {proxy_host}:{proxy_port}: {e}")))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();

    // SOCKS5: greeting (no-auth) → CONNECT with the RAW hostname (Tor
    // resolves .onion itself; ATYP=0x03 domain).
    stream
        .write_all(&[0x05, 0x01, 0x00])
        .map_err(socks_write)?;
    let mut ack = [0u8; 2];
    stream.read_exact(&mut ack).map_err(socks_read)?;
    if ack[0] != 0x05 || ack[1] != 0x00 {
        return Err(FetchError::TorUnavailable(format!(
            "proxy rejected auth method {:?}",
            ack
        )));
    }
    let mut connect = Vec::with_capacity(7 + target.host.len());
    connect.extend_from_slice(&[0x05, 0x01, 0x00, 0x03, target.host.len() as u8]);
    connect.extend_from_slice(target.host.as_bytes());
    connect.extend_from_slice(&target.port.to_be_bytes());
    stream.write_all(&connect).map_err(socks_write)?;
    // Reply: VER REP RSV ATYP ADDR — read the header then drain the bound
    // address by ATYP.
    // Error-semantics split: tor HOLDS the CONNECT reply for an onion target
    // until the rendezvous circuit is established, so a timeout here means
    // "circuit to the target failed/slow" while tor itself is up →
    // Unreachable (ONION_UNREACHABLE). TorUnavailable stays reserved for
    // proxy-level failures (tcp connect / greeting / auth reject).
    let mut head = [0u8; 4];
    stream.read_exact(&mut head).map_err(tunnel_read)?;
    if head[1] != 0x00 {
        return Err(FetchError::Unreachable(format!(
            "SOCKS CONNECT reply status {}",
            head[1]
        )));
    }
    let drain = match head[3] {
        0x01 => 4 + 2,
        0x03 => {
            let mut l = [0u8; 1];
            stream.read_exact(&mut l).map_err(tunnel_read)?;
            l[0] as usize + 2
        }
        0x04 => 16 + 2,
        _ => 0,
    };
    if drain > 0 {
        let mut sink = vec![0u8; drain];
        stream.read_exact(&mut sink).map_err(tunnel_read)?;
    }

    // HTTP/1.1 request over the tunnel.
    let req = build_request(&target.host, &target.path);
    stream.write_all(req.as_bytes()).map_err(tunnel_write)?;

    read_http_response(&mut stream, max_bytes)
}

fn socks_write(e: std::io::Error) -> FetchError {
    FetchError::TorUnavailable(format!("write: {e}"))
}
fn socks_read(e: std::io::Error) -> FetchError {
    FetchError::TorUnavailable(format!("read: {e}"))
}
/// Post-handshake I/O on the ESTABLISHED tunnel: tor is up; the target
/// circuit/transfer failed → Unreachable, not TorUnavailable.
fn tunnel_read(e: std::io::Error) -> FetchError {
    FetchError::Unreachable(format!("tunnel read: {e}"))
}
fn tunnel_write(e: std::io::Error) -> FetchError {
    FetchError::Unreachable(format!("tunnel write: {e}"))
}

fn build_request(host: &str, path: &str) -> String {
    format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: {USER_AGENT}\r\nAccept: text/html,application/xhtml+xml,*/*;q=0.8\r\nAccept-Language: en-US,en;q=0.9\r\nConnection: close\r\n\r\n"
    )
}

struct ParsedResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

fn header_lookup(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
}

fn read_http_response(stream: &mut TcpStream, max_bytes: usize) -> Result<ParsedResponse, FetchError> {
    // Buffered read of the header block (terminated by \r\n\r\n).
    let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        if let Some(pos) = find_header_end(&buf) {
            header_end = pos;
            break;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(FetchError::Protocol("header block too large".to_string()));
        }
        let n = stream.read(&mut chunk).map_err(|e| FetchError::Unreachable(e.to_string()))?;
        if n == 0 {
            return Err(FetchError::Protocol("connection closed before headers".to_string()));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let header_text = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = header_text.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| FetchError::Protocol(format!("bad status line: {status_line}")))?;
    let mut headers = Vec::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let mut body_bytes: Vec<u8> = buf[header_end + 4..].to_vec();

    let chunked = header_lookup(&headers, "transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false);
    if chunked {
        // Read everything (Connection: close), then de-chunk.
        loop {
            let n = stream.read(&mut chunk).map_err(|e| FetchError::Unreachable(e.to_string()))?;
            if n == 0 {
                break;
            }
            body_bytes.extend_from_slice(&chunk[..n]);
            if body_bytes.len() > max_bytes * 2 {
                break;
            }
        }
        let decoded = dechunk(&body_bytes);
        return Ok(ParsedResponse {
            status,
            headers,
            body: String::from_utf8_lossy(&decoded[..decoded.len().min(max_bytes)]).to_string(),
        });
    }

    let content_length = header_lookup(&headers, "content-length")
        .and_then(|v| v.parse::<usize>().ok());
    match content_length {
        Some(len) => {
            while body_bytes.len() < len.min(max_bytes) {
                let n = stream.read(&mut chunk).map_err(|e| FetchError::Unreachable(e.to_string()))?;
                if n == 0 {
                    break;
                }
                body_bytes.extend_from_slice(&chunk[..n]);
            }
        }
        None => {
            // Read until close, bounded.
            loop {
                let n = stream.read(&mut chunk).map_err(|e| FetchError::Unreachable(e.to_string()))?;
                if n == 0 {
                    break;
                }
                body_bytes.extend_from_slice(&chunk[..n]);
                if body_bytes.len() >= max_bytes {
                    break;
                }
            }
        }
    }
    Ok(ParsedResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&body_bytes[..body_bytes.len().min(max_bytes)]).to_string(),
    })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Decode a chunked body (sizes in hex per line, terminal 0-chunk).
fn dechunk(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let line_end = match raw[i..].windows(2).position(|w| w == b"\r\n") {
            Some(p) => i + p,
            None => break,
        };
        let size_str = String::from_utf8_lossy(&raw[i..line_end]);
        let size = usize::from_str_radix(size_str.trim().split(';').next().unwrap_or("0"), 16)
            .unwrap_or(0);
        if size == 0 {
            break;
        }
        let start = line_end + 2;
        let end = (start + size).min(raw.len());
        out.extend_from_slice(&raw[start..end]);
        i = end + 2; // skip trailing CRLF
    }
    out
}

/// Resolve a Location header against the current URL (absolute or
/// root/relative path).
fn resolve_redirect(current: &str, location: &str) -> String {
    let loc = location.trim();
    if loc.starts_with("http://") || loc.starts_with("https://") {
        return loc.to_string();
    }
    let base = parse_http_url(current);
    match base {
        Some(b) => {
            if loc.starts_with('/') {
                format!("http://{}:{}{}", b.host, b.port, loc)
            } else {
                let dir = match b.path.rfind('/') {
                    Some(p) => &b.path[..=p],
                    None => "/",
                };
                format!("http://{}:{}{}{}", b.host, b.port, dir, loc)
            }
        }
        None => loc.to_string(),
    }
}

/// Clearnet GET for gateways like ahmia.fi (HTTPS via ureq).
pub fn get_clearnet(
    url: &str,
    timeout_ms: u64,
    max_bytes: usize,
) -> Result<SimpleResponse, FetchError> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(timeout_ms))
        .build();
    let resp = agent
        .get(url)
        .set("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => FetchError::Unreachable(format!("HTTP {code}")),
            other => FetchError::Unreachable(other.to_string()),
        })?;
    let status = resp.status();
    let content_type = resp.header("content-type").map(str::to_string);
    let mut text = String::new();
    resp.into_reader()
        .take(max_bytes as u64)
        .read_to_string(&mut text)
        .map_err(|e| FetchError::Unreachable(e.to_string()))?;
    Ok(SimpleResponse { status, content_type, text, final_url: url.to_string() })
}

/// HTTPS GET for a CLEARNET host routed through the Tor SOCKS5 gateway.
/// TLS-over-SOCKS via ureq's socks support: the CONNECT carries the raw
/// hostname, so DNS resolves on the Tor side (same anonymity as an onion
/// fetch — this is NOT a direct fallback). Used when an onion mirror
/// (e.g. ahmia's) is flaky while the Tor circuit itself is healthy.
pub fn get_https_via_socks5(
    socks_host: &str,
    socks_port: u16,
    url: &str,
    timeout_ms: u64,
    max_bytes: usize,
) -> Result<SimpleResponse, FetchError> {
    let proxy = ureq::Proxy::new(format!("socks5://{socks_host}:{socks_port}"))
        .map_err(|e| FetchError::Unreachable(e.to_string()))?;
    let agent = ureq::AgentBuilder::new()
        .proxy(proxy)
        .timeout(Duration::from_millis(timeout_ms))
        .build();
    let resp = agent
        .get(url)
        .set("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => FetchError::Unreachable(format!("HTTP {code}")),
            other => FetchError::Unreachable(other.to_string()),
        })?;
    let status = resp.status();
    let content_type = resp.header("content-type").map(str::to_string);
    let mut text = String::new();
    resp.into_reader()
        .take(max_bytes as u64)
        .read_to_string(&mut text)
        .map_err(|e| FetchError::Unreachable(e.to_string()))?;
    Ok(SimpleResponse { status, content_type, text, final_url: url.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_http_urls_only() {
        let p = parse_http_url("http://abcxyz.onion/search?q=%s").unwrap();
        assert_eq!(p.host, "abcxyz.onion");
        assert_eq!(p.port, 80);
        assert_eq!(p.path, "/search?q=%s");

        let p = parse_http_url("http://tor66sewebgixwhcqfnp5inzp5x5uohhyl3qcyyeiafkliegvfiogiijd.onion").unwrap();
        assert_eq!(p.path, "/");
        assert_eq!(p.port, 80);

        assert!(parse_http_url("https://ahmia.fi/search").is_none()); // TLS not here
        assert!(parse_http_url("ftp://x/").is_none());
        let creds = parse_http_url("http://user:pass@evil.onion/").unwrap();
        assert_eq!(creds.host, "evil.onion"); // creds stripped, never sent
    }

    #[test]
    fn builds_wellformed_request() {
        let req = build_request("abc.onion", "/search?q=1");
        assert!(req.starts_with("GET /search?q=1 HTTP/1.1\r\n"));
        assert!(req.contains("Host: abc.onion\r\n"));
        assert!(req.ends_with("Connection: close\r\n\r\n"));
    }

    #[test]
    fn dechunks_bodies() {
        let raw = b"4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n";
        assert_eq!(dechunk(raw), b"Wikipedia".to_vec());
    }

    #[test]
    fn resolves_redirects() {
        assert_eq!(
            resolve_redirect("http://a.onion/x/y", "http://b.onion/z"),
            "http://b.onion/z"
        );
        assert_eq!(
            resolve_redirect("http://a.onion/x/y", "/root"),
            "http://a.onion:80/root"
        );
        assert_eq!(
            resolve_redirect("http://a.onion/x/y", "sib"),
            "http://a.onion:80/x/sib"
        );
    }

    #[test]
    fn header_lookup_is_case_insensitive() {
        let headers = vec![
            ("Content-Type".to_string(), "text/html".to_string()),
            ("Location".to_string(), "/next".to_string()),
        ];
        assert_eq!(header_lookup(&headers, "content-type").as_deref(), Some("text/html"));
        assert_eq!(header_lookup(&headers, "LOCATION").as_deref(), Some("/next"));
    }
}
