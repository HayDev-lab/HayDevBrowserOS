//! HayDev Shield (PROMPT 07) — REAL network-level request blocking for tab
//! webviews through WebView2 WebResourceRequested, attached before navigation.
//!
//! Honesty contract:
//! - a block supplies a native 403 response before the request leaves WebView2;
//! - this is a BASIC domain blocklist (embedded defaults + optional user
//!   file), NOT "полный uBlock": no cosmetic filtering, no filter-list
//!   subscription ecosystem. The UI says exactly that;
//! - site exceptions (allowlist) are explicit and persisted;
//! - the extension path (uBO into WebView2) is documented as incompatible
//!   with the current stack (wry exposes no AddBrowserExtension API) —
//!   DECISIONS #18.
//! - no TLS MITM, no root certificates, no system proxy, no firewall rules.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde_json::json;

/// Basic embedded blocklist — well-known ad/tracker domains (suffix match).
/// Deliberately small and conservative: login/OAuth flows must not break.
pub const DEFAULT_BLOCKLIST: &[&str] = &[
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "google-analytics.com",
    "googletagmanager.com",
    "adservice.google.com",
    "pagead2.googlesyndication.com",
    "analytics.tiktok.com",
    "ads-twitter.com",
    "static.ads-twitter.com",
    "adnxs.com",
    "adsrvr.org",
    "amazon-adsystem.com",
    "criteo.com",
    "criteo.net",
    "scorecardresearch.com",
    "quantserve.com",
    "quantcount.com",
    "hotjar.com",
    "hotjar.io",
    "mixpanel.com",
    "segment.io",
    "segment.com",
    "fullstory.com",
    "clarity.ms",
    "mc.yandex.ru",
    "an.yandex.ru",
    "adfox.ru",
    "ads.example",       // E2E fixture host (reserved TLD, never resolves)
    "tracker.example",   // E2E fixture host
    "adhost.example",    // E2E fixture host
];

#[derive(Default)]
pub struct ShieldState {
    pub enabled: AtomicBool,
    pub attached: Mutex<HashSet<String>>,
    /// host → blocked request count (blocked REQUEST host, not page host).
    pub by_host: Mutex<Vec<(String, u64)>>,
    pub total: AtomicU64,
    /// Site exceptions (suffix match, same rule shape as the blocklist).
    pub allow: Mutex<HashSet<String>>,
    pub store_error: Mutex<Option<String>>,
    store_path: std::path::PathBuf,
}

pub type SharedShield = std::sync::Arc<ShieldState>;

pub fn new_shield(enabled: bool) -> SharedShield {
    let store_path = allow_path();
    let mut store_error = None;
    let allow = match crate::atomic_store::transaction(&store_path).and_then(|t| t.read_json::<serde_json::Value>()) {
        Ok(value) => value.and_then(|v| v.get("allow").and_then(|a| a.as_array()).cloned()).unwrap_or_default().into_iter().filter_map(|v| v.as_str().map(str::to_owned)).collect(),
        Err(e) => { store_error = Some(e.code); HashSet::new() }
    };
    std::sync::Arc::new(ShieldState {
        enabled: AtomicBool::new(enabled),
        attached: Mutex::new(HashSet::new()),
        by_host: Mutex::new(Vec::new()),
        total: AtomicU64::new(0),
        allow: Mutex::new(allow), store_error: Mutex::new(store_error), store_path,
    })
}

fn allow_path() -> std::path::PathBuf {
    // Unit tests share the process env — keep their fixture file in the
    // temp dir so the real user allowlist is never touched.
    #[cfg(test)]
    {
        std::env::temp_dir().join(format!("haydev-shield-test-{}.json", uuid::Uuid::new_v4()))
    }
    #[cfg(not(test))]
    {
        crate::lib_app_data_dir().join("shield-allow.json")
    }
}

/// Suffix match: `host` equals the rule or is a subdomain of it.
fn host_matches(host: &str, rule: &str) -> bool {
    let host = host.trim_matches('.').to_ascii_lowercase();
    let rule = rule.trim_matches('.').to_ascii_lowercase();
    host == rule || host.ends_with(&format!(".{rule}"))
}

/// The decision function: should this request host be blocked?

/// The ONE decision function: should this request host be blocked?
pub fn should_block(state: &ShieldState, host: &str) -> bool {
    if !state.enabled.load(Ordering::SeqCst) {
        return false;
    }
    {
        let allow = state.allow.lock().unwrap_or_else(|p| p.into_inner());
        if allow.iter().any(|rule| host_matches(host, rule)) {
            return false;
        }
    }
    DEFAULT_BLOCKLIST.iter().any(|rule| host_matches(host, rule))
}

/// Exceptions belong to the top-level site being visited, not the tracker.
pub fn should_block_on_site(state: &ShieldState, request_host: &str, page_host: &str) -> bool {
    if !state.enabled.load(Ordering::SeqCst) { return false; }
    if state.allow.lock().unwrap_or_else(|p| p.into_inner()).iter().any(|rule| host_matches(page_host, rule)) { return false; }
    DEFAULT_BLOCKLIST.iter().any(|rule| host_matches(request_host, rule))
}

/// Record a REAL block only after WebResourceRequested.SetResponse succeeds.
pub fn record_block(state: &ShieldState, host: &str) {
    state.total.fetch_add(1, Ordering::SeqCst);
    let mut by_host = state.by_host.lock().unwrap_or_else(|p| p.into_inner());
    match by_host.iter_mut().find(|(h, _)| h == host) {
        Some((_, n)) => *n += 1,
        None => by_host.push((host.to_string(), 1)),
    }
}

/// Allow a site. Returns the FINAL state (true = the host is now allowed),
/// so repeated calls stay honest even when the entry already existed.
pub fn allow_site(state: &ShieldState, host: &str) -> bool { update_allow(state, host, true) }
pub fn disallow_site(state: &ShieldState, host: &str) -> bool { update_allow(state, host, false) }
fn update_allow(state: &ShieldState, host: &str, enabled: bool) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || !host.contains('.') || host.contains(['/', '@', ':']) || url::Host::parse(&host).is_err() { return false; }
    let mut live = state.allow.lock().unwrap_or_else(|p| p.into_inner());
    let mut allow = live.clone();
    if enabled { allow.insert(host); } else { allow.remove(&host); }
    let result = crate::atomic_store::transaction(&state.store_path).and_then(|tx| {
        tx.read_json::<serde_json::Value>()?;
        tx.write_json(&json!({"allow":allow}))
    });
    match result {
        Ok(()) => { *live = allow; *state.store_error.lock().unwrap_or_else(|p| p.into_inner()) = None; true },
        Err(e) => { *state.store_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(e.code); false },
    }
}

pub fn status_payload(state: &ShieldState) -> serde_json::Value {
    let by_host = state.by_host.lock().unwrap_or_else(|p| p.into_inner());
    let mut hosts: Vec<serde_json::Value> = by_host
        .iter()
        .map(|(h, n)| json!({ "host": h, "blocked": n }))
        .collect();
    hosts.sort_by(|a, b| {
        b.get("blocked")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            .cmp(&a.get("blocked").and_then(|v| v.as_u64()).unwrap_or(0))
    });
    hosts.truncate(10);
    let allow = state.allow.lock().unwrap_or_else(|p| p.into_inner());
    json!({
        "enabled": state.enabled.load(Ordering::SeqCst),
        "totalBlocked": state.total.load(Ordering::SeqCst),
        "interceptor": "native-webview2",
        "storeError": state.store_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        "protectedTabs": state.attached.lock().unwrap_or_else(|p| p.into_inner()).len(),
        "byHost": hosts,
        "allowlist": allow.iter().cloned().collect::<Vec<_>>(),
        // Honest scope statement for the UI.
        "scope": "basic ad/tracker domain blocklist — not a full uBlock replacement",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shield(enabled: bool) -> SharedShield {
        // Deterministic fixture state: clear the test allowlist file.
        let _ = std::fs::remove_file(allow_path());
        let s = new_shield(false);
        s.enabled.store(enabled, Ordering::SeqCst);
        s
    }

    #[test]
    fn disabled_never_blocks() {
        assert!(!should_block(&shield(false), "doubleclick.net"));
    }

    #[test]
    fn blocklist_suffix_matching() {
        let s = shield(true);
        assert!(should_block(&s, "doubleclick.net"));
        assert!(should_block(&s, "stats.g.doubleclick.net"));
        assert!(should_block(&s, "tracker.example"));
        assert!(!should_block(&s, "notdoubleclick.net"));
        assert!(!should_block(&s, "example.com"));
    }

    #[test]
    fn allowlist_overrides_blocklist() {
        let s = shield(true);
        allow_site(&s, "doubleclick.net");
        assert!(!should_block(&s, "doubleclick.net"));
        assert!(!should_block(&s, "ads.doubleclick.net"));
        assert!(should_block(&s, "criteo.com"), "other rules still apply");
    }

    #[test]
    fn allow_site_rejects_garbage() {
        let s = shield(true);
        assert!(!allow_site(&s, ""));
        assert!(!allow_site(&s, "localhost"));
        assert!(allow_site(&s, "example.com"));
    }

    #[test]
    fn counters_record_real_blocks() {
        let s = shield(true);
        record_block(&s, "doubleclick.net");
        record_block(&s, "doubleclick.net");
        record_block(&s, "criteo.com");
        let st = status_payload(&s);
        assert_eq!(st["totalBlocked"], 3);
        assert_eq!(st["byHost"][0]["host"], "doubleclick.net");
        assert_eq!(st["byHost"][0]["blocked"], 2);
    }
}
