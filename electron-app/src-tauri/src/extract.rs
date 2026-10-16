//! Readable-text extraction (PROMPT 06) — the ONE local extractor for
//! research fetches. Dependency-free, UTF-8-safe replacement for the old
//! byte-wise `crawl::extract_text` (which corrupted every non-ASCII byte:
//! `bytes[i] as char` mangles multibyte UTF-8).
//!
//! Pipeline: strip script/style/noscript/template/head → prefer
//! <article>/<main> content when present → block tags to paragraph breaks →
//! decode the common HTML entities → collapse whitespace. Extraction
//! failure is honest: an empty/binary page yields near-empty text and the
//! caller surfaces it (never a fabricated document).

/// Extract readable text from an HTML document.
pub fn extract_readable(html: &str, max_chars: usize) -> String {
    let without_blocks = strip_blocks(html);
    let region = pick_main_region(&without_blocks);
    let text = blocks_to_text(&region);
    let decoded = decode_entities(&text);
    collapse(&decoded, max_chars)
}

/// Remove script/style/noscript/template/head comment blocks entirely
/// (byte-offset scanning over the ORIGINAL string — UTF-8 safe).
fn strip_blocks(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut pos = 0usize;
    while let Some(rel) = find_block_start(&lower[pos..]) {
        let (start_marker, end_marker) = block_pair(rel.1);
        let start = pos + rel.0;
        let close = lower[start..].find(end_marker).map(|p| start + p + end_marker.len());
        // Copy everything before the block, then jump past it.
        out.push_str(&html[pos..start]);
        match close {
            Some(next) => pos = next,
            None => {
                pos = html.len(); // unterminated block: drop the tail
                break;
            }
        }
        let _ = start_marker;
    }
    out.push_str(&html[pos.min(html.len())..]);
    out
}

fn find_block_start(lower: &str) -> Option<(usize, &'static str)> {
    const OPENS: [(&str, &'static str); 6] = [
        ("<script", "</script>"),
        ("<style", "</style>"),
        ("<noscript", "</noscript>"),
        ("<template", "</template>"),
        ("<head", "</head>"),
        ("<!--", "-->"),
    ];
    let mut best: Option<(usize, &'static str)> = None;
    for (open, close) in OPENS {
        if let Some(p) = lower.find(open) {
            if best.map(|(bp, _)| p < bp).unwrap_or(true) {
                best = Some((p, close));
            }
        }
    }
    best
}

fn block_pair(close: &'static str) -> (&'static str, &'static str) {
    ("", close)
}

/// Prefer the first <article>/<main> region; else the <body>; else all.
fn pick_main_region(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    for tag in ["<article", "<main"] {
        if let Some(start) = lower.find(tag) {
            let Some(gt) = lower[start..].find('>') else { continue };
            let open_end = start + gt + 1;
            let close = format!("</{}", &lower[start + 1..start + 1 + tag.len() - 1]);
            let Some(rel_end) = lower[open_end..].rfind(&close) else { continue };
            let end = open_end + rel_end;
            if end > open_end {
                return html[open_end..end].to_string();
            }
        }
    }
    if let Some(start) = lower.find("<body") {
        let Some(gt) = lower[start..].find('>') else { return html.to_string() };
        let open_end = start + gt + 1;
        let Some(close_rel) = lower.rfind("</body>") else { return html[open_end..].to_string() };
        if close_rel >= open_end {
            return html[open_end..close_rel].to_string();
        }
    }
    html.to_string()
}

/// Block-level boundaries become paragraph breaks; all tags dropped.
/// UTF-8-safe: advances by char boundaries, never reinterprets bytes.
fn blocks_to_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase(); // byte-length preserving
    let bytes = html.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let Some(rel) = lower[i..].find('>') else { break };
            let tag = &lower[i + 1..i + rel];
            let name = tag
                .trim_start_matches('/')
                .split(|c: char| !c.is_ascii_alphanumeric())
                .next()
                .unwrap_or("");
            let is_block = tag.starts_with('/')
                || matches!(
                    name,
                    "p" | "div" | "br" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                        | "section" | "header" | "footer" | "nav" | "ul" | "ol" | "table"
                        | "blockquote" | "pre" | "figure" | "figcaption" | "article" | "main"
                        | "aside" | "hr" | "td" | "th" | "dl" | "dt" | "dd"
                );
            if is_block {
                let last = out.chars().last();
                if last.map(|c| c != '\n').unwrap_or(false) {
                    out.push('\n');
                }
            }
            i += rel + 1;
            continue;
        }
        // Copy one full UTF-8 scalar at its boundary.
        let ch = html[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = s.to_string();
    for (ent, ch) in [
        ("&amp;", '&'),
        ("&lt;", '<'),
        ("&gt;", '>'),
        ("&quot;", '"'),
        ("&#39;", '\''),
        ("&apos;", '\''),
        ("&nbsp;", ' '),
        ("&#160;", ' '),
        ("&mdash;", '—'),
        ("&ndash;", '–'),
        ("&hellip;", '…'),
        ("&laquo;", '«'),
        ("&raquo;", '»'),
    ] {
        out = out.replace(ent, &ch.to_string());
    }
    // Numeric entities: &#1234; / &#x1F600; — char-boundary-safe scan.
    if !out.contains("&#") {
        return out;
    }
    let bytes = out.as_bytes();
    let mut final_out = String::with_capacity(out.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'&' && out[i..].starts_with("&#") {
            if let Some(end_rel) = out[i..].find(';') {
                let body = &out[i + 2..i + end_rel];
                let code = if let Some(hex) = body.strip_prefix('x').or_else(|| body.strip_prefix('X')) {
                    u32::from_str_radix(hex, 16).ok()
                } else {
                    body.parse::<u32>().ok()
                };
                if let Some(c) = code.and_then(char::from_u32) {
                    final_out.push(c);
                    i += end_rel + 1;
                    continue;
                }
            }
        }
        let ch = out[i..].chars().next().unwrap();
        final_out.push(ch);
        i += ch.len_utf8();
    }
    final_out
}

fn collapse(s: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(s.len().min(max_chars * 2));
    let mut prev_space = false;
    let mut prev_nl = false;
    for c in s.chars() {
        let kept = match c {
            '\r' | '\t' => ' ',
            '\n' => {
                if prev_nl {
                    continue;
                }
                prev_nl = true;
                out.push('\n');
                prev_space = true;
                continue;
            }
            ' ' => ' ',
            other => other,
        };
        if kept == ' ' {
            if prev_space {
                continue;
            }
            prev_space = true;
        } else {
            prev_nl = false;
            prev_space = false;
        }
        if out.chars().count() >= max_chars {
            break;
        }
        out.push(kept);
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cyrillic_survives_extraction() {
        let html = "<html><body><h1>Привет мир</h1><p>Тест кириллицы — проверка UTF-8.</p></body></html>";
        let text = extract_readable(html, 5000);
        assert!(text.contains("Привет мир"), "got: {text}");
        assert!(text.contains("Тест кириллицы — проверка UTF-8."));
    }

    #[test]
    fn armenian_survives_extraction() {
        let html = "<body><p>Բարև աշխարհ</p></body>";
        let text = extract_readable(html, 5000);
        assert!(text.contains("Բարև աշխարհ"), "got: {text}");
    }

    #[test]
    fn scripts_styles_and_comments_are_gone() {
        let html = "<body><script>var x = '<p>fake paragraph</p>';</script><style>.a{color:red}</style><!-- hidden -->Real text</body>";
        let text = extract_readable(html, 5000);
        assert!(text.contains("Real text"));
        assert!(!text.contains("fake paragraph"));
        assert!(!text.contains("color:red"));
        assert!(!text.contains("hidden"));
    }

    #[test]
    fn article_region_preferred_over_nav_chrome() {
        let html = "<body><nav>Home Products About Company Careers Blog</nav><article><p>The core research finding is here.</p></article><footer>© 2026 MegaSite</footer></body>";
        let text = extract_readable(html, 5000);
        assert!(text.contains("The core research finding is here."));
        assert!(!text.contains("Home Products"), "nav chrome must not dominate: {text}");
    }

    #[test]
    fn entities_decode() {
        let html = "<p>A &amp; B &lt;tag&gt; &laquo;quoted&raquo; &#1055;&#1088;&#1080;&#1074;&#1077;&#1090;</p>";
        let text = extract_readable(html, 5000);
        assert!(text.contains("A & B <tag>"), "got: {text}");
        assert!(text.contains("«quoted»"));
        assert!(text.contains("Привет"));
    }

    #[test]
    fn empty_and_broken_documents_degrade_honestly() {
        assert!(extract_readable("", 1000).is_empty());
        assert!(extract_readable("<html><head></head><body></body></html>", 1000).is_empty());
        // Binary-ish garbage must not panic and must not fabricate text.
        let garbage: String = (0u8..=255).map(|b| b as char).collect();
        let _ = extract_readable(&garbage, 1000);
    }

    #[test]
    fn max_chars_respected() {
        let body = "word ".repeat(5000);
        let html = format!("<p>{body}</p>");
        let text = extract_readable(&html, 200);
        assert!(text.chars().count() <= 200);
    }

    #[test]
    fn old_extractor_corruption_is_fixed() {
        // The OLD crawl::extract_text byte-walk turned "Привет" into
        // mojibake (0xD0 0x9F ...). The new extractor must preserve it.
        let html = "<p>Привет</p>";
        let text = extract_readable(html, 100);
        assert_eq!(text, "Привет");
    }
}
