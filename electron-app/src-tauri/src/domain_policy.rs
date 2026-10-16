//! Exact host authorization. PSL is used only to reject ambiguous legacy
//! records, never to grant access to a sibling or child host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainMatch { Match, NoMatch, Ambiguous }
pub fn normalize_host(raw: &str) -> Option<String> {
    let value = raw.trim().trim_end_matches('.');
    if value.is_empty() || value.contains(['/', '@', '?', '#', '\\']) { return None; }
    url::Host::parse(value).ok().map(|h| h.to_string().to_ascii_lowercase())
}
pub fn host_matches_record(page_host: &str, record_domain: &str) -> DomainMatch {
    let Some(host) = normalize_host(page_host) else { return DomainMatch::NoMatch; };
    let Some(record) = normalize_host(record_domain) else { return DomainMatch::Ambiguous; };
    let ip = record.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok();
    if !ip && (psl::domain_str(&record).is_none() || psl::suffix_str(&record) == Some(record.as_str())) {
        return DomainMatch::Ambiguous;
    }
    if host == record { DomainMatch::Match } else { DomainMatch::NoMatch }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_only_without_www_alias() {
        for (host, record) in [("example.com", "example.com"), ("EXAMPLE.com.", "example.com"), ("xn--mnchen-3ya.de", "münchen.de"), ("127.0.0.1", "127.0.0.1"), ("[::1]", "[::1]")] {
            assert_eq!(host_matches_record(host, record), DomainMatch::Match);
        }
        for host in ["www.example.com", "a.example.com", "example.com.evil.test", "notexample.com"] {
            assert_eq!(host_matches_record(host, "example.com"), DomainMatch::NoMatch);
        }
    }
    #[test]
    fn public_and_private_suffixes_refused_even_exact() {
        for suffix in ["com", "co.uk", "co.kr", "github.io", "blogspot.com"] {
            assert_eq!(host_matches_record(suffix, suffix), DomainMatch::Ambiguous);
            assert_eq!(host_matches_record(&format!("attacker.{suffix}"), suffix), DomainMatch::Ambiguous);
        }
    }
    #[test]
    fn malformed_legacy_records_do_not_expand_trust() {
        for raw in ["https://example.com", "example.com:8443", "user@example.com", "example.com/path", "localhost"] {
            assert_ne!(host_matches_record("example.com", raw), DomainMatch::Match);
        }
    }
}
