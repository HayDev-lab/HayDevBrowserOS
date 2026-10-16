//! BrowserAutomationBridge (migration Phase D, master prompt §19–§20).
//!
//! One evaluation channel: the tab webview handle (`eval_with_callback`,
//! already proven by the ChallengeDetector). Every action is a SINGLE IIFE
//! returning a JSON string — the Rust side parses it. No Playwright rewrite;
//! WebView2 primitives only.
//!
//! Screenshot is the one action JS cannot do: it goes through the in-process
//! CDP client (`cdp.rs`) attached to the tab-environment debug port.

use tauri::{AppHandle, Manager, Wry};

use crate::error::{AppError, AppResult};

/// Escape an arbitrary Rust string into a JS single-quoted literal.
fn js_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        match c {
            '\'' => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

/// Run a script in the tab and parse its JSON reply (5s bound).
pub fn eval_json(app: &AppHandle<Wry>, tab_id: &str, script: &str) -> AppResult<serde_json::Value> {
    let label = crate::core::BrowserState::tab_label(tab_id);
    let wv = app
        .get_webview(label.as_str())
        .ok_or_else(|| AppError::new("TAB_NOT_FOUND", format!("no tab {tab_id}")))?;
    let lease = crate::run_guard::current();
    if let Some(g) = &lease { g.check()?; }
    let (tx, rx) = std::sync::mpsc::channel::<AppResult<String>>();
    let script = if let Some(g) = &lease {
        format!("(() => {{ const __haydevCheck = () => {{ if (window.__haydevRunAllowed({}) !== true) throw new Error('AGENT_CANCELLED'); }}; try {{ __haydevCheck(); return ({}); }} catch(e) {{ return JSON.stringify({{ok:false,error:'AGENT_CANCELLED'}}); }} }})()", g.id, script)
    } else { format!("(() => {{ const __haydevCheck = () => {{}}; return ({}); }})()", script) };
    #[cfg(windows)]
    {
        let pending = lease.clone();
        wv.with_webview(move |native| {
            let send = tx.clone();
            let execute = || -> AppResult<()> {
                unsafe {
                    let webview = native.controller().CoreWebView2().map_err(|_| AppError::new("EVAL_FAILED", "WebView unavailable"))?;
                    webview.ExecuteScript(&windows::core::HSTRING::from(script),
                        &webview2_com::ExecuteScriptCompletedHandler::create(Box::new(move |result, value| {
                            let _ = send.send(result.map(|_| value).map_err(|_| AppError::new("EVAL_FAILED", "Script evaluation failed"))); Ok(())
                        }))).map_err(|_| AppError::new("EVAL_FAILED", "Script dispatch failed"))?;
                } Ok(())
            };
            let result = match &pending { Some(g) => g.effect(execute), None => execute() };
            if let Err(e) = result { let _ = tx.send(Err(e)); }
        })?;
    }
    #[cfg(not(windows))]
    wv.eval_with_callback(script, move |json| { let _ = tx.send(Ok(json)); })?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let json = loop {
        if let Some(g) = &lease { g.check()?; }
        match rx.recv_timeout(std::time::Duration::from_millis(50)) {
            Ok(v) => break v?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) if std::time::Instant::now() < deadline => {},
            _ => return Err(AppError::new("BRIDGE_TIMEOUT", "Tab did not answer within 5s")),
        }
    };
    let mut parsed: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| AppError::new("BRIDGE_PARSE_FAILED", e.to_string()))?;
    // The callback receives the completion value of the LAST expression —
    // our IIFEs return JSON.stringify(...), i.e. a JSON-encoded STRING.
    // Unwrap that one extra layer (verified live: commands answered
    // {"message":"unknown"} without it).
    if let serde_json::Value::String(inner) = &parsed {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(inner) {
            parsed = v;
        }
    }
    Ok(parsed)
}

/// Guarded native navigation: ownership is checked on the UI thread at
/// dispatch, after any queue delay. Revocation and dispatch share a mutex.
#[cfg(windows)]
pub fn navigate_guarded(app: &AppHandle<Wry>, tab_id: &str, url: &str, guard: crate::run_guard::RunGuard) -> AppResult<bool> {
    guard.check()?;
    let wv = app.get_webview(&crate::core::BrowserState::tab_label(tab_id)).ok_or_else(|| AppError::new("TAB_NOT_FOUND", "Tab no longer exists"))?;
    let url = url.to_string(); let pending = guard.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    wv.with_webview(move |native| {
        let result = pending.effect(|| unsafe {
            let webview = native.controller().CoreWebView2().map_err(|_| AppError::new("NAVIGATE_FAILED", "WebView unavailable"))?;
            webview.Navigate(&windows::core::HSTRING::from(url)).map_err(|_| AppError::new("NAVIGATE_FAILED", "Navigation dispatch failed"))?;
            Ok(true)
        });
        let _ = tx.send(result);
    })?;
    loop {
        guard.check()?;
        match rx.recv_timeout(std::time::Duration::from_millis(50)) {
            Ok(v) => return v,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {},
            _ => return Err(AppError::new("NAVIGATE_FAILED", "Navigation dispatch stopped")),
        }
    }
}

// ---------------------------------------------------------------------------
// Actions (each = one pure JS payload)
// ---------------------------------------------------------------------------

pub fn evaluate(
    app: &AppHandle<Wry>,
    tab_id: &str,
    expression: &str,
) -> AppResult<serde_json::Value> {
    // Wrap the caller expression so ANY completion value comes back as JSON.
    let script = format!(
        "(function () {{ try {{ var __v = ({}); return JSON.stringify({{ ok: true, value: __v === undefined ? null : __v }}); }} catch (e) {{ return JSON.stringify({{ ok: false, error: String(e) }}); }} }})()",
        expression
    );
    let parsed = eval_json(app, tab_id, &script)?;
    if parsed.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok(parsed
            .get("value")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    } else {
        Err(AppError::new(
            "EVAL_ERROR",
            parsed
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ))
    }
}

pub fn click(app: &AppHandle<Wry>, tab_id: &str, selector: &str) -> AppResult<serde_json::Value> {
    let script = format!(
        r#"(function () {{
  try {{
    var el = document.querySelector({});
    if (!el) return JSON.stringify({{ ok: false, error: 'selector not found' }});
    __haydevCheck();
    el.scrollIntoView({{ block: 'center' }});
    __haydevCheck();
    el.focus();
    __haydevCheck();
    el.click();
    return JSON.stringify({{ ok: true, clicked: el.tagName.toLowerCase() }});
  }} catch (e) {{ return JSON.stringify({{ ok: false, error: String(e) }}); }}
}})()"#,
        js_str(selector)
    );
    ok_or_err(app, tab_id, &script)
}

pub fn r#type(
    app: &AppHandle<Wry>,
    tab_id: &str,
    selector: &str,
    text: &str,
    clear: bool,
) -> AppResult<serde_json::Value> {
    let script = format!(
        r#"(function () {{
  try {{
    var el = document.querySelector({});
    if (!el) return JSON.stringify({{ ok: false, error: 'selector not found' }});
    __haydevCheck();
    el.focus();
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    __haydevCheck();
    desc.set.call(el, {} ? {} : desc.get.call(el) + {});
    __haydevCheck();
    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
    __haydevCheck();
    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
    return JSON.stringify({{ ok: true, typed: true }});
  }} catch (e) {{ return JSON.stringify({{ ok: false, error: String(e) }}); }}
}})()"#,
        js_str(selector),
        if clear { "true" } else { "false" },
        js_str(text),
        js_str(text)
    );
    ok_or_err(app, tab_id, &script)
}

pub fn press_key(app: &AppHandle<Wry>, tab_id: &str, key: &str) -> AppResult<serde_json::Value> {
    let script = format!(
        r#"(function () {{
  try {{
    var el = document.activeElement || document.body;
    var opts = {{ key: {}, bubbles: true, cancelable: true }};
    __haydevCheck();
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    __haydevCheck();
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    return JSON.stringify({{ ok: true, dispatched: true }});
  }} catch (e) {{ return JSON.stringify({{ ok: false, error: String(e) }}); }}
}})()"#,
        js_str(key)
    );
    ok_or_err(app, tab_id, &script)
}

pub fn scroll(
    app: &AppHandle<Wry>,
    tab_id: &str,
    dx: i64,
    dy: i64,
) -> AppResult<serde_json::Value> {
    let script = format!(
        r#"(function () {{
  try {{
    __haydevCheck();
    window.scrollBy({dx}, {dy});
    return JSON.stringify({{ ok: true, scrollY: window.scrollY }});
  }} catch (e) {{ return JSON.stringify({{ ok: false, error: String(e) }}); }}
}})()"#,
        dx = dx,
        dy = dy
    );
    ok_or_err(app, tab_id, &script)
}

/// Bounded DOM snapshot: interactive elements first (a11y-ish), depth-capped.
pub fn dom_snapshot(
    app: &AppHandle<Wry>,
    tab_id: &str,
    max: usize,
) -> AppResult<serde_json::Value> {
    let script = format!(
        r#"(function () {{
  try {{
    var out = [];
    var sel = 'a[href],button,input,textarea,select,[role="button"],[role="tab"],[role="link"],h1,h2,h3';
    var nodes = document.querySelectorAll(sel);
    for (var i = 0; i < nodes.length && out.length < {}; i++) {{
      var el = nodes[i];
      var r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      out.push({{
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || null,
        text: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? '[redacted]' : (el.innerText || '')).trim().slice(0, 80),
        href: el.getAttribute('href') || null,
        placeholder: el.getAttribute('placeholder') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        rect: {{ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }}
      }});
    }}
    return JSON.stringify({{ ok: true, url: location.href, title: document.title, nodes: out }});
  }} catch (e) {{ return JSON.stringify({{ ok: false, error: String(e) }}); }}
}})()"#,
        max
    );
    ok_or_err(app, tab_id, &script)
}

/// Wait for a selector (page-side polling inside one eval — WebView2 awaits
/// the promise, the callback fires when it settles). Timeout in ms.
pub fn wait_for_selector(
    app: &AppHandle<Wry>,
    tab_id: &str,
    selector: &str,
    timeout_ms: u64,
) -> AppResult<serde_json::Value> {
    let script = format!(
        r#"(function () {{
  var deadline = Date.now() + {};
  return new Promise(function (resolve) {{
    (function poll() {{
      var el = null;
      try {{ el = document.querySelector({}); }} catch (e) {{}}
      if (el) return resolve(JSON.stringify({{ ok: true, found: true }}));
      if (Date.now() >= deadline) return resolve(JSON.stringify({{ ok: false, error: 'timeout' }}));
      setTimeout(poll, 150);
    }})();
  }});
}})()"#,
        timeout_ms,
        js_str(selector)
    );
    ok_or_err(app, tab_id, &script)
}

/// Wait until the tab's committed URL matches `needle` (host-side poll —
/// navigation state lives in the registry).
pub fn wait_for_url<R: tauri::Runtime>(
    app: &AppHandle<R>,
    tab_id: &str,
    needle: &str,
    timeout_ms: u64,
) -> AppResult<String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        let url = crate::core::with_state(app, |s| {
            s.registry
                .get(tab_id)
                .map(|t| t.url.clone())
                .unwrap_or_default()
        })?;
        if url.contains(needle) {
            return Ok(url);
        }
        if std::time::Instant::now() >= deadline {
            return Err(AppError::new(
                "WAIT_URL_TIMEOUT",
                format!("url never contained {needle:?} (last: {url})"),
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn ok_or_err(app: &AppHandle<Wry>, tab_id: &str, script: &str) -> AppResult<serde_json::Value> {
    let parsed = eval_json(app, tab_id, script)?;
    if parsed.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok(parsed)
    } else {
        Err(AppError::new(
            "BRIDGE_ACTION_FAILED",
            parsed
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_str_escapes() {
        assert_eq!(js_str("ab"), "'ab'");
        assert_eq!(js_str("it's"), r"'it\'s'");
        assert_eq!(js_str("a\nb"), "'a\\nb'");
    }
}
