//! Existing v1 store formats with locked read/modify/write transactions.
use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(test)]
use std::fs;
use serde::{Deserialize, Serialize};
use crate::atomic_store::{transaction, corrupt, Transaction};
use crate::error::AppResult;
use crate::navstack::NavStack;
use crate::types::{Bookmark, BookmarkAddRequest, HistoryAddRequest, HistoryEntry, HistoryQuery, SessionSnapshot, SessionTab, TabState};
use crate::urlnorm::canonicalize_for_history;

fn now_millis() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
fn next_id(prefix: &str) -> String { format!("{prefix}_{}", uuid::Uuid::new_v4()) }
#[derive(Serialize, Deserialize)]
struct HistoryFile { version: u8, entries: Vec<HistoryEntry> }
fn history(tx: &Transaction) -> AppResult<HistoryFile> {
    let value = tx.read_json::<HistoryFile>()?.unwrap_or(HistoryFile { version: 1, entries: vec![] });
    if value.version != 1 { return Err(corrupt()); } Ok(value)
}
pub struct HistoryStore { path: PathBuf }
impl HistoryStore {
    pub fn new(path: PathBuf) -> Self { Self { path } }
    pub fn add(&mut self, input: &HistoryAddRequest) -> AppResult<HistoryEntry> {
        let tx = transaction(&self.path)?; let mut data = history(&tx)?;
        let canonical = canonicalize_for_history(&input.url);
        let visited_at = input.visited_at.unwrap_or_else(now_millis);
        let entry = if let Some(e) = data.entries.iter_mut().find(|e| e.url == canonical) {
            e.visited_at = visited_at; e.visit_count += 1;
            if !input.title.is_empty() { e.title = input.title.clone(); } e.clone()
        } else {
            let e = HistoryEntry { id: next_id("hist"), title: if input.title.is_empty() { canonical.clone() } else { input.title.clone() }, url: canonical, visited_at, visit_count: 1 };
            data.entries.push(e.clone()); e
        };
        if data.entries.len() > 10_000 { data.entries.drain(..data.entries.len() - 10_000); }
        tx.write_json(&data)?; Ok(entry)
    }
    pub fn query(&mut self, q: &HistoryQuery) -> AppResult<Vec<HistoryEntry>> {
        let tx = transaction(&self.path)?; let data = history(&tx)?;
        let search = q.search.as_deref().unwrap_or("").trim().to_lowercase();
        let mut entries: Vec<_> = data.entries.into_iter().filter(|e| e.visited_at >= q.since.unwrap_or(0) && (search.is_empty() || e.url.to_lowercase().contains(&search) || e.title.to_lowercase().contains(&search))).collect();
        entries.sort_by_key(|e| std::cmp::Reverse(e.visited_at)); entries.truncate(q.limit.unwrap_or(100)); Ok(entries)
    }
    pub fn delete(&mut self, id: &str) -> AppResult<bool> {
        let tx = transaction(&self.path)?; let mut data = history(&tx)?; let before = data.entries.len();
        data.entries.retain(|e| e.id != id); let removed = before != data.entries.len();
        if removed { tx.write_json(&data)?; } Ok(removed)
    }
    pub fn clear(&mut self) -> AppResult<()> {
        let tx = transaction(&self.path)?; let mut data = history(&tx)?; data.entries.clear(); tx.write_json(&data)
    }
}
#[derive(Serialize, Deserialize)]
struct BookmarksFile { version: u8, bookmarks: Vec<Bookmark> }
fn bookmarks(tx: &Transaction) -> AppResult<BookmarksFile> {
    let value = tx.read_json::<BookmarksFile>()?.unwrap_or(BookmarksFile { version: 1, bookmarks: vec![] });
    if value.version != 1 { return Err(corrupt()); } Ok(value)
}
pub struct BookmarksStore { path: PathBuf }
impl BookmarksStore {
    pub fn new(path: PathBuf) -> Self { Self { path } }
    pub fn list(&mut self) -> AppResult<Vec<Bookmark>> { Ok(bookmarks(&transaction(&self.path)?)?.bookmarks) }
    pub fn add(&mut self, req: &BookmarkAddRequest) -> AppResult<Bookmark> {
        let tx = transaction(&self.path)?; let mut data = bookmarks(&tx)?;
        let item = Bookmark { id: next_id("bm"), url: req.url.clone(), title: req.title.clone(), folder_id: req.folder_id.clone(), added_at: now_millis() };
        data.bookmarks.push(item.clone()); tx.write_json(&data)?; Ok(item)
    }
    pub fn delete(&mut self, id: &str) -> AppResult<bool> {
        let tx = transaction(&self.path)?; let mut data = bookmarks(&tx)?; let before = data.bookmarks.len();
        data.bookmarks.retain(|b| b.id != id); let removed = before != data.bookmarks.len();
        if removed { tx.write_json(&data)?; } Ok(removed)
    }
}
pub struct SessionStore { path: PathBuf }
impl SessionStore {
    pub fn new(path: PathBuf) -> Self { Self { path } }
    pub fn load(&self) -> AppResult<Option<SessionSnapshot>> {
        let tx = transaction(&self.path)?; let parsed = tx.read_json::<SessionSnapshot>()?;
        if parsed.as_ref().is_some_and(|s| s.version != 1 || s.tabs.iter().any(|t| t.is_incognito)) { return Err(corrupt()); }
        Ok(parsed)
    }
    pub fn save(&self, tabs: &[TabState], navstacks: &HashMap<String, NavStack>, _order: &[String], active_id: Option<&str>) -> AppResult<()> {
        let tx = transaction(&self.path)?;
        if let Some(old) = tx.read_json::<SessionSnapshot>()? { if old.version != 1 { return Err(corrupt()); } }
        let session_tabs: Vec<_> = tabs.iter().filter(|t| !t.is_incognito && t.is_dark_web != Some(true)).map(|t| SessionTab {
            id: t.id.clone(), url: t.url.clone(), pending_url: t.pending_url.clone(), title: t.title.clone(), is_incognito: false, agent: t.profile == "agent",
            navigation: navstacks.get(&t.id).map(|s| s.to_session()).unwrap_or_else(|| NavStack::new().to_session()),
        }).collect();
        let ids: Vec<_> = session_tabs.iter().map(|t| t.id.clone()).collect();
        let active_id = active_id.filter(|id| ids.iter().any(|x| x == id)).map(str::to_owned);
        tx.write_json(&SessionSnapshot { version: 1, tabs: session_tabs, order: ids, active_id })
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
        }).unwrap();
        store.add(&HistoryAddRequest {
            url: "https://a.io/x".into(), // same canonical URL → upsert
            title: "A2".into(),
            visited_at: Some(200),
        }).unwrap();
        let all = store.query(&HistoryQuery {
            limit: Some(10),
            since: None,
            search: None,
        }).unwrap();
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
        }).unwrap();
        store.add(&HistoryAddRequest {
            url: "https://news.ycombinator.com".into(),
            title: "HN".into(),
            visited_at: Some(20),
        }).unwrap();
        let found = store.query(&HistoryQuery {
            limit: None,
            since: Some(15),
            search: Some("github".into()),
        }).unwrap();
        assert!(found.is_empty(), "github entry visited at 10 < since 15");
        let found = store.query(&HistoryQuery {
            limit: None,
            since: Some(5),
            search: Some("hn".into()),
        }).unwrap();
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
        }).unwrap();
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
        }).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        let id = store.list().unwrap()[0].id.clone();
        assert!(store.delete(&id).unwrap());
        assert!(store.list().unwrap().is_empty());
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
            profile: "default".into(), egress: "direct".into(), owner_run: None,
            unread_count: 0,
            is_discarded: false,
            created_at: 1,
            last_activated_at: 1,
        };
        store.save(std::slice::from_ref(&incognito_tab), &Default::default(), &[], Some("tab-x")).unwrap();
        assert!(store.load().unwrap().is_none() || store.load().unwrap().unwrap().tabs.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn session_persists_navigation_stacks_for_restore() {
        let dir = temp_dir();
        let store = SessionStore::new(dir.join("session.json"));
        let mut stacks = HashMap::new();
        let mut stack = NavStack::new();
        stack.commit("https://a.io/1");
        stack.commit("https://a.io/2");
        stack.go_back(); // at /1 with forward history
        stacks.insert("tab-a".to_string(), stack);
        let mut plain = TabState {
            id: "tab-a".into(),
            url: "https://a.io/1".into(),
            pending_url: String::new(),
            title: "A".into(),
            load_state: crate::types::TabLoadState::Committed,
            error: None,
            can_go_back: true,
            can_go_forward: true,
            is_incognito: false,
            is_dark_web: None,
            is_active: true,
            is_audio_playing: false,
            profile: "default".into(), egress: "direct".into(), owner_run: None,
            unread_count: 0,
            is_discarded: false,
            created_at: 1,
            last_activated_at: 1,
        };
        store.save(std::slice::from_ref(&plain), &stacks, &[], Some("tab-a")).unwrap();
        let snap = store.load().unwrap().unwrap();
        assert_eq!(snap.tabs.len(), 1);
        let nav = &snap.tabs[0].navigation;
        assert!(nav.back_stack.is_empty());
        assert_eq!(nav.current.as_deref(), Some("https://a.io/1"));
        assert_eq!(nav.forward_stack, vec!["https://a.io/2"]);
        // A tab without a stack entry still saves a well-formed empty one.
        plain.id = "tab-b".to_string();
        store.save(std::slice::from_ref(&plain), &stacks, &[], Some("tab-b")).unwrap();
        let snap = store.load().unwrap().unwrap();
        assert!(snap.tabs[0].navigation.current.is_none());
        fs::remove_dir_all(&dir).ok();
    }
}
