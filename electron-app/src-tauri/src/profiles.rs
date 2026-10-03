//! BrowserProfileManager (migration Phase B) — WebView2 user-data folders.
//!
//! Profiles map 1:1 to WebView2 `data_directory` values (native cookie /
//! localStorage / IndexedDB / cache persistence — NO manual serialization):
//!
//! - DEFAULT — persistent, shared by normal tabs.
//! - AGENT   — persistent, dedicated to agent automation. Reused across
//!   tasks so login/trusted-device state survives (anti-bot principle:
//!   never a fresh browser every task).
//! - PRIVATE — ephemeral: `incognito(true)` (InPrivate: browsing data is
//!   never written) in its OWN user-data folder. The folder exists only to
//!   host an ISOLATED WebView2 environment (own proxy / privacy browser
//!   args — see privacy.rs) and is WIPED at every startup.
//!
//! The StableIdentityPolicy (Phase E) is intentionally a NO-OP rotation-wise:
//! one profile = one stable identity. UA/locale/timezone/GPU stay whatever
//! the runtime reports, unchanged across navigations — random rotation is
//! explicitly forbidden (it *reduces* trust).

use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileKind {
    Default,
    Agent,
    Private,
    /// Isolated Tor environment: dedicated user-data folder + SOCKS proxy,
    /// wiped at startup (Electron parity: memory:darkweb- partitions).
    DarkWeb,
}

impl ProfileKind {
    pub fn dir_name(self) -> &'static str {
        match self {
            ProfileKind::Default => "default",
            ProfileKind::Agent => "agent",
            ProfileKind::Private => "private",
            ProfileKind::DarkWeb => "darkweb",
        }
    }

    pub fn is_persistent(self) -> bool {
        !matches!(self, ProfileKind::Private)
    }
}

pub struct BrowserProfileManager {
    base: PathBuf,
}

impl BrowserProfileManager {
    pub fn new(app_data: &std::path::Path) -> Self {
        Self {
            base: app_data.join("profiles"),
        }
    }

    /// The WebView2 `data_directory` for a profile. Every profile — PRIVATE
    /// included — gets its own folder: PRIVATE needs environment isolation
    /// (own proxy/privacy args); InPrivate mode keeps the browsing data
    /// itself off disk and startup wipes complete the ephemeral guarantee.
    pub fn data_dir(&self, kind: ProfileKind) -> Option<PathBuf> {
        Some(self.base.join(kind.dir_name()))
    }

    /// Ensure the on-disk folder exists before a webview is attached.
    pub fn ensure(&self, kind: ProfileKind) -> std::io::Result<()> {
        if let Some(dir) = self.data_dir(kind) {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }

    /// Wipe a profile's persisted state. Caller must guarantee no live
    /// webview uses it (checked at the command layer).
    pub fn clear(&self, kind: ProfileKind) -> std::io::Result<bool> {
        let dir = self.data_dir(kind).expect("every profile has a data dir");
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
            std::fs::create_dir_all(&dir)?;
            return Ok(true);
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("hd-profiles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn default_and_agent_persist_private_does_not() {
        let m = BrowserProfileManager::new(&tmp());
        assert!(ProfileKind::Default.is_persistent());
        assert!(ProfileKind::Agent.is_persistent());
        assert!(!ProfileKind::Private.is_persistent());
        // PRIVATE still gets a data dir — for environment isolation only;
        // persistence policy (is_persistent=false + startup wipe) stays.
        assert!(m
            .data_dir(ProfileKind::Private)
            .unwrap()
            .ends_with("profiles/private"));
        assert!(m
            .data_dir(ProfileKind::Default)
            .unwrap()
            .ends_with("profiles/default"));
        assert!(m
            .data_dir(ProfileKind::Agent)
            .unwrap()
            .ends_with("profiles/agent"));
    }

    #[test]
    fn clear_removes_and_recreates() {
        let base = tmp();
        let m = BrowserProfileManager::new(&base);
        m.ensure(ProfileKind::Default).unwrap();
        let marker = m.data_dir(ProfileKind::Default).unwrap().join("Cookies");
        std::fs::write(&marker, b"x").unwrap();
        assert!(m.clear(ProfileKind::Default).unwrap());
        assert!(!marker.exists());
        assert!(m.data_dir(ProfileKind::Default).unwrap().exists());
        m.ensure(ProfileKind::Private).unwrap();
        assert!(m.clear(ProfileKind::Private).unwrap());
        std::fs::remove_dir_all(&base).ok();
    }
}
