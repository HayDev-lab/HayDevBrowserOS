//! Download registry — records `on_download` events from tab webviews.
//!
//! PARITY NOTE (honest limitation): Tauri 2.11's `DownloadEvent` surface
//! exposes only `Requested` and `Finished` — no byte-progress and no cancel
//! handle. `receivedBytes`/`totalBytes` therefore stay 0 and cancel is
//! honestly rejected; the list itself, save paths and completion states are
//! real (files really land on disk).

use std::collections::HashMap;
use std::path::PathBuf;

use crate::types::{DownloadItemState, DownloadStateName};

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct DownloadRegistry {
    items: Vec<DownloadItemState>,
    by_id: HashMap<String, usize>,
    counter: u64,
}

impl DownloadRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Compute the real save destination: the OS Downloads folder with a
    /// deduplicated, sanitized filename.
    pub fn destination_for(&self, url: &str, suggested: &std::path::Path) -> PathBuf {
        let downloads = dirs_downloads().unwrap_or_else(std::env::temp_dir);
        let raw_name = suggested
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .or_else(|| filename_from_url(url))
            .unwrap_or_else(|| "download".to_string());
        let safe: String = raw_name
            .chars()
            .map(|c| match c {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
                c => c,
            })
            .collect();
        let mut candidate = downloads.join(&safe);
        let stem = candidate
            .file_stem()
            .map(|s| s.to_string_lossy().to_string());
        let ext = candidate
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()));
        let mut n = 1;
        while candidate.exists() {
            let stem = stem.clone().unwrap_or_else(|| "download".to_string());
            let name = match &ext {
                Some(e) => format!("{stem} ({n}){e}"),
                None => format!("{stem} ({n})"),
            };
            candidate = downloads.join(name);
            n += 1;
        }
        candidate
    }

    pub fn started(&mut self, url: &str, destination: &std::path::Path) -> String {
        self.counter += 1;
        let id = format!("dl_{}", self.counter);
        let filename = destination
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let item = DownloadItemState {
            id: id.clone(),
            url: url.to_string(),
            filename,
            state: DownloadStateName::Downloading,
            total_bytes: 0,
            received_bytes: 0,
            start_time: now_millis(),
            end_time: None,
            save_path: Some(destination.to_string_lossy().to_string()),
            mime_type: None,
            error: None,
            tab_id: None,
        };
        self.by_id.insert(id.clone(), self.items.len());
        self.items.push(item);
        id
    }

    pub fn finished(&mut self, url: &str, path: Option<&PathBuf>, success: bool) {
        // Match by URL on the most recent in-flight download of that URL.
        let idx = self
            .items
            .iter()
            .rposition(|i| i.url == url && i.state == DownloadStateName::Downloading);
        if let Some(idx) = idx {
            let item = &mut self.items[idx];
            item.state = if success {
                DownloadStateName::Completed
            } else {
                DownloadStateName::Failed
            };
            item.end_time = Some(now_millis());
            if let Some(p) = path {
                item.save_path = Some(p.to_string_lossy().to_string());
                if let Some(n) = p.file_name() {
                    item.filename = n.to_string_lossy().to_string();
                }
            }
            if !success {
                item.error = Some("download failed".to_string());
            }
        }
    }

    pub fn list(&self) -> Vec<DownloadItemState> {
        self.items.clone()
    }

    /// Remove an entry from the list (does not delete the file — the TS
    /// runtime has the same semantics: `removeDownload` only drops the entry).
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|i| i.id != id);
        self.by_id.clear();
        for (idx, item) in self.items.iter().enumerate() {
            self.by_id.insert(item.id.clone(), idx);
        }
        before != self.items.len()
    }

    #[allow(dead_code)]
    pub fn in_flight(&self) -> usize {
        self.items
            .iter()
            .filter(|i| i.state == DownloadStateName::Downloading)
            .count()
    }
}

fn dirs_downloads() -> Option<PathBuf> {
    // Windows: the Downloads known-folder is %USERPROFILE%\Downloads on
    // every profile since Vista — no shell API binding needed.
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .map(|h| PathBuf::from(h).join("Downloads"))
            .filter(|p| p.is_dir())
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join("Downloads"))
            .filter(|p| p.is_dir())
    }
}

fn filename_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let last = parsed.path_segments()?.next_back()?.to_string();
    let decoded = percent_decode(&last);
    (!decoded.is_empty()).then_some(decoded)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn started_then_finished_completes() {
        let mut r = DownloadRegistry::new();
        let dest = PathBuf::from("C:/Users/x/Downloads/file.zip");
        let id = r.started("https://a.io/file.zip", &dest);
        assert_eq!(r.list().len(), 1);
        assert_eq!(r.list()[0].state, DownloadStateName::Downloading);
        r.finished(
            "https://a.io/file.zip",
            Some(&PathBuf::from("C:/Users/x/Downloads/file.zip")),
            true,
        );
        let item = r.list()[0].clone();
        assert_eq!(item.state, DownloadStateName::Completed);
        assert_eq!(item.filename, "file.zip");
        assert!(item.end_time.is_some());
        assert!(r.remove(&id));
        assert!(r.list().is_empty());
    }

    #[test]
    fn failed_download_marks_failed() {
        let mut r = DownloadRegistry::new();
        r.started("https://a.io/x.bin", &PathBuf::from("x.bin"));
        r.finished("https://a.io/x.bin", None, false);
        assert_eq!(r.list()[0].state, DownloadStateName::Failed);
        assert!(r.list()[0].error.is_some());
    }

    #[test]
    fn filenames_sanitized() {
        let r = DownloadRegistry::new();
        let dest = r.destination_for("https://a.io/a%20b.zip", &PathBuf::from("bad:name*.zip"));
        let name = dest.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.contains("bad_name_"), "sanitized: {name}");
    }
}
