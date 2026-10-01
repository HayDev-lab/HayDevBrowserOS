//! MemoryStore — confirmed user facts + the confirmation-prompt flow
//! (port of Electron `memory-store.ts` + `proposeMemoryFact`).
//!
//! Writes happen ONLY through `confirm()` — the agent's memory.save tool
//! merely PROPOSES a fact, surfaced as a prompt in the rail via the
//! `memory:prompt:update` push; the user's explicit answer (memory_prompt_
//! resolve) is the only path into the store.
//!
//! Persisted shape mirrors Electron: {version:1, facts:[{id,fact,createdAt}]}
//! in `<data-dir>/memory.json` — both runtimes can read each other's file.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Parity: MEMORY_BOUNDS.
pub const MAX_FACT_LENGTH: usize = 300;
pub const MAX_FACTS: usize = 100;
/// Facts injected into the system prompt (parity: factTexts(50)).
const PROMPT_FACTS: usize = 50;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UserFact {
    pub id: String,
    pub fact: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

/// The pending confirmation prompt (Electron MemorySavePrompt shape).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MemoryPrompt {
    pub id: String,
    pub fact: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

#[derive(Default)]
pub struct MemoryState {
    facts: Vec<UserFact>,
    pending: Option<MemoryPrompt>,
    loaded: bool,
    data_dir: Option<PathBuf>,
}

pub type SharedMemory = Mutex<MemoryState>;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fact_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join("memory.json")
}

impl MemoryState {
    fn load(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let Some(dir) = self.data_dir.clone() else { return };
        let Ok(raw) = std::fs::read_to_string(fact_path(&dir)) else { return };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
        if v.get("version").and_then(|x| x.as_i64()) != Some(1) {
            return; // corrupt/foreign file — start clean
        }
        if let Some(arr) = v.get("facts").and_then(|x| x.as_array()) {
            self.facts = arr
                .iter()
                .filter_map(|f| {
                    Some(UserFact {
                        id: f.get("id")?.as_str()?.to_string(),
                        fact: f.get("fact")?.as_str()?.to_string(),
                        created_at: f.get("createdAt").and_then(|c| c.as_u64()).unwrap_or(0),
                    })
                })
                .collect();
        }
    }

    fn persist(&self) {
        let Some(dir) = self.data_dir.clone() else { return };
        let doc = serde_json::json!({ "version": 1, "facts": self.facts });
        let _ = std::fs::write(
            fact_path(&dir),
            serde_json::to_string_pretty(&doc).unwrap_or_default(),
        );
    }

    /// Fact texts for the system prompt (bounded, oldest first).
    pub fn fact_texts(&self) -> Vec<String> {
        self.facts
            .iter()
            .rev()
            .take(PROMPT_FACTS)
            .rev()
            .map(|f| f.fact.clone())
            .collect()
    }

    /// Store a confirmed fact: normalize whitespace, cap length, dedupe
    /// (case-insensitive → existing id), evict oldest past the limit.
    pub fn confirm(&mut self, raw: &str) -> Option<UserFact> {
        let fact: String = raw
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(MAX_FACT_LENGTH)
            .collect();
        if fact.is_empty() {
            return None;
        }
        if let Some(existing) = self
            .facts
            .iter()
            .find(|f| f.fact.eq_ignore_ascii_case(&fact))
        {
            return Some(existing.clone());
        }
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let record = UserFact {
            id: format!(
                "fact_{:x}_{}",
                now_ms(),
                SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ),
            fact: fact.clone(),
            created_at: now_ms(),
        };
        self.facts.push(record.clone());
        while self.facts.len() > MAX_FACTS {
            self.facts.remove(0);
        }
        self.persist();
        Some(record)
    }

    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.facts.len();
        self.facts.retain(|f| f.id != id);
        if self.facts.len() == before {
            return false;
        }
        self.persist();
        true
    }

    pub fn list(&self) -> Vec<UserFact> {
        self.facts.clone()
    }
}

/// Agent-side proposal: stage the pending prompt and push it to the rail.
/// Only called from the memory.save tool dispatch (agent.rs).
pub fn propose(app: &AppHandle<tauri::Wry>, fact: &str) {
    let prompt = MemoryPrompt {
        id: format!("mem_{:x}_{}", now_ms(), std::process::id()),
        fact: fact.chars().take(MAX_FACT_LENGTH).collect(),
        created_at: now_ms(),
    };
    {
        let state = app.state::<SharedMemory>();
        let mut st = state.lock().unwrap_or_else(|p| p.into_inner());
        st.load();
        st.pending = Some(prompt.clone());
    }
    let _ = app.emit(
        "memory:prompt:update",
        serde_json::json!({ "kind": "set", "prompt": prompt }),
    );
}

/// Resolve the pending prompt (memory_prompt_resolve command). A mismatched
/// id, a missing prompt or `save=false` all clear the rail honestly.
pub fn resolve(app: &AppHandle<tauri::Wry>, prompt_id: &str, save: bool) -> bool {
    let state = app.state::<SharedMemory>();
    let mut st = state.lock().unwrap_or_else(|p| p.into_inner());
    st.load();
    let pending = st.pending.take();
    let _ = app.emit(
        "memory:prompt:update",
        serde_json::json!({ "kind": "clear" }),
    );
    match pending {
        Some(p) if p.id == prompt_id && save => st.confirm(&p.fact).is_some(),
        _ => false,
    }
}

/// Current pending prompt for the renderer's initial fetch.
pub fn current(app: &AppHandle<tauri::Wry>) -> Option<MemoryPrompt> {
    let state = app.state::<SharedMemory>();
    let mut st = state.lock().unwrap_or_else(|p| p.into_inner());
    st.load();
    st.pending.clone()
}

/// Wire the store's data dir at startup (called from lib.rs setup).
pub fn init(app: &AppHandle<tauri::Wry>) {
    let state = app.state::<SharedMemory>();
    let mut st = state.lock().unwrap_or_else(|p| p.into_inner());
    st.data_dir = Some(crate::lib_app_data_dir());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> MemoryState {
        MemoryState { loaded: true, ..Default::default() }
    }

    #[test]
    fn confirm_normalizes_and_dedupes() {
        let mut st = state();
        let a = st.confirm("  likes   dark  themes  ").unwrap();
        assert_eq!(a.fact, "likes dark themes");
        let b = st.confirm("Likes Dark  THEMES").unwrap();
        assert_eq!(a.id, b.id, "case-insensitive dedupe must return the SAME fact");
    }

    #[test]
    fn confirm_rejects_empty_and_caps_length() {
        let mut st = state();
        assert!(st.confirm("   ").is_none());
        let long = "x".repeat(500);
        let f = st.confirm(&long).unwrap();
        assert_eq!(f.fact.chars().count(), MAX_FACT_LENGTH);
    }

    #[test]
    fn evicts_oldest_past_limit() {
        let mut st = state();
        for i in 0..(MAX_FACTS + 10) {
            st.confirm(&format!("fact number {i}"));
        }
        assert_eq!(st.list().len(), MAX_FACTS);
        assert_eq!(st.list()[0].fact, "fact number 10", "oldest evicted first");
    }

    #[test]
    fn delete_removes_and_reports_misses() {
        let mut st = state();
        let f = st.confirm("known fact").unwrap();
        assert!(st.delete(&f.id));
        assert!(!st.delete(&f.id));
        assert!(st.list().is_empty());
    }

    #[test]
    fn fact_texts_bounded_oldest_first() {
        let mut st = state();
        for i in 0..60 {
            st.confirm(&format!("f{i}"));
        }
        let texts = st.fact_texts();
        assert_eq!(texts.len(), PROMPT_FACTS);
        assert_eq!(texts[0], "f10", "oldest 50 of 60, in order");
    }
}
