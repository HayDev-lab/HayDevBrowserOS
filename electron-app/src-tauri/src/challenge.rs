//! ChallengeDetector + same-session Human Handoff (migration Phase F).
//!
//! Detection = ONE pure JS expression evaluated in the TAB page (URL, title,
//! DOM selectors, visible text — no LLM). The detector NEVER retries,
//! never rotates identity, never clears cookies: on a challenge the agent
//! pipeline must PAUSE → WAITING_FOR_HUMAN; the user solves it in the SAME
//! tab/profile/session; `resolve(Continue)` re-detects and only then resumes.

use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Wry};

use crate::core::BrowserState;
use crate::error::{AppError, AppResult};

/// Single detection payload — returns {type, evidence}. Order matters:
/// the most specific challenge wins.
const DETECT_JS: &str = r#"(function () {
  var url = location.href, title = document.title || '';
  var text = (document.body && document.body.innerText || '').slice(0, 4000).toLowerCase();
  function has(sel) { try { return document.querySelector(sel) !== null; } catch (e) { return false; } }
  function iframe(substr) {
    try { return Array.prototype.some.call(document.querySelectorAll('iframe'), function (f) { return (f.src || '').indexOf(substr) >= 0; }); }
    catch (e) { return false; }
  }
  if (has('.cf-turnstile') || has('#challenge-form') || has('#challenge-running') || text.indexOf('checking your browser') >= 0 || text.indexOf('verify you are human') >= 0 && url.indexOf('challenge') >= 0) return { type: 'TURNSTILE', evidence: 'cloudflare challenge markers' };
  if (iframe('recaptcha') || has('.g-recaptcha') || has('[data-sitekey]') && text.indexOf('recaptcha') >= 0) return { type: 'RECAPTCHA', evidence: 'recaptcha widget' };
  if (iframe('hcaptcha') || has('.h-captcha')) return { type: 'HCAPTCHA', evidence: 'hcaptcha widget' };
  if (/(captcha|challenge|verify|verification)/i.test(url) || /captcha|challenge/i.test(title)) return { type: 'CAPTCHA', evidence: 'url/title mentions ' + JSON.stringify(title.slice(0, 80)) };
  if (/(two.?factor|2fa|otp|one.?time.?code|verification code)/i.test(url + ' ' + title) || has('input[autocomplete="one-time-code"]')) return { type: 'TWO_FACTOR', evidence: '2fa markers' };
  if (has('input[type="password"]') && /(login|signin|sign-in|account)/i.test(url + ' ' + title)) return { type: 'LOGIN_REQUIRED', evidence: 'login form' };
  if (/(rate.?limit|too many requests|slow down)/i.test(title) || text.indexOf('too many requests') >= 0) return { type: 'RATE_LIMIT', evidence: 'rate limit text' };
  if (/(403|forbidden)/.test(title) || text.indexOf('access denied') >= 0) return { type: 'ACCESS_DENIED', evidence: 'access denied' };
  if (text.indexOf('unusual traffic') >= 0 || text.indexOf('bot detection') >= 0) return { type: 'BOT_CHECK', evidence: 'bot-check text' };
  return { type: 'NONE', evidence: '' };
})()"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeInfo {
    pub r#type: String,
    pub evidence: String,
    pub url: String,
    pub title: String,
}

/// Handoff state per tab (§27): NONE → WAITING_FOR_HUMAN → (recheck) → RESUMED.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HandoffStatus {
    None,
    WaitingForHuman,
    Resumed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeHandoff {
    pub status: HandoffStatus,
    pub challenge: Option<ChallengeInfo>,
    pub detected_at: u64,
}

impl Default for ChallengeHandoff {
    fn default() -> Self {
        Self {
            status: HandoffStatus::None,
            challenge: None,
            detected_at: 0,
        }
    }
}

impl BrowserState {
    pub fn handoff_mut(&mut self, tab_id: &str) -> &mut ChallengeHandoff {
        self.challenges.entry(tab_id.to_string()).or_default()
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Run the detection expression in the tab and parse the result.
/// (async command context — the eval callback arrives on the event loop.)
pub fn detect(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<ChallengeInfo> {
    let label = crate::core::BrowserState::tab_label(tab_id);
    let wv = app
        .get_webview(label.as_str())
        .ok_or_else(|| AppError::new("TAB_NOT_FOUND", format!("no tab {tab_id}")))?;
    let (tx, rx) = mpsc::channel::<String>();
    wv.eval_with_callback(DETECT_JS.to_string(), move |json| {
        let _ = tx.send(json);
    })
    .map_err(|e| AppError::new("EVAL_FAILED", e.to_string()))?;
    let json = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| AppError::new("DETECT_TIMEOUT", "tab did not answer within 5s"))?;
    let mut parsed: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| AppError::new("DETECT_PARSE_FAILED", e.to_string()))?;
    // Same double-encoding unwrap as bridge::eval_json (stringified JSON).
    if let serde_json::Value::String(inner) = &parsed {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(inner) {
            parsed = v;
        }
    }
    let (tab_url, tab_title) = crate::core::with_state(app, |s| {
        s.registry
            .get(tab_id)
            .map(|t| (t.url.clone(), t.title.clone()))
            .unwrap_or_default()
    })
    .unwrap_or_default();
    Ok(ChallengeInfo {
        r#type: parsed
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN_VERIFICATION")
            .to_string(),
        evidence: parsed
            .get("evidence")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        url: tab_url,
        title: tab_title,
    })
}

/// Detect + record: a real challenge flips the tab into WAITING_FOR_HUMAN.
pub fn detect_and_record(app: &AppHandle<Wry>, tab_id: &str) -> AppResult<ChallengeInfo> {
    let info = detect(app, tab_id)?;
    let is_challenge = info.r#type != "NONE";
    let state_store = crate::core::state_handle(app)?;
    let mut state = state_store.lock().unwrap_or_else(|p| p.into_inner());
    let handoff = state.handoff_mut(tab_id);
    if is_challenge {
        handoff.status = HandoffStatus::WaitingForHuman;
        handoff.challenge = Some(info.clone());
        handoff.detected_at = now_millis();
    } else {
        // Challenge gone (or never there): same-session resume is allowed.
        if handoff.status == HandoffStatus::WaitingForHuman {
            handoff.status = HandoffStatus::Resumed;
            handoff.challenge = None;
        }
    }
    Ok(info)
}

/// §27 continue/cancel — Continue re-detects (still challenged → stays
/// WAITING_FOR_HUMAN; cleared → RESUMED). Cancel marks Cancelled.
pub fn resolve(app: &AppHandle<Wry>, tab_id: &str, proceed: bool) -> AppResult<ChallengeHandoff> {
    if !proceed {
        let state_store = crate::core::state_handle(app)?;
        let mut state = state_store.lock().unwrap_or_else(|p| p.into_inner());
        let handoff = state.handoff_mut(tab_id);
        handoff.status = HandoffStatus::Cancelled;
        handoff.challenge = None;
        return Ok(handoff.clone());
    }
    detect_and_record(app, tab_id)?;
    let state_store = crate::core::state_handle(app)?;
    let state = state_store.lock().unwrap_or_else(|p| p.into_inner());
    Ok(state.challenges.get(tab_id).cloned().unwrap_or_default())
}

pub fn handoff_of(app: &AppHandle<Wry>, tab_id: &str) -> ChallengeHandoff {
    let Ok(state_store) = crate::core::state_handle(app) else {
        return ChallengeHandoff::default();
    };
    let state = state_store.lock().unwrap_or_else(|p| p.into_inner());
    state.challenges.get(tab_id).cloned().unwrap_or_default()
}

/// Regression tests for the pure classification payload string (the JS itself
/// is executed in-page; here we pin its selector/priority contract).
#[cfg(test)]
mod tests {
    #[test]
    fn detection_payload_contract() {
        let js = super::DETECT_JS;
        assert!(js.contains("cf-turnstile"), "turnstile selector present");
        assert!(js.contains("recaptcha"), "recaptcha selector present");
        assert!(js.contains("hcaptcha"), "hcaptcha selector present");
        assert!(js.contains("one-time-code"), "2fa marker present");
        assert!(js.contains("'NONE'"), "none branch present");
        // The payload is a single expression (IIFE) — callback-compatible.
        assert!(js.starts_with("(function () {"), "iife expression");
    }
}
