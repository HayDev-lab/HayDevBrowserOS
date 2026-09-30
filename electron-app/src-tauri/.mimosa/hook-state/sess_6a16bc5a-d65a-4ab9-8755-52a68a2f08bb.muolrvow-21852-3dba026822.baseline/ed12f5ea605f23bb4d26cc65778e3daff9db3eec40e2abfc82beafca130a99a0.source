//! Shared DTOs — byte-compatible (camelCase) with `src/shared/browser-types.ts`.
//!
//! Field names and persisted JSON shapes MUST stay identical so the same
//! userData files work under both the Electron and Tauri runtimes.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabLoadState {
    Idle,
    Loading,
    Committed,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
    pub id: String,
    /// Last committed URL (post-redirect). Empty for a fresh tab.
    pub url: String,
    /// URL the user typed / requested.
    pub pending_url: String,
    pub title: String,
    pub load_state: TabLoadState,
    pub error: Option<String>,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub is_incognito: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dark_web: Option<bool>,
    pub is_active: bool,
    pub is_audio_playing: bool,
    pub unread_count: u64,
    pub is_discarded: bool,
    pub created_at: u64,
    pub last_activated_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTabRequest {
    pub url: String,
    pub activate: Option<bool>,
    pub incognito: Option<bool>,
    pub darkweb: Option<bool>,
    pub background: Option<bool>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigateRequest {
    pub tab_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabIdRequest {
    pub tab_id: String,
}

/// BrowserAutomationBridge: type into a selector (React-safe).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeTypeRequest {
    pub tab_id: String,
    pub selector: String,
    pub text: String,
    #[serde(default)]
    pub clear: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvalRequest {
    pub tab_id: String,
    pub expression: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSelectorRequest {
    pub tab_id: String,
    pub selector: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeKeyRequest {
    pub tab_id: String,
    pub key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeScrollRequest {
    pub tab_id: String,
    pub dx: i64,
    pub dy: i64,
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    /// Epoch milliseconds of the most recent visit.
    pub visited_at: u64,
    pub visit_count: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryQuery {
    pub limit: Option<usize>,
    pub since: Option<u64>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryAddRequest {
    pub url: String,
    pub title: String,
    pub visited_at: Option<u64>,
}

#[derive(Serialize)]
struct PersistedHistory {
    version: u8,
    entries: Vec<HistoryEntry>,
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub added_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkAddRequest {
    pub url: String,
    pub title: String,
    pub folder_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStateName {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItemState {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub state: DownloadStateName,
    pub total_bytes: u64,
    pub received_bytes: u64,
    pub start_time: u64,
    pub end_time: Option<u64>,
    pub save_path: Option<String>,
    pub mime_type: Option<String>,
    pub error: Option<String>,
    pub tab_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTabNavigation {
    pub back_stack: Vec<String>,
    pub current: Option<String>,
    pub forward_stack: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    pub url: String,
    pub pending_url: String,
    pub title: String,
    pub is_incognito: bool,
    pub navigation: SessionTabNavigation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub version: u8,
    pub tabs: Vec<SessionTab>,
    pub order: Vec<String>,
    pub active_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub electron: String,
    pub chrome: String,
    pub node: String,
    pub app_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub endpoint: String,
    pub reachable: bool,
    /// Managed-engine phase: "ready" | "starting" | "offline" (footer chip).
    pub state: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoundationPingPayload {
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub sent_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundationPingResult {
    pub received_at: u64,
    pub echoed: FoundationPingPayload,
}

/// Helper: history persisted-file wrapper (format parity with the TS store).
pub fn persisted_history_json(entries: &[HistoryEntry]) -> String {
    serde_json::to_string(&PersistedHistory {
        version: 1,
        entries: entries.to_vec(),
    })
    .unwrap_or_else(|_| "{\"version\":1,\"entries\":[]}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The renderer contract (src/shared/browser-types.ts) is camelCase —
    /// regression guard for the TabState wire format.
    #[test]
    fn tab_state_serializes_camel_case() {
        let tab = TabState {
            id: "t1".into(),
            url: "https://a.io".into(),
            pending_url: "a.io".into(),
            title: "A".into(),
            load_state: TabLoadState::Committed,
            error: None,
            can_go_back: true,
            can_go_forward: false,
            is_incognito: false,
            is_dark_web: Some(false),
            is_active: true,
            is_audio_playing: false,
            unread_count: 3,
            is_discarded: false,
            created_at: 1,
            last_activated_at: 2,
        };
        let json = serde_json::to_value(&tab).unwrap();
        assert!(json.get("loadState").is_some(), "loadState missing: {json}");
        assert!(json.get("isActive").is_some(), "isActive missing: {json}");
        assert!(json.get("canGoBack").is_some(), "canGoBack missing: {json}");
        assert!(
            json.get("unreadCount").is_some(),
            "unreadCount missing: {json}"
        );
        assert!(
            json.get("lastActivatedAt").is_some(),
            "lastActivatedAt missing: {json}"
        );
        assert!(
            json.get("load_state").is_none(),
            "snake_case leaked: {json}"
        );
    }
}
