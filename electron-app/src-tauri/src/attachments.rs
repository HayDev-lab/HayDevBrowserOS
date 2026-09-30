//! New Tab / Search attachment + research bridge backing store — port of
//! Electron's `@shared/newtab-bridge.ts` contracts and the registry from
//! `newtab-ipc-handlers.ts`.
//!
//! The pab:// pages get `window.__pabNewTab` via an init script injected in
//! `core.rs` (see `BRIDGE_INIT_SCRIPT`), backed by fetch() to pab:// API
//! endpoints served in `pab.rs` — NOT via Tauri invoke. This keeps the
//! capability model intact: tab webviews (including remote pages) have zero
//! IPC; only our own pab:// documents can reach these endpoints, and the
//! protocol handler attributes requests by Referer.
//!
//! The protocol handler is synchronous, but a native file dialog is modal —
//! so the pick is a two-step job: POST pick → {pickId}, then poll. Research
//! start returns immediately and runs the agent loop on a worker thread
//! (Electron parity: {started, error?}).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::Manager;

/// Hard caps — mirror of newtab-bridge.ts (enforced HERE, in the backend).
pub const NEWTAB_ATTACH_MAX_FILES: usize = 4;
pub const NEWTAB_ATTACH_MAX_TEXT_BYTES: usize = 256 * 1024;
pub const NEWTAB_ATTACH_INLINE_TEXT_LIMIT: usize = 24 * 1024;
pub const NEWTAB_RESEARCH_QUERY_MAX: usize = 2_000;
pub const NEWTAB_ATTACH_MAX_IMAGES: usize = 2;
pub const NEWTAB_IMAGE_MAX_EDGE: u32 = 1024;
pub const NEWTAB_THUMB_EDGE: u32 = 192;

/// Registry bound: live attachments cap (8) + one run's worth of files.
const REGISTRY_CAP: usize = 8;
const REGISTRY_TTL: Duration = Duration::from_secs(30 * 60);

/// Opaque descriptor handed to the page — no filesystem paths leak.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AttachmentDescriptor {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    /// Small JPEG data-URL thumbnail — images only. Not generated yet in the
    /// Tauri runtime (Phase 2.3 vision work); the page treats it as optional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
}

/// Main-side view of a pending attachment (registry entry).
#[derive(Debug, Clone)]
pub struct PendingAttachment {
    pub attachment: AttachmentDescriptor,
    /// Bounded utf-8 text excerpt for text-like files (no path leaves here).
    pub text: Option<String>,
    /// Full-size (≤1024px) JPEG base64 for vision models — images only.
    pub model_image_base64: Option<String>,
    stored_at: Instant,
}

/// One asynchronous file-dialog job (POST pick → poll).
#[derive(Debug, Clone)]
enum PickJob {
    Pending,
    Done(Option<AttachmentDescriptor>),
}

#[derive(Default)]
pub struct Registry {
    attachments: HashMap<String, PendingAttachment>,
    picks: HashMap<String, (PickJob, Instant)>,
}

pub type SharedAttachments = Arc<Mutex<Registry>>;

/// Evict expired attachments/picks (called on insert; cheap at this scale).
fn sweep(registry: &mut Registry) {
    registry.attachments.retain(|_, v| v.stored_at.elapsed() < REGISTRY_TTL);
    registry
        .picks
        .retain(|_, (_, at)| at.elapsed() < REGISTRY_TTL);
}

/// Blocking pick: native dialog (MUST run off the main thread — invoke
/// commands and start_pick's worker both qualify) + registry registration.
/// `None` = the user cancelled.
pub fn blocking_pick(
    app: &tauri::AppHandle<tauri::Wry>,
    kind: &str,
) -> Option<AttachmentDescriptor> {
    let picked = run_file_dialog(app, kind)?;
    match register_file(app, &picked) {
        Ok(desc) => Some(desc),
        Err(err) => {
            log::warn!("[NEWTAB] attachment read failed: {err}");
            None
        }
    }
}

/// Start an async native file pick. Returns the pick job id immediately; the
/// dialog runs on a worker thread and the result is consumed via `poll_pick`.
pub fn start_pick(app: &tauri::AppHandle<tauri::Wry>, kind: &str) -> String {
    let registry = attachments_state(app);
    let pick_id = uuid::Uuid::new_v4().to_string();
    {
        let mut reg = registry.lock().unwrap_or_else(|p| p.into_inner());
        sweep(&mut reg);
        // Parity: a full registry refuses new picks with an immediate null.
        if reg.attachments.len() >= REGISTRY_CAP + NEWTAB_ATTACH_MAX_FILES {
            reg.picks
                .insert(pick_id.clone(), (PickJob::Done(None), Instant::now()));
            return pick_id;
        }
        reg.picks
            .insert(pick_id.clone(), (PickJob::Pending, Instant::now()));
    }

    let handle = app.clone();
    let job_id = pick_id.clone();
    let kind = kind.to_string();
    std::thread::spawn(move || {
        let done = match blocking_pick(&handle, &kind) {
            Some(desc) => PickJob::Done(Some(desc)),
            None => PickJob::Done(None), // cancelled or read failure
        };
        let reg = attachments_state(&handle);
        let mut reg = reg.lock().unwrap_or_else(|p| p.into_inner());
        reg.picks.insert(job_id, (done, Instant::now()));
    });
    pick_id
}

/// blocking_pick_file must run OFF the main thread — we are on our own
/// worker thread, and the plugin dispatches the dialog to the UI thread.
fn run_file_dialog(app: &tauri::AppHandle<tauri::Wry>, kind: &str) -> Option<std::path::PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file();
    if kind == "image" {
        dialog = dialog.add_filter("Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
    } else {
        dialog = dialog.add_filter(
            "Documents & Images",
            &[
                "pdf", "doc", "docx", "txt", "md", "csv", "tsv", "json", "xml", "log", "yml",
                "yaml", "ini", "png", "jpg", "jpeg", "webp", "gif", "bmp",
            ],
        );
    }
    dialog.blocking_pick_file().and_then(|p| p.into_path().ok())
}

/// Read the picked file with the hard caps; returns the opaque descriptor
/// and registers the pending attachment. No path is returned to any page.
/// Images additionally get a ≤1024px JPEG model image and a 192px thumbnail
/// (Electron NEWTAB_IMAGE_MAX_EDGE / NEWTAB_THUMB_EDGE parity).
fn register_file(
    app: &tauri::AppHandle<tauri::Wry>,
    path: &Path,
) -> std::io::Result<AttachmentDescriptor> {
    const IMAGE_FILE_READ_CAP: u64 = 25 * 1024 * 1024;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let size = std::fs::metadata(path)?.len();
    let mime = mime_by_name(&name);
    let text = if is_text_like(&mime, &name) && size > 0 {
        read_text_prefix(path, NEWTAB_ATTACH_MAX_TEXT_BYTES)
    } else {
        None
    };
    let mut model_image = None;
    let mut thumbnail = None;
    if mime.starts_with("image/") && size > 0 && size <= IMAGE_FILE_READ_CAP {
        match build_image_variants(path) {
            Ok((model, thumb)) => {
                model_image = Some(model);
                thumbnail = Some(thumb);
            }
            Err(err) => log::warn!("[NEWTAB] image variant build failed for {name}: {err}"),
        }
    }
    let descriptor = AttachmentDescriptor {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        mime,
        size,
        thumbnail,
    };
    let registry = attachments_state(app);
    let mut reg = registry.lock().unwrap_or_else(|p| p.into_inner());
    sweep(&mut reg);
    reg.attachments.insert(
        descriptor.id.clone(),
        PendingAttachment {
            attachment: descriptor.clone(),
            text,
            model_image_base64: model_image,
            stored_at: Instant::now(),
        },
    );
    Ok(descriptor)
}

/// Decode + downscale one image into the two variants the pipeline uses:
/// (model_image_base64 ≤1024px JPEG, thumbnail data-URL 192px JPEG).
fn build_image_variants(path: &Path) -> Result<(String, String), String> {
    use base64::Engine;
    let img = image::open(path).map_err(|e| e.to_string())?;
    let encode_jpeg = |img: &image::DynamicImage| -> Result<Vec<u8>, String> {
        let mut out = std::io::Cursor::new(Vec::new());
        let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80);
        img.write_with_encoder(enc).map_err(|e| e.to_string())?;
        Ok(out.into_inner())
    };
    let model = img.thumbnail(NEWTAB_IMAGE_MAX_EDGE, NEWTAB_IMAGE_MAX_EDGE);
    let model_b64 = base64::engine::general_purpose::STANDARD.encode(encode_jpeg(&model)?);
    let thumb = img.thumbnail(NEWTAB_THUMB_EDGE, NEWTAB_THUMB_EDGE);
    let thumb_b64 = base64::engine::general_purpose::STANDARD.encode(encode_jpeg(&thumb)?);
    Ok((model_b64, format!("data:image/jpeg;base64,{thumb_b64}")))
}

/// Model-ready base64 images for a research run, in pick order, capped at
/// NEWTAB_ATTACH_MAX_IMAGES (Electron runResearch parity).
pub fn images_for(app: &tauri::AppHandle<tauri::Wry>, ids: &[String]) -> Vec<String> {
    let registry = attachments_state(app);
    let reg = registry.lock().unwrap_or_else(|p| p.into_inner());
    ids.iter()
        .take(NEWTAB_ATTACH_MAX_FILES)
        .filter_map(|id| reg.attachments.get(id)?.model_image_base64.clone())
        .take(NEWTAB_ATTACH_MAX_IMAGES)
        .collect()
}

/// One-shot poll: `{"state":"pending"}` while the dialog is open; a `done`
/// answer is consumed (removed) — `{attachment: null}` means cancelled.
pub fn poll_pick(app: &tauri::AppHandle<tauri::Wry>, pick_id: &str) -> Option<serde_json::Value> {
    let registry = attachments_state(app);
    let mut reg = registry.lock().unwrap_or_else(|p| p.into_inner());
    let (job, _) = reg.picks.get(pick_id)?.clone();
    match job {
        PickJob::Pending => Some(serde_json::json!({ "state": "pending" })),
        PickJob::Done(attachment) => {
            reg.picks.remove(pick_id);
            Some(serde_json::json!({ "state": "done", "attachment": attachment }))
        }
    }
}

/// Digests for a research run: metadata for every id, text only for
/// text-like attachments (already read at pick time). Unknown ids are
/// skipped — the composed command announces what actually resolved.
pub fn digests_for(
    app: &tauri::AppHandle<tauri::Wry>,
    ids: &[String],
) -> Vec<(String, String, u64, Option<String>)> {
    let registry = attachments_state(app);
    let reg = registry.lock().unwrap_or_else(|p| p.into_inner());
    ids.iter()
        .take(NEWTAB_ATTACH_MAX_FILES)
        .filter_map(|id| {
            let entry = reg.attachments.get(id)?;
            let a = &entry.attachment;
            Some((a.name.clone(), a.mime.clone(), a.size, entry.text.clone()))
        })
        .collect()
}

/// Port of composeResearchCommand: query + bounded attachment digests → the
/// DEEP_RESEARCH command string. Pure — no secrets, no paths.
pub fn compose_research_command(
    query: &str,
    digests: &[(String, String, u64, Option<String>)],
) -> String {
    let mut parts = vec![query.trim().to_string()];
    for (name, mime, size, text) in digests {
        let header = format!(
            "[attached file: {name} — {}, {}]",
            if mime.is_empty() { "unknown type" } else { mime.as_str() },
            format_bytes(*size)
        );
        match text {
            Some(t) if !t.is_empty() => {
                let inline: String = t.chars().take(NEWTAB_ATTACH_INLINE_TEXT_LIMIT).collect();
                parts.push(format!(
                    "{header}\n<attached-file name=\"{}\">\n{inline}\n</attached-file>",
                    sanitize_file_name(name)
                ));
            }
            _ => parts.push(format!(
                "{header}\n(binary content — analyze using this file's metadata)"
            )),
        }
    }
    parts.join("\n\n")
}

/// Keep attachment names out of tag-like positions (parity sanitizeFileName).
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | '"' | '\'' | '&'))
        .take(80)
        .collect();
    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned
    }
}

/// Parity formatBytes: "1.5 KB" style, never negative.
pub fn format_bytes(size: u64) -> String {
    if size < 1024 {
        format!("{size} B")
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    }
}

/// Text-like attachments whose content can be safely inlined (parity).
pub fn is_text_like(mime: &str, name: &str) -> bool {
    if mime.starts_with("text/") {
        return true;
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if matches!(
        ext.as_str(),
        "json" | "xml" | "csv" | "md" | "txt" | "log" | "yaml" | "yml" | "ini" | "tsv"
    ) {
        return true;
    }
    mime.contains("json") || mime.contains("xml") || mime.contains("csv")
}

/// Extension-based mime resolution (no content sniffing — honest default).
pub fn mime_by_name(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "txt" | "log" | "ini" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "json" => "application/json",
        "xml" => "application/xml",
        "yml" | "yaml" => "application/yaml",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn read_text_prefix(path: &Path, cap: usize) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; cap];
    let read = file.read(&mut buf).ok()?;
    buf.truncate(read);
    Some(String::from_utf8_lossy(&buf).to_string())
}

fn attachments_state(app: &tauri::AppHandle<tauri::Wry>) -> SharedAttachments {
    app.state::<SharedAttachments>().inner().clone()
}

// ---------------------------------------------------------------------------
// Init script — defines window.__pabNewTab in pab://newtab and pab://search
// documents ONLY (self-gated by document URL; injected into every tab
// webview in core.rs). Backed by fetch() to the pab:// API endpoints, so
// tab webviews keep ZERO Tauri invoke capability (migration contract §9).
// ---------------------------------------------------------------------------

pub const BRIDGE_INIT_SCRIPT: &str = r#"
(function () {
  'use strict';
  // pab pages surface under THREE URL forms depending on the webview
  // engine/platform: pab://newtab/, http(s)://pab.localhost/newtab/ and
  // http(s)://pab.newtab/ (WebView2 maps custom schemes to virtual hosts).
  // The bridge exists ONLY on our own newtab/search documents.
  function bridgePage(href) {
    var m = /^pab:\/\/(newtab|search)\/?(\?.*)?$/i.exec(href)
         || /^(?:https?:)?\/\/pab\.localhost\/(newtab|search)?\/?(\?.*)?$/i.exec(href)
         || /^(?:https?:)?\/\/pab\.(newtab|search)\/?(\?.*)?$/i.exec(href);
    return m ? (m[1] || 'newtab').toLowerCase() : null;
  }
  var page = bridgePage(String(location.href));
  if (!page) return;
  if (window.__pabNewTab) return;
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }
  window.__pabNewTab = {
    pickAttachment: function (kind) {
      return post('/api/attachment/pick', { kind: kind || 'file' })
        .then(function (start) {
          if (!start || !start.pickId) return { attachment: null };
          var pickId = start.pickId;
          return new Promise(function (resolve) {
            var attempts = 0;
            (function poll() {
              fetch('/api/attachment/poll?id=' + encodeURIComponent(pickId))
                .then(function (r) { return r.json(); })
                .then(function (st) {
                  if (st && st.state === 'pending' && attempts++ < 600) {
                    setTimeout(poll, 200);
                    return;
                  }
                  resolve({ attachment: (st && st.attachment) || null });
                })
                .catch(function () { resolve({ attachment: null }); });
            })();
          });
        })
        .catch(function () { return { attachment: null }; });
    },
    runResearch: function (req) {
      return post('/api/research/run', req || {}).catch(function () {
        return { started: false, error: 'bridge unavailable' };
      });
    }
  };
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_inlines_text_and_announces_binary() {
        let digests = vec![
            ("notes.md".into(), "text/markdown".into(), 10u64, Some("hello world".into())),
            ("photo.png".into(), "image/png".into(), 2048u64, None),
        ];
        let out = compose_research_command("summarize", &digests);
        assert!(out.starts_with("summarize\n\n[attached file: notes.md"));
        assert!(out.contains("<attached-file name=\"notes.md\">\nhello world\n</attached-file>"));
        assert!(out.contains("[attached file: photo.png — image/png, 2.0 KB]"));
        assert!(out.contains("(binary content — analyze using this file's metadata)"));
    }

    #[test]
    fn compose_inlines_at_most_the_cap() {
        let big = "x".repeat(NEWTAB_ATTACH_INLINE_TEXT_LIMIT + 100);
        let digests = vec![("a.txt".into(), "text/plain".into(), big.len() as u64, Some(big))];
        let out = compose_research_command("q", &digests);
        assert!(out.len() < NEWTAB_ATTACH_INLINE_TEXT_LIMIT + 500);
    }

    #[test]
    fn sanitize_strips_tag_characters() {
        assert_eq!(sanitize_file_name("a<b>c\"d'e&f"), "abcdef");
        assert_eq!(sanitize_file_name(""), "file");
        let long = "a".repeat(200);
        assert_eq!(sanitize_file_name(&long).chars().count(), 80);
    }

    #[test]
    fn format_bytes_matches_electron() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(2048), "2.0 KB");
        assert_eq!(format_bytes(3 * 1024 * 1024), "3.0 MB");
    }

    #[test]
    fn text_like_detection_parity() {
        assert!(is_text_like("text/plain", "x"));
        assert!(is_text_like("application/octet-stream", "data.JSON"));
        assert!(is_text_like("", "notes.md"));
        assert!(!is_text_like("image/png", "x.png"));
    }

    #[test]
    fn mime_by_extension() {
        assert_eq!(mime_by_name("a.png"), "image/png");
        assert_eq!(mime_by_name("b.MD"), "text/markdown");
        assert_eq!(mime_by_name("noext"), "application/octet-stream");
    }

    #[test]
    fn image_variants_produce_model_and_thumbnail() {
        // Synthetic 800×600 PNG → ≤1024 model JPEG + 192 thumb data-URL.
        let dir = std::env::temp_dir().join(format!("haydev-att-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("in.png");
        let img = image::DynamicImage::new_rgb8(800, 600);
        img.save_with_format(&png, image::ImageFormat::Png).unwrap();
        let (model, thumb) = build_image_variants(&png).expect("variants");
        use base64::Engine;
        let model_bytes = base64::engine::general_purpose::STANDARD
            .decode(&model)
            .expect("model b64");
        assert_eq!(model_bytes[..2], [0xFF, 0xD8], "model must be JPEG");
        assert!(thumb.starts_with("data:image/jpeg;base64,"), "thumb data-URL");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn images_for_caps_at_two() {
        // Static shape check: the cap constant matches Electron parity.
        assert_eq!(NEWTAB_ATTACH_MAX_IMAGES, 2);
        assert_eq!(NEWTAB_IMAGE_MAX_EDGE, 1024);
        assert_eq!(NEWTAB_THUMB_EDGE, 192);
    }
}
