//! Per-tab navigation stack — Rust counterpart of the TS `NavigationStack`.
//!
//! Tauri's webview API exposes no native back/forward query, so the stack is
//! maintained here from page-load commits and reconciled when the committed
//! URL does not match a neighbouring position (e.g. in-page JS navigation).

use crate::types::SessionTabNavigation;

#[derive(Debug, Default)]
pub struct NavStack {
    entries: Vec<String>,
    /// Current position; None until the first commit.
    index: Option<usize>,
}

impl NavStack {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn can_go_back(&self) -> bool {
        self.index.map(|i| i > 0).unwrap_or(false)
    }

    pub fn can_go_forward(&self) -> bool {
        match self.index {
            Some(i) => i + 1 < self.entries.len(),
            None => false,
        }
    }

    /// Record a committed navigation URL (page-load Finished).
    pub fn commit(&mut self, url: &str) {
        match self.index {
            None => {
                self.entries.push(url.to_string());
                self.index = Some(0);
            }
            Some(i) => {
                if self.entries[i] == url {
                    // Same URL re-committed (reload) — no stack change.
                    return;
                }
                if i > 0 && self.entries[i - 1] == url {
                    self.index = Some(i - 1); // history.back() landed
                    return;
                }
                if i + 1 < self.entries.len() && self.entries[i + 1] == url {
                    self.index = Some(i + 1); // history.forward() landed
                    return;
                }
                // New navigation: truncate forward history and push.
                self.entries.truncate(i + 1);
                self.entries.push(url.to_string());
                self.index = Some(i + 1);
            }
        }
    }

    /// Optimistically move back when `history.back()` is evaluated.
    pub fn go_back(&mut self) {
        if let Some(i) = self.index {
            if i > 0 {
                self.index = Some(i - 1);
            }
        }
    }

    /// Optimistically move forward when `history.forward()` is evaluated.
    pub fn go_forward(&mut self) {
        if let Some(i) = self.index {
            if i + 1 < self.entries.len() {
                self.index = Some(i + 1);
            }
        }
    }

    /// Current committed URL, if any.
    pub fn current(&self) -> Option<&str> {
        self.index.map(|i| self.entries[i].as_str())
    }

    /// Session-persistable snapshot (matches `SessionTabNavigation`).
    pub fn to_session(&self) -> SessionTabNavigation {
        match self.index {
            Some(i) => SessionTabNavigation {
                back_stack: self.entries[..i].to_vec(),
                current: self.entries.get(i).cloned(),
                forward_stack: self
                    .entries
                    .get(i + 1..)
                    .map(|s| s.to_vec())
                    .unwrap_or_default(),
            },
            None => SessionTabNavigation {
                back_stack: Vec::new(),
                current: None,
                forward_stack: Vec::new(),
            },
        }
    }

    /// Restore from a session snapshot.
    pub fn from_session(nav: &SessionTabNavigation) -> Self {
        let mut entries = nav.back_stack.clone();
        let current_idx = if let Some(cur) = &nav.current {
            entries.push(cur.clone());
            Some(entries.len() - 1)
        } else {
            None
        };
        entries.extend(nav.forward_stack.iter().cloned());
        Self {
            entries,
            index: current_idx,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pushes_and_truncates() {
        let mut s = NavStack::new();
        s.commit("a");
        s.commit("b");
        s.commit("c");
        assert!(s.can_go_back());
        assert!(!s.can_go_forward());
        s.go_back();
        s.commit("b"); // back landed
        s.commit("x"); // new entry truncates forward 'c'
        assert_eq!(s.current(), Some("x"));
        assert!(!s.can_go_forward());
    }

    #[test]
    fn forward_reconciles() {
        let mut s = NavStack::new();
        s.commit("a");
        s.commit("b");
        s.go_back(); // -> a
        assert_eq!(s.current(), Some("a"));
        s.go_forward();
        s.commit("b"); // forward landed on b
        assert!(s.can_go_back());
        assert!(!s.can_go_forward());
    }

    #[test]
    fn session_roundtrip() {
        let mut s = NavStack::new();
        s.commit("a");
        s.commit("b");
        s.commit("c");
        s.go_back(); // at b
        let snap = s.to_session();
        assert_eq!(snap.back_stack, vec!["a"]);
        assert_eq!(snap.current.as_deref(), Some("b"));
        assert_eq!(snap.forward_stack, vec!["c"]);
        let restored = NavStack::from_session(&snap);
        assert_eq!(restored.current(), Some("b"));
        assert!(restored.can_go_back());
        assert!(restored.can_go_forward());
    }
}
