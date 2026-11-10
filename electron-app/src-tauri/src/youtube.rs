//! YouTube playback helpers follow the browser's Shield setting.
use tauri::{AppHandle, Manager, Wry};

const SCRIPT: &str = include_str!("youtube.js");

pub fn is_site(host: &str) -> bool {
    matches!(host, "youtube.com" | "www.youtube.com" | "m.youtube.com")
}

pub fn script(shield: &crate::shield::ShieldState, host: &str) -> String {
    let enabled = crate::shield::filtering_enabled_on_site(shield, host);
    format!("{SCRIPT}\nwindow.__haydevYoutubeShield?.setEnabled({enabled});")
}

pub fn refresh(app: &AppHandle<Wry>) {
    let Some(shield) = app.try_state::<crate::shield::SharedShield>() else { return; };
    for tab in crate::core::list_tabs(app).unwrap_or_default() {
        let Ok(url) = url::Url::parse(&tab.url) else { continue; };
        let host = url.host_str().unwrap_or_default();
        if !is_site(host) { continue; }
        if let Some(view) = app.get_webview(&crate::core::BrowserState::tab_label(&tab.id)) {
            let _ = view.eval(script(shield.inner(), host));
        }
    }
}
