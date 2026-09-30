//! Login capture — Tauri port of Electron's tab-preload → vault:form-submitted.
//!
//! Remote tab webviews get ZERO Tauri IPC by design (capabilities/main.json
//! scopes the chrome webview only), so the capture hook rides an
//! initialization_script that stores the last submitted login in a page
//! variable, and the main process polls the ACTIVE tab through the
//! BrowserAutomationBridge (eval_with_callback) on a slow timer.
//!
//! The plaintext password exists only in: the page (where the user typed
//! it), the main process (this module + vault save) — it is NEVER sent to
//! the renderer: the prompt payload carries domain/username only (parity
//! with Electron's PasswordSavePrompt).

use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The script injected into every NORMAL (non-incognito) tab webview.
/// Bounded: keeps at most ONE capture, cleared on read.
pub const CAPTURE_INIT_SCRIPT: &str = r#"
(function () {
  if (window.__pabCaptureInstalled) return;
  window.__pabCaptureInstalled = true;
  function grab(form) {
    try {
      var u = null, p = null;
      var els = form ? form.elements : document.querySelectorAll('input');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el || !el.type) continue;
        if (el.type === 'password' && el.value && !p) p = el.value;
        if ((el.type === 'email' || el.type === 'text') && el.value && !u && (el.name || '').toLowerCase().match(/user|login|email|mail|acct/) || (el.id || '').toLowerCase().match(/user|login|email|mail/)) u = el.value;
      }
      if (!p) return;
      window.__pabCapture = {
        url: location.href,
        username: u || '',
        password: p,
        at: Date.now()
      };
    } catch (e) { /* never break the page */ }
  }
  document.addEventListener('submit', function (e) { grab(e.target && e.target.elements ? e.target : null); }, true);
  // Password managers / SPA logins often fire XHR without a submit event —
  // also hook button clicks inside forms with a password field.
  document.addEventListener('click', function (e) {
    try {
      var b = e.target && e.target.closest ? e.target.closest('button,input[type=submit]') : null;
      if (!b) return;
      var f = b.closest && b.closest('form');
      if (!f) return;
      if (!f.querySelector('input[type=password]')) return;
      setTimeout(function () { grab(f); }, 400);
    } catch (err) {}
  }, true);
})();
"#;

/// Pending save prompt (renderer-visible fields only — NO password).
#[derive(Debug, Clone)]
pub struct CapturePrompt {
    pub id: String,
    pub tab_id: String,
    pub domain: String,
    pub username: String,
    /// The captured credential — main-process only, never serialized to UI.
    password: String,
    pub created_at: u64,
}

pub struct CaptureState {
    pub pending: Option<CapturePrompt>,
    /// Domains the user answered "Not now / Never" for this session.
    pub dismissed: Vec<String>,
}

pub type SharedCapture = Mutex<CaptureState>;

pub fn new_capture() -> SharedCapture {
    Mutex::new(CaptureState { pending: None, dismissed: Vec::new() })
}

fn canonical_domain(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    //Registrable domain approximation: last two labels.
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return Some(host);
    }
    Some(labels[labels.len() - 2..].join("."))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Poll the active tab once: read+clear `window.__pabCapture`, run the
/// same gating as the Electron handler (needs username-ish + password,
/// not internal/incognito, not already stored, not dismissed), then push
/// `vault:prompt:update` to the chrome renderer.
fn poll_once(app: &AppHandle<Wry>) {
    // Which tab is active, and is it a normal browsing tab?
    let tab = crate::core::with_state(app, |s| {
        s.registry
            .list()
            .into_iter()
            .find(|t| t.is_active)
            .map(|t| (t.id.clone(), t.is_incognito, t.url.clone()))
    })
    .unwrap_or_default();
    let Some((tab_id, incognito, tab_url)) = tab else { return };
    if incognito {
        return;
    }
    if tab_url.starts_with("pab://") || tab_url.contains("pab.localhost") {
        return; // internal pages never capture
    }
    // Read and CLEAR the capture slot in one expression.
    let Ok(Value::String(raw)) = crate::bridge::evaluate(
        app,
        &tab_id,
        "(function(){ var c = window.__pabCapture || null; if (c) window.__pabCapture = null; return c ? JSON.stringify(c) : ''; })()",
    ) else {
        return;
    };
    if raw.trim().is_empty() {
        return;
    }
    let Ok(capture) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let password = capture.get("password").and_then(Value::as_str).unwrap_or("").to_string();
    if password.is_empty() {
        return;
    }
    let page_url = capture.get("url").and_then(Value::as_str).unwrap_or(tab_url.as_str()).to_string();
    let Some(domain) = canonical_domain(&page_url) else { return };
    let username = capture
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(200)
        .collect::<String>();

    let Some(capture_state) = app.try_state::<SharedCapture>() else {
        return;
    };
    let mut cs = capture_state.lock().unwrap_or_else(|p| p.into_inner());
    if cs.dismissed.iter().any(|d| d == &domain) {
        return;
    }
    // Already stored (domain+username)? — don't re-prompt (Electron parity).
    let vault = crate::vault::Vault::new(&crate::lib_app_data_dir());
    if username.is_empty() {
        // A capture without a username can still be offered — the Electron
        // handler requires BOTH; keep parity and skip.
        return;
    }
    if let Ok(true) = vault.has(&domain, Some(&username)) {
        return;
    }
    let prompt = CapturePrompt {
        id: format!("vp_{}_{}", now_ms(), tab_id),
        tab_id: tab_id.clone(),
        domain: domain.clone(),
        username: username.clone(),
        password,
        created_at: now_ms(),
    };
    let payload = json!({
        "kind": "set",
        "prompt": {
            "id": prompt.id,
            "tabId": prompt.tab_id,
            "domain": prompt.domain,
            "username": prompt.username,
            "createdAt": prompt.created_at,
        }
    });
    cs.pending = Some(prompt);
    drop(cs);
    let _ = app.emit("vault:prompt:update", payload);
}

/// Resolve the pending prompt: save=true stores the credential (DPAPI
/// vault), any answer clears the prompt and pushes the clear event.
pub fn resolve(app: &AppHandle<Wry>, prompt_id: &str, save: bool) -> Result<Value, String> {
    let state = app
        .try_state::<SharedCapture>()
        .ok_or_else(|| "capture state missing".to_string())?;
    let mut cs = state.lock().unwrap_or_else(|p| p.into_inner());
    let Some(prompt) = cs.pending.take() else {
        let _ = app.emit("vault:prompt:update", json!({ "kind": "clear" }));
        return Ok(json!({ "success": false, "error": "prompt_not_found" }));
    };
    if prompt.id != prompt_id {
        // Stale answer for an older prompt — restore and clear like Electron.
        cs.pending = None;
        let _ = app.emit("vault:prompt:update", json!({ "kind": "clear" }));
        return Ok(json!({ "success": false, "error": "prompt_not_found" }));
    }
    let mut result = json!({ "success": true });
    if save {
        let vault = crate::vault::Vault::new(&crate::lib_app_data_dir());
        match vault.save(&prompt.domain, &prompt.username, &prompt.password, || {
            uuid::Uuid::new_v4().to_string()
        }) {
            Ok(_) => {}
            Err(e) => {
                result = json!({ "success": false, "error": e.message });
            }
        }
    } else {
        cs.dismissed.push(prompt.domain.clone());
        cs.dismissed.truncate(50);
    }
    let _ = app.emit("vault:prompt:update", json!({ "kind": "clear" }));
    Ok(result)
}

/// Start the slow capture poller (2s cadence, daemon thread).
pub fn start_poller(app: AppHandle<Wry>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(2000));
        // Poll errors are normal (no page / bridge busy) — never log-spam.
        poll_once(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_domain_strips_www_and_takes_registrable() {
        assert_eq!(
            canonical_domain("https://accounts.google.com/signin?x=1").as_deref(),
            Some("google.com")
        );
        assert_eq!(canonical_domain("http://a.b.c.example.co.uk/x").as_deref(), Some("co.uk"));
        assert_eq!(canonical_domain("https://example.com/").as_deref(), Some("example.com"));
        assert_eq!(canonical_domain("notaurl"), None);
    }
}
