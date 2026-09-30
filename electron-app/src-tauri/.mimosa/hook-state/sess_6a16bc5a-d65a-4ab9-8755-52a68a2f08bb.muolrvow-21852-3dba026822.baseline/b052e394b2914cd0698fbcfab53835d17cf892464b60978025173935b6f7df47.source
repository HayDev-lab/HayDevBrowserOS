//! File-backed stores — format-parity ports of the TS pure stores.
//!
//! The SAME userData JSON files (`history.json`, `bookmarks.json`,
//! `session.json`) are read/written by the Electron and Tauri runtimes, so
//! switching runtimes preserves user data. Writes are atomic (temp + rename).

use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{
    Bookmark, BookmarkAddRequest, HistoryAddRequest, HistoryEntry, HistoryQuery, SessionSnapshot,
    SessionTab, TabState,
};
use crate::urlnorm::canonicalize_for_history;

const HISTORY_LIMIT: usize = 10_000;
const HISTORY_QUERY_DEFAULT_LIMIT: usize = 100;

// ---------------------------------------------------------------------------
// Atomic JSON file helpers
// ---------------------------------------------------------------------------

fn read_json(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .filter(|s| !s.trim().is_empty())
}

/// Write via temp-file + rename so a crash never leaves a truncated store.
fn write_json_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents)?;
    if path.exists() {
        // Windows rename refuses to overwrite — remove then rename.
        fs::remove_file(path)?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn next_id(prefix: &str) -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    format!("{prefix}_{}_{n}", radix36(now))
}

fn radix36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

pub struct HistoryStore {
    path: PathBuf,
    entries: Vec<HistoryEntry>,
    loaded: bool,
}

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            entries: Vec::new(),
            loaded: false,
        }
    }

    fn load(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let Some(raw) = read_json(&self.path) else {
            return;
        };
        #[derive(serde::Deserialize)]
        struct Parsed {
            version: u8,
            #[serde(default)]
            entries: Vec<HistoryEntry>,
        }
        if let Ok(parsed) = serde_json::from_str::<Parsed>(&raw) {
            if parsed.version == 1 {
                self.entries = parsed.entries;
            }
        }
        // Corrupt or unknown version → start empty; the file is NOT deleted
        // (same recovery policy as the TS store).
    }

    fn persist(&self) {
        let payload = crate::types::persisted_history_json(&self.entries);
        if let Err(err) = write_json_atomic(&self.path, &payload) {
            log::error!("[HISTORY] persist failed: {err}");
        }
    }

    /// Add a visit; same URL increments visitCount and refreshes visitedAt.
    pub fn add(&mut self, input: &HistoryAddRequest) -> HistoryEntry {
        self.load();
        let canonical = canonicalize_for_history(&input.url);
        let visited_at = input.visited_at.unwrap_or_else(now_millis);
        if let Some(existing) = self.entries.iter_mut().find(|e| e.url == canonical) {
            existing.visited_at = visited_at;
            existing.visit_count += 1;
            if !input.title.is_empty() && input.title != existing.title {
                existing.title = input.title.clone();
            }
            let out = existing.clone();
            self.persist();
            return out;
        }
        let entry = HistoryEntry {
            id: next_id("hist"),
            title: if input.title.is_empty() {
                canonical.clone()
            } else {
                input.title.clone()
            },
            url: canonical,
            visited_at,
            visit_count: 1,
        };
        self.entries.push(entry.clone());
        if self.entries.len() > HISTORY_LIMIT {
            self.entries.drain(..self.entries.len() - HISTORY_LIMIT);
        }
        self.persist();
        entry
    }

    /// Query entries, newest first (port of HistoryStore.query).
    pub fn query(&mut self, q: &HistoryQuery) -> Vec<HistoryEntry> {
        self.load();
        let limit = q.limit.unwrap_or(HISTORY_QUERY_DEFAULT_LIMIT);
        let since = q.since.unwrap_or(0);
        let search = q
            .search
            .as_deref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());
        let mut filtered: Vec<HistoryEntry> = self
            .entries
            .iter()
            .filter(|e| {
                if e.visited_at < since {
                    return false;
                }
                if let Some(s) = &search {
                    if !e.url.to_lowercase().contains(s) && !e.title.to_lowercase().contains(s) {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect();
        filtered.sort_by_key(|e| std::cmp::Reverse(e.visited_at));
        filtered.truncate(limit);
        filtered
    }

    pub fn delete(&mut self, id: &str) -> bool {
        self.load();
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        let removed = before != self.entries.len();
        if removed {
            self.persist();
        }
        removed
    }

    pub fn clear(&mut self) {
        self.load();
        self.entries.clear();
        self.persist();
    }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

pub struct BookmarksStore {
    path: PathBuf,
    items: Vec<Bookmark>,
    loaded: bool,
}

impl BookmarksStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            items: Vec::new(),
            loaded: false,
        }
    }

    fn load(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let Some(raw) = read_json(&self.path) else {
            return;
        };
        #[derive(serde::Deserialize)]
        struct Parsed {
            version: u8,
            #[serde(default)]
            bookmarks: Vec<Bookmark>,
        }
        if let Ok(parsed) = serde_json::from_str::<Parsed>(&raw) {
            if parsed.version == 1 {
                self.items = parsed.bookmarks;
            }
        }
    }

    fn persist(&self) {
        #[derive(serde::Serialize)]
        struct Payload<'a> {
            version: u8,
            bookmarks: &'a [Bookmark],
        }
        let payload = serde_json::to_string(&Payload {
            version: 1,
            bookmarks: &self.items,
        })
        .unwrap_or_else(|_| "{\"version\":1,\"bookmarks\":[]}".to_string());
        if let Err(err) = write_json_atomic(&self.path, &payload) {
            log::error!("[BOOKMARKS] persist failed: {err}");
        }
    }

    pub fn list(&mut self) -> Vec<Bookmark> {
        self.load();
        self.items.clone()
    }

    pub fn add(&mut self, req: &BookmarkAddRequest) -> Bookmark {
        self.load();
        let item = Bookmark {
            id: next_id("bm"),
            url: req.url.clone(),
            title: req.title.clone(),
            folder_id: req.folder_id.clone(),
            added_at: now_millis(),
        };
        self.items.push(item.clone());
        self.persist();
        item
    }

    pub fn delete(&mut self, id: &str) -> bool {
        self.load();
        let before = self.items.len();
        self.items.retain(|b| b.id != id);
        let removed = before != self.items.len();
        if removed {
            self.persist();
        }
        removed
    }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

pub struct SessionStore {
    path: PathBuf,
}

impl SessionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Option<SessionSnapshot> {
        let raw = read_json(&self.path)?;
        let parsed = serde_json::from_str::<SessionSnapshot>(&raw).ok()?;
        (parsed.version == 1).then_some(parsed)
    }

    /// Persist tabs — incognito tabs are NEVER written (privacy policy).
    pub fn save(&self, tabs: &[TabState], order: &[String], active_id: Option<&str>) {
        let session_tabs: Vec<SessionTab> = tabs
            .iter()
            .filter(|t| !t.is_incognito)
            .map(|t| SessionTab {
                id: t.id.clone(),
                url: t.url.clone(),
                pending_url: t.pending_url.clone(),
                title: t.title.clone(),
                is_incognito: false,
                navigation: crate::navstack::NavStack::new().to_session(),
            })
            .collect();
        let filtered_ids: Vec<String> = session_tabs.iter().map(|t| t.id.clone()).collect();
        let snapshot = SessionSnapshot {
            version: 1,
            tabs: session_tabs,
            order: filtered_ids,
            active_id: active_id
                .filter(|id| tabs.iter().any(|t| t.id == *id && !t.is_incognito))
                .map(str::to_string),
        };
        let _ = order; // ordering follows the tab list (same as TS store)
        if let Ok(json) = serde_json::to_string(&snapshot) {
            if let Err(err) = write_json_atomic(&self.path, &json) {
                log::error!("[SESSION] persist failed: {err}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("haydev-tauri-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn history_add_query_and_upsert() {
        let dir = temp_dir();
        let mut store = HistoryStore::new(dir.join("history.json"));
        store.add(&HistoryAddRequest {
            url: "https://a.io/x#frag".into(),
            title: "A".into(),
            visited_at: Some(100),
        });
        store.add(&HistoryAddRequest {
            url: "https://a.io/x".into(), // same canonical URL → upsert
            title: "A2".into(),
            visited_at: Some(200),
        });
        let all = store.query(&HistoryQuery {
            limit: Some(10),
            since: None,
            search: None,
        });
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].visit_count, 2);
        assert_eq!(all[0].visited_at, 200);
        assert_eq!(all[0].title, "A2");
        assert_eq!(all[0].url, "https://a.io/x");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn history_search_and_since() {
        let dir = temp_dir();
        let mut store = HistoryStore::new(dir.join("history.json"));
        store.add(&HistoryAddRequest {
            url: "https://github.com/x".into(),
            title: "GitHub".into(),
            visited_at: Some(10),
        });
        store.add(&HistoryAddRequest {
            url: "https://news.ycombinator.com".into(),
            title: "HN".into(),
            visited_at: Some(20),
        });
        let found = store.query(&HistoryQuery {
            limit: None,
            since: Some(15),
            search: Some("github".into()),
        });
        assert!(found.is_empty(), "github entry visited at 10 < since 15");
        let found = store.query(&HistoryQuery {
            limit: None,
            since: Some(5),
            search: Some("hn".into()),
        });
        assert_eq!(found.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn history_file_format_parity() {
        let dir = temp_dir();
        let path = dir.join("history.json");
        let mut store = HistoryStore::new(path.clone());
        store.add(&HistoryAddRequest {
            url: "https://a.io".into(),
            title: "A".into(),
            visited_at: Some(1),
        });
        let raw = fs::read_to_string(&path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["version"], 1);
        assert!(v["entries"].is_array());
        assert_eq!(v["entries"][0]["visitedAt"], 1);
        assert_eq!(v["entries"][0]["visitCount"], 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn bookmarks_roundtrip() {
        let dir = temp_dir();
        let mut store = BookmarksStore::new(dir.join("bookmarks.json"));
        store.add(&BookmarkAddRequest {
            url: "https://a.io".into(),
            title: "A".into(),
            folder_id: None,
        });
        assert_eq!(store.list().len(), 1);
        let id = store.list()[0].id.clone();
        assert!(store.delete(&id));
        assert!(store.list().is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn session_never_persists_incognito() {
        let dir = temp_dir();
        let store = SessionStore::new(dir.join("session.json"));
        let incognito_tab = TabState {
            id: "tab-x".into(),
            url: "https://a.io".into(),
            pending_url: String::new(),
            title: "A".into(),
            load_state: crate::types::TabLoadState::Committed,
            error: None,
            can_go_back: false,
            can_go_forward: false,
            is_incognito: true,
            is_dark_web: None,
            is_active: true,
            is_audio_playing: false,
            unread_count: 0,
            is_discarded: false,
            created_at: 1,
            last_activated_at: 1,
        };
        store.save(std::slice::from_ref(&incognito_tab), &[], Some("tab-x"));
        assert!(store.load().is_none() || store.load().unwrap().tabs.is_empty());
        fs::remove_dir_all(&dir).ok();
    }
}
