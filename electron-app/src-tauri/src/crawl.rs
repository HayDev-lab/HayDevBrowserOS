//! Bounded onion crawler + local document index — port of Electron
//! `crawler.ts` + `local-index.ts` (spec §22–§27).
//!
//! Same security gates as search/fetch: onion-only URLs, Tor-only transport
//! (socks_http), byte caps, bounded BFS (maxDepth 1, maxPages 25,
//! sameHostOnly, concurrency 2 — clamped by the darkweb config). Jobs run
//! on worker threads over a shared queue; `cancel` stops scheduling and the
//! job settles CANCELLED when workers drain (threads cannot be killed —
//! an in-flight socket read just times out and its result is dropped).
//!
//! The local index is a JSON file (`darkweb/darkweb-index.json`) with
//! FNV-1a content-hash dedup (exact Electron parity) and LLM-free keyword
//! scoring (title×3, url×1, text×1).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

use crate::darkweb::{is_onion_url, DarkWebConfig};

const MAX_JOBS: usize = 8;
const TEXT_MAX_CHARS: usize = 400_000;
/// ~8 MiB heuristic cap (Electron INDEX_MAX_BYTES / AVG_DOC_BYTES).
const MAX_DOCS: usize = 1000;
const LINKS_PER_PAGE: usize = 100;
const AVAIL_CONCURRENCY: usize = 2;

// ---------------------------------------------------------------------------
// Local index
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct IndexDoc {
    pub id: String,
    pub url: String,
    pub host: String,
    pub title: String,
    pub text: String,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: u64,
    #[serde(rename = "provider")]
    pub provider: Option<String>,
    #[serde(rename = "crawlJobId")]
    pub crawl_job_id: Option<String>,
}

/// Add outcome (Electron shape: {added, reason, id}).
pub struct AddOutcome {
    pub added: bool,
    pub reason: Option<String>,
    pub id: Option<String>,
}

/// FNV-1a 64-bit over normalized text, 16-char hex — exact Electron parity
/// (content-hash.ts) so both runtimes dedupe identically.
pub fn content_hash(text: &str) -> String {
    let mut normalized: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    normalized.truncate(normalized.trim_end().len());
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for ch in normalized.chars() {
        hash ^= (ch as u64) & 0xff;
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[derive(Default)]
pub struct LocalIndex {
    docs: Vec<IndexDoc>,
    by_hash: HashSet<String>,
    loaded: bool,
    seq: u64,
}

impl LocalIndex {
    pub fn load(&mut self, data_dir: &std::path::Path) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let path = data_dir.join("darkweb-index.json");
        let Ok(raw) = std::fs::read_to_string(path) else { return };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
        let Some(arr) = v.get("docs").and_then(|d| d.as_array()) else { return };
        for d in arr {
            let Some(url) = d.get("url").and_then(|x| x.as_str()) else { continue };
            let Some(hash) = d.get("contentHash").and_then(|x| x.as_str()) else { continue };
            self.by_hash.insert(hash.to_string());
            self.docs.push(IndexDoc {
                id: d.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                url: url.to_string(),
                host: d.get("host").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                title: d.get("title").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                text: d.get("text").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                content_hash: hash.to_string(),
                fetched_at: d.get("fetchedAt").and_then(|x| x.as_u64()).unwrap_or(0),
                provider: d.get("provider").and_then(|x| x.as_str()).map(str::to_string),
                crawl_job_id: d.get("crawlJobId").and_then(|x| x.as_str()).map(str::to_string),
            });
        }
        self.docs.sort_by(|a, b| b.fetched_at.cmp(&a.fetched_at));
    }

    fn persist(&self, data_dir: &std::path::Path) {
        let doc = serde_json::json!({ "version": 1, "docs": self.docs });
        let _ = std::fs::write(
            data_dir.join("darkweb-index.json"),
            serde_json::to_string_pretty(&doc).unwrap_or_default(),
        );
    }

    pub fn add(
        &mut self,
        data_dir: &std::path::Path,
        url: &str,
        host: &str,
        title: &str,
        text: &str,
        fetched_at: u64,
        crawl_job_id: Option<&str>,
    ) -> AddOutcome {
        if text.trim().is_empty() {
            return AddOutcome { added: false, reason: Some("empty_text".into()), id: None };
        }
        let hash = content_hash(text);
        if self.by_hash.contains(&hash) {
            return AddOutcome { added: false, reason: Some("duplicate_content".into()), id: None };
        }
        self.seq += 1;
        let record = IndexDoc {
            id: format!("doc_{:x}_{}", fetched_at, self.seq),
            url: url.to_string(),
            host: host.to_string(),
            title: title.to_string(),
            text: text.to_string(),
            content_hash: hash,
            fetched_at,
            provider: None,
            crawl_job_id: crawl_job_id.map(str::to_string),
        };
        self.docs.insert(0, record.clone());
        self.by_hash.insert(record.content_hash.clone());
        self.docs.truncate(MAX_DOCS);
        self.persist(data_dir);
        AddOutcome { added: true, reason: None, id: Some(record.id) }
    }

    /// Keyword scoring: title×3, url×1, text×1 (Electron parity).
    pub fn search(&self, query: &str, limit: usize) -> Vec<serde_json::Value> {
        let terms = crate::darkweb::extract_query_terms(query);
        if terms.is_empty() {
            return Vec::new();
        }
        let mut hits: Vec<(i64, &IndexDoc)> = Vec::new();
        for d in &self.docs {
            let title = d.title.to_lowercase();
            let text = d.text.to_lowercase();
            let url = d.url.to_lowercase();
            let mut score: i64 = 0;
            for t in &terms {
                if title.contains(t.as_str()) {
                    score += 3;
                }
                if url.contains(t.as_str()) {
                    score += 1;
                }
                if text.contains(t.as_str()) {
                    score += 1;
                }
            }
            if score == 0 {
                continue;
            }
            hits.push((score, d));
        }
        hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.fetched_at.cmp(&a.1.fetched_at)));
        hits
            .into_iter()
            .take(limit.max(1))
            .map(|(score, d)| {
                let lower = d.text.to_lowercase();
                let at = lower.find(&terms[0]).unwrap_or(0);
                let start = at.saturating_sub(60);
                let snippet: String = d.text.chars().skip(start).take(220).collect();
                serde_json::json!({
                    "id": d.id,
                    "url": d.url,
                    "host": d.host,
                    "title": if d.title.is_empty() { d.url.clone() } else { d.title.clone() },
                    "snippet": snippet.trim(),
                    "fetchedAt": d.fetched_at,
                    "score": score,
                })
            })
            .collect()
    }

    pub fn clear(&mut self, data_dir: &std::path::Path) {
        self.docs.clear();
        self.by_hash.clear();
        self.persist(data_dir);
    }

    pub fn count(&self) -> usize {
        self.docs.len()
    }
}

pub type SharedIndex = Arc<Mutex<LocalIndex>>;

// ---------------------------------------------------------------------------
// Crawler
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlStatus {
    pub job_id: String,
    pub seed_url: String,
    /// RUNNING | STOPPING | DONE | CANCELLED
    pub state: String,
    pub max_depth: u32,
    pub max_pages: u32,
    pub same_host_only: bool,
    pub pages_fetched: u32,
    pub pages_failed: u32,
    pub pages_queued: u32,
    pub docs_added: u32,
    pub docs_duplicate: u32,
    pub started_at: u64,
    pub ended_at: Option<u64>,
    pub error_code: Option<String>,
}

struct CrawlJobInner {
    status: CrawlStatus,
    seen: HashSet<String>,
    queue: Vec<(String, u32)>,
    stop: bool,
    data_dir: std::path::PathBuf,
}

#[derive(Clone)]
pub struct CrawlRegistry {
    jobs: Arc<Mutex<HashMap<String, Arc<Mutex<CrawlJobInner>>>>>,
    index: SharedIndex,
    seq: Arc<Mutex<u64>>,
}

impl CrawlRegistry {
    pub fn new(index: SharedIndex) -> Self {
        Self { jobs: Arc::new(Mutex::new(HashMap::new())), index, seq: Arc::new(Mutex::new(0)) }
    }

    fn prune(jobs: &mut HashMap<String, Arc<Mutex<CrawlJobInner>>>) {
        let now = now_ms();
        jobs.retain(|_, j| {
            let j = j.lock().unwrap_or_else(|p| p.into_inner());
            !j.status.state.as_str().contains("DONE")
                && !j.status.state.as_str().contains("CANCELLED")
                || j.status.ended_at.map(|e| now.saturating_sub(e) < 10 * 60_000).unwrap_or(true)
        });
    }

    /// Start a bounded crawl. The job runs on worker threads; the id comes
    /// back immediately (Electron parity: {jobId}).
    pub fn crawl(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
        config: &DarkWebConfig,
        url: &str,
        max_depth: Option<u32>,
        max_pages: Option<u32>,
        same_host_only: Option<bool>,
    ) -> Result<String, String> {
        if !config.enabled {
            return Err("DARKWEB_DISABLED".into());
        }
        if !is_onion_url(url) {
            return Err("ONION_ONLY".into());
        }
        let seed_host = host_of(url).ok_or("invalid_url")?;
        let max_depth = max_depth.unwrap_or(1).clamp(1, 5).min(5);
        let max_pages = max_pages.unwrap_or(25).clamp(1, 200);
        let same_host_only = same_host_only.unwrap_or(true);
        let timeout_ms = 120_000u64; // Electron crawlerTimeoutMs default

        let mut jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
        Self::prune(&mut jobs);
        if jobs.len() >= MAX_JOBS {
            return Err("TOO_MANY_CRAWL_JOBS".into());
        }
        let job_id = {
            let mut seq = self.seq.lock().unwrap_or_else(|p| p.into_inner());
            *seq += 1;
            format!("c_{:x}_{:x}", now_ms(), *seq)
        };
        let job = Arc::new(Mutex::new(CrawlJobInner {
            status: CrawlStatus {
                job_id: job_id.clone(),
                seed_url: url.to_string(),
                state: "RUNNING".into(),
                max_depth,
                max_pages,
                same_host_only,
                pages_fetched: 0,
                pages_failed: 0,
                pages_queued: 1,
                docs_added: 0,
                docs_duplicate: 0,
                started_at: now_ms(),
                ended_at: None,
                error_code: None,
            },
            seen: HashSet::from([url.to_string()]),
            queue: vec![(url.to_string(), 0)],
            stop: false,
            data_dir: crate::lib_app_data_dir().join("darkweb"),
        }));
        jobs.insert(job_id.clone(), job.clone());
        drop(jobs);

        // Worker pool over the shared queue (Electron concurrency parity).
        let deadline = now_ms() + timeout_ms;
        for _ in 0..AVAIL_CONCURRENCY {
            let job_w = job.clone();
            let registry_w = self.clone();
            let app_w = app.clone();
            let config_w = config.clone();
            let seed_w = seed_host.clone();
            std::thread::spawn(move || {
                worker_loop(&app_w, &config_w, &registry_w, &job_w, &seed_w, deadline);
            });
        }
        Ok(job_id)
    }

    pub fn status(&self, job_id: &str) -> Option<CrawlStatus> {
        let jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
        let job = jobs.get(job_id)?.clone();
        let status = job.lock().unwrap_or_else(|p| p.into_inner()).status.clone();
        Some(status)
    }

    pub fn list(&self) -> Vec<CrawlStatus> {
        let jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
        jobs.values()
            .map(|j| j.lock().unwrap_or_else(|p| p.into_inner()).status.clone())
            .collect()
    }

    pub fn cancel(&self, job_id: &str) -> bool {
        let jobs = self.jobs.lock().unwrap_or_else(|p| p.into_inner());
        let Some(job) = jobs.get(job_id) else { return false };
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        if j.status.ended_at.is_some() {
            return true;
        }
        j.stop = true;
        j.status.state = "STOPPING".into();
        j.queue.clear();
        true
    }
}

fn worker_loop(
    app: &tauri::AppHandle<tauri::Wry>,
    config: &DarkWebConfig,
    registry: &CrawlRegistry,
    job: &Arc<Mutex<CrawlJobInner>>,
    seed_host: &str,
    deadline: u64,
) {
    loop {
        let (url, depth) = {
            let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
            if j.stop {
                return;
            }
            if j.status.pages_fetched + j.status.pages_failed >= j.status.max_pages {
                return;
            }
            match j.queue.pop() {
                Some(next) => next,
                None => return,
            }
        };
        if now_ms() > deadline {
            let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
            j.status.error_code = Some("CRAWL_TIMEOUT".into());
            return;
        }
        fetch_and_store(app, config, registry, job, &url, depth, seed_host);
    }
}

fn fetch_and_store(
    app: &tauri::AppHandle<tauri::Wry>,
    config: &DarkWebConfig,
    registry: &CrawlRegistry,
    job: &Arc<Mutex<CrawlJobInner>>,
    url: &str,
    depth: u32,
    seed_host: &str,
) {
    let Some((host, port)) = crate::darkweb::tor_endpoint(app, config) else {
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        j.status.pages_failed += 1;
        j.status.error_code = Some("TOR_UNAVAILABLE".into());
        return;
    };
    let fetch_to = config.fetch_timeout_ms.min(20_000);
    let resp = match crate::socks_http::get_via_socks5(
        &host,
        port,
        url,
        fetch_to,
        config.fetch_max_bytes,
    ) {
        Ok(r) => r,
        Err(_) => {
            let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
            j.status.pages_failed += 1;
            return;
        }
    };
    {
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        j.status.pages_fetched += 1;
    }

    let mime = resp.content_type.as_deref().unwrap_or("").split(';').next().unwrap_or("").trim().to_lowercase();
    let is_html = mime == "text/html"
        || (mime.is_empty() && resp.text.trim_start().to_lowercase().starts_with("<!doctype html")
            || resp.text.trim_start().to_lowercase().starts_with("<html"));

    // Index the text content (page text, capped).
    let text = if is_html {
        extract_text(&resp.text, TEXT_MAX_CHARS)
    } else if mime.starts_with("text/") || mime == "application/json" {
        resp.text.chars().take(TEXT_MAX_CHARS).collect()
    } else {
        String::new()
    };
    if !text.trim().is_empty() {
        let title = if is_html {
            crate::darkweb::extract_title(&resp.text).unwrap_or_else(|| url.to_string())
        } else {
            url.to_string()
        };
        let outcome = {
            let mut index = registry.index.lock().unwrap_or_else(|p| p.into_inner());
            index.load(&job.lock().unwrap_or_else(|p| p.into_inner()).data_dir);
            let data_dir = job.lock().unwrap_or_else(|p| p.into_inner()).data_dir.clone();
            let job_id = job.lock().unwrap_or_else(|p| p.into_inner()).status.job_id.clone();
            index.add(&data_dir, &resp.final_url, seed_host, &title, &text, now_ms(), Some(&job_id))
        };
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        if outcome.added {
            j.status.docs_added += 1;
        } else if outcome.reason.as_deref() == Some("duplicate_content") {
            j.status.docs_duplicate += 1;
        }
    }

    // Link discovery from HTML pages under the depth limit.
    if is_html && depth < job.lock().unwrap_or_else(|p| p.into_inner()).status.max_depth {
        let links = extract_links(&resp.text, &resp.final_url, LINKS_PER_PAGE);
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        for link in links {
            if j.status.pages_fetched + j.status.pages_failed + j.queue.len() as u32
                >= j.status.max_pages
            {
                break;
            }
            if !is_onion_url(&link) {
                continue;
            }
            if j.status.same_host_only && host_of(&link).as_deref() != Some(seed_host) {
                continue;
            }
            if j.seen.contains(&link) {
                continue;
            }
            j.seen.insert(link.clone());
            j.queue.push((link, depth + 1));
            j.status.pages_queued += 1;
        }
    }

    // Drain detection: last worker out finalizes the state.
    let j = job.lock().unwrap_or_else(|p| p.into_inner());
    if j.queue.is_empty() && j.status.ended_at.is_none() {
        // Other workers may still hold a popped URL; only settle when the
        // page counters stop moving is hard to observe — settle lazily via
        // a short grace sleep (threads cannot block forever: fetch timeouts
        // bound every worker).
        drop(j);
        std::thread::sleep(Duration::from_millis(1500));
        let mut j = job.lock().unwrap_or_else(|p| p.into_inner());
        if j.queue.is_empty() && j.status.ended_at.is_none() {
            j.status.state = if j.stop { "CANCELLED".into() } else { "DONE".into() };
            j.status.ended_at = Some(now_ms());
        }
    }
}

// ---------------------------------------------------------------------------
// HTML helpers (bounded, dependency-light)
// ---------------------------------------------------------------------------

/// Strip tags/scripts/styles to visible text (bounded char output).
pub fn extract_text(html: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut depth_script = 0usize;
    let mut depth_style = 0usize;
    let lower = html.to_lowercase();
    let bytes = html.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && out.chars().count() < max_chars {
        if bytes[i] == b'<' {
            // Tag or comment.
            if lower[i..].starts_with("<!--") {
                i = lower[i..].find("-->").map(|p| i + p + 3).unwrap_or(bytes.len());
                continue;
            }
            let Some(end_rel) = lower[i..].find('>') else { break };
            let tag = &lower[i + 1..i + end_rel];
            if tag.starts_with("script") || tag.starts_with("/script") {
                depth_script = if tag.starts_with('/') { depth_script.saturating_sub(1) } else { depth_script + 1 };
            } else if tag.starts_with("style") || tag.starts_with("/style") {
                depth_style = if tag.starts_with('/') { depth_style.saturating_sub(1) } else { depth_style + 1 };
            } else if !tag.starts_with('/') && out.chars().last().map(|c| c != ' ').unwrap_or(true) {
                out.push(' ');
            }
            i += end_rel + 1;
            continue;
        }
        if depth_script == 0 && depth_style == 0 {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    // Collapse whitespace + decode the handful of entities that matter.
    let collapsed: String = out.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .chars()
        .take(max_chars)
        .collect()
}

/// Absolute http(s) hrefs resolved against the page URL (bounded).
pub fn extract_links(html: &str, base_url: &str, cap: usize) -> Vec<String> {
    use url::Url;
    let Ok(base) = Url::parse(base_url) else { return Vec::new() };
    let re = regex::Regex::new(r#"(?is)<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))"#)
        .unwrap_or_else(|_| regex::Regex::new("$^").unwrap());
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for cap_m in re.captures_iter(html).take(cap * 4) {
        let href = cap_m
            .get(2)
            .or_else(|| cap_m.get(3))
            .or_else(|| cap_m.get(4))
            .map(|m| m.as_str().trim())
            .unwrap_or("");
        if href.is_empty() || href.starts_with('#') {
            continue;
        }
        let Ok(resolved) = base.join(href) else { continue };
        if resolved.scheme() != "http" && resolved.scheme() != "https" {
            continue;
        }
        let s = resolved.to_string();
        if seen.insert(s.clone()) {
            out.push(s);
            if out.len() >= cap {
                break;
            }
        }
    }
    out
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    let authority = rest.split('/').next()?;
    let host = authority.rsplit_once(':').map(|(h, _)| h).unwrap_or(authority);
    if host.is_empty() { None } else { Some(host.to_string()) }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_hash_parity_with_fnv1a() {
        // Hand-computed FNV-1a 64 of "abc" = e71fa2190541574b.
        assert_eq!(content_hash("abc"), "e71fa2190541574b");
        // Whitespace/case normalization collapses duplicates.
        assert_eq!(content_hash("A  B\nC"), content_hash("a b c"));
        assert_ne!(content_hash("a"), content_hash("b"));
    }

    #[test]
    fn extract_text_strips_scripts_and_tags() {
        let html = r#"<html><head><style>p{}</style></head><body><script>evil()</script><h1>Title</h1><p>Hello <b>world</b></p><!-- comment --></body></html>"#;
        let text = extract_text(html, 1000);
        assert!(text.contains("Hello world"), "got: {text}");
        assert!(text.contains("Title"));
        assert!(!text.contains("evil"));
        assert!(!text.contains("p{}"));
    }

    #[test]
    fn extract_links_resolves_relative_and_dedupes() {
        let base = "http://aabbccddeeff.onion/dir/page";
        let html = r#"<a href="/x">1</a> <a href="/x">dup</a> <a href="https://other.onion/y">2</a> <a href="javascript:void(0)">js</a>"#;
        let links = extract_links(html, base, 10);
        assert_eq!(links.len(), 2, "{links:?}");
        assert!(links.contains(&"http://aabbccddeeff.onion/x".to_string()));
        assert!(links.contains(&"https://other.onion/y".to_string()));
    }

    #[test]
    fn index_add_dedupes_and_searches() {
        let dir = std::env::temp_dir().join(format!("haydev-crawl-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut index = LocalIndex::default();
        let a = index.add(&dir, "http://a.onion/", "a.onion", "Market A", "sells apples daily", 1, None);
        assert!(a.added);
        let dup = index.add(&dir, "http://a.onion/", "a.onion", "Market A", "sells apples daily", 2, None);
        assert!(!dup.added);
        assert_eq!(dup.reason.as_deref(), Some("duplicate_content"));
        let b = index.add(&dir, "http://b.onion/", "b.onion", "Shop B", "bananas and apples", 3, None);
        assert!(b.added);
        let hits = index.search("apples", 10);
        assert_eq!(hits.len(), 2);
        assert!(hits[0]["score"].as_i64().unwrap() >= 1);
        let title_hit = index.search("Market", 10);
        assert_eq!(title_hit.len(), 1, "title hit scores higher/only one has it");
        index.clear(&dir);
        assert_eq!(index.count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
