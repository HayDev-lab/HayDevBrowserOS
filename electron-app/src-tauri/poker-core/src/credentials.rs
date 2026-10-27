//! Parse only an explicitly selected Gemini credential; never expose other tokens.
use crate::Result;
pub fn parse_gemini_token(raw: &str) -> Result<String> {
    if raw.len() > 16384 {
        return Err("TOKEN_FILE_TOO_LARGE".into());
    }
    let raw = raw.trim().trim_start_matches('\u{feff}');
    let mut keys = Vec::new();
    if raw.starts_with('{') {
        let data: serde_json::Value =
            serde_json::from_str(raw).map_err(|_| "TOKEN_FILE_INVALID_JSON")?;
        for name in ["GEMINI_API_KEY", "geminiApiKey"] {
            if let Some(v) = data[name].as_str() {
                keys.push(v.trim().to_string());
            }
        }
    } else {
        for line in raw.lines() {
            if let Some((k, v)) = line.trim().trim_start_matches("export ").split_once('=') {
                if k.trim() == "GEMINI_API_KEY" {
                    keys.push(v.trim().trim_matches(['\'', '"']).to_string());
                }
            }
        }
        if keys.is_empty() && (raw.starts_with("AIza") || raw.starts_with("AQ.")) {
            keys.push(raw.to_string());
        }
    }
    keys.sort();
    keys.dedup();
    if keys.len() != 1 {
        return Err("ONE_GEMINI_API_KEY_REQUIRED".into());
    }
    let key = keys.remove(0);
    if key.len() < 20
        || key.len() > 4096
        || key.chars().any(|c| c.is_whitespace() || c.is_control())
        || key.starts_with("ghp_")
        || key.starts_with("github_pat_")
    {
        return Err("INVALID_GEMINI_KEY_FORMAT".into());
    }
    Ok(key)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_file_formats_do_not_mix_providers() {
        let key = "AIza_TEST_ONLY_NOT_A_REAL_KEY_12345";
        assert_eq!(parse_gemini_token(key).unwrap(), key);
        assert_eq!(
            parse_gemini_token(&format!("GITHUB_TOKEN=ghp_private\nGEMINI_API_KEY='{key}'"))
                .unwrap(),
            key
        );
        assert_eq!(
            parse_gemini_token(&format!(r#"{{"geminiApiKey":"{key}"}}"#)).unwrap(),
            key
        );
        assert!(parse_gemini_token("github_pat_not_a_gemini_credential").is_err());
        assert!(parse_gemini_token("GEMINI_API_KEY=a\nGEMINI_API_KEY=b").is_err());
    }
}
