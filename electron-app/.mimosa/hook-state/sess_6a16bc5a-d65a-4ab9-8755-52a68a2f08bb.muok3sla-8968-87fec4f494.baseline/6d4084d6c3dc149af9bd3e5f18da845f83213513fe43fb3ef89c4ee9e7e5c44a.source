//! Serializable application error model (migration contract §30).
//!
//! Frontend always receives `{ code, message, details? }` — never a raw Rust
//! panic string or a huge stack trace.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            details: None,
        }
    }

    /// Attach structured details (step traces etc.) — serialized to the UI.
    pub fn with_details(mut self, details: Vec<String>) -> Self {
        self.details = Some(serde_json::json!({ "steps": details }));
        self
    }

    pub fn not_available(feature: &str) -> Self {
        Self::new(
            "FEATURE_NOT_AVAILABLE_IN_TAURI_RUNTIME",
            format!(
                "'{feature}' runs on the Node side of the Electron runtime and has not \
                 been migrated to the Tauri runtime yet. Use the Electron runtime \
                 (npm run dev:electron) for this feature."
            ),
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::new("TAURI_ERROR", err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new("IO_ERROR", err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::new("SERIALIZATION_ERROR", err.to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(err: url::ParseError) -> Self {
        Self::new("URL_PARSE_ERROR", err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
