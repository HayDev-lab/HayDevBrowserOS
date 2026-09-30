//! Site-facing User-Agent — Rust port of `browser/pure/site-user-agent.ts`.
//!
//! Embedding-shell tokens are stripped from the UA before any TAB webview
//! presents itself to sites: engines gate on the browser FAMILY parsed from
//! the UA (e.g. WhatsApp's "Chrome 100+ required" parser). The engine
//! version stays HONEST — no version spoofing, token removal only.
//!
//! The chrome webview (app UI) is not affected: only tab webviews get the
//! cleaned UA (builder.user_agent in core.rs).

/// Product tokens of an embedding shell, hidden from sites.
const SHELL_TOKENS: [&str; 3] = [
    "PersonalAgenticBrowser",
    "HayDevBrowser",
    "Electron",
];

/// Clean a raw UA: remove `Token/x.y.z` shell tokens, collapse the
/// double spaces left behind. Pure + unit-tested.
pub fn build_site_user_agent(raw_ua: &str) -> String {
    if raw_ua.is_empty() {
        return String::new();
    }
    let mut ua = raw_ua.to_string();
    for token in SHELL_TOKENS {
        ua = remove_token(&ua, token);
    }
    collapse_spaces(&ua)
}

/// Remove every `Token/<version>` occurrence (case-sensitive family match
/// on the token itself, like the TS regexes `(?:^|\s)Token\/[\d.]+`).
fn remove_token(ua: &str, token: &str) -> String {
    let mut out = String::with_capacity(ua.len());
    let bytes = ua.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let rest = &ua[i..];
        let at_start = i == 0 || bytes[i - 1] == b' ';
        if at_start && rest.starts_with(token) {
            let after = &rest[token.len()..];
            if let Some(stripped) = after.strip_prefix('/') {
                // Consume `Token/<version>` — version = [0-9.] run.
                let vlen = stripped.chars().take_while(|c| c.is_ascii_digit() || *c == '.').count();
                // Token must be followed by whitespace or end (otherwise it's
                // a longer product name that merely starts with the token).
                let after_version = &stripped[vlen..];
                if after_version.is_empty() || after_version.starts_with(' ') {
                    // Skip `Token/version` plus ONE following space (added
                    // back implicitly by the next iteration — do not keep).
                    i += token.len() + 1 + vlen;
                    if bytes.get(i) == Some(&b' ') {
                        i += 1;
                    }
                    continue;
                }
            }
        }
        out.push(ua[i..].chars().next().unwrap());
        i += ua[i..].chars().next().unwrap().len_utf8();
    }
    out
}

fn collapse_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.chars() {
        if c == ' ' {
            if !prev_space {
                out.push(c);
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_shell_tokens_keeps_engine() {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Safari/537.36 PersonalAgenticBrowser/0.1.0 Electron/44.3.0";
        let cleaned = build_site_user_agent(ua);
        assert!(!cleaned.contains("Electron"));
        assert!(!cleaned.contains("PersonalAgenticBrowser"));
        assert!(cleaned.contains("Chrome/152.0.7977.78"));
        assert!(cleaned.ends_with("Safari/537.36"));
        assert!(!cleaned.contains("  "));
    }

    #[test]
    fn webview2_ua_passes_through_unchanged() {
        let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Safari/537.36 Edg/152.0.7977.78";
        assert_eq!(build_site_user_agent(ua), ua);
    }

    #[test]
    fn empty_and_token_like_names_survive() {
        assert_eq!(build_site_user_agent(""), "");
        // A product that merely STARTS with a token name is kept intact.
        let ua = "Foo Electronium/2.0 Chrome/120.0.0.0";
        assert_eq!(build_site_user_agent(ua), ua);
    }

    #[test]
    fn haydev_browser_token_is_stripped() {
        let ua = "Mozilla/5.0 Chrome/120.0.0.0 HayDevBrowser/0.1.0 Safari/537.36";
        let cleaned = build_site_user_agent(ua);
        assert!(!cleaned.contains("HayDevBrowser"));
        assert!(cleaned.contains("Chrome/120.0.0.0"));
    }
}
