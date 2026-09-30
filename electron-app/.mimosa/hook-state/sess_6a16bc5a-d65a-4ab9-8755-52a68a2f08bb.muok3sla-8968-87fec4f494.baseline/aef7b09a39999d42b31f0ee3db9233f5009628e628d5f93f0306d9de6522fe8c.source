//! URL normalization — port of `src/main/browser/pure/url-utils.ts`.
//!
//! PURE LOGIC — no tauri imports; unit-tested in `tests` module below with
//! the same cases the vitest suite uses on the TS side.

use url::Url;

const ALLOWED_PROTOCOLS: [&str; 5] = ["http:", "https:", "about:", "pab:", "file:"];
const BLOCKED_PROTOCOLS_FROM_ADDRESS_BAR: [&str; 5] =
    ["javascript:", "data:", "vbscript:", "blob:", "file:"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedUrl {
    /// The URL string to actually load, or None if the input is rejected.
    pub url: Option<String>,
    /// Why the input was rejected, when `url` is None.
    pub reason: Option<String>,
    /// True when the input was treated as a search query.
    pub is_search: bool,
}

impl NormalizedUrl {
    fn rejected(reason: impl Into<String>) -> Self {
        Self {
            url: None,
            reason: Some(reason.into()),
            is_search: false,
        }
    }
}

/// Default search URL (see url-utils.ts `getSearchUrl`). Env-driven, with the
/// same PAB_PERPLEXICA_URL → pab://search rerouting as the Electron runtime.
pub fn get_search_url(query: &str) -> String {
    let perplexica = std::env::var("PAB_PERPLEXICA_URL")
        .ok()
        .filter(|v| !v.trim().is_empty());
    if perplexica.is_some() {
        return format!("pab://search?q={}", urlencode_query(query));
    }
    let template = std::env::var("PAB_SEARCH_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://duckduckgo.com/?q=".to_string());
    let encoded = urlencode_query(query);
    if template.contains("%s") {
        return template.replacen("%s", &encoded, 1);
    }
    if template.ends_with("q=") {
        return format!("{template}{encoded}");
    }
    if template.contains('?') {
        format!("{template}&q={encoded}")
    } else {
        format!("{template}?q={encoded}")
    }
}

/// Minimal percent-encoding matching JS encodeURIComponent for query parts.
fn urlencode_query(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(*byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn looks_like_search_query(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Already a valid URL with an allowed protocol → not a search.
    if let Ok(u) = Url::parse(trimmed) {
        let proto = protocol_of(&u);
        if ALLOWED_PROTOCOLS.contains(&proto.as_str()) {
            return false;
        }
    }

    if trimmed.chars().any(char::is_whitespace) {
        return true;
    }

    // No `.` in the host portion (before the first `/`) → search.
    let host_part = trimmed.split('/').next().unwrap_or(trimmed);
    if !host_part.contains('.') {
        return true;
    }

    false
}

fn protocol_of(u: &Url) -> String {
    format!("{}:", u.scheme()).to_lowercase()
}

/// Port of `normalizeAddressBarInput`.
pub fn normalize_address_bar_input(raw: &str) -> NormalizedUrl {
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return NormalizedUrl::rejected("empty");
    }

    // Step 1 — try as URL.
    if let Ok(u) = Url::parse(trimmed) {
        let proto = protocol_of(&u);
        if BLOCKED_PROTOCOLS_FROM_ADDRESS_BAR.contains(&proto.as_str()) {
            return NormalizedUrl::rejected(format!("blocked_protocol:{proto}"));
        }
        if ALLOWED_PROTOCOLS.contains(&proto.as_str()) {
            return NormalizedUrl {
                url: Some(u.to_string()),
                reason: None,
                is_search: false,
            };
        }
        // Unknown protocol → fall through to search heuristic.
    }

    // Step 2 — search query?
    if looks_like_search_query(trimmed) {
        return NormalizedUrl {
            url: Some(get_search_url(trimmed)),
            reason: None,
            is_search: true,
        };
    }

    // Step 3 — bare hostname upgrade.
    let upgraded = format!("https://{trimmed}");
    if let Ok(u) = Url::parse(&upgraded) {
        if ALLOWED_PROTOCOLS.contains(&protocol_of(&u).as_str()) {
            return NormalizedUrl {
                url: Some(u.to_string()),
                reason: None,
                is_search: false,
            };
        }
    }

    NormalizedUrl::rejected("unparseable")
}

/// Port of `canonicalizeForHistory` — strip the hash fragment.
pub fn canonicalize_for_history(input: &str) -> String {
    match Url::parse(input) {
        Ok(mut u) => {
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => input.to_string(),
    }
}

/// WebView2 surfaces custom-scheme pages in canonical display form
/// (`http://pab.newtab/` for `pab://newtab`). Map that form back to the
/// canonical `pab://` URL so state, session and history stay consistent.
pub fn canonicalize_internal_url(input: &str) -> String {
    if let Ok(u) = Url::parse(input) {
        if u.scheme() == "http" || u.scheme() == "https" {
            if let Some(host) = u.host_str() {
                if let Some(page) = host.strip_prefix("pab.") {
                    if !page.is_empty() {
                        let mut out = format!("pab://{page}{}", u.path());
                        if let Some(q) = u.query() {
                            out.push('?');
                            out.push_str(q);
                        }
                        return out;
                    }
                }
            }
        }
    }
    input.to_string()
}

/// Inverse of `canonicalize_internal_url`: pab:// → the WebView2 display
/// form it actually navigates against (http://pab.<page>/…). Needed because
/// WebView2's Navigate() silently drops custom-scheme URIs.
pub fn to_webview_display_url(input: &str) -> Result<String, url::ParseError> {
    let u = Url::parse(input)?;
    if u.scheme() == "pab" {
        let page = u.host_str().unwrap_or("newtab");
        let mut out = format!("http://pab.{page}/");
        if !u.path().is_empty() && u.path() != "/" {
            out = format!("http://pab.{page}{}", u.path());
        }
        if let Some(q) = u.query() {
            out.push('?');
            out.push_str(q);
        }
        return Ok(out);
    }
    Ok(u.to_string())
}

/// Port of `shouldPersistHistory` (incognito-policy.ts): internal pages and
/// loopback service URLs are not real visits — never recorded in history.
pub fn should_persist_history(url: &str) -> bool {
    if url.starts_with("pab:") {
        return false;
    }
    if let Ok(u) = Url::parse(url) {
        if u.scheme() == "http" || u.scheme() == "https" {
            if let Some(host) = u.host_str() {
                if host == "127.0.0.1" || host == "localhost" {
                    return false;
                }
            }
        }
    }
    true
}

/// Port of `@shared/tab-unread.ts parseUnreadTitle` — "(N)"/"[N]" prefix
/// marker, capped at 3 digits with optional trailing `+`.
pub fn parse_unread_title(raw: &str) -> (u64, String) {
    if raw.is_empty() {
        return (0, raw.to_string());
    }
    let bytes = raw.as_bytes();
    let close = match bytes[0] {
        b'(' => b')',
        b'[' => b']',
        _ => return (0, raw.to_string()),
    };
    // Marker digits: up to 3 ASCII digits + optional '+'.
    let mut i = 1;
    let mut digits = String::new();
    while i < bytes.len() && bytes[i].is_ascii_digit() && digits.len() < 3 {
        digits.push(bytes[i] as char);
        i += 1;
    }
    if digits.is_empty() {
        return (0, raw.to_string());
    }
    let plus = i < bytes.len() && bytes[i] == b'+';
    if plus {
        i += 1;
    }
    if i >= bytes.len() || bytes[i] != close {
        return (0, raw.to_string());
    }
    // After the closing bracket the TS regex requires `\s+`.
    let rest = &raw[i + 1..];
    if !rest.starts_with(|c: char| c.is_whitespace()) {
        return (0, raw.to_string());
    }
    let value: u64 = digits.parse().unwrap_or(0);
    if value == 0 {
        return (0, raw.to_string());
    }
    (value, rest.trim_start().to_string())
}

/// Allow-navigation policy for tab webviews (`on_navigation`).
pub fn navigation_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about" | "pab" | "file")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bare_hostnames() {
        let r = normalize_address_bar_input("example.com");
        assert_eq!(r.url.as_deref(), Some("https://example.com/"));
        assert!(!r.is_search);
    }

    #[test]
    fn treats_free_text_as_search() {
        let r = normalize_address_bar_input("hello world");
        assert!(r.is_search);
        assert!(r.url.unwrap().contains("hello%20world"));
    }

    #[test]
    fn keeps_https_urls() {
        let r = normalize_address_bar_input("https://github.com/explore");
        assert_eq!(r.url.as_deref(), Some("https://github.com/explore"));
    }

    #[test]
    fn blocks_script_urls_from_address_bar() {
        let r = normalize_address_bar_input("javascript:alert(1)");
        assert!(r.url.is_none());
        assert!(r.reason.unwrap().contains("blocked_protocol"));
    }

    #[test]
    fn canonicalization_strips_hash() {
        assert_eq!(
            canonicalize_for_history("https://a.io/x#section"),
            "https://a.io/x"
        );
    }

    #[test]
    fn internal_url_display_form_maps_back() {
        assert_eq!(
            canonicalize_internal_url("http://pab.newtab/"),
            "pab://newtab/"
        );
        assert_eq!(
            canonicalize_internal_url("http://pab.newtab/api/news"),
            "pab://newtab/api/news"
        );
        assert_eq!(
            canonicalize_internal_url("https://pab.search/?q=hi"),
            "pab://search/?q=hi"
        );
        // Unrelated URLs pass through untouched.
        assert_eq!(
            canonicalize_internal_url("https://example.com/x"),
            "https://example.com/x"
        );
    }

    #[test]
    fn history_policy_excludes_internal_and_loopback() {
        assert!(!should_persist_history("pab://newtab"));
        assert!(!should_persist_history("http://127.0.0.1:3000/x"));
        assert!(!should_persist_history("http://localhost:8888/search"));
        assert!(should_persist_history("https://example.com/"));
    }

    #[test]
    fn pab_display_form_for_navigate() {
        assert_eq!(
            to_webview_display_url("pab://search").unwrap(),
            "http://pab.search/"
        );
        assert_eq!(
            to_webview_display_url("pab://search?q=hi").unwrap(),
            "http://pab.search/?q=hi"
        );
        assert_eq!(
            to_webview_display_url("pab://darkweb").unwrap(),
            "http://pab.darkweb/"
        );
        // non-pab passes through
        assert_eq!(
            to_webview_display_url("https://example.com/x").unwrap(),
            "https://example.com/x"
        );
    }

    #[test]
    fn parses_unread_markers() {
        assert_eq!(
            parse_unread_title("(3) WhatsApp"),
            (3, "WhatsApp".to_string())
        );
        assert_eq!(
            parse_unread_title("[9+] Telegram"),
            (9, "Telegram".to_string())
        );
        assert_eq!(
            parse_unread_title("Plain title"),
            (0, "Plain title".to_string())
        );
        assert_eq!(parse_unread_title("(x) bad"), (0, "(x) bad".to_string()));
    }
}
