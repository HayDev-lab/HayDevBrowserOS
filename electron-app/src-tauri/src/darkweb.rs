//! DarkWeb search, previews and indexing routed through Tor.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use regex::Regex;
use serde_json::{json, Value};

use crate::socks_http::{self, FetchError};

// ---------------------------------------------------------------------------
// Bounds + defaults (port of darkweb-config.ts hard bounds)
// ---------------------------------------------------------------------------

pub const DEFAULT_SOCKS_PORT: u16 = 9050;
const SEARCH_GLOBAL_TIMEOUT_MS: u64 = 30_000;
const SEARCH_PROVIDER_TIMEOUT_MS: u64 = 15_000;
const SEARCH_MAX_RESULTS: usize = 50;
const AVAILABILITY_MAX_URLS: usize = 12;
const AVAILABILITY_CONCURRENCY: usize = 4;
const AVAILABILITY_TIMEOUT_MS: u64 = 8_000;
const SEARCH_CACHE_TTL_MS: u64 = 600_000;
const FETCH_TIMEOUT_MS: u64 = 25_000;
const FETCH_MAX_BYTES: usize = 2 * 1024 * 1024;
const JOB_TTL_MS: u64 = 10 * 60 * 1000;
const VORMWEB_ID: &str = "vormweb";
pub(crate) const VORMWEB_HOST: &str = "vormweb.de";
const VORMWEB_SEARCH_URL: &str = "https://vormweb.de/en/search";

// ---------------------------------------------------------------------------
// Config (clamped subset; unknown/absent fields keep defaults)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct DarkWebConfig {
    pub enabled: bool,
    pub socks_host: String,
    pub socks_port: u16,
    /// Electron parity (tor.spawnIfAvailable): when Tor is offline, kick an
    /// on-demand managed start (rate-limited) instead of failing closed.
    pub tor_spawn_if_available: bool,
    pub max_results: usize,
    pub provider_timeout_ms: u64,
    pub global_timeout_ms: u64,
    pub cache_ttl_ms: u64,
    pub availability_enabled: bool,
    pub availability_max_urls: usize,
    pub fetch_timeout_ms: u64,
    pub fetch_max_bytes: usize,
    pub vormweb_enabled: bool,
    pub store_search_history: bool,
    pub store_local_index: bool,
    pub crawler_max_depth: u32,
    pub crawler_max_pages: u32,
    // Ranking weights (Electron DARKWEB_HARD_BOUNDS.ranking, clamp 0..10).
    pub rank_provider_count: f64,
    pub rank_title_match: f64,
    pub rank_snippet_match: f64,
    pub rank_url_match: f64,
    pub rank_reachable: f64,
    pub rank_freshness: f64,
}

impl Default for DarkWebConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            socks_host: "127.0.0.1".to_string(),
            socks_port: DEFAULT_SOCKS_PORT,
            tor_spawn_if_available: true,
            max_results: SEARCH_MAX_RESULTS,
            provider_timeout_ms: SEARCH_PROVIDER_TIMEOUT_MS,
            global_timeout_ms: SEARCH_GLOBAL_TIMEOUT_MS,
            cache_ttl_ms: SEARCH_CACHE_TTL_MS,
            availability_enabled: true,
            availability_max_urls: AVAILABILITY_MAX_URLS,
            fetch_timeout_ms: FETCH_TIMEOUT_MS,
            fetch_max_bytes: FETCH_MAX_BYTES,
            vormweb_enabled: true,
            store_search_history: true,
            store_local_index: true,
            crawler_max_depth: 1,
            crawler_max_pages: 25,
            rank_provider_count: 3.0,
            rank_title_match: 2.0,
            rank_snippet_match: 0.5,
            rank_url_match: 1.0,
            rank_reachable: 1.5,
            rank_freshness: 0.5,
        }
    }
}

impl DarkWebConfig {
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("darkweb-config.json");
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                let raw: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                Self::from_json(&raw)
            }
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, data_dir: &std::path::Path) {
        let path = data_dir.join("darkweb-config.json");
        let doc = json!({
            "enabled": self.enabled,
            "tor": { "socksHost": self.socks_host, "socksPort": self.socks_port, "spawnIfAvailable": self.tor_spawn_if_available },
            "search": {
                "maxResults": self.max_results,
                "providerTimeoutMs": self.provider_timeout_ms,
                "globalTimeoutMs": self.global_timeout_ms,
                "cacheTtlMs": self.cache_ttl_ms,
                "availability": {
                    "enabled": self.availability_enabled,
                    "maxUrls": self.availability_max_urls,
                },
            },
            "fetch": { "timeoutMs": self.fetch_timeout_ms, "maxBytes": self.fetch_max_bytes },
            "providers": {
                VORMWEB_ID: { "enabled": self.vormweb_enabled },
            },
            "storeSearchHistory": self.store_search_history,
            "storeLocalIndex": self.store_local_index,
            "crawler": { "maxDepth": self.crawler_max_depth, "maxPages": self.crawler_max_pages },
            "ranking": {
                "providerCount": self.rank_provider_count,
                "titleMatch": self.rank_title_match,
                "snippetMatch": self.rank_snippet_match,
                "urlMatch": self.rank_url_match,
                "reachable": self.rank_reachable,
                "freshness": self.rank_freshness,
            },
        });
        let _ = std::fs::write(&path, serde_json::to_string_pretty(&doc).unwrap_or_default());
    }

    fn from_json(raw: &Value) -> Self {
        let mut c = Self::default();
        let get_bool = |v: &Value| v.as_bool();
        let get_u64 = |v: &Value| v.as_u64();
        if let Some(t) = raw.get("tor") {
            if let Some(h) = t.get("socksHost").and_then(Value::as_str) {
                if !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
                    c.socks_host = h.to_string();
                }
            }
            if let Some(p) = t.get("socksPort").and_then(get_u64) {
                c.socks_port = clamp_port(p);
            }
            if let Some(b) = t.get("spawnIfAvailable").and_then(get_bool) {
                c.tor_spawn_if_available = b;
            }
        }
        if let Some(s) = raw.get("search") {
            c.max_results = clamp(s.get("maxResults").and_then(get_u64), 1, 200, c.max_results as u64) as usize;
            c.provider_timeout_ms = clamp(s.get("providerTimeoutMs").and_then(get_u64), 1_000, 60_000, c.provider_timeout_ms);
            c.global_timeout_ms = clamp(s.get("globalTimeoutMs").and_then(get_u64), 3_000, 120_000, c.global_timeout_ms);
            c.cache_ttl_ms = clamp(s.get("cacheTtlMs").and_then(get_u64), 0, 3_600_000, c.cache_ttl_ms);
            if let Some(a) = s.get("availability") {
                c.availability_enabled = a.get("enabled").and_then(get_bool).unwrap_or(c.availability_enabled);
                c.availability_max_urls = clamp(a.get("maxUrls").and_then(get_u64), 0, 50, c.availability_max_urls as u64) as usize;
            }
        }
        if let Some(f) = raw.get("fetch") {
            c.fetch_timeout_ms = clamp(f.get("timeoutMs").and_then(get_u64), 1_000, 120_000, c.fetch_timeout_ms);
            c.fetch_max_bytes = clamp(f.get("maxBytes").and_then(get_u64), 4_096, 10_485_760, c.fetch_max_bytes as u64) as usize;
        }
        if let Some(p) = raw.get("providers") {
            if let Some(provider) = p.get(VORMWEB_ID) {
                c.vormweb_enabled = provider.get("enabled").and_then(get_bool).unwrap_or(c.vormweb_enabled);
            }
        }
        c.apply_index_settings(raw);
        c.enabled = raw.get("enabled").and_then(get_bool).unwrap_or(c.enabled);
        c.store_search_history = raw.get("storeSearchHistory").and_then(get_bool).unwrap_or(c.store_search_history);
        if let Some(r) = raw.get("ranking") {
            let get_f = |v: &Value| v.as_f64();
            c.rank_provider_count = clamp_f64(r.get("providerCount").and_then(get_f), 0.0, 10.0, c.rank_provider_count);
            c.rank_title_match = clamp_f64(r.get("titleMatch").and_then(get_f), 0.0, 10.0, c.rank_title_match);
            c.rank_snippet_match = clamp_f64(r.get("snippetMatch").and_then(get_f), 0.0, 10.0, c.rank_snippet_match);
            c.rank_url_match = clamp_f64(r.get("urlMatch").and_then(get_f), 0.0, 10.0, c.rank_url_match);
            c.rank_reachable = clamp_f64(r.get("reachable").and_then(get_f), 0.0, 10.0, c.rank_reachable);
            c.rank_freshness = clamp_f64(r.get("freshness").and_then(get_f), 0.0, 10.0, c.rank_freshness);
        }
        c
    }

    fn apply_index_settings(&mut self, value: &Value) {
        if let Some(enabled) = value.get("storeLocalIndex").and_then(Value::as_bool) {
            self.store_local_index = enabled;
        }
        if let Some(crawler) = value.get("crawler") {
            self.crawler_max_depth = clamp(
                crawler.get("maxDepth").and_then(Value::as_u64), 1, 5, self.crawler_max_depth.into(),
            ) as u32;
            self.crawler_max_pages = clamp(
                crawler.get("maxPages").and_then(Value::as_u64), 1, 200, self.crawler_max_pages.into(),
            ) as u32;
        }
    }

    /// Apply an untrusted settings patch (UI POST /api/settings) with clamps.
    pub fn apply_patch(&mut self, patch: &Value) {
        self.apply_index_settings(patch);
        if let Some(b) = patch.get("enabled").and_then(Value::as_bool) {
            self.enabled = b;
        }
        if let Some(b) = patch.get("storeSearchHistory").and_then(Value::as_bool) {
            self.store_search_history = b;
        }
        if let Some(t) = patch.get("tor") {
            if let Some(p) = t.get("socksPort").and_then(Value::as_u64) {
                self.socks_port = clamp_port(p);
            }
            if let Some(h) = t.get("socksHost").and_then(Value::as_str) {
                let h = h.trim();
                if !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
                    self.socks_host = h.to_string();
                }
            }
            if let Some(b) = t.get("spawnIfAvailable").and_then(Value::as_bool) {
                self.tor_spawn_if_available = b;
            }
        }
        if let Some(s) = patch.get("search") {
            self.max_results = clamp(s.get("maxResults").and_then(Value::as_u64), 1, 200, self.max_results as u64) as usize;
            self.provider_timeout_ms = clamp(s.get("providerTimeoutMs").and_then(Value::as_u64), 1_000, 60_000, self.provider_timeout_ms);
            self.global_timeout_ms = clamp(s.get("globalTimeoutMs").and_then(Value::as_u64), 3_000, 120_000, self.global_timeout_ms);
            self.cache_ttl_ms = clamp(s.get("cacheTtlMs").and_then(Value::as_u64), 0, 3_600_000, self.cache_ttl_ms);
            if let Some(a) = s.get("availability") {
                if let Some(b) = a.get("enabled").and_then(Value::as_bool) {
                    self.availability_enabled = b;
                }
                self.availability_max_urls = clamp(a.get("maxUrls").and_then(Value::as_u64), 0, 50, self.availability_max_urls as u64) as usize;
            }
        }
        if let Some(f) = patch.get("fetch") {
            self.fetch_timeout_ms = clamp(f.get("timeoutMs").and_then(Value::as_u64), 1_000, 120_000, self.fetch_timeout_ms);
            self.fetch_max_bytes = clamp(f.get("maxBytes").and_then(Value::as_u64), 4_096, 10_485_760, self.fetch_max_bytes as u64) as usize;
        }
        if let Some(p) = patch.get("providers") {
            if let Some(enabled) = p.get(VORMWEB_ID).and_then(|v| v.get("enabled")).and_then(Value::as_bool) {
                self.vormweb_enabled = enabled;
            }
        }
        if let Some(r) = patch.get("ranking") {
            self.rank_provider_count = clamp_f64(r.get("providerCount").and_then(Value::as_f64), 0.0, 10.0, self.rank_provider_count);
            self.rank_title_match = clamp_f64(r.get("titleMatch").and_then(Value::as_f64), 0.0, 10.0, self.rank_title_match);
            self.rank_snippet_match = clamp_f64(r.get("snippetMatch").and_then(Value::as_f64), 0.0, 10.0, self.rank_snippet_match);
            self.rank_url_match = clamp_f64(r.get("urlMatch").and_then(Value::as_f64), 0.0, 10.0, self.rank_url_match);
            self.rank_reachable = clamp_f64(r.get("reachable").and_then(Value::as_f64), 0.0, 10.0, self.rank_reachable);
            self.rank_freshness = clamp_f64(r.get("freshness").and_then(Value::as_f64), 0.0, 10.0, self.rank_freshness);
        }
    }

    /// UI echo (parity: getConfig / redacted).
    pub fn to_json(&self) -> Value {
        json!({
            "enabled": self.enabled,
            "tor": { "socksHost": self.socks_host, "socksPort": self.socks_port, "spawnIfAvailable": self.tor_spawn_if_available, "binaryPath": null },
            "search": {
                "globalTimeoutMs": self.global_timeout_ms,
                "providerTimeoutMs": self.provider_timeout_ms,
                "maxResults": self.max_results,
                "cacheTtlMs": self.cache_ttl_ms,
                "availability": { "enabled": self.availability_enabled, "maxUrls": self.availability_max_urls },
            },
            "fetch": { "timeoutMs": self.fetch_timeout_ms, "maxBytes": self.fetch_max_bytes },
            "providers": {
                VORMWEB_ID: { "enabled": self.vormweb_enabled },
            },
            "storeSearchHistory": self.store_search_history,
            "storeLocalIndex": self.store_local_index,
            "crawler": { "maxDepth": self.crawler_max_depth, "maxPages": self.crawler_max_pages },
            "ranking": {
                "providerCount": self.rank_provider_count,
                "titleMatch": self.rank_title_match,
                "snippetMatch": self.rank_snippet_match,
                "urlMatch": self.rank_url_match,
                "reachable": self.rank_reachable,
                "freshness": self.rank_freshness,
            },
        })
    }
}

fn clamp_f64(v: Option<f64>, min: f64, max: f64, default: f64) -> f64 {
    v.unwrap_or(default).clamp(min, max)
}

fn clamp_port(p: u64) -> u16 {
    p.clamp(1, 65_535) as u16
}

fn clamp(v: Option<u64>, min: u64, max: u64, default: u64) -> u64 {
    v.unwrap_or(default).clamp(min, max)
}

// ---------------------------------------------------------------------------
// Provider health (circuit breaker, port of provider-health.ts semantics)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Clone)]
pub struct ProviderHealth {
    pub last_latency_ms: Option<u64>,
    pub last_success_at: Option<u64>,
    pub last_failure_at: Option<u64>,
    pub consecutive_failures: u32,
    pub circuit_open_until: Option<u64>,
}

const CIRCUIT_OPEN_MS: u64 = 60_000;
const CIRCUIT_THRESHOLD: u32 = 3;

impl ProviderHealth {
    pub fn record_success(&mut self, latency: u64, now: u64) {
        self.last_latency_ms = Some(latency);
        self.last_success_at = Some(now);
        self.consecutive_failures = 0;
        self.circuit_open_until = None;
    }

    pub fn record_failure(&mut self, now: u64) {
        self.last_failure_at = Some(now);
        self.consecutive_failures += 1;
        if self.consecutive_failures >= CIRCUIT_THRESHOLD {
            self.circuit_open_until = Some(now + CIRCUIT_OPEN_MS);
        }
    }

    pub fn allows(&self, now: u64) -> bool {
        match self.circuit_open_until {
            Some(until) => now >= until,
            None => true,
        }
    }

    /// HEALTHY | DEGRADED | OFFLINE | UNKNOWN (parity: ProviderHealth).
    pub fn health_label(&self, now: u64) -> &'static str {
        if self.circuit_open_until.is_some_and(|u| now < u) {
            return "OFFLINE";
        }
        match (self.last_success_at, self.last_failure_at) {
            (Some(_), None) => "HEALTHY",
            (None, Some(_)) => "DEGRADED",
            (Some(s), Some(f)) => {
                if f > s {
                    if self.consecutive_failures >= 2 {
                        "DEGRADED"
                    } else {
                        "UNKNOWN"
                    }
                } else {
                    "HEALTHY"
                }
            }
            (None, None) => "UNKNOWN",
        }
    }
}

// ---------------------------------------------------------------------------
// VormWeb response parsing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RawProviderResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub last_seen: Option<u64>,
}

fn unescape_html(s: &str) -> String {
    let stripped = strip_tags(s);
    stripped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// Remove tags (BeautifulSoup .text-ish) + collapse whitespace.
pub fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    collapse_ws(&out)
}

pub fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_vormweb_results(html: &str, limit: usize) -> Result<Vec<RawProviderResult>, &'static str> {
    static COUNT: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?is)<b>\s*<u>([0-9]+)</u>\s*</b>\s*Search results for\b").unwrap()
    });
    static CARD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?is)<div\s+class\s*=\s*["']query-box["'][^>]*>(.*?)</div\s*>"#).unwrap()
    });
    static ANCHOR: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?is)<a\b([^>]*)>(.*?)</a\s*>").unwrap());
    static RESULT_ID: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\sid\s*=\s*(?:"urllink"|'urllink')(?:\s|$)"#).unwrap()
    });
    static HREF: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\shref\s*=\s*(?:"([^"]+)"|'([^']+)')"#).unwrap()
    });
    static SNIPPET: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?is)<li>\s*<i>(.*?)</i>\s*</li\s*>").unwrap());

    let count = COUNT.captures(html)
        .and_then(|capture| capture[1].parse::<usize>().ok())
        .ok_or("PROVIDER_RESPONSE_INVALID")?;
    if count == 0 {
        return Ok(Vec::new());
    }
    let results: Vec<_> = CARD.captures_iter(html)
        .filter_map(|card| {
            let body = card.get(1)?.as_str();
            let anchor = ANCHOR.captures_iter(body).find(|anchor| RESULT_ID.is_match(&anchor[1]))?;
            let href = HREF.captures(&anchor[1])?;
            let url = unescape_html(href.get(1).or_else(|| href.get(2))?.as_str());
            let parsed = url::Url::parse(&url).ok()?;
            if !is_onion_url(&url) || !parsed.host_str().is_some_and(is_v3_onion_host) {
                return None;
            }
            Some(RawProviderResult {
                title: unescape_html(&anchor[2]).chars().take(300).collect(),
                url: parsed.into(),
                snippet: SNIPPET.captures(body)
                    .map(|text| unescape_html(&text[1]).chars().take(2000).collect())
                    .unwrap_or_default(),
                last_seen: None,
            })
        })
        .take(limit)
        .collect();
    if results.is_empty() {
        return Err("PROVIDER_RESPONSE_INVALID");
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Normalize → merge → rank (ports of normalize.ts / rank.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NormalizedResult {
    pub title: String,
    pub url: String,
    pub hostname: String,
    pub snippet: String,
    pub provider: String,
    pub last_seen: Option<u64>,
    pub key: String,
}

pub fn normalize_provider_result(raw: RawProviderResult, provider: &str) -> Option<NormalizedResult> {
    let mut url = raw.url.trim().to_string();
    if url.is_empty() || url.len() > 2048 {
        return None;
    }
    // Accept bare onion addresses from historical index entries and fixtures.
    let has_scheme = {
        let lower = url.to_lowercase();
        lower.contains("://")
    };
    if !has_scheme {
        url = format!("http://{url}");
    }
    let parsed = url::Url::parse(&url).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let hostname = parsed.host_str()?.to_lowercase();
    if !hostname.ends_with(".onion") {
        return None;
    }
    // Result URLs are metadata, not navigation targets — strip creds+hash.
    let mut cleaned = parsed.clone();
    cleaned.set_username("").ok();
    cleaned.set_password(None).ok();
    cleaned.set_fragment(None);
    let key = result_key(&cleaned)?;
    Some(NormalizedResult {
        title: collapse_ws(&raw.title).chars().take(300).collect(),
        url: cleaned.to_string(),
        hostname,
        snippet: collapse_ws(&raw.snippet).chars().take(2000).collect(),
        provider: provider.to_string(),
        last_seen: raw.last_seen,
        key,
    })
}

fn result_key(u: &url::Url) -> Option<String> {
    let mut params: Vec<(String, String)> = u
        .query_pairs()
        .filter(|(k, _)| !k.to_lowercase().starts_with("utm_"))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    params.sort();
    let search = serde_urlencoded(&params);
    let path = u.path().to_string();
    let path = if path.is_empty() { "/".to_string() } else { path.trim_end_matches('/').to_string() };
    let path = if path.is_empty() { "/".to_string() } else { path };
    Some(format!(
        "{}{}{}",
        u.host_str().unwrap_or_default(),
        path,
        if search.is_empty() { String::new() } else { format!("?{search}") }
    ))
}

/// Minimal application/x-www-form-urlencoded serializer (sorted params).
fn serde_urlencoded(params: &[(String, String)]) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Debug, Clone)]
pub struct MergedResult {
    pub title: String,
    pub url: String,
    pub hostname: String,
    pub snippet: String,
    pub providers: Vec<String>,
    pub last_seen: Option<u64>,
    pub key: String,
}

/// Merge by canonical key; longest title/snippet wins (parity: mergeResults).
pub fn merge_results(entries: Vec<NormalizedResult>) -> Vec<MergedResult> {
    let mut order: Vec<String> = Vec::new();
    let mut by_key: HashMap<String, MergedResult> = HashMap::new();
    for e in entries {
        let entry = by_key.entry(e.key.clone()).or_insert_with(|| {
            order.push(e.key.clone());
            MergedResult {
                title: e.title.clone(),
                url: e.url.clone(),
                hostname: e.hostname.clone(),
                snippet: e.snippet.clone(),
                providers: vec![e.provider.clone()],
                last_seen: e.last_seen,
                key: e.key.clone(),
            }
        });
        if !entry.providers.contains(&e.provider) {
            entry.providers.push(e.provider.clone());
        }
        if e.title.len() > entry.title.len() {
            entry.title = e.title;
        }
        if e.snippet.len() > entry.snippet.len() {
            entry.snippet = e.snippet;
        }
        if let Some(ls) = e.last_seen {
            if entry.last_seen.map(|cur| ls > cur).unwrap_or(true) {
                entry.last_seen = Some(ls);
            }
        }
    }
    order.into_iter().filter_map(|k| by_key.remove(&k)).collect()
}

/// Weighted deterministic ranking (parity: rank.ts — weights from CONFIG,
/// Electron defaults providerCount 3 / titleMatch 2 / snippetMatch 0.5 /
/// urlMatch 1 / reachable 1.5 / freshness 0.5).
pub fn rank_results(
    merged: Vec<MergedResult>,
    query: &str,
    reachability: &HashMap<String, (&'static str, Option<u64>)>,
    now: u64,
    config: &DarkWebConfig,
) -> Vec<Value> {
    let (w_provider, w_title, w_snippet, w_url, w_reach, w_fresh) = (
        config.rank_provider_count,
        config.rank_title_match,
        config.rank_snippet_match,
        config.rank_url_match,
        config.rank_reachable,
        config.rank_freshness,
    );
    let terms = extract_query_terms(query);
    let mut scored: Vec<(f64, MergedResult, &'static str, Option<u64>)> = merged
        .into_iter()
        .map(|m| {
            let (reach, checked_at) = reachability
                .get(&m.key)
                .map(|(r, t)| (*r, *t))
                .unwrap_or(("unknown", None));
            let provider_score = m.providers.len().min(5) as f64 * w_provider;
            let title_score = coverage(&terms, &m.title) * w_title;
            let snippet_score = coverage(&terms, &m.snippet) * w_snippet;
            let url_score = coverage(&terms, &m.url) * w_url;
            let reach_factor = match reach {
                "yes" => 1.0,
                "unknown" => 0.4,
                _ => 0.0,
            };
            let reach_score = reach_factor * w_reach;
            let fresh = match m.last_seen {
                Some(ls) if ls > 0 => {
                    let age_days = (now.saturating_sub(ls)) as f64 / 86_400_000.0;
                    0.5f64.powf(age_days / 30.0)
                }
                _ => 0.0,
            };
            let score =
                ((provider_score + title_score + snippet_score + url_score + reach_score + fresh * w_fresh) * 100.0).round() / 100.0;
            (score, m, reach, checked_at)
        })
        .collect();
    scored.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.url.cmp(&b.1.url))
    });
    scored
        .into_iter()
        .map(|(score, m, reach, checked_at)| {
            json!({
                "title": m.title,
                "url": m.url,
                "hostname": m.hostname,
                "snippet": m.snippet,
                "providers": m.providers,
                "score": score,
                "reachable": reach,
                "checkedAt": checked_at,
                "lastSeen": m.last_seen,
            })
        })
        .collect()
}

pub fn extract_query_terms(query: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in query.to_lowercase().split(|c: char| {
        matches!(c, ' ' | ',' | '.' | ';' | ':' | '!' | '?' | '(' | ')' | '"' | '\'')
    }) {
        let t = raw.trim();
        if t.len() >= 2 && seen.insert(t.to_string()) {
            out.push(t.to_string());
        }
    }
    out
}

fn coverage(terms: &[String], text: &str) -> f64 {
    if terms.is_empty() {
        return 0.0;
    }
    let lower = text.to_lowercase();
    let hits = terms.iter().filter(|t| lower.contains(t.as_str())).count();
    hits as f64 / terms.len() as f64
}

// ---------------------------------------------------------------------------
// Tor gateway resolution
// ---------------------------------------------------------------------------

/// Existing Tor endpoint used by configurable private and agent profiles.
pub fn tor_endpoint(app: &tauri::AppHandle<tauri::Wry>, config: &DarkWebConfig) -> Option<(String, u16)> {
    resolve_tor_endpoint(app, config, false)
}

/// DarkWeb uses the owner-checked local relay when the app manages Tor.
pub fn onion_endpoint(app: &tauri::AppHandle<tauri::Wry>, config: &DarkWebConfig) -> Option<(String, u16)> {
    if !config.enabled {
        return None;
    }
    resolve_tor_endpoint(app, config, true)
}

fn resolve_tor_endpoint(
    app: &tauri::AppHandle<tauri::Wry>,
    config: &DarkWebConfig,
    onion_only: bool,
) -> Option<(String, u16)> {
    if std::env::var("HAYDEV_NO_ENGINES").is_ok_and(|v| v.trim() == "1") {
        return None;
    }
    let (endpoint, owned) = crate::runtime_manager::with_manager(app, |s| {
        (s.tor_socks_endpoint(), s.managed_tor_proxy().is_some())
    }).unwrap_or_default();
    if let Some(ep) = endpoint {
        if onion_only && owned {
            return crate::tor_route::managed_endpoint(app).ok();
        }
        if let Some((host, port)) = parse_socks_endpoint(&ep) {
            return Some((host, port));
        }
    }
    // Default DarkWeb uses the managed process. A configured external Tor
    // client must be selected explicitly and listen on loopback.
    let manual_host = if onion_only {
        match (config.tor_spawn_if_available, config.socks_host.as_str()) {
            (false, "127.0.0.1" | "localhost") => Some("127.0.0.1"),
            _ => None,
        }
    } else {
        Some(config.socks_host.as_str())
    };
    if let Some(host) = manual_host.filter(|host| socks_probe(host, config.socks_port)) {
        return Some((host.to_string(), config.socks_port));
    }
    if config.tor_spawn_if_available {
        use tauri::Manager;
        if let Some(manager) = app.try_state::<crate::runtime_manager::SharedRuntimeManager>() {
            crate::runtime_manager::request_tor_start(manager.inner());
        }
    }
    None
}

fn parse_socks_endpoint(ep: &str) -> Option<(String, u16)> {
    let rest = ep.strip_prefix("socks5://")?;
    let (host, port) = rest.rsplit_once(':')?;
    Some((host.to_string(), port.parse().ok()?))
}

pub fn socks_probe(host: &str, port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &format!("{host}:{port}")
            .to_socket_addrs_first()
            .unwrap_or_else(|| std::net::SocketAddr::from(([127, 0, 0, 1], port))),
        Duration::from_millis(400),
    )
    .is_ok()
}

trait ToSocketAddrsFirst {
    fn to_socket_addrs_first(&self) -> Option<std::net::SocketAddr>;
}

impl ToSocketAddrsFirst for String {
    fn to_socket_addrs_first(&self) -> Option<std::net::SocketAddr> {
        use std::net::ToSocketAddrs;
        self.to_socket_addrs().ok()?.next()
    }
}

// ---------------------------------------------------------------------------
// Fetch + text extraction
// ---------------------------------------------------------------------------

pub fn has_onion_host(url: &url::Url) -> bool {
    url.host_str().is_some_and(|host| host.trim_end_matches('.').ends_with(".onion"))
}

pub(crate) fn is_v3_onion_host(host: &str) -> bool {
    let Some(name) = host.trim_end_matches('.').strip_suffix(".onion") else {
        return false;
    };
    let Some(service) = name.rsplit('.').next() else {
        return false;
    };
    host.len() <= 253
        && service.len() == 56
        && service.bytes().all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
        && name.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

pub fn is_onion_url(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && has_onion_host(&url)
    })
}

pub fn extract_title(html: &str) -> Option<String> {
    let re = Regex::new(r"(?is)<title[^>]*>(.*?)</title\s*>").ok()?;
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| unescape_html(m.as_str()).chars().take(300).collect())
}

/// Sanitize fetched HTML into an allowlisted, script-free fragment for the
/// darkweb preview overlay — port of the Electron preview sanitizer
/// (html-extract.ts): every tag outside the allowlist is dropped, ALL
/// attributes disappear except a[href] with http(s) URLs, and ammonia
/// forces rel="noopener noreferrer" on the surviving links. The page
/// renders the fragment in a sandbox="" iframe — belt and braces.
pub fn sanitize_for_preview(html: &str) -> String {
    use std::collections::{HashMap, HashSet};
    let capped: String = html.chars().take(200_000).collect();
    let tags: HashSet<&str> = [
        "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "blockquote", "pre", "code",
        "b", "strong", "i", "em", "u", "s",
        "table", "thead", "tbody", "tr", "th", "td", "a",
    ]
    .into_iter()
    .collect();
    let mut tag_attributes: HashMap<&str, HashSet<&str>> = HashMap::new();
    tag_attributes.insert("a", ["href"].into_iter().collect());
    let schemes: HashSet<&str> = ["http", "https"].into_iter().collect();
    ammonia::Builder::new()
        .tags(tags)
        .tag_attributes(tag_attributes)
        .url_schemes(schemes)
        .strip_comments(true)
        .clean(&capped)
        .to_string()
}

/// Sanitized HTML preview (parity: fetchPreview → {url, finalUrl, title,
/// html, status, contentType}); the page renders `html` via srcdoc in a
/// sandboxed iframe.
pub fn fetch_preview_html(
    app: &tauri::AppHandle<tauri::Wry>,
    config: &DarkWebConfig,
    url: &str,
) -> Result<Value, String> {
    if !is_onion_url(url) {
        return Err("ONION_ONLY".to_string());
    }
    let Some((host, port)) = onion_endpoint(app, config) else {
        return Err("TOR_UNAVAILABLE".to_string());
    };
    let resp = socks_http::get_via_socks5(&host, port, url, config.fetch_timeout_ms, config.fetch_max_bytes)
        .map_err(|e: FetchError| e.code().to_string())?;
    Ok(json!({
        "url": url,
        "finalUrl": resp.final_url,
        "title": extract_title(&resp.text),
        "html": sanitize_for_preview(&resp.text),
        "status": resp.status,
        "contentType": resp.content_type,
    }))
}

/// onion-only fetch through the Tor gateway (parity: fetcher.ts bounds).
pub fn fetch_page(
    app: &tauri::AppHandle<tauri::Wry>,
    config: &DarkWebConfig,
    url: &str,
    mode: &str,
) -> Result<Value, String> {
    if !is_onion_url(url) {
        return Err("ONION_ONLY".to_string());
    }
    let Some((host, port)) = onion_endpoint(app, config) else {
        return Err("TOR_UNAVAILABLE".to_string());
    };
    let started = now_ms();
    let resp = socks_http::get_via_socks5(&host, port, url, config.fetch_timeout_ms, config.fetch_max_bytes)
        .map_err(|e: FetchError| e.code().to_string())?;
    let truncated = resp.text.len() >= config.fetch_max_bytes;
    let bytes = resp.text.len();
    Ok(json!({
        "url": url,
        "finalUrl": resp.final_url,
        "status": resp.status,
        "contentType": resp.content_type,
        "text": if mode == "metadata" { Value::Null } else { json!(resp.text.chars().take(100_000).collect::<String>()) },
        "title": extract_title(&resp.text),
        "bytes": bytes,
        "durationMs": now_ms().saturating_sub(started),
        "truncated": truncated,
        "untrustedContent": true,
    }))
}

/// Bounded availability probe ('yes' | 'no' | 'unknown' — an offline Tor
/// gateway proves NOTHING, so it reports 'unknown', never a false 'no').
pub fn check_reachable(
    app: &tauri::AppHandle<tauri::Wry>,
    config: &DarkWebConfig,
    url: &str,
) -> (&'static str, Option<u64>) {
    if !is_onion_url(url) {
        return ("unknown", None);
    }
    let Some((host, port)) = onion_endpoint(app, config) else {
        return ("unknown", None);
    };
    match socks_http::get_via_socks5(&host, port, url, AVAILABILITY_TIMEOUT_MS, 1024) {
        Ok(resp) if resp.status < 400 => ("yes", Some(now_ms())),
        Ok(_) => ("no", Some(now_ms())),
        Err(FetchError::TorUnavailable(_)) => ("unknown", None),
        Err(_) => ("no", Some(now_ms())),
    }
}

// ---------------------------------------------------------------------------
// Search service (jobs + cache + history)
// ---------------------------------------------------------------------------

pub struct SearchJob {
    pub id: String,
    pub query: String,
    cache_key: String,
    pub state: &'static str,
    pub results: Vec<Value>,
    pub providers: HashMap<String, Value>,
    /// Raw provider results parked between settlement and finalize.
    pub raw: Vec<NormalizedResult>,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub error_code: Option<String>,
    pub cancelled: bool,
    pub settled: usize,
    pub registered: usize,
    /// Provider ids this job waits on (for the global-timeout report).
    pub registered_ids: Vec<String>,
    /// Finalize runs exactly once (late provider settles after a forced
    /// global-timeout finalize must not re-rank/re-cache/re-chronicle).
    pub finalized: bool,
}

impl SearchJob {
    pub fn snapshot(&self, now: u64) -> Value {
        json!({
            "searchId": self.id,
            "query": self.query,
            "state": self.state,
            "results": self.results,
            "providers": self.providers,
            "total": self.results.len(),
            "durationMs": (self.ended_at.unwrap_or(now)).saturating_sub(self.started_at),
            "errorCode": self.error_code,
        })
    }

    fn pending_raw(&mut self, raw: Vec<NormalizedResult>) {
        self.raw.extend(raw);
    }

    fn take_raw(&mut self) -> Vec<NormalizedResult> {
        std::mem::take(&mut self.raw)
    }
}

pub struct DarkWebService {
    pub data_dir: std::path::PathBuf,
    pub config: Mutex<DarkWebConfig>,
    pub health: Mutex<HashMap<String, ProviderHealth>>,
    pub jobs: Mutex<HashMap<String, Arc<Mutex<SearchJob>>>>,
    pub cache: Mutex<HashMap<String, (Value, u64)>>,
    pub history: Mutex<Vec<Value>>,
    pub job_seq: AtomicU64,
}

const MAX_JOBS: usize = 24;
const MAX_CACHE: usize = 50;
const MAX_HISTORY: usize = 100;

impl DarkWebService {
    pub fn new(data_dir: &std::path::Path) -> Self {
        let config = DarkWebConfig::load(data_dir);
        let history = std::fs::read_to_string(data_dir.join("darkweb-history.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| {
                v.get("entries")
                    .and_then(Value::as_array)
                    .cloned()
            })
            .unwrap_or_default();
        Self {
            data_dir: data_dir.to_path_buf(),
            config: Mutex::new(config),
            health: Mutex::new(HashMap::new()),
            jobs: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
            history: Mutex::new(history),
            job_seq: AtomicU64::new(1),
        }
    }

    pub fn config(&self) -> DarkWebConfig {
        self.config.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// Start a search — returns the initial job snapshot; providers run on
    /// worker threads and the page polls GET /api/search/:id (parity with
    /// the Electron flow).
    pub fn search(
        self: &Arc<Self>,
        app: &tauri::AppHandle<tauri::Wry>,
        query: &str,
        providers_filter: Option<Vec<String>>,
    ) -> Result<Value, String> {
        let config = self.config();
        if !config.enabled {
            return Err("DARKWEB_DISABLED".to_string());
        }
        let query = query.trim().to_string();
        if query.is_empty() {
            return Err("EMPTY_QUERY".to_string());
        }
        if query.chars().count() < 3 {
            return Err("QUERY_TOO_SHORT".to_string());
        }
        if query.len() > 512 {
            return Err("QUERY_TOO_LONG".to_string());
        }

        let selected: Vec<&str> = [(VORMWEB_ID, config.vormweb_enabled)]
            .into_iter()
            .filter(|(id, enabled)| {
                *enabled && providers_filter.as_ref().is_none_or(|filter| filter.iter().any(|p| p == id))
            })
            .map(|(id, _)| id)
            .collect();
        if selected.is_empty() {
            return Err("NO_PROVIDERS_ENABLED".to_string());
        }

        // The provider request is tied to the Tor route resolved here.
        let tor = onion_endpoint(app, &config).ok_or("TOR_UNAVAILABLE")?;
        let now = now_ms();
        let cache_key = format!("{}|{}", query.to_lowercase(), selected.join(","));
        if config.cache_ttl_ms > 0 {
            let cache = self.cache.lock().unwrap_or_else(|p| p.into_inner());
            if let Some((snap, expires)) = cache.get(&cache_key) {
                if now < *expires {
                    return Ok(snap.clone());
                }
            }
        }
        let runnable: Vec<_> = {
            let health = self.health.lock().unwrap_or_else(|p| p.into_inner());
            selected.into_iter()
                .filter(|id| health.get(*id).is_none_or(|provider| provider.allows(now)))
                .collect()
        };

        let job_id = format!("s_{}_{}", now, self.job_seq.fetch_add(1, Ordering::Relaxed));
        let job = Arc::new(Mutex::new(SearchJob {
            id: job_id.clone(),
            query: query.clone(),
            cache_key,
            state: "SEARCHING",
            results: Vec::new(),
            providers: HashMap::new(),
            raw: Vec::new(),
            started_at: now,
            ended_at: None,
            error_code: None,
            cancelled: false,
            settled: 0,
            registered: runnable.len(),
            registered_ids: runnable.iter().map(|id| id.to_string()).collect(),
            finalized: false,
        }));
        {
            let mut jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
            jobs.retain(|_, j| {
                let j = j.lock().unwrap_or_else(|p| p.into_inner());
                !matches!(j.state, "DONE" | "ERROR" | "CANCELLED")
                    || j.ended_at.map(|e| now.saturating_sub(e) < JOB_TTL_MS).unwrap_or(true)
            });
            while jobs.len() >= MAX_JOBS {
                let oldest = jobs.keys().next().cloned();
                match oldest {
                    Some(k) => {
                        jobs.remove(&k);
                    }
                    None => break,
                }
            }
            jobs.insert(job_id.clone(), job.clone());
        }

        if runnable.is_empty() {
            {
                let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
                j.state = "ERROR";
                j.ended_at = Some(now);
                j.error_code = Some("EXTERNAL_PROVIDER_UNAVAILABLE".to_string());
            }
            return Ok(job.lock().unwrap_or_else(|p| p.into_inner()).snapshot(now));
        }

        // Fire the workers; each records its own report, the LAST settler
        // finalizes (merge → rank → availability → cache → history).
        for id in runnable {
            let job_ref = job.clone();
            let service = self.clone();
            let app_w = app.clone();
            let cfg_w = config.clone();
            let tor = tor.clone();
            let query_w = query.clone();
            let provider_id = id.to_string();
            std::thread::spawn(move || {
                let started = now_ms();
                let result = vormweb_search(&tor, &cfg_w, &query_w);
                let duration = now_ms().saturating_sub(started);
                // Budget: provider work beyond providerTimeoutMs abandons its
                // results (the thread may still be blocked in the socket read;
                // its output is then ignored).
                let on_time = duration <= cfg_w.provider_timeout_ms;
                match result {
                    Ok(raw) if on_time => {
                        let count = raw.len();
                        if !job_ref.lock().unwrap_or_else(|p| p.into_inner()).cancelled {
                            service.push_raw(&job_ref, &provider_id, raw);
                        }
                        service.record_provider(&job_ref, &provider_id, "ok", duration, count, None);
                    }
                    Ok(_) => {
                        service.record_provider(&job_ref, &provider_id, "timeout", duration, 0, Some("PROVIDER_TIMEOUT".to_string()));
                    }
                    Err(code) => {
                        let status = if code == "TOR_UNAVAILABLE" { "no_tor" } else if on_time { "error" } else { "timeout" };
                        service.record_provider(&job_ref, &provider_id, status, duration, 0, Some(code));
                    }
                }
                service.maybe_finalize(&app_w, &cfg_w, &job_ref);
            });
        }

        // Global budget watchdog (Electron parity: globalTimeoutMs). Rust
        // threads cannot be killed — instead, when the budget is exhausted
        // the job is force-finalized with whatever arrived; provider threads
        // still blocked in a socket read settle later and are ignored via
        // the `finalized` guard in maybe_finalize.
        {
            let job_w = job.clone();
            let service_w = self.clone();
            let app_w = app.clone();
            let cfg_w = config.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(
                    cfg_w.global_timeout_ms.max(1),
                ));
                {
                    let mut j = job_w.lock().unwrap_or_else(|p| p.into_inner());
                    if j.finalized || j.cancelled || j.ended_at.is_some() {
                        return;
                    }
                    // Providers that never settled report a GLOBAL timeout.
                    // No circuit-breaker penalty — the budget is ours, not a
                    // provider failure (honest health bookkeeping).
                    let started_at = j.started_at;
                    for id in j.registered_ids.clone() {
                        if !j.providers.contains_key(&id) {
                            j.providers.insert(
                                id.clone(),
                                json!({
                                    "id": id,
                                    "status": "timeout",
                                    "durationMs": now_ms().saturating_sub(started_at),
                                    "resultCount": 0,
                                    "errorCode": "GLOBAL_TIMEOUT",
                                }),
                            );
                        }
                    }
                    j.settled = j.registered;
                }
                service_w.maybe_finalize(&app_w, &cfg_w, &job_w);
            });
        }

        let initial = job.lock().unwrap_or_else(|p| p.into_inner()).snapshot(now);
        Ok(initial)
    }

    fn record_provider(
        &self,
        job: &Arc<Mutex<SearchJob>>,
        id: &str,
        status: &str,
        duration_ms: u64,
        count: usize,
        error_code: Option<String>,
    ) {
        {
            let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
            if j.cancelled || j.finalized || j.providers.contains_key(id) {
                return;
            }
            j.providers.insert(
                id.to_string(),
                json!({
                    "id": id,
                    "status": status,
                    "durationMs": duration_ms,
                    "resultCount": count,
                    "errorCode": error_code,
                }),
            );
            j.settled += 1;
            if !j.cancelled && j.settled < j.registered && j.state == "SEARCHING" {
                j.state = "PARTIAL_RESULTS";
            }
        }
        let mut health = self.health.lock().unwrap_or_else(|p| p.into_inner());
        let h = health.entry(id.to_string()).or_default();
        let now = now_ms();
        if status == "ok" {
            h.record_success(duration_ms, now);
        } else {
            h.record_failure(now);
        }
    }

    fn push_raw(&self, job: &Arc<Mutex<SearchJob>>, provider: &str, raw: Vec<RawProviderResult>) {
        let normalized: Vec<NormalizedResult> = raw
            .into_iter()
            .filter_map(|r| normalize_provider_result(r, provider))
            .collect();
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        if !j.cancelled && !j.finalized {
            j.pending_raw(normalized);
        }
    }

    /// Finalize when every provider settled: merge → rank → availability →
    /// cache → history.
    fn maybe_finalize(&self, app: &tauri::AppHandle<tauri::Wry>, config: &DarkWebConfig, job: &Arc<Mutex<SearchJob>>) {
        let (settled, registered, cancelled) = {
            let j = job.lock().unwrap_or_else(|p| p.into_inner());
            (j.settled, j.registered, j.cancelled)
        };
        if settled < registered {
            return;
        }
        let now = now_ms();
        let (merged, query, search_id, cache_key) = {
            let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
            if j.finalized {
                return;
            }
            j.finalized = true;
            if cancelled || j.cancelled {
                j.state = "CANCELLED";
                j.ended_at = Some(now);
                return;
            }
            if !j.providers.values().any(|provider| provider["status"] == "ok") {
                j.state = "ERROR";
                j.ended_at = Some(now);
                j.error_code = j.providers.values()
                    .find_map(|provider| provider["errorCode"].as_str().map(str::to_owned))
                    .or_else(|| Some("EXTERNAL_PROVIDER_UNAVAILABLE".to_string()));
                return;
            }
            let merged = merge_results(j.take_raw());
            (merged, j.query.clone(), j.id.clone(), j.cache_key.clone())
        };

        // Bounded availability check (concurrent, capped). Precompute the
        // (key, url) pairs so worker threads own their data; the queue must
        // outlive thread::scope (created OUTSIDE the scope closure).
        let mut reachability: HashMap<String, (&'static str, Option<u64>)> = HashMap::new();
        if config.availability_enabled && config.availability_max_urls > 0 {
            let pairs: Vec<(String, String)> = merged
                .iter()
                .take(config.availability_max_urls)
                .map(|m| (m.key.clone(), m.url.clone()))
                .collect();
            let checked: Mutex<HashMap<String, (&'static str, Option<u64>)>> =
                Mutex::new(HashMap::new());
            let queue = Mutex::new(pairs.into_iter());
            std::thread::scope(|scope| {
                let mut handles = Vec::new();
                for _ in 0..AVAILABILITY_CONCURRENCY {
                    let queue = &queue;
                    let checked = &checked;
                    let app = &app;
                    let cfg = &config;
                    handles.push(scope.spawn(move || loop {
                        let Some((key, url)) = queue.lock().unwrap_or_else(|p| p.into_inner()).next()
                        else {
                            return;
                        };
                        let r = check_reachable(app, cfg, &url);
                        checked.lock().unwrap_or_else(|p| p.into_inner()).insert(key, r);
                    }));
                }
                for h in handles {
                    let _ = h.join();
                }
            });
            reachability = checked.into_inner().unwrap_or_default();
        }

        let ranked = rank_results(merged, &query, &reachability, now, config);
        let results: Vec<Value> = ranked
            .into_iter()
            .take(config.max_results)
            .enumerate()
            .map(|(i, mut r)| {
                if let Some(obj) = r.as_object_mut() {
                    obj.insert("id".to_string(), json!(format!("{search_id}_{i}")));
                }
                r
            })
            .collect();

        {
            let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
            if j.cancelled {
                return;
            }
            j.results = results;
            j.state = "DONE";
            j.ended_at = Some(now);
        }
        if config.cache_ttl_ms > 0 {
            let mut cache = self.cache.lock().unwrap_or_else(|p| p.into_inner());
            if cache.len() >= MAX_CACHE {
                cache.clear();
            }
            cache.insert(
                cache_key,
                (job.lock().unwrap_or_else(|p| p.into_inner()).snapshot(now), now + config.cache_ttl_ms),
            );
        }
        if config.store_search_history {
            self.history_add(&query);
        }
    }

    pub fn get_search(&self, id: &str) -> Option<Value> {
        let jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
        let job = jobs.get(id)?;
        let job = job.lock().unwrap_or_else(|p| p.into_inner());
        Some(job.snapshot(now_ms()))
    }

    pub fn cancel_search(&self, id: &str) -> bool {
        let jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
        let Some(job) = jobs.get(id) else {
            return false;
        };
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        if matches!(j.state, "DONE" | "ERROR" | "CANCELLED") {
            return true;
        }
        j.cancelled = true;
        j.state = "CANCELLED";
        j.ended_at = Some(now_ms());
        true
    }

    // -- history --------------------------------------------------------------

    fn history_add(&self, query: &str) {
        let mut history = self.history.lock().unwrap_or_else(|p| p.into_inner());
        history.insert(
            0,
            json!({ "query": query, "providers": [VORMWEB_ID], "at": now_ms() }),
        );
        history.truncate(MAX_HISTORY);
        let doc = json!({ "entries": history.clone() });
        let _ = std::fs::write(
            self.data_dir.join("darkweb-history.json"),
            serde_json::to_string(&doc).unwrap_or_default(),
        );
    }

    // -- status ---------------------------------------------------------------

    pub fn ui_status(&self, app: &tauri::AppHandle<tauri::Wry>) -> Value {
        let config = self.config();
        let now = now_ms();
        let (tor_state, endpoint, progress) = crate::runtime_manager::with_manager(app, |manager| {
            (
                manager.service_state("tor"),
                manager.tor_socks_endpoint(),
                manager.status_json()["tor"]["progress"].as_u64(),
            )
        }).unwrap_or_default();
        let tor_label = match tor_state {
            Some(crate::runtime_manager::ServiceState::Ready) => "READY",
            Some(crate::runtime_manager::ServiceState::Starting)
            | Some(crate::runtime_manager::ServiceState::Bootstrapping) => "STARTING",
            Some(crate::runtime_manager::ServiceState::Failed) => "FAILED",
            _ => "STOPPED",
        };
        let socks_port = endpoint
            .as_ref()
            .and_then(|e| parse_socks_endpoint(e))
            .map(|(_, p)| p)
            .unwrap_or(config.socks_port);
        let health = self.health.lock().unwrap_or_else(|p| p.into_inner());
        let provider_status = |id: &str, name: &str, enabled: bool, requires_tor: bool| {
            let h = health.get(id);
            json!({
                "id": id,
                "name": name,
                "enabled": enabled,
                "requiresTor": requires_tor,
                "health": h.map(|h| h.health_label(now)).unwrap_or("UNKNOWN"),
                "lastLatencyMs": h.and_then(|h| h.last_latency_ms),
                "lastSuccessAt": h.and_then(|h| h.last_success_at),
                "lastFailureAt": h.and_then(|h| h.last_failure_at),
                "circuitOpenUntil": h.and_then(|h| h.circuit_open_until),
            })
        };
        let history_count = self.history.lock().unwrap_or_else(|p| p.into_inner()).len();
        // Real local-index count (was hardcoded 0 — the index is implemented).
        let index_count = {
            use tauri::Manager;
            app.try_state::<crate::crawl::SharedIndex>()
                .map(|index| {
                    let mut index = index.lock().unwrap_or_else(|p| p.into_inner());
                    index.load(&self.data_dir);
                    index.count()
                })
                .unwrap_or(0)
        };
        json!({
            "enabled": config.enabled,
            "tor": {
                "state": tor_label,
                "progress": progress,
                "socksHost": config.socks_host,
                "socksPort": socks_port,
                "detail": endpoint,
                "latencyMs": null,
                "lastCheckAt": now,
            },
            "providers": [
                provider_status(VORMWEB_ID, "VormWeb", config.vormweb_enabled, true),
            ],
            "historyCount": history_count,
            "indexCount": index_count,
        })
    }

    pub fn history_entries(&self) -> Value {
        json!({ "entries": self.history.lock().unwrap_or_else(|p| p.into_inner()).clone() })
    }

    pub fn clear_history(&self) {
        self.history.lock().unwrap_or_else(|p| p.into_inner()).clear();
        let _ = std::fs::write(self.data_dir.join("darkweb-history.json"), "{\"entries\":[]}");
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Managed Tauri state handle for the service.
pub type SharedDarkWeb = Arc<DarkWebService>;

/// Config snapshot from the managed service (consumed by core.rs when a
/// darkweb tab resolves its Tor endpoint).
pub fn config_of(app: &tauri::AppHandle<tauri::Wry>) -> DarkWebConfig {
    use tauri::Manager;
    app.try_state::<SharedDarkWeb>()
        .map(|s| s.config())
        .unwrap_or_default()
}

fn vormweb_search(
    tor: &(String, u16),
    config: &DarkWebConfig,
    query: &str,
) -> Result<Vec<RawProviderResult>, String> {
    let mut url = url::Url::parse(VORMWEB_SEARCH_URL).expect("static VormWeb search URL");
    url.query_pairs_mut().append_pair("q", query);
    let response = socks_http::get_https_via_socks5(
        &tor.0, tor.1, url.as_str(), config.provider_timeout_ms, config.fetch_max_bytes,
    ).map_err(|issue| issue.code().to_string())?;
    if response.status != 200 || !response.content_type.as_deref()
        .is_some_and(|content_type| content_type.to_ascii_lowercase().starts_with("text/html"))
    {
        return Err("EXTERNAL_PROVIDER_UNAVAILABLE".to_string());
    }
    parse_vormweb_results(&response.text, config.max_results).map_err(str::to_owned)
}

// ---------------------------------------------------------------------------
// Tests (pure logic — parsers, normalize, merge, rank, config, health)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_sanitizer_strips_active_content() {
        let html = concat!(
            "<html><head><style>body{}</style></head><body>",
            "<script>alert(1)</script>",
            "<p onclick=\"evil()\">text <b>bold</b></p>",
            "<a href=\"javascript:alert(1)\">bad</a>",
            "<a href=\"http://x.onion/a?b=1\">good</a>",
            "<img src=\"http://x.onion/pixel.png\" onerror=\"pwn()\">",
            "</body></html>"
        );
        let clean = sanitize_for_preview(html);
        assert!(!clean.contains("script"), "script survived: {clean}");
        assert!(!clean.contains("style"), "style survived: {clean}");
        assert!(!clean.contains("img"), "img survived: {clean}");
        assert!(!clean.contains("onclick"), "attribute survived: {clean}");
        assert!(!clean.contains("javascript:"), "js url survived: {clean}");
        assert!(clean.contains("<b>bold</b>"), "allowed tag lost: {clean}");
        assert!(clean.contains("href=\"http://x.onion/a?b=1\""), "safe href lost: {clean}");
        assert!(clean.contains("rel=\""), "noopener rel missing: {clean}");
    }

    #[test]
    fn rank_weights_come_from_config() {
        // Electron default provider weight is 3 — the config must own it.
        assert_eq!(DarkWebConfig::default().rank_provider_count, 3.0);
        let mut cfg = DarkWebConfig::default();
        let patch = serde_json::json!({ "ranking": { "providerCount": 10.0, "titleMatch": 99.0 } });
        cfg.apply_patch(&patch);
        assert_eq!(cfg.rank_provider_count, 10.0);
        assert_eq!(cfg.rank_title_match, 10.0, "clamp to hard bound failed");
    }

    #[test]
    fn vormweb_parses_only_onion_result_cards() {
        let host = format!("{}.onion", "a".repeat(56));
        let html = format!(r#"
            <p><b><u>3</u></b> Search results for "example" found!</p>
            <a id="urllink" href="http://{host}/nav">Header link</a>
            <div class="query-box"><a href="http://{host}/a?one=1&amp;two=2" id="urllink">A &amp; <b>B</b></a>
            <li><i>Plain &lt;text&gt;</i></li></div>
            <div class="query-box"><a id='urllink' href='https://example.com/'>External</a></div>
            <div class="query-box"><a id="urllink" href="http://user:pass@{host}/">Credentials</a></div>
        "#);
        let rows = parse_vormweb_results(&html, 20).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].url, format!("http://{host}/a?one=1&two=2"));
        assert_eq!(rows[0].title, "A & B");
        assert_eq!(rows[0].snippet, "Plain <text>");
    }

    #[test]
    fn vormweb_distinguishes_empty_results_and_unexpected_html() {
        assert!(parse_vormweb_results("<b><u>0</u></b> Search results for test found!", 20)
            .unwrap().is_empty());
        assert!(parse_vormweb_results("<h1>Just a moment</h1>", 20).is_err());
        assert!(parse_vormweb_results("<b><u>1</u></b> Search results for test found!", 20).is_err());
    }

    #[test]
    fn normalize_adds_scheme_and_dedups() {
        let raw = RawProviderResult {
            title: "  Wiki   Title ".to_string(),
            url: "abc.onion".to_string(),
            snippet: "s".to_string(),
            last_seen: None,
        };
        let n = normalize_provider_result(raw, "fixture-a").unwrap();
        assert_eq!(n.url, "http://abc.onion/");
        assert_eq!(n.title, "Wiki Title");
        // Non-onion rejected.
        let bad = normalize_provider_result(
            RawProviderResult { title: "t".into(), url: "http://example.com/".into(), snippet: String::new(), last_seen: None },
            "fixture-a",
        );
        assert!(bad.is_none());
        // Credentials stripped.
        let creds = normalize_provider_result(
            RawProviderResult { title: "t".into(), url: "http://u:p@abc.onion/x".into(), snippet: String::new(), last_seen: None },
            "fixture-b",
        )
        .unwrap();
        assert!(!creds.url.contains("u:p@"));
    }

    #[test]
    fn merge_unifies_providers_and_keeps_longest_text() {
        let a = normalize_provider_result(
            RawProviderResult { title: "Short".into(), url: "http://abc.onion/".into(), snippet: "hi".into(), last_seen: None },
            "fixture-a",
        )
        .unwrap();
        let b = normalize_provider_result(
            RawProviderResult { title: "The Longer Title".into(), url: "abc.onion".into(), snippet: "longer snippet".into(), last_seen: Some(5) },
            "fixture-b",
        )
        .unwrap();
        let merged = merge_results(vec![a, b]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].providers, vec!["fixture-a", "fixture-b"]);
        assert_eq!(merged[0].title, "The Longer Title");
        assert_eq!(merged[0].snippet, "longer snippet");
        assert_eq!(merged[0].last_seen, Some(5));
    }

    #[test]
    fn ranking_prefers_multi_provider_and_term_coverage() {
        let make = |url: &str, providers: usize, title: &str| MergedResult {
            title: title.to_string(),
            url: url.to_string(),
            hostname: "x.onion".into(),
            snippet: String::new(),
            providers: (0..providers).map(|i| format!("p{i}")).collect(),
            last_seen: None,
            key: url.to_string(),
        };
        let merged = vec![
            make("http://weak.onion/", 1, "unrelated text"),
            make("http://strong.onion/", 3, "bitcoin wallet guide"),
        ];
        let ranked = rank_results(merged, "bitcoin wallet", &HashMap::new(), 0, &DarkWebConfig::default());
        assert_eq!(ranked[0]["url"], "http://strong.onion/");
        assert!(ranked[0]["score"].as_f64().unwrap() > ranked[1]["score"].as_f64().unwrap());
    }

    #[test]
    fn health_circuit_opens_and_recovers() {
        let mut h = ProviderHealth::default();
        h.record_failure(1);
        h.record_failure(2);
        assert!(h.allows(3));
        h.record_failure(3);
        assert!(!h.allows(4));
        assert_eq!(h.health_label(4), "OFFLINE");
        assert!(h.allows(4 + CIRCUIT_OPEN_MS));
        h.record_success(50, 4 + CIRCUIT_OPEN_MS + 1);
        assert!(h.allows(9_999_999));
        assert_eq!(h.health_label(9_999_999), "HEALTHY");
    }

    #[test]
    fn config_patch_clamps_and_persists_roundtrip() {
        let mut c = DarkWebConfig::default();
        c.apply_patch(&json!({
            "enabled": false,
            "search": { "maxResults": 99_999, "cacheTtlMs": -5 },
            "tor": { "socksPort": 99_999 },
            "providers": { "vormweb": { "enabled": false } },
        }));
        assert!(!c.enabled);
        assert_eq!(c.max_results, 200);
        assert_eq!(c.socks_port, 65_535);
        assert!(!c.vormweb_enabled);
        let tmp = std::env::temp_dir().join(format!("hd-dw-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        c.save(&tmp);
        let loaded = DarkWebConfig::load(&tmp);
        assert_eq!(loaded.max_results, 200);
        assert!(!loaded.vormweb_enabled);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn onion_url_validation() {
        assert!(is_onion_url("http://abcxyz56charonionaddress0000000000000000000000000000000.onion/x"));
        assert!(!is_onion_url("https://vormweb.de/en/search"));
        assert!(!is_onion_url("notaurl"));
    }

    #[test]
    fn title_extraction() {
        assert_eq!(extract_title("<html><title>Hello &amp; World</title></html>").as_deref(), Some("Hello & World"));
    }
}
