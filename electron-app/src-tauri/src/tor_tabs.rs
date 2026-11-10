use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, Webview, Wry};

use crate::arman_vpn::{blocking, check_webview_overrides, navigation_allowed, on_main, trusted, Relay};
use crate::error::{AppError, AppResult};
use crate::profiles::ProfileKind;
use crate::runtime_manager::{request_tor_start, with_manager, SharedRuntimeManager};

static RELAY: OnceLock<Mutex<Option<Relay>>> = OnceLock::new();

#[tauri::command]
pub async fn tor_open_tab(webview: Webview<Wry>, app: AppHandle<Wry>, url: String) -> AppResult<String> {
    trusted(&webview)?;
    check_webview_overrides()?;
    let target = url::Url::parse(url.trim())
        .ok()
        .filter(|url| url.scheme() != "about" && navigation_allowed(url))
        .ok_or_else(|| AppError::new("TOR_TAB_URL", "Enter an HTTP or HTTPS address"))?;

    blocking(move || {
        if with_manager(&app, |manager| manager.managed_tor_proxy()).flatten().is_none() {
            if let Some(manager) = app.try_state::<SharedRuntimeManager>() {
                request_tor_start(manager.inner());
            }
            return Err(AppError::new("TOR_TAB_NOT_READY", "The bundled Tor proxy is not ready"));
        }

        // Retain the local port for the browser lifetime. Existing WebView2
        // environments can recover through the next managed Tor endpoint,
        // and never try a different application that binds an old Tor port.
        let port = {
            let mut relay = RELAY.get_or_init(Default::default).lock()
                .map_err(|_| AppError::new("TOR_TAB_RELAY", "Tor relay is unavailable"))?;
            if let Some(relay) = relay.as_ref() {
                relay.port
            } else {
                let handle = app.clone();
                let new_relay = Relay::start(move || {
                    let (address, pid) = with_manager(&handle, |manager| manager.managed_tor_proxy()).flatten()?;
                    let stream = std::net::TcpStream::connect_timeout(
                        &address.into(), std::time::Duration::from_secs(2),
                    ).ok()?;
                    crate::windows_routes::tcp_peer_is_owned(&stream, pid).then_some(stream)
                })?;
                let port = new_relay.port;
                *relay = Some(new_relay);
                port
            }
        };
        on_main(&app, move |app| crate::core::open_proxy_tab(app, target.as_str(), ProfileKind::TorProxy, port))
    }).await
}
