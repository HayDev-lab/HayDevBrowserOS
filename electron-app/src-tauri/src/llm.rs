//! LLM provider resolution — parity with Electron `src/main/index.ts`.
//!
//! Selection (identical semantics):
//!   - `AI_PROVIDER=gemini|nvidia|ollama` forces a stack;
//!   - else AUTO: Gemini when `GEMINI_API_KEY` is present, then NVIDIA NIM,
//!     then the Ollama Cloud/local stack.
//!
//! Ollama uses the OpenAI-COMPATIBLE endpoint (`https://ollama.com/v1`) so
//! the tool-calling loop speaks one protocol for every provider:
//!   POST {base}/chat/completions   Authorization: Bearer {key}
//!
//! All providers read keys from the environment AT CALL TIME; the key is
//! NEVER stored in the resolved config exposed to the UI (only the
//! `credentialRef` naming the env var).

/// Gemini's OpenAI-compatible surface (same constant as agent.rs before).
pub const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
pub const NVIDIA_BASE: &str = "https://integrate.api.nvidia.com/v1";
/// Ollama Cloud / local Ollama, OpenAI-compatible endpoint.
pub const OLLAMA_BASE: &str = "https://ollama.com/v1";

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.6-flash";
pub const DEFAULT_NVIDIA_MODEL: &str = "openai/gpt-oss-20b";
pub const DEFAULT_OLLAMA_MODEL: &str = "glm-5.3-flash";
/// DEEP_RESEARCH profile model for the Ollama stack (heavier model for
/// research quality — parity with Electron's OLLAMA_DEEP_RESEARCH_MODEL).
pub const DEFAULT_OLLAMA_RESEARCH_MODEL: &str = "glm-5.3";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmProvider {
    /// 'gemini' | 'nvidia' | 'ollama'
    pub id: &'static str,
    /// OpenAI-compatible base URL (no trailing slash), e.g. https://ollama.com/v1
    pub base_url: String,
    /// Model for STANDARD runs.
    pub model: String,
    /// Model for DEEP_RESEARCH runs (None → same as `model`).
    pub research_model: Option<String>,
    /// Env var holding the API key — read at call time, never copied.
    pub api_key_env: &'static str,
    pub reasoning: crate::ai_settings::GeminiReasoning,
    pub profile: String,
}

impl LlmProvider {
    /// UI-facing config (NO key material) — shape matches Electron's
    /// `OllamaClientConfig { baseUrl, model, credentialRef }`.
    pub fn public_config(&self) -> serde_json::Value {
        let saved = crate::ai_settings::load().ok().is_some_and(|s| s.providers.get(self.id).is_some_and(|p| p.encrypted_key.is_some()));
        serde_json::json!({
            "baseUrl": self.base_url,
            "model": self.model,
            "reasoningMode": if self.id == "gemini" { serde_json::to_value(self.reasoning).ok() } else { None },
            "credentialRef": if saved {format!("settings:{}", self.id)} else {format!("env:{}", self.api_key_env)},
        })
    }

    pub fn is_configured(&self) -> bool {
        !self.model.is_empty() && env_key(self.api_key_env)
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    }

    pub fn api_key(&self) -> Option<String> {
        env_key(self.api_key_env).filter(|k| !k.is_empty())
    }

    /// Model for a run profile ("STANDARD" | "DEEP_RESEARCH").
    pub fn model_for_profile(&self, profile: &str) -> String {
        if profile == "DEEP_RESEARCH" {
            self.research_model
                .clone()
                .unwrap_or_else(|| self.model.clone())
        } else {
            self.model.clone()
        }
    }

    /// Keep ordinary tool interaction quick; deepen only a research run.
    /// Never silently change models.
    pub fn reasoning_effort(&self, messages: &[serde_json::Value]) -> Option<&'static str> {
        use crate::ai_settings::GeminiReasoning::*;
        if self.id != "gemini" { return None; }
        match self.reasoning {
            Default => None, Low => Some("low"), Medium => Some("medium"), High => Some("high"),
            Adaptive => {
                let _ = messages;
                Some(if self.profile == "DEEP_RESEARCH" { "medium" } else { "low" })
            }
        }
    }

    pub fn request_timeout(&self, messages: &[serde_json::Value]) -> std::time::Duration {
        std::time::Duration::from_secs(match self.reasoning_effort(messages) {
            Some("low") => 20, Some("medium") => 60, _ => 120,
        })
    }
}

fn env_key(name: &str) -> Option<String> {
    let provider = match name { "GEMINI_API_KEY" => Some("gemini"), "OPENAI_API_KEY" => Some("openai"), "OPENROUTER_API_KEY" => Some("openrouter"), _ => None };
    if let Some(provider) = provider { return crate::ai_settings::key(provider).ok().flatten(); }
    std::env::var(name).ok().map(|v| v.trim().to_string())
}

fn env_str(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn build(id: &'static str, base: String, model: String, research: Option<String>, env: &'static str) -> LlmProvider {
    let reasoning = if id == "gemini" { crate::ai_settings::load().map(|s| s.gemini_reasoning).unwrap_or_default() } else { crate::ai_settings::GeminiReasoning::Default };
    LlmProvider { id, base_url: base, model, research_model: research, api_key_env: env, reasoning, profile: "STANDARD".into() }
}

/// Resolve the active provider. `Ok(None)` means "no stack is usable" —
/// the caller answers AI_PROVIDER_NOT_CONFIGURED honestly.
pub fn resolve_provider() -> Option<LlmProvider> {
    let settings = crate::ai_settings::load().ok()?;
    let forced = settings.active_provider.or_else(|| env_str("AI_PROVIDER")).map(|v| v.to_lowercase());
    match forced.as_deref() {
        Some("gemini") => return Some(gemini_provider()),
        Some("openai") => return Some(compatible_provider("openai")),
        Some("openrouter") => return Some(compatible_provider("openrouter")),
        Some("nvidia") => return Some(nvidia_provider()),
        Some("ollama") => return Some(ollama_provider()),
        Some(other) => {
            log::warn!("[LLM] unknown AI_PROVIDER={other:?} — falling back to auto selection");
        }
        None => {}
    }
    // AUTO — same order as the Electron runtime.
    if env_key("GEMINI_API_KEY").is_some_and(|k| !k.is_empty()) {
        return Some(gemini_provider());
    }
    if env_key("NVIDIA_API_KEY").is_some_and(|k| !k.is_empty()) {
        return Some(nvidia_provider());
    }
    if env_key("OPENROUTER_API_KEY").is_some_and(|k| !k.is_empty()) { return Some(compatible_provider("openrouter")); }
    if env_key("OPENAI_API_KEY").is_some_and(|k| !k.is_empty()) { return Some(compatible_provider("openai")); }
    Some(ollama_provider())
}

fn configured_model(provider: &str, env: &str, default: &str) -> String {
    crate::ai_settings::load().ok().and_then(|s| s.providers.get(provider).map(|p| p.model.clone()))
        .filter(|s| !s.is_empty()).or_else(|| env_str(env)).unwrap_or_else(|| default.into())
}
fn compatible_provider(id: &'static str) -> LlmProvider {
    let (base, model_env, key_env) = if id == "openai" {
        ("https://api.openai.com/v1", "OPENAI_MODEL", "OPENAI_API_KEY")
    } else { ("https://openrouter.ai/api/v1", "OPENROUTER_MODEL", "OPENROUTER_API_KEY") };
    build(id, base.into(), configured_model(id, model_env, ""), None, key_env)
}

pub fn gemini_provider() -> LlmProvider {
    let has_saved_key = crate::ai_settings::load().ok()
        .and_then(|settings| settings.providers.get("gemini").map(|provider| provider.encrypted_key.is_some()))
        .unwrap_or(false);
    let base = env_str("GEMINI_BASE_URL")
        .filter(|endpoint| !has_saved_key || synthetic_gemini_endpoint(endpoint))
        .unwrap_or_else(|| GEMINI_BASE.to_string());
    let model = configured_model("gemini", "GEMINI_MODEL", DEFAULT_GEMINI_MODEL);
    build("gemini", base.trim_end_matches('/').to_string(), model, None, "GEMINI_API_KEY")
}

fn synthetic_gemini_endpoint(endpoint: &str) -> bool {
    crate::debugging::enabled()
        && url::Url::parse(endpoint).ok().is_some_and(|url| {
            url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
                && url.username().is_empty() && url.password().is_none()
        })
}

pub fn nvidia_provider() -> LlmProvider {
    let base = env_str("NVIDIA_BASE_URL").unwrap_or_else(|| NVIDIA_BASE.to_string());
    let model = env_str("NVIDIA_MODEL").unwrap_or_else(|| DEFAULT_NVIDIA_MODEL.to_string());
    build("nvidia", base.trim_end_matches('/').to_string(), model, None, "NVIDIA_API_KEY")
}

pub fn ollama_provider() -> LlmProvider {
    let base = env_str("OLLAMA_BASE_URL")
        .map(|u| {
            // Accept both cloud root (https://ollama.com) and explicit /v1 —
            // normalize to the OpenAI-compatible surface.
            let u = u.trim_end_matches('/').to_string();
            if u.ends_with("/v1") {
                u
            } else {
                format!("{u}/v1")
            }
        })
        .unwrap_or_else(|| OLLAMA_BASE.to_string());
    let model = env_str("OLLAMA_MODEL").unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let research = Some(
        env_str("OLLAMA_DEEP_RESEARCH_MODEL")
            .unwrap_or_else(|| DEFAULT_OLLAMA_RESEARCH_MODEL.to_string()),
    );
    build("ollama", base, model, research, "OLLAMA_API_KEY")
}

// ---------------------------------------------------------------------------
// Verified chat-model resolution — parity with Electron's
// `resolvePreferredChatModel` (search-services.ts).
//
// Root cause it fixes: Perplexica's live model list starts with keys that
// 404 for the account, and a 404 inside generateObject makes the non-stream
// /api/search promise never settle (infinite spinner). Probing candidates
// with a 1-token request and using the FIRST model that answers 200 avoids
// the dead key. Divergence from Electron (documented): we cache with a TTL
// instead of for the process lifetime, and `pab://search` serves from the
// CACHE ONLY (never blocks on the probe) — a background warm thread fills
// it at startup.
// ---------------------------------------------------------------------------

/// Curated cheap+quality candidates, tried in order (same list as Electron).
pub const PREFERRED_CHAT_MODELS: &[&str] = &[
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
];

/// Cache TTL: a long-lived browser re-picks up rotated keys/models without a
/// restart (the probe costs one 1-token request).
const PROBE_TTL: std::time::Duration = std::time::Duration::from_secs(600);

struct ProbeCache {
    model: Option<String>,
    resolved_at: std::time::Instant,
}

static PROBE_CACHE: std::sync::Mutex<Option<ProbeCache>> = std::sync::Mutex::new(None);

/// Probe candidates live (BLOCKING — up to 6 s per candidate). Prefer
/// `cached_preferred_chat_model()` on serve paths and `warm_…` at startup.
pub fn probe_preferred_chat_model() -> Option<String> {
    // Fresh cache fast-path.
    {
        let guard = PROBE_CACHE.lock().unwrap();
        if let Some(cache) = guard.as_ref() {
            if cache.resolved_at.elapsed() < PROBE_TTL {
                return cache.model.clone();
            }
        }
    }
    let model = run_model_probe();
    *PROBE_CACHE.lock().unwrap() = Some(ProbeCache {
        model: model.clone(),
        resolved_at: std::time::Instant::now(),
    });
    model
}

/// Cache-only read for serve paths: `Some` when verified, `None` when not
/// yet probed/expired — callers fall through to env/default (Electron's
/// `verifiedModel ?? PAB_PERPLEXICA_MODEL ?? default` chain).
pub fn cached_preferred_chat_model() -> Option<String> {
    let guard = PROBE_CACHE.lock().unwrap();
    match guard.as_ref() {
        Some(cache) if cache.resolved_at.elapsed() < PROBE_TTL => cache.model.clone(),
        _ => None,
    }
}

/// Resolve at startup on a worker thread so the first `pab://search` render
/// never waits on the network.
pub fn warm_preferred_chat_model() {
    if std::env::var("HAYDEV_WARM_SEARCH_MODEL").as_deref() != Ok("1") {
        return;
    }
    std::thread::spawn(|| {
        let _ = probe_preferred_chat_model();
    });
}

fn run_model_probe() -> Option<String> {
    // Preserve the legacy search probe's environment-only opt-in. Saving an agent key
    // must not introduce automatic provider requests on the next application startup.
    let key = std::env::var("GEMINI_API_KEY").ok().filter(|s| !s.trim().is_empty())?;
    let base = env_str("GEMINI_BASE_URL")
        .unwrap_or_else(|| GEMINI_BASE.to_string())
        .trim_end_matches('/')
        .to_string();
    let mut candidates: Vec<String> = Vec::new();
    if let Some(m) = env_str("GEMINI_MODEL") {
        candidates.push(m);
    }
    candidates.extend(PREFERRED_CHAT_MODELS.iter().map(|s| s.to_string()));
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(6))
        .build();
    for model in candidates {
        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 1,
        });
        let url = format!("{base}/chat/completions");
        let answered = agent
            .post(url.as_str())
            .set("authorization", &format!("Bearer {key}"))
            .send_json(body)
            .is_ok();
        if answered {
            log::info!("[LLM] verified chat model via live probe: {model}");
            return Some(model);
        }
    }
    if let Ok(k) = std::env::var("GEMINI_API_KEY") {
        if !k.trim().is_empty() {
            log::warn!("[LLM] no PREFERRED_CHAT_MODELS candidate answered — falling back to env/default model");
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clear_env() {
        for k in [
            "AI_PROVIDER",
            "GEMINI_API_KEY",
            "GEMINI_MODEL",
            "GEMINI_BASE_URL",
            "NVIDIA_API_KEY",
            "NVIDIA_MODEL",
            "NVIDIA_BASE_URL",
            "OLLAMA_API_KEY",
            "OLLAMA_MODEL",
            "OLLAMA_DEEP_RESEARCH_MODEL",
            "OLLAMA_BASE_URL",
        ] {
            std::env::remove_var(k);
        }
    }

    // Env-var mutation is global; serialize the env-sensitive tests.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn auto_selection_prefers_gemini_then_nvidia_then_ollama() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        clear_env();
        // Ollama is the terminal fallback (key presence is checked at CALL time).
        let p = resolve_provider().unwrap();
        assert_eq!(p.id, "ollama");
        assert!(!p.is_configured());

        std::env::set_var("NVIDIA_API_KEY", "nv");
        assert_eq!(resolve_provider().unwrap().id, "nvidia");

        std::env::set_var("GEMINI_API_KEY", "g");
        assert_eq!(resolve_provider().unwrap().id, "gemini");
        clear_env();
    }

    #[test]
    fn forced_provider_wins_even_with_other_keys() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        clear_env();
        std::env::set_var("GEMINI_API_KEY", "g");
        std::env::set_var("AI_PROVIDER", "ollama");
        let p = resolve_provider().unwrap();
        assert_eq!(p.id, "ollama");
        clear_env();
    }

    #[test]
    fn ollama_defaults_and_research_model() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        clear_env();
        let p = ollama_provider();
        assert_eq!(p.base_url, "https://ollama.com/v1");
        assert_eq!(p.model, "glm-5.3-flash");
        assert_eq!(p.model_for_profile("STANDARD"), "glm-5.3-flash");
        assert_eq!(p.model_for_profile("DEEP_RESEARCH"), "glm-5.3");
        clear_env();
    }

    #[test]
    fn ollama_base_url_normalizes_to_v1() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        clear_env();
        std::env::set_var("OLLAMA_BASE_URL", "http://localhost:11434/");
        let p = ollama_provider();
        assert_eq!(p.base_url, "http://localhost:11434/v1");

        std::env::set_var("OLLAMA_BASE_URL", "https://ollama.com/v1");
        assert_eq!(ollama_provider().base_url, "https://ollama.com/v1");
        clear_env();
    }

    #[test]
    fn reasoning_policy_keeps_selected_model_and_raises_effort_for_research() {
        use crate::ai_settings::GeminiReasoning;
        let mut p=LlmProvider{id:"gemini",base_url:GEMINI_BASE.into(),model:"gemini-3.6-flash".into(),research_model:None,api_key_env:"GEMINI_API_KEY",reasoning:GeminiReasoning::Adaptive,profile:"STANDARD".into()};
        assert_eq!(p.reasoning_effort(&[]),Some("low"));
        assert_eq!(p.request_timeout(&[]).as_secs(),20);
        p.profile="DEEP_RESEARCH".into();
        assert_eq!(p.reasoning_effort(&[]),Some("medium"));
        assert_eq!(p.model_for_profile("DEEP_RESEARCH"),"gemini-3.6-flash");
        p.reasoning=GeminiReasoning::Low; assert_eq!(p.reasoning_effort(&[]),Some("low"));
        p.reasoning=GeminiReasoning::High; assert_eq!(p.reasoning_effort(&[]),Some("high"));
        p.reasoning=GeminiReasoning::Default; assert_eq!(p.reasoning_effort(&[]),None);
        p.id="openai";p.reasoning=GeminiReasoning::High;assert_eq!(p.reasoning_effort(&[]),None);
    }
    #[test]
    fn public_config_never_carries_the_key() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        clear_env();
        std::env::set_var("OLLAMA_API_KEY", "super-secret");
        let p = ollama_provider();
        let json = p.public_config().to_string();
        assert!(!json.contains("super-secret"));
        assert!(json.contains("env:OLLAMA_API_KEY"));
        clear_env();
    }
}
