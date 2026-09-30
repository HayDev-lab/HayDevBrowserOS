//! Tab registry — Rust port of the pure TS `TabManager` state machine
//! (`src/main/browser/pure/tab-manager.ts`). Semantics (activation on open,
//! right-neighbour activation on close with left/none overrides, uuid ids,
//! order array) are kept identical; covered by unit tests below.

use std::collections::HashMap;

use crate::types::{OpenTabRequest, TabLoadState, TabState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivateAfterClose {
    Right,
    Left,
    None,
}

/// Outcome of a registry mutation the runtime layer applies to webviews.
#[derive(Debug, Clone, PartialEq)]
pub enum RegistryEvent {
    /// New tab added; webview should be created.
    Opened(String),
    /// Tab removed; webview should be destroyed. Next active id, if any.
    Closed {
        tab_id: String,
        next_active: Option<String>,
    },
    /// Tab became active; show its webview, hide the previous.
    Activated {
        tab_id: String,
        prev: Option<String>,
    },
}

#[derive(Default)]
pub struct TabRegistry {
    tabs: HashMap<String, TabState>,
    order: Vec<String>,
    active_id: Option<String>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl TabRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Port of `openTab`. Returns the new id plus the events the runtime
    /// layer must apply (webview creation, optional activation).
    pub fn open(&mut self, req: &OpenTabRequest) -> Result<(String, Vec<RegistryEvent>), String> {
        let id = req
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if self.tabs.contains_key(&id) {
            return Err(format!("tab id already exists: {id}"));
        }
        let now = now_millis();
        let url = req.url.trim().to_string();
        let tab = TabState {
            id: id.clone(),
            url: String::new(),
            pending_url: url.clone(),
            title: req.title.clone().unwrap_or(url),
            load_state: TabLoadState::Idle,
            error: None,
            can_go_back: false,
            can_go_forward: false,
            is_incognito: req.incognito.unwrap_or(false),
            is_dark_web: Some(req.darkweb.unwrap_or(false)),
            is_active: false,
            is_audio_playing: false,
            unread_count: 0,
            is_discarded: false,
            created_at: now,
            last_activated_at: now,
        };
        self.tabs.insert(id.clone(), tab);
        self.order.push(id.clone());

        let mut events = vec![RegistryEvent::Opened(id.clone())];
        let should_activate = req.activate.unwrap_or(true) && !req.background.unwrap_or(false);
        if should_activate {
            if let Some(ev) = self.activate(&id) {
                events.push(ev);
            }
        }
        Ok((id, events))
    }

    /// Port of `activateTab`. Returns an event when the active tab changed.
    pub fn activate(&mut self, tab_id: &str) -> Option<RegistryEvent> {
        if !self.tabs.contains_key(tab_id) {
            return None;
        }
        if self.active_id.as_deref() == Some(tab_id) {
            return None;
        }
        let prev = self.active_id.take();
        if let Some(p) = &prev {
            if let Some(tab) = self.tabs.get_mut(p) {
                tab.is_active = false;
            }
        }
        self.active_id = Some(tab_id.to_string());
        let tab = self.tabs.get_mut(tab_id)?;
        tab.is_active = true;
        tab.last_activated_at = now_millis();
        Some(RegistryEvent::Activated {
            tab_id: tab_id.to_string(),
            prev,
        })
    }

    /// Port of `closeTab`. Returns the removal event with next-active id.
    pub fn close(&mut self, tab_id: &str, strategy: ActivateAfterClose) -> Option<RegistryEvent> {
        self.tabs.get(tab_id)?;
        let idx = match self.order.iter().position(|id| id == tab_id) {
            Some(i) => i,
            None => {
                // Inconsistent state — remove the entry, skip re-activation.
                self.tabs.remove(tab_id);
                return Some(RegistryEvent::Closed {
                    tab_id: tab_id.to_string(),
                    next_active: self.active_id.clone(),
                });
            }
        };
        self.order.remove(idx);
        self.tabs.remove(tab_id);

        let was_active = self.active_id.as_deref() == Some(tab_id);
        let next_active = if was_active {
            self.active_id = None;
            let candidate = match strategy {
                ActivateAfterClose::Right if idx < self.order.len() => self.order.get(idx).cloned(),
                ActivateAfterClose::Left if idx > 0 => self.order.get(idx - 1).cloned(),
                _ if !self.order.is_empty() => {
                    self.order.get(idx.min(self.order.len() - 1)).cloned()
                }
                _ => None,
            };
            if let Some(c) = &candidate {
                self.active_id = Some(c.clone());
                if let Some(tab) = self.tabs.get_mut(c) {
                    tab.is_active = true;
                    tab.last_activated_at = now_millis();
                }
            }
            candidate
        } else {
            self.active_id.clone()
        };

        Some(RegistryEvent::Closed {
            tab_id: tab_id.to_string(),
            next_active,
        })
    }

    pub fn get(&self, tab_id: &str) -> Option<&TabState> {
        self.tabs.get(tab_id)
    }

    pub fn get_mut(&mut self, tab_id: &str) -> Option<&mut TabState> {
        self.tabs.get_mut(tab_id)
    }

    pub fn list(&self) -> Vec<TabState> {
        self.order
            .iter()
            .filter_map(|id| self.tabs.get(id))
            .cloned()
            .collect()
    }

    pub fn active_id(&self) -> Option<&str> {
        self.active_id.as_deref()
    }

    pub fn order(&self) -> &[String] {
        &self.order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(url: &str) -> OpenTabRequest {
        OpenTabRequest {
            url: url.to_string(),
            activate: None,
            incognito: None,
            darkweb: None,
            background: None,
            id: Some(format!("tab-{url}")),
            title: None,
        }
    }

    #[test]
    fn open_activates_by_default() {
        let mut r = TabRegistry::new();
        let (id, events) = r.open(&req("a")).unwrap();
        assert_eq!(r.active_id(), Some(id.as_str()));
        assert!(matches!(events[0], RegistryEvent::Opened(_)));
        assert!(matches!(events[1], RegistryEvent::Activated { .. }));
    }

    #[test]
    fn background_open_does_not_activate() {
        let mut r = TabRegistry::new();
        let (first, _) = r.open(&req("a")).unwrap();
        let mut b = req("b");
        b.background = Some(true);
        let (second, events) = r.open(&b).unwrap();
        assert_eq!(r.active_id(), Some(first.as_str()));
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], RegistryEvent::Opened(_)));
        assert_ne!(first, second);
    }

    #[test]
    fn close_activates_right_neighbour() {
        let mut r = TabRegistry::new();
        let (a, _) = r.open(&req("a")).unwrap();
        let (b, _) = r.open(&req("b")).unwrap();
        let (c, _) = r.open(&req("c")).unwrap();
        assert_eq!(r.active_id(), Some(c.as_str()));
        let ev = r.close(&c, ActivateAfterClose::Right).unwrap();
        assert_eq!(
            ev,
            RegistryEvent::Closed {
                tab_id: c.clone(),
                next_active: Some(b.clone())
            }
        );
        assert_eq!(r.active_id(), Some(b.as_str()));
        assert_eq!(r.list().len(), 2);
        assert!(r.get(&a).is_some());
    }

    #[test]
    fn close_left_neighbour_when_last() {
        let mut r = TabRegistry::new();
        let (a, _) = r.open(&req("a")).unwrap();
        let (b, _) = r.open(&req("b")).unwrap();
        let RegistryEvent::Closed { next_active, .. } =
            r.close(&b, ActivateAfterClose::Right).unwrap()
        else {
            panic!("expected Closed event");
        };
        assert_eq!(
            next_active,
            Some(a),
            "closing the last tab falls back to the left neighbour"
        );
    }

    #[test]
    fn close_last_tab_leaves_none() {
        let mut r = TabRegistry::new();
        let (a, _) = r.open(&req("a")).unwrap();
        let RegistryEvent::Closed { next_active, .. } =
            r.close(&a, ActivateAfterClose::Right).unwrap()
        else {
            panic!("expected Closed event");
        };
        assert_eq!(next_active, None);
        assert!(r.list().is_empty());
    }

    #[test]
    fn duplicate_ids_rejected() {
        let mut r = TabRegistry::new();
        assert!(r.open(&req("a")).is_ok());
        assert!(r.open(&req("a")).is_err());
    }

    #[test]
    fn activate_switches_active_flag() {
        let mut r = TabRegistry::new();
        let (a, _) = r.open(&req("a")).unwrap();
        let (b, _) = r.open(&req("b")).unwrap();
        assert!(r.get(&b).unwrap().is_active);
        let ev = r.activate(&a).unwrap();
        assert_eq!(
            ev,
            RegistryEvent::Activated {
                tab_id: a.clone(),
                prev: Some(b.clone())
            }
        );
        assert!(r.get(&a).unwrap().is_active);
        assert!(!r.get(&b).unwrap().is_active);
    }
}
