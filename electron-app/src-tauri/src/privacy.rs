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
    /// HayDev Shield (PROMPT 07): network-level ad/tracker blocking in tab
    /// webviews. Default ON; toggleable at runtime (shield_set_enabled).
    pub shield_enabled: bool,
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self {
            private_egress: Egress::TorIfAvailable,
            agent_egress: Egress::Direct,
            private_locale: None,
            private_timezone: None,
            agent_fetch_via_tor: false,
            shield_enabled: true,
        }
    }
}

impl PrivacyConfig {
    pub fn path(app_data: &std::path::Path) -> PathBuf {
        app_data.join("privacy.json")
    }

    /// Load from `app_data/privacy.json`; missing file → defaults; broken
    /// JSON → fail-closed routing; the original is preserved for recovery.
    pub fn load(app_data: &std::path::Path) -> Self {
        match std::fs::read_to_string(Self::path(app_data)) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                log::error!("[PRIVACY] STORE_CORRUPT: privacy configuration requires recovery ({e})");
                Self { private_egress: Egress::TorStrict, agent_egress: Egress::TorStrict, agent_fetch_via_tor: true, ..Self::default() }
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(_) => {
                log::error!("[PRIVACY] STORE_UNREADABLE: routing denied until configuration is readable");
                Self { private_egress: Egress::TorStrict, agent_egress: Egress::TorStrict, agent_fetch_via_tor: true, ..Self::default() }
            },
        }
    }

    pub fn save(&self, app_data: &std::path::Path) -> crate::error::AppResult<()> {
        let tx = crate::atomic_store::transaction(&Self::path(app_data))?;
        tx.read_json::<Self>()?;
        tx.write_json(self)
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

/// Privacy browser args shared by PRIVATE and DARKWEB webviews: WebRTC must
/// never bypass proxies (real-IP leak), no component updates /
/// domain-reliability pings / crash-reporter phoning home. SmartScreen stays
/// off (wry default).
pub const PRIVACY_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --force-webrtc-ip-handling-policy=disable_non_proxied_udp --disable-component-update --disable-domain-reliability --disable-breakpad";

/// The FULL additional_browser_args string for a PRIVATE tab.
///
/// Contract (PROMPT 02): the egress proxy RIDES IN the args string because
/// wry 0.55 applies `proxy_config` only when `additional_browser_args` is
/// unset (webview2 `create_environment` `unwrap_or_else`) — a separately
/// set proxy_url would be silently DROPPED. Strict Tor that is unavailable
/// fails closed (Err), never a silent direct downgrade.
pub fn private_browser_args(
    egress: &Egress,
    tor: Option<SocksEndpoint>,
) -> Result<String, &'static str> {
    match resolve_egress(egress, tor) {
        Ok(Some(ep)) => Ok(format!(
            "{PRIVACY_BROWSER_ARGS} --proxy-server=socks5://{}:{} --proxy-bypass-list=<-loopback>",
            ep.host, ep.port
        )),
        Ok(None) => Ok(PRIVACY_BROWSER_ARGS.to_string()),
        Err(msg) => Err(msg),
    }
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
        Egress::Socks5 { host, port } if *port == 0 || host.contains(|c: char| c.is_whitespace() || c == '/' || c == '@') || url::Host::parse(host).is_err() => Err("invalid SOCKS5 endpoint"),
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
            shield_enabled: false,
        };
        cfg.save(&dir).unwrap();
        let loaded = PrivacyConfig::load(&dir);
        assert_eq!(loaded, cfg);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn broken_json_preserved_and_routing_fails_closed() {
        let dir = std::env::temp_dir().join(format!("hd-privacy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(PrivacyConfig::path(&dir), "{ not json").unwrap();
        assert_eq!(PrivacyConfig::load(&dir).agent_egress, Egress::TorStrict);
        assert!(PrivacyConfig::default().save(&dir).is_err());
        assert_eq!(std::fs::read_to_string(PrivacyConfig::path(&dir)).unwrap(), "{ not json");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn private_args_embed_proxy_in_args() {
        let a = private_browser_args(
            &Egress::Socks5 { host: "127.0.0.1".into(), port: 9150 },
            None,
        )
        .unwrap();
        assert!(a.contains("--proxy-server=socks5://127.0.0.1:9150"));
        assert!(a.contains("--proxy-bypass-list=<-loopback>"));
        assert!(a.contains("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"));
    }

    #[test]
    fn private_args_direct_have_no_proxy() {
        for e in [Egress::Direct, Egress::TorIfAvailable] {
            let a = private_browser_args(&e, None).unwrap();
            assert!(!a.contains("--proxy-server"), "egress {e:?} must be direct");
        }
    }

    #[test]
    fn private_args_strict_without_tor_fail_closed() {
        assert!(private_browser_args(&Egress::TorStrict, None).is_err());
        assert!(private_browser_args(&Egress::TorStrict, Some(SocksEndpoint { host: "127.0.0.1".into(), port: 9050 })).is_ok());
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
