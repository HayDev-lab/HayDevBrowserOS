//! SSRF boundary: canonical URL parsing, one DNS resolution, pinned connection.
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::io::Read;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicTarget { pub scheme: String, pub host: String, pub port: u16, pub addresses: Vec<SocketAddr> }
impl PublicTarget {
    pub fn agent(&self, timeout: Duration) -> ureq::Agent {
        let netloc = format!("{}:{}", self.host, self.port);
        let bracketed = format!("[{}]:{}", self.host, self.port);
        let addresses = self.addresses.clone();
        ureq::AgentBuilder::new().redirects(0).try_proxy_from_env(false)
            .timeout(timeout).timeout_connect(timeout.min(Duration::from_secs(5))).timeout_read(timeout.min(Duration::from_secs(5)))
            .resolver(move |requested: &str| {
                if requested != netloc && requested != bracketed {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "unpinned target"));
                }
                Ok(addresses.clone())
            }).build()
    }
}
fn banned(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            matches!(o[0], 0 | 10 | 127) || o[0] >= 224
                || (o[0] == 169 && o[1] == 254) || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168) || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 192 && o[1] == 0) || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                || (o[0] == 198 && o[1] == 51 && o[2] == 100) || (o[0] == 203 && o[1] == 0 && o[2] == 113)
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            (s[0] & 0xe000) != 0x2000 || s[0] == 0x2002
                || (s[0] == 0x2001 && (s[1] == 0xdb8 || s[1] < 0x200))
        }
    }
}
fn parse(raw: &str) -> Result<url::Url, String> {
    if raw.contains('\\') || raw.chars().any(|c| c.is_control()) { return Err("invalid URL encoding".into()); }
    let u = url::Url::parse(raw).map_err(|_| "invalid URL")?;
    if !matches!(u.scheme(), "http" | "https") { return Err("HTTP(S) required".into()); }
    if !u.username().is_empty() || u.password().is_some() { return Err("userinfo forbidden".into()); }
    let host = u.host_str().ok_or("missing host")?.trim_end_matches('.');
    if host == "onion" || host.ends_with(".onion") { return Err("onion requires Tor".into()); }
    Ok(u)
}
fn validate(raw: &str, allow_fixture: bool) -> Result<PublicTarget, String> {
    let u = parse(raw)?;
    let host = u.host_str().ok_or("missing host")?.trim_matches(['[', ']']).to_string();
    let port = u.port_or_known_default().ok_or("missing port")?;
    let addresses: Vec<_> = (host.as_str(), port).to_socket_addrs().map_err(|_| "DNS resolution failed")?.collect();
    if addresses.is_empty() || (!allow_fixture && addresses.iter().any(|a| banned(a.ip()))) {
        return Err("address is not a permitted public destination".into());
    }
    if allow_fixture && addresses.iter().any(|a| !a.ip().is_loopback()) { return Err("fixture must resolve only to loopback".into()); }
    Ok(PublicTarget { scheme: u.scheme().into(), host, port, addresses })
}
pub fn validate_public_http_url(raw: &str) -> Result<PublicTarget, String> { validate(raw, false) }
pub fn validate_fetch_url(raw: &str) -> Result<PublicTarget, String> {
    #[cfg(debug_assertions)]
    if std::env::var("HAYDEV_QA_MODE").as_deref() == Ok("1") && std::env::var_os("HAYDEV_DATA_DIR").is_some() {
        if let (Ok(u), Ok(allow)) = (parse(raw), std::env::var("HAYDEV_TEST_FETCH_ALLOW")) {
            if allow.split(',').filter_map(|v| parse(v.trim()).ok()).any(|a| a.origin() == u.origin()) { return validate(raw, true); }
        }
    }
    validate_public_http_url(raw)
}
/// Each redirect gets its own verified address set and its own fresh client.
/// No proxy environment, DNS re-resolution or reused connection can bypass it.
pub fn fetch(raw: &str) -> Result<(String, String, u16), String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut current = raw.to_string();
    for hop in 0..=5 {
        crate::run_guard::check().map_err(|e| e.code)?;
        let target = validate_fetch_url(&current)?;
        let remaining = deadline.checked_duration_since(Instant::now()).ok_or("FETCH_TIMEOUT")?;
        let fetcher = target.agent(remaining);
        crate::run_guard::check().map_err(|e| e.code)?;
        let response = match fetcher.get(&current).set("Accept", "text/html,application/xhtml+xml").call() {
            Ok(r) => r,
            Err(ureq::Error::Status(code, _)) => return Err(format!("FETCH_HTTP_{code}")),
            Err(_) => return Err("FETCH_TRANSPORT_ERROR".into()),
        };
        crate::run_guard::check().map_err(|e| e.code)?;
        let status = response.status();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            if hop == 5 { return Err("FETCH_TOO_MANY_REDIRECTS".into()); }
            let location = response.header("location").ok_or("FETCH_REDIRECT_NO_LOCATION")?;
            current = url::Url::parse(&current).and_then(|u| u.join(location)).map_err(|_| "FETCH_BAD_REDIRECT")?.to_string();
            continue;
        }
        if status != 200 { return Err(format!("FETCH_HTTP_{status}")); }
        let mut bytes = Vec::new();
        response.into_reader().take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "FETCH_READ_ERROR")?;
        crate::run_guard::check().map_err(|e| e.code)?;
        if bytes.len() > 2 * 1024 * 1024 { return Err("FETCH_SIZE_LIMIT".into()); }
        return Ok((String::from_utf8_lossy(&bytes).into_owned(), current, status));
    }
    Err("FETCH_TOO_MANY_REDIRECTS".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adversarial_urls() {
        for u in ["file:///etc/passwd", "https://user:pass@example.com", "http://x.onion", "http://127.0.0.1", "http://2130706433", "http://0177.0.0.1", "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://[fe80::1]", "http://[fc00::1]", "http://169.254.169.254", "http://10.0.0.1", "http://172.16.0.1", "http://192.168.1.1", "http://198.18.0.1", "http://100.64.0.1", "http://example.com@127.0.0.1"] {
            assert!(validate_public_http_url(u).is_err(), "accepted {u}");
        }
        assert!(validate_public_http_url("https://8.8.8.8").is_ok());
    }
    #[test]
    fn pinned_connection_does_not_resolve_host_again() {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let addr = server.local_addr().unwrap();
        let worker = std::thread::spawn(move || { let (mut c, _) = server.accept().unwrap(); let mut b = [0; 2048]; let n = c.read(&mut b).unwrap();
            assert!(String::from_utf8_lossy(&b[..n]).contains("never-resolve.invalid"));
            c.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\npinned").unwrap(); });
        let target = PublicTarget { scheme: "http".into(), host: "never-resolve.invalid".into(), port: addr.port(), addresses: vec![addr] };
        let text = target.agent(Duration::from_secs(2)).get(&format!("http://never-resolve.invalid:{}/", addr.port())).call().unwrap().into_string().unwrap();
        assert_eq!(text, "pinned"); worker.join().unwrap();
    }
}
