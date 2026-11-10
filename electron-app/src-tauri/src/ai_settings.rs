//! AI preferences and Windows-user-bound credentials. No secret readback command.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const PROVIDERS: [&str; 3] = ["gemini", "openrouter", "openai"];
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GeminiReasoning { #[default] Adaptive, Default, Low, Medium, High }
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub model: String,
    pub encrypted_key: Option<String>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub active_provider: Option<String>,
    pub gemini_live_model: Option<String>,
    #[serde(default)]
    pub gemini_reasoning: GeminiReasoning,
    pub providers: BTreeMap<String, Entry>,
}
fn error(code: &str) -> AppError { AppError::new(code, code) }
fn path() -> std::path::PathBuf { crate::lib_app_data_dir().join("ai-settings.json") }
pub fn load() -> AppResult<Settings> {
    crate::atomic_store::transaction(&path())?.read_json().map(|v| v.unwrap_or_default())
}
fn env_name(provider: &str) -> AppResult<&'static str> {
    match provider {
        "gemini" => Ok("GEMINI_API_KEY"), "openrouter" => Ok("OPENROUTER_API_KEY"),
        "openai" => Ok("OPENAI_API_KEY"), _ => Err(error("AI_INVALID_PROVIDER")),
    }
}
pub fn key(provider: &str) -> AppResult<Option<String>> {
    let env = env_name(provider)?;
    let settings = load()?;
    if let Some(encrypted) = settings.providers.get(provider).and_then(|p| p.encrypted_key.as_ref()) {
        return crate::vault::dpapi_decrypt(encrypted).map(Some);
    }
    Ok(std::env::var(env).ok().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()))
}
pub fn live_model() -> String {
    load().ok().and_then(|s| s.gemini_live_model)
        .or_else(|| std::env::var("GEMINI_LIVE_MODEL").ok())
        .unwrap_or_else(|| "gemini-3.8-live".into())
}
fn valid_model(value: &str) -> bool {
    !value.is_empty() && value.len() <= 200 && value.chars().all(|c| c.is_ascii_alphanumeric() || "-._/:".contains(c))
}
fn public(settings: &Settings) -> Value {
    let providers: Vec<Value> = PROVIDERS.iter().map(|id| {
        let entry = settings.providers.get(*id);
        let saved = entry.is_some_and(|e| e.encrypted_key.is_some());
        let env = std::env::var(env_name(id).unwrap()).ok().is_some_and(|s| !s.trim().is_empty());
        let model_env = format!("{}_MODEL", id.to_uppercase());
        let model = entry.map(|e| e.model.clone()).filter(|m| !m.is_empty())
            .or_else(|| std::env::var(model_env).ok())
            .unwrap_or_else(|| if *id == "gemini" {crate::llm::DEFAULT_GEMINI_MODEL.into()} else {String::new()});
        json!({"id":id,"model":model,"configured":saved || env,"keySource":if saved {"saved"} else if env {"environment"} else {"none"}})
    }).collect();
    json!({"activeProvider":settings.active_provider.as_deref().unwrap_or("environment"),"geminiLiveModel":live_model(),"geminiReasoning":settings.gemini_reasoning,"providers":providers})
}
#[tauri::command]
pub fn ai_settings_get() -> AppResult<Value> { Ok(public(&load()?)) }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderPatch {
    id: String, model: String, api_key: Option<String>, #[serde(default)] remove_key: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch { active_provider: String, gemini_live_model: String, gemini_reasoning: Option<GeminiReasoning>, providers: Vec<ProviderPatch> }

#[tauri::command]
pub fn ai_settings_save(app: tauri::AppHandle<tauri::Wry>, patch: Patch) -> AppResult<Value> {
    use tauri::{Manager, Emitter};
    // Same lock order as run start. A completed cancellation must not leave settings locked.
    let control = app.state::<crate::control::SharedControl>();
    let control_guard = control.lock().unwrap_or_else(|p| p.into_inner());
    let agent = app.state::<crate::agent::SharedAgent>();
    let active = agent.active.lock().unwrap_or_else(|p| p.into_inner());
    if control_guard.agent_run_active || active.as_ref().is_some_and(|g| g.check().is_ok()) { return Err(error("AI_AGENT_RUNNING")); }
    if patch.active_provider != "environment" && !PROVIDERS.contains(&patch.active_provider.as_str()) { return Err(error("AI_INVALID_PROVIDER")); }
    if !valid_model(&patch.gemini_live_model) || patch.gemini_live_model.contains(['/', ':']) { return Err(error("AI_INVALID_LIVE_MODEL")); }
    if patch.providers.len() > 3 { return Err(error("AI_INVALID_PROVIDER")); }
    let tx = crate::atomic_store::transaction(&path())?;
    let mut settings: Settings = tx.read_json()?.unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    for p in patch.providers {
        env_name(&p.id)?;
        if !seen.insert(p.id.clone()) { return Err(error("AI_DUPLICATE_PROVIDER")); }
        let model = p.model.trim();
        if !model.is_empty() && !valid_model(model) { return Err(error("AI_INVALID_MODEL")); }
        let entry = settings.providers.entry(p.id).or_default();
        entry.model = model.to_owned();
        if p.remove_key { entry.encrypted_key = None; }
        if let Some(value) = p.api_key.filter(|s| !s.trim().is_empty()) {
            let value = value.trim();
            if p.remove_key || value.len() > 4096 || value.len() < 8 || !value.bytes().all(|b| b.is_ascii_graphic()) { return Err(error("AI_INVALID_KEY")); }
            entry.encrypted_key = Some(crate::vault::dpapi_encrypt(value)?);
        }
    }
    settings.active_provider = (patch.active_provider != "environment").then_some(patch.active_provider);
    settings.gemini_live_model = Some(patch.gemini_live_model);
    if let Some(reasoning) = patch.gemini_reasoning { settings.gemini_reasoning = reasoning; }
    tx.write_json(&settings)?;
    drop(tx);
    drop(active);
    drop(control_guard);
    let _ = app.emit("agent:state:update", crate::agent::status_payload(&app, agent.inner()));
    Ok(public(&settings))
}

fn models_from(provider: &str, body: &Value) -> AppResult<Vec<Value>> {
    let list = body[if provider == "gemini" {"models"} else {"data"}].as_array().ok_or_else(|| error("AI_INVALID_MODEL_LIST"))?;
    let mut out = Vec::new();
    for model in list {
        let id = model[if provider == "gemini" {"name"} else {"id"}].as_str().unwrap_or("").trim_start_matches("models/");
        if !valid_model(id) { continue; }
        let supports = |name: &str| model["supportedGenerationMethods"].as_array().is_some_and(|a| a.iter().any(|v| v == name));
        let live = provider == "gemini" && supports("bidiGenerateContent");
        if provider == "gemini" && !live && !supports("generateContent") { continue; }
        if provider == "openrouter" && !model["supported_parameters"].as_array().is_some_and(|a| a.iter().any(|v| v == "tools")) { continue; }
        // OpenAI's catalog does not expose endpoint/tool capabilities. Exclude obvious non-chat families.
        if provider == "openai" && (!id.starts_with("gpt-") && !id.starts_with("o1") && !id.starts_with("o3") && !id.starts_with("o4") || ["realtime", "audio", "transcribe", "image", "tts"].iter().any(|s| id.contains(s))) { continue; }
        out.push(json!({"id":id,"live":live}));
    }
    Ok(out)
}
#[tauri::command]
pub async fn ai_settings_models(provider: String) -> AppResult<Value> {
    env_name(&provider)?;
    if crate::privacy::global().agent_egress != crate::privacy::Egress::Direct { return Err(error("AI_MODELS_DIRECT_EGRESS_REQUIRED")); }
    tauri::async_runtime::spawn_blocking(move || {
        let secret = key(&provider)?.ok_or_else(|| error("AI_KEY_REQUIRED"))?;
        let url = match provider.as_str() {
            "gemini" => "https://generativelanguage.googleapis.com/v1beta/models",
            "openrouter" => "https://openrouter.ai/api/v1/models",
            _ => "https://api.openai.com/v1/models",
        };
        let client = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(15)).redirects(0).build();
        let mut models = Vec::new();
        let mut page_token = String::new();
        for _ in 0..10 {
            let mut request = client.get(url);
            if provider == "gemini" {
                request = request.set("x-goog-api-key", &secret).query("pageSize", "1000");
                if !page_token.is_empty() { request = request.query("pageToken", &page_token); }
            } else { request = request.set("Authorization", &format!("Bearer {secret}")); }
            let response = request.call().map_err(|e| match e {
                ureq::Error::Status(status, _) => AppError::new("AI_MODELS_HTTP", format!("HTTP {status}")),
                _ => error("AI_MODELS_CONNECTION_FAILED"),
            })?;
            use std::io::Read;
            let mut bytes = Vec::new();
            response.into_reader().take(8_000_001).read_to_end(&mut bytes).map_err(|_| error("AI_INVALID_MODEL_LIST"))?;
            if bytes.len() > 8_000_000 { return Err(error("AI_MODEL_LIST_TOO_LARGE")); }
            let body: Value = serde_json::from_slice(&bytes).map_err(|_| error("AI_INVALID_MODEL_LIST"))?;
            models.extend(models_from(&provider, &body)?);
            page_token = body["nextPageToken"].as_str().unwrap_or("").to_owned();
            if provider != "gemini" || page_token.is_empty() {
                models.sort_by(|a,b| a["id"].as_str().cmp(&b["id"].as_str()));
                models.dedup_by(|a,b| a["id"] == b["id"]);
                return Ok(json!({"models":models}));
            }
        }
        Err(error("AI_MODEL_LIST_PAGE_LIMIT"))
    }).await.map_err(|_| error("AI_MODELS_FAILED"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_catalog_separates_live_and_filters_non_chat() {
        let result = models_from("gemini", &json!({"models":[{"name":"models/chat","supportedGenerationMethods":["generateContent"]},{"name":"models/live","supportedGenerationMethods":["bidiGenerateContent"]},{"name":"models/embed","supportedGenerationMethods":["embedContent"]}]})).unwrap();
        assert_eq!(result.len(), 2); assert_eq!(result[1]["live"], true);
        assert!(models_from("openai", &json!({"error":"bad"})).is_err());
        assert!(!valid_model("model\nheader"));
        assert_eq!(models_from("openrouter", &json!({"data":[{"id":"a/b","supported_parameters":["tools"]},{"id":"x/y"}]})).unwrap().len(), 1);
    }
}
