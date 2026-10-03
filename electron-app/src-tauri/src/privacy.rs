//! Privacy & anonymity configuration (anonymity hardening).
//!
//! `privacy.json` in the app-data dir controls the per-profile network
//! egress and the PRIVATE-profile fingerprint-noise parameters. The
//! philosophy follows `profiles.rs`: one profile = one stable identity —
//! egress, locale and timezone are STABLE for the process lifetime, never
//! rotated per navigation (rotation reduces trust).
//!
//! Applied to webviews in `core::create_tab_webview`:
//! - PRIVATE  — own user-data folder (env independence) + InPrivate mode +
//!              privacy browser args + optional SOCKS5/Tor egress +
//!              fingerprint-noise init script.
//! - DARKWEB  — unchanged fail-closed Tor policy, plus the same privacy
//!              browser args (WebRTC lockdown, no component updates).
//! - AGENT    — optional custom egress; default stays direct (stable,
//!              honest identity).
//!
//! Header-level filtering (X-Client-Data, Referer) is NOT possible through
//! wry 0.55's WebResourceRequested hook (custom protocols only) — that
//! needs a local filtering proxy (future phase) and is documented honestly.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

/// Network egress for a profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Egress {
    /// Direct connection — no proxy (explicit, the AGENT default).
    Direct,
    /// Route through the bundled/installed Tor gateway when it is running;
    /// fall back to DIRECT when it is not (non-strict; logged).
    TorIfAvailable,
    /// Route through Tor or FAIL the tab creation (strict — the same
    /// fail-closed policy the darkweb tabs already have).
    TorStrict,
    /// A user-supplied SOCKS5 endpoint (own proxy / alternate Tor instance).
    Socks5 { host: String, port: u16 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SocksEndpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct PrivacyConfig {
    /// Network egress for PRIVATE (incognito) tabs.
    pub private_egress: Egress,
    /// Network egress for AGENT tabs.
    pub agent_egress: Egress,
    /// Locale override for PRIVATE tabs, e.g. "en-US" — feeds
    /// navigator.language(s) in the privacy init script. None = keep real.
    pub private_locale: Option<String>,
    /// IANA timezone override for PRIVATE tabs, e.g. "Europe/Amsterdam" —
    /// feeds Date.getTimezoneOffset + Intl.resolvedOptions. None = real.
    pub private_timezone: Option<String>,
    /// Route the agent's INVISIBLE web_fetch through the Tor gateway when
    /// it is available. Default false (explicit opt-in).
    pub agent_fetch_via_tor: bool,
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self {
            private_egress: Egress::TorIfAvailable,
            agent_egress: Egress::Direct,
            private_locale: None,
            private_timezone: None,
            agent_fetch_via_tor: false,
        }
    }
}

impl PrivacyConfig {
    pub fn path(app_data: &std::path::Path) -> PathBuf {
        app_data.join("privacy.json")
    }

    /// Load from `app_data/privacy.json`; missing file → defaults; broken
    /// JSON → defaults (fail-open for usability, the file is user-owned).
    pub fn load(app_data: &std::path::Path) -> Self {
        match std::fs::read_to_string(Self::path(app_data)) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                log::warn!("[PRIVACY] privacy.json parse failed ({e}) — using defaults");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, app_data: &std::path::Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into());
        std::fs::write(Self::path(app_data), json)
    }
}

/// Process-lifetime snapshot: read once at first use so all webviews of a
/// profile share ONE environment definition (WebView2 fails creation when
/// options mismatch across webviews of the same user-data folder).
pub fn global() -> &'static PrivacyConfig {
    static CFG: OnceLock<PrivacyConfig> = OnceLock::new();
    CFG.get_or_init(|| {
        let cfg = PrivacyConfig::load(&crate::lib_app_data_dir());
        log::info!(
            "[PRIVACY] config: private_egress={:?} agent_egress={:?} fetch_via_tor={} tz={:?} locale={:?}",
            cfg.private_egress,
            cfg.agent_egress,
            cfg.agent_fetch_via_tor,
            cfg.private_timezone,
            cfg.private_locale
        );
        cfg
    })
}

/// Resolve an `Egress` against the live Tor gateway.
/// `Ok(None)` = browse directly; `Err(msg)` = strict Tor demanded but the
/// gateway is down (fail closed, darkweb-tab parity).
pub fn resolve_egress(
    egress: &Egress,
    tor: Option<SocksEndpoint>,
) -> Result<Option<SocksEndpoint>, &'static str> {
    match egress {
        Egress::Direct => Ok(None),
        Egress::Socks5 { host, port } => Ok(Some(SocksEndpoint {
            host: host.clone(),
            port: *port,
        })),
        Egress::TorIfAvailable => Ok(tor),
        Egress::TorStrict => tor.map(Some).ok_or("the Tor gateway is not running"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sensible() {
        let c = PrivacyConfig::default();
        assert_eq!(c.private_egress, Egress::TorIfAvailable);
        assert_eq!(c.agent_egress, Egress::Direct);
        assert!(!c.agent_fetch_via_tor);
        assert!(c.private_locale.is_none() && c.private_timezone.is_none());
    }

    #[test]
    fn roundtrip_keeps_egress() {
        let dir = std::env::temp_dir().join(format!("hd-privacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = PrivacyConfig {
            private_egress: Egress::Socks5 {
                host: "127.0.0.1".into(),
                port: 9150,
            },
            agent_egress: Egress::TorStrict,
            private_locale: Some("en-US".into()),
            private_timezone: Some("Europe/Amsterdam".into()),
            agent_fetch_via_tor: true,
        };
        cfg.save(&dir).unwrap();
        let loaded = PrivacyConfig::load(&dir);
        assert_eq!(loaded, cfg);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn broken_json_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("hd-privacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(PrivacyConfig::path(&dir), "{ not json").unwrap();
        assert_eq!(PrivacyConfig::load(&dir), PrivacyConfig::default());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn egress_matrix() {
        let tor = Some(SocksEndpoint {
            host: "127.0.0.1".into(),
            port: 9050,
        });
        assert_eq!(resolve_egress(&Egress::Direct, tor.clone()).unwrap(), None);
        assert_eq!(resolve_egress(&Egress::TorIfAvailable, tor.clone()).unwrap(), tor);
        assert_eq!(resolve_egress(&Egress::TorStrict, tor.clone()).unwrap(), tor);
        assert!(resolve_egress(&Egress::TorStrict, None).is_err());
        assert_eq!(resolve_egress(&Egress::TorIfAvailable, None).unwrap(), None);
        assert_eq!(
            resolve_egress(
                &Egress::Socks5 {
                    host: "10.0.0.1".into(),
                    port: 1080
                },
                None
            )
            .unwrap()
            .unwrap()
            .port,
            1080
        );
    }
}
