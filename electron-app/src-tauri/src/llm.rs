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

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.5-flash-lite";
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
}

impl LlmProvider {
    /// UI-facing config (NO key material) — shape matches Electron's
    /// `OllamaClientConfig { baseUrl, model, credentialRef }`.
    pub fn public_config(&self) -> serde_json::Value {
        serde_json::json!({
            "baseUrl": self.base_url,
            "model": self.model,
            "credentialRef": format!("env:{}", self.api_key_env),
        })
    }

    pub fn is_configured(&self) -> bool {
        env_key(self.api_key_env)
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
}

fn env_key(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string())
}

fn env_str(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn build(id: &'static str, base: String, model: String, research: Option<String>, env: &'static str) -> LlmProvider {
    LlmProvider { id, base_url: base, model, research_model: research, api_key_env: env }
}

/// Resolve the active provider. `Ok(None)` means "no stack is usable" —
/// the caller answers AI_PROVIDER_NOT_CONFIGURED honestly.
pub fn resolve_provider() -> Option<LlmProvider> {
    let forced = env_str("AI_PROVIDER").map(|v| v.to_lowercase());
    match forced.as_deref() {
        Some("gemini") => return Some(gemini_provider()),
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
    Some(ollama_provider())
}

pub fn gemini_provider() -> LlmProvider {
    let base = env_str("GEMINI_BASE_URL").unwrap_or_else(|| GEMINI_BASE.to_string());
    let model = env_str("GEMINI_MODEL").unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string());
    build("gemini", base.trim_end_matches('/').to_string(), model, None, "GEMINI_API_KEY")
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
