//! Minimal CDP (Chrome DevTools Protocol) WebSocket client — the ONLY piece
//! the bridge cannot do through `eval_with_callback`: page screenshots.
//!
//! Connects to the tab-environment remote-debugging port (loopback only,
//! `core::tab_debug_port()`), finds the target by URL, issues
//! `Page.captureScreenshot`, saves the PNG. Hand-rolled RFC6455 client
//! framing (client→server masked, server→client plain) — no new deps.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Frame codec (pure — unit-tested)
// ---------------------------------------------------------------------------

/// Encode one client text frame (FIN + opcode 0x1, masked).
pub fn encode_client_frame(payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 14);
    out.push(0x81);
    let len = payload.len();
    if len < 126 {
        out.push(0x80 | len as u8);
    } else if len <= 0xffff {
        out.push(0x80 | 126);
        out.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        out.push(0x80 | 127);
        out.extend_from_slice(&(len as u64).to_be_bytes());
    }
    out.extend_from_slice(&mask);
    for (i, b) in payload.iter().enumerate() {
        out.push(b ^ mask[i % 4]);
    }
    out
}

/// Decoded server frame.
#[derive(Debug, PartialEq)]
pub struct Frame {
    pub opcode: u8,
    pub payload: Vec<u8>,
}

/// Try to decode one (possibly fragmented-into-one-buffer) frame from `buf`.
/// Returns the frame + bytes consumed, or None when incomplete.
pub fn decode_server_frame(buf: &[u8]) -> Option<(Frame, usize)> {
    if buf.len() < 2 {
        return None;
    }
    let opcode = buf[0] & 0x0f;
    let masked = buf[1] & 0x80 != 0;
    let mut len = (buf[1] & 0x7f) as usize;
    let mut off = 2;
    if len == 126 {
        if buf.len() < 4 {
            return None;
        }
        len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
        off = 4;
    } else if len == 127 {
        if buf.len() < 10 {
            return None;
        }
        let mut b = [0u8; 8];
        b.copy_from_slice(&buf[2..10]);
        len = u64::from_be_bytes(b) as usize;
        off = 10;
    }
    let mask = if masked {
        if buf.len() < off + 4 {
            return None;
        }
        let m = [buf[off], buf[off + 1], buf[off + 2], buf[off + 3]];
        off += 4;
        Some(m)
    } else {
        None
    };
    if buf.len() < off + len {
        return None;
    }
    let mut payload = buf[off..off + len].to_vec();
    if let Some(m) = mask {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= m[i % 4];
        }
    }
    Some((Frame { opcode, payload }, off + len))
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

struct WsConn {
    stream: TcpStream,
    buf: Vec<u8>,
}

impl WsConn {
    fn connect(port: u16, target_id: &str) -> AppResult<Self> {
        Self::connect_path(port, &format!("/devtools/page/{target_id}"))
    }

    /// Connect to ANY DevTools ws path (page target OR the browser-level
    /// endpoint used by the shield's Fetch interceptor).
    fn connect_path(port: u16, path: &str) -> AppResult<Self> {
        let addr = format!("127.0.0.1:{port}");
        let mut stream = TcpStream::connect(&addr)
            .map_err(|e| AppError::new("CDP_CONNECT_FAILED", e.to_string()))?;
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
        let key = cdp_key();
        let req = format!(
            "GET {path} HTTP/1.1\r\n\
             Host: 127.0.0.1:{port}\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Key: {key}\r\n\
             Sec-WebSocket-Version: 13\r\n\r\n"
        );
        stream
            .write_all(req.as_bytes())
            .map_err(|e| AppError::new("CDP_CONNECT_FAILED", e.to_string()))?;
        // Read the 101 response (headers end with \r\n\r\n).
        let mut buf = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            if Instant::now() > deadline {
                return Err(AppError::new(
                    "CDP_HANDSHAKE_TIMEOUT",
                    "no upgrade response",
                ));
            }
            let mut chunk = [0u8; 4096];
            match stream.read(&mut chunk) {
                Ok(0) => return Err(AppError::new("CDP_HANDSHAKE_CLOSED", "stream closed")),
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(e) => return Err(AppError::new("CDP_HANDSHAKE_IO", e.to_string())),
            }
            if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buf[..pos]);
                if !head.to_lowercase().contains("101") {
                    return Err(AppError::new(
                        "CDP_HANDSHAKE_REJECTED",
                        head.lines().next().unwrap_or(""),
                    ));
                }
                break;
            }
        }
        Ok(Self {
            stream,
            buf: Vec::new(),
        })
    }

    /// Read frames until one TEXT message is assembled (events included —
    /// the caller inspects them). Pings are answered transparently. Returns
    /// Err on close/IO, Ok(None) on timeout.
    fn next_message(&mut self, idle: Duration) -> AppResult<Option<serde_json::Value>> {
        let deadline = Instant::now() + idle;
        let mut assembled: Vec<u8> = Vec::new();
        loop {
            if let Some((frame, used)) = decode_server_frame(&self.buf) {
                let fin = self.buf[0] & 0x80 != 0;
                self.buf.drain(..used);
                match frame.opcode {
                    0x8 => return Err(AppError::new("CDP_CLOSED", "close frame")),
                    0x9 => {
                        let pong = encode_client_frame(&frame.payload, rand_mask());
                        self.stream
                            .write_all(&pong)
                            .map_err(|e| AppError::new("CDP_SEND_FAILED", e.to_string()))?;
                    }
                    0x1 | 0x2 => {
                        if fin {
                            if let Ok(msg) = serde_json::from_slice::<serde_json::Value>(&frame.payload) {
                                return Ok(Some(msg));
                            }
                        } else {
                            assembled = frame.payload;
                        }
                    }
                    0x0 => {
                        assembled.extend_from_slice(&frame.payload);
                        if fin {
                            let payload = std::mem::take(&mut assembled);
                            if let Ok(msg) = serde_json::from_slice::<serde_json::Value>(&payload) {
                                return Ok(Some(msg));
                            }
                        }
                    }
                    _ => {}
                }
                continue;
            }
            if Instant::now() > deadline {
                return Ok(None);
            }
            self.stream
                .set_read_timeout(Some(idle.min(Duration::from_secs(1))))
                .ok();
            let mut chunk = [0u8; 16384];
            match self.stream.read(&mut chunk) {
                Ok(0) => return Err(AppError::new("CDP_CLOSED", "stream closed")),
                Ok(n) => self.buf.extend_from_slice(&chunk[..n]),
                Err(e) => {
                    // Read timeout just means "no data within the window" —
                    // loop back to the deadline check.
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut
                    {
                        if Instant::now() > deadline {
                            return Ok(None);
                        }
                        continue;
                    }
                    return Err(AppError::new("CDP_RECV_IO", e.to_string()));
                }
            }
        }
    }

    /// Parse an assembled message; Ok(Some) when it carries our id.
    fn parse_reply(&self, payload: &[u8], id: u64) -> Option<serde_json::Value> {
        let msg = serde_json::from_slice::<serde_json::Value>(payload).ok()?;
        if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
            Some(msg)
        } else {
            None // event (no id) → skip
        }
    }

    fn send_text(&mut self, payload: &str) -> AppResult<()> {
        let mask = rand_mask();
        let frame = encode_client_frame(payload.as_bytes(), mask);
        self.stream
            .write_all(&frame)
            .map_err(|e| AppError::new("CDP_SEND_FAILED", e.to_string()))
    }

    /// Read frames until one TEXT message carries `id` (skip events).
    /// Large replies (page screenshots) arrive as WebSocket FRAGMENTS —
    /// first frame opcode 0x1 without FIN, continuations opcode 0x0 — so
    /// messages are assembled across frames (verified live).
    fn wait_reply(&mut self, id: u64, timeout: Duration) -> AppResult<serde_json::Value> {
        let deadline = Instant::now() + timeout;
        let mut assembled: Vec<u8> = Vec::new();
        loop {
            if let Some((frame, used)) = decode_server_frame(&self.buf) {
                let fin = self.buf[0] & 0x80 != 0;
                self.buf.drain(..used);
                match frame.opcode {
                    0x8 => return Err(AppError::new("CDP_CLOSED", "close frame")),
                    0x9 => {
                        // Ping → Pong (opcode 0xA, masked client frame).
                        let pong = encode_client_frame(&frame.payload, rand_mask());
                        self.stream
                            .write_all(&pong)
                            .map_err(|e| AppError::new("CDP_SEND_FAILED", e.to_string()))?;
                    }
                    0x1 | 0x2 => {
                        if fin {
                            if let Some(msg) = self.parse_reply(&frame.payload, id) {
                                return Ok(msg);
                            }
                        } else {
                            assembled = frame.payload; // fragmentation starts
                        }
                    }
                    0x0 => {
                        assembled.extend_from_slice(&frame.payload);
                        if fin {
                            if let Some(msg) = self.parse_reply(&assembled, id) {
                                return Ok(msg);
                            }
                            assembled.clear();
                        }
                    }
                    _ => {}
                }
                continue;
            }
            if Instant::now() > deadline {
                return Err(AppError::new("CDP_REPLY_TIMEOUT", "no reply in time"));
            }
            let mut chunk = [0u8; 16384];
            match self.stream.read(&mut chunk) {
                Ok(0) => return Err(AppError::new("CDP_CLOSED", "stream closed")),
                Ok(n) => self.buf.extend_from_slice(&chunk[..n]),
                Err(e) => {
                    return Err(AppError::new("CDP_RECV_IO", e.to_string()));
                }
            }
        }
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Deterministic-enough random mask (time + address entropy).
fn rand_mask() -> [u8; 4] {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as usize)
        .unwrap_or(0);
    let stack = &t as *const _ as usize;
    ((t ^ stack) as u32).to_le_bytes()
}

fn cdp_key() -> String {
    // 16 bytes → base64-ish; CDP only validates 24-char base64 format.
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    const CH: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(24);
    let mut n = t;
    for _ in 0..22 {
        out.push(CH[(n % 62) as usize] as char);
        n = n
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
    }
    out.push_str("==");
    out
}

fn http_get_json(port: u16, path: &str) -> AppResult<serde_json::Value> {
    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}"))
        .map_err(|e| AppError::new("CDP_LIST_FAILED", e.to_string()))?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .map_err(|e| AppError::new("CDP_LIST_FAILED", e.to_string()))?;
    let mut raw = Vec::new();
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .map_err(|e| AppError::new("CDP_LIST_FAILED", e.to_string()))?;
    // The DevTools server IGNORES Connection: close and keeps the socket open
    // (verified live: read_to_end hung until timeout, os error 10060) — read
    // headers, then exactly Content-Length bytes of body.
    let header_end = loop {
        if let Some(pos) = find_subslice(&raw, b"\r\n\r\n") {
            break pos;
        }
        let mut chunk = [0u8; 4096];
        let n = stream
            .read(&mut chunk)
            .map_err(|e| AppError::new("CDP_LIST_FAILED", e.to_string()))?;
        if n == 0 {
            return Err(AppError::new(
                "CDP_LIST_FAILED",
                "stream closed before headers",
            ));
        }
        raw.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&raw[..header_end]).to_lowercase();
    let content_length = head
        .lines()
        .find_map(|l| l.strip_prefix("content-length:"))
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    while raw.len() < body_start + content_length {
        let mut chunk = [0u8; 16384];
        let n = stream
            .read(&mut chunk)
            .map_err(|e| AppError::new("CDP_LIST_FAILED", e.to_string()))?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&chunk[..n]);
    }
    let body = &raw[body_start..];
    serde_json::from_slice(body).map_err(|e| AppError::new("CDP_LIST_PARSE", e.to_string()))
}

/// Browser-level version info (includes the engine's real User-Agent) —
/// used to derive the cleaned site-facing UA (site_ua.rs).
pub fn http_get_json_version(port: u16) -> AppResult<serde_json::Value> {
    http_get_json(port, "/json/version")
}

/// Find the CDP target id with the exact native target ID. URLs never identify a target.
pub fn find_target(port: u16, needle: &str) -> AppResult<(String, String)> {
    let list = http_get_json(port, "/json")?;
    let wanted = needle;
    for t in list.as_array().cloned().unwrap_or_default() {
        let url = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
        if t.get("id").and_then(|v| v.as_str()) == Some(wanted)
            && t.get("type").and_then(|v| v.as_str()) == Some("page")
        {
            let id = t
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::new("CDP_LIST_PARSE", "target without id"))?
                .to_string();
            return Ok((id, url.to_string()));
        }
    }
    Err(AppError::new(
        "CDP_TARGET_NOT_FOUND",
        format!("no page target for {needle:?} on :{port}"),
    ))
}

/// Capture a PNG of the page `needle` lives in and save it under `out_path`.
/// Every failure carries a step-trace in `details` for release-mode debugging.
pub fn capture_screenshot(
    port: u16,
    needle: &str,
    out_path: &std::path::Path,
) -> AppResult<std::path::PathBuf> {
    let mut steps: Vec<String> = Vec::new();
    let t0 = Instant::now();
    let step = |steps: &mut Vec<String>, s: String| {
        steps.push(format!("{}ms {}", t0.elapsed().as_millis(), s));
    };

    step(
        &mut steps,
        format!("find_target needle={needle:?} port={port}"),
    );
    let (target_id, url) = match find_target(port, needle) {
        Ok(v) => {
            step(
                &mut steps,
                format!("target found id={} url={}", target_id_repr(&v.0), v.1),
            );
            v
        }
        Err(e) => {
            step(&mut steps, format!("find_target FAILED: {e}"));
            return Err(e.with_details(steps));
        }
    };
    let mut ws = match WsConn::connect(port, &target_id) {
        Ok(v) => {
            step(&mut steps, "ws handshake ok".into());
            v
        }
        Err(e) => {
            step(&mut steps, format!("handshake FAILED: {e}"));
            return Err(e.with_details(steps));
        }
    };
    if let Err(e) = ws.send_text(r#"{"id":1,"method":"Page.enable"}"#) {
        step(&mut steps, format!("enable send FAILED: {e}"));
        return Err(e.with_details(steps));
    }
    match ws.wait_reply(1, Duration::from_secs(5)) {
        Ok(_) => step(&mut steps, "enable ack".to_string()),
        Err(e) => {
            step(&mut steps, format!("enable ack FAILED: {e}"));
            return Err(e.with_details(steps));
        }
    }
    if let Err(e) =
        ws.send_text(r#"{"id":2,"method":"Page.captureScreenshot","params":{"format":"png"}}"#)
    {
        step(&mut steps, format!("shot send FAILED: {e}"));
        return Err(e.with_details(steps));
    }
    let reply = match ws.wait_reply(2, Duration::from_secs(25)) {
        Ok(v) => {
            step(&mut steps, "shot reply received".to_string());
            v
        }
        Err(e) => {
            step(&mut steps, format!("shot reply FAILED: {e}"));
            return Err(e.with_details(steps));
        }
    };
    let data = reply
        .get("result")
        .and_then(|r| r.get("data"))
        .and_then(|d| d.as_str())
        .ok_or_else(|| {
            AppError::new("CDP_SHOT_FAILED", "no data in reply").with_details(steps.clone())
        })?;
    let bytes = base64_decode(data);
    if bytes.is_empty() {
        return Err(AppError::new("CDP_SHOT_FAILED", "empty png").with_details(steps));
    }
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::new("IO_ERROR", e.to_string()))?;
    }
    std::fs::write(out_path, &bytes).map_err(|e| AppError::new("IO_ERROR", e.to_string()))?;
    step(&mut steps, format!("written {} bytes", bytes.len()));
    log::info!(
        "[BRIDGE] screenshot {} ({} bytes) from {url}",
        out_path.display(),
        bytes.len()
    );
    Ok(out_path.to_path_buf())
}

fn target_id_repr(id: &str) -> &str {
    if id.len() > 12 {
        &id[..12]
    } else {
        id
    }
}

/// Page targets (`type=page`) currently alive on this DevTools endpoint.
pub fn list_page_targets(port: u16) -> AppResult<Vec<String>> {
    let list = http_get_json(port, "/json")?;
    Ok(list
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.get("type").and_then(|v| v.as_str()) == Some("page"))
        .filter_map(|t| t.get("id").and_then(|v| v.as_str()).map(str::to_string))
        .collect())
}

/// Run ONE page-level shield session (BLOCKS the caller until the ws
/// dies): direct `Fetch.enable` on the page target — no Target domain,
/// which WebView2's browser endpoint does not reliably deliver. Real
/// network blocking: paused requests are failed (BlockedByClient) or
/// continued by the caller's decision.
pub fn run_page_fetch_filter(
    port: u16,
    target_id: &str,
    decide: std::sync::Arc<dyn Fn(&str) -> bool + Send + Sync>,
    on_block: std::sync::Arc<dyn Fn(&str) + Send + Sync>,
) {
    let Ok(mut ws) = WsConn::connect_path(port, &format!("/devtools/page/{target_id}")) else {
        return;
    };
    if ws
        .send_text(
            r#"{"id":1,"method":"Fetch.enable","params":{"patterns":[{"urlPattern":"*","requestStage":"Request"}]}}"#,
        )
        .is_err()
    {
        return;
    }
    if ws.wait_reply(1, Duration::from_secs(5)).is_err() {
        return;
    }
    log::info!("[SHIELD] page session attached target={}", target_id_repr(target_id));
    let mut next_id: u64 = 10;
    let target_id2 = target_id.to_string();
    loop {
        match ws.next_message(Duration::from_secs(30)) {
            Err(e) => {
                log::info!("[SHIELD] page session {} exit: {e}", target_id_repr(&target_id2));
                return;
            }
            Ok(None) => continue,
            Ok(Some(msg)) => {
                let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
                if method != "Fetch.requestPaused" {
                    continue;
                }
                let url = msg
                    .pointer("/params/request/url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let request_id = msg
                    .pointer("/params/requestId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if request_id.is_empty() {
                    continue;
                }
                let host = host_of_url(&url);
                let (method, reason) = if !host.is_empty() && decide(&host) {
                    on_block(&host);
                    ("Fetch.failRequest", "BlockedByClient")
                } else {
                    ("Fetch.continueRequest", "")
                };
                let mut req = serde_json::json!({
                    "id": next_id,
                    "method": method,
                    "params": { "requestId": request_id },
                });
                if !reason.is_empty() {
                    req["params"]["errorReason"] = json!(reason);
                }
                if ws.send_text(&req.to_string()).is_err() {
                    return;
                }
                next_id += 1;
                if next_id > 100_000_000 {
                    next_id = 10;
                }
            }
        }
    }
}

/// Extract the request HOST from a URL string (lowercase, no port).
fn host_of_url(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .map(|h| h.to_ascii_lowercase())
        .unwrap_or_default()
}

/// BROWSER-LEVEL filter session — NOT USED on WebView2: verified live that
/// its browser endpoint accepts `Target.setAutoAttach` (empty OK reply) but
/// NEVER delivers `Target.attachedToTarget` sessions for page targets
/// (only `Target.targetInfoChanged`). Kept as the documented fallback for
/// a future wry/WebView2 that supports it; the ACTIVE path is
/// `run_page_fetch_filter` (one direct session per page target).
#[allow(dead_code)]
pub fn run_fetch_filter(
    port: u16,
    decide: std::sync::Arc<dyn Fn(&str) -> bool + Send + Sync>,
    on_block: std::sync::Arc<dyn Fn(&str) + Send + Sync>,
) {
    let Some(path) = browser_ws_path(port) else { return };
    let mut ws = match WsConn::connect_path(port, &path) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[SHIELD] browser ws connect failed: {e}");
            return;
        }
    };
    if ws
        .send_text(
            r#"{"id":1,"method":"Target.setAutoAttach","params":{"autoAttach":true,"waitForDebuggerOnStart":false,"flatten":true}}"#,
        )
        .is_err()
    {
        return;
    }
    match ws.wait_reply(1, Duration::from_secs(5)) {
        Ok(reply) => log::info!("[SHIELD] setAutoAttach reply: {reply}"),
        Err(e) => {
            log::warn!("[SHIELD] setAutoAttach no reply: {e}");
            return;
        }
    }
    // WebView2 sometimes needs explicit discovery for EXISTING targets to
    // (re)emit attachedToTarget on the browser-level connection.
    if ws
        .send_text(r#"{"id":2,"method":"Target.setDiscoverTargets","params":{"discover":true}}"#)
        .is_ok()
    {
        let _ = ws.wait_reply(2, Duration::from_secs(5));
    }
    log::info!("[SHIELD] fetch filter attached to tab environment :{port}");
    let mut next_id: u64 = 10;
    loop {
        match ws.next_message(Duration::from_secs(30)) {
            Err(_) => return, // environment gone — supervisor respawns
            Ok(None) => continue, // idle keepalive window elapsed
            Ok(Some(msg)) => {
                let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
                match method {
                    "Target.attachedToTarget" => {
                        let session = msg
                            .pointer("/params/sessionId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let ttype = msg
                            .pointer("/params/targetInfo/type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if ttype != "page" || session.is_empty() {
                            continue;
                        }
                        let req = serde_json::json!({
                            "id": next_id,
                            "sessionId": session,
                            "method": "Fetch.enable",
                            "params": { "patterns": [{ "urlPattern": "*", "requestStage": "Request" }] },
                        });
                        if ws.send_text(&req.to_string()).is_err() {
                            return;
                        }
                        next_id += 1;
                    }
                    "Fetch.requestPaused" => {
                        let url = msg
                            .pointer("/params/request/url")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let request_id = msg
                            .pointer("/params/requestId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let session = msg
                            .get("sessionId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if request_id.is_empty() {
                            continue;
                        }
                        let host = host_of_url(&url);
                        let (method, reason) = if !host.is_empty() && decide(&host) {
                            on_block(&host);
                            ("Fetch.failRequest", "BlockedByClient")
                        } else {
                            ("Fetch.continueRequest", "")
                        };
                        let mut req = serde_json::json!({
                            "id": next_id,
                            "method": method,
                            "params": { "requestId": request_id },
                        });
                        if !session.is_empty() {
                            req["sessionId"] = json!(session);
                        }
                        if !reason.is_empty() {
                            req["params"]["errorReason"] = json!(reason);
                        }
                        if ws.send_text(&req.to_string()).is_err() {
                            return;
                        }
                        next_id += 1;
                        if next_id > 100_000_000 {
                            next_id = 10; // wrap far beyond any run
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// The browser-level DevTools ws path (`/devtools/browser/<id>`) from
/// `/json/version` — present only while the tab environment runs.
fn browser_ws_path(port: u16) -> Option<String> {
    let v = http_get_json_version(port).ok()?;
    let ws = v.get("webSocketDebuggerUrl")?.as_str()?.to_string();
    let idx = ws.find("/devtools/")?;
    Some(ws[idx..].to_string())
}


fn base64_decode(input: &str) -> Vec<u8> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in input.bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = if c.is_ascii_alphanumeric() || c == b'+' || c == b'/' {
            alphabet.iter().position(|&a| a == c).map(|p| p as u32)
        } else {
            None
        };
        let Some(v) = v else { continue };
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_frame_roundtrip_small() {
        let mask = [0x11, 0x22, 0x33, 0x44];
        let frame = encode_client_frame(b"hi", mask);
        assert_eq!(frame[0], 0x81);
        assert_eq!(frame[1] & 0x80, 0x80, "client frames are masked");
        let (decoded, used) = decode_server_frame(&frame).unwrap();
        // decoding a client-frame bytes works too (mask present)
        assert_eq!(used, frame.len());
        assert_eq!(decoded.opcode, 0x1);
        assert_eq!(decoded.payload, b"hi".to_vec());
    }

    #[test]
    fn client_frame_large_payload() {
        let mask = [1, 2, 3, 4];
        let payload = vec![7u8; 70_000]; // > 0xffff → 64-bit length
        let frame = encode_client_frame(&payload, mask);
        assert_eq!(frame[1] & 0x7f, 127);
        let (decoded, used) = decode_server_frame(&frame).unwrap();
        assert_eq!(used, frame.len());
        assert_eq!(decoded.payload, payload);
    }

    #[test]
    fn incomplete_frame_returns_none() {
        let full = encode_client_frame(b"abcdef", [9, 9, 9, 9]);
        for cut in [1usize, 3, 5] {
            assert!(decode_server_frame(&full[..cut]).is_none());
        }
    }
}
