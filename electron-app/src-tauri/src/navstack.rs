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
    /// Native-history window of THIS webview instance: the lowest and highest
    /// stack indices committed since creation. Entries restored from a
    /// previous session lie outside it, so native back/forward cannot reach
    /// them and navigation must go through an explicit URL. Set by the first
    /// commit; `from_session` resets both.
    native_lo: Option<usize>,
    native_hi: Option<usize>,
    /// Set while an explicit-URL navigation (a hop into restored history) is
    /// in flight. A `location.href` push reorders the webview's joint
    /// history away from this stack's order, so the landing commit must be
    /// recorded as a fresh navigation and the native window must collapse to
    /// the landing entry — later hops re-evaluate reachability from there.
    pending_explicit: Option<String>,
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

    /// Announce that the next page-load commit will be an explicit-URL
    /// navigation to `url` (used for restored-history hops).
    pub fn begin_explicit(&mut self, url: &str) {
        self.pending_explicit = Some(url.to_string());
    }

    /// Record a committed navigation URL (page-load Finished).
    pub fn commit(&mut self, url: &str) {
        if self.pending_explicit.as_deref() == Some(url) {
            self.pending_explicit = None;
            // An explicit hop into restored history moves to the landing
            // entry WITHOUT truncating forward history — forward entries stay
            // reachable through further explicit hops. The native window
            // collapses to the landing: the webview's joint history was
            // reordered by the URL navigation, so every neighbour
            // re-evaluates reachability from here.
            if let Some(i) = self.index {
                let pos = (0..self.entries.len())
                    .filter(|p| self.entries[*p] == url)
                    .min_by_key(|p| p.abs_diff(i));
                let pos = pos.unwrap_or_else(|| {
                    self.entries.truncate(i + 1);
                    self.entries.push(url.to_string());
                    i + 1
                });
                self.index = Some(pos);
                self.native_lo = Some(pos);
                self.native_hi = Some(pos);
            }
            return;
        }
        self.pending_explicit = None;
        match self.index {
            None => {
                self.entries.push(url.to_string());
                self.index = Some(0);
                self.native_lo = Some(0);
                self.native_hi = Some(0);
            }
            Some(i) => {
                if self.entries[i] == url {
                    // Same URL re-committed (reload or the restored current
                    // page's first load) — the instance has now visited i.
                    let lo = self.native_lo.get_or_insert(i);
                    *lo = (*lo).min(i);
                    let hi = self.native_hi.get_or_insert(i);
                    *hi = (*hi).max(i);
                    return;
                }
                if i > 0 && self.entries[i - 1] == url {
                    self.index = Some(i - 1); // history.back() (or a direct nav to the back entry) landed
                    let lo = self.native_lo.get_or_insert(i - 1);
                    *lo = (*lo).min(i - 1);
                    let hi = self.native_hi.get_or_insert(i - 1);
                    *hi = (*hi).max(i - 1);
                    return;
                }
                if i + 1 < self.entries.len() && self.entries[i + 1] == url {
                    self.index = Some(i + 1); // history.forward() (or a direct nav to the forward entry) landed
                    let lo = self.native_lo.get_or_insert(i + 1);
                    *lo = (*lo).min(i + 1);
                    let hi = self.native_hi.get_or_insert(i + 1);
                    *hi = (*hi).max(i + 1);
                    return;
                }
                // New navigation: truncate forward history and push.
                self.entries.truncate(i + 1);
                self.entries.push(url.to_string());
                self.index = Some(i + 1);
                let hi = self.native_hi.get_or_insert(i + 1);
                *hi = (*hi).max(i + 1);
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

    /// Entry just behind/at-front of the current one, without moving.
    pub fn back_target(&self) -> Option<(usize, &str)> {
        self.index.filter(|i| *i > 0).map(|i| (i - 1, self.entries[i - 1].as_str()))
    }

    /// Entry just ahead of the current one, without moving.
    pub fn forward_target(&self) -> Option<(usize, &str)> {
        match self.index {
            Some(i) if i + 1 < self.entries.len() => Some((i + 1, self.entries[i + 1].as_str())),
            _ => None,
        }
    }

    /// False for entries restored from a previous session that this webview
    /// instance has never visited — native back/forward cannot reach them.
    pub fn native_reachable(&self, stack_index: usize) -> bool {
        self.native_lo.map_or(true, |lo| stack_index >= lo)
            && self.native_hi.map_or(true, |hi| stack_index <= hi)
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
            native_lo: None,
            native_hi: None,
            pending_explicit: None,
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

    #[test]
    fn restored_neighbours_outside_native_window_need_explicit_navigation() {
        let mut s = NavStack::new();
        s.commit("a");
        s.commit("b");
        s.commit("c");
        s.go_back(); // at b
        let mut restored = NavStack::from_session(&s.to_session());
        // First commit in the new instance opens the restored current page.
        restored.commit("b");
        // Back entry predates this instance's native history...
        let (back_idx, back_url) = restored.back_target().unwrap();
        assert_eq!(back_url, "a");
        assert!(!restored.native_reachable(back_idx));
        // ...and the forward entry was never visited in this instance.
        let (fwd_idx, fwd_url) = restored.forward_target().unwrap();
        assert_eq!(fwd_url, "c");
        assert!(!restored.native_reachable(fwd_idx));
        // An explicit hop is recorded against the landing entry WITHOUT
        // truncating forward history, and the native window collapses to the
        // landing so later hops re-evaluate reachability from there.
        restored.begin_explicit("a");
        restored.commit("a");
        assert_eq!(restored.current(), Some("a"));
        assert!(restored.back_target().is_none());
        let (fwd_idx, fwd_url) = restored.forward_target().unwrap();
        assert_eq!(fwd_url, "b");
        assert!(!restored.native_reachable(fwd_idx), "forward entry stays listed but needs an explicit hop");
        // The next explicit hop restores forward traversal entry by entry.
        restored.begin_explicit("b");
        restored.commit("b");
        assert_eq!(restored.current(), Some("b"));
        let (fwd_idx, fwd_url) = restored.forward_target().unwrap();
        assert_eq!(fwd_url, "c");
        assert!(!restored.native_reachable(fwd_idx));
        let (back_idx, back_url) = restored.back_target().unwrap();
        assert_eq!(back_url, "a");
        assert!(!restored.native_reachable(back_idx));
        // A stale explicit intent never hijacks an unrelated commit.
        restored.begin_explicit("nowhere");
        restored.commit("b");
        assert_eq!(restored.current(), Some("b"));
    }

    #[test]
    fn in_session_forward_stays_native_reachable() {
        let mut s = NavStack::new();
        s.commit("a");
        s.commit("b");
        s.commit("c");
        s.go_back(); // at b; c was visited in this instance
        let (fwd_idx, fwd_url) = s.forward_target().unwrap();
        assert_eq!(fwd_url, "c");
        assert!(s.native_reachable(fwd_idx));
        let (back_idx, back_url) = s.back_target().unwrap();
        assert_eq!(back_url, "a");
        assert!(s.native_reachable(back_idx));
    }
}
