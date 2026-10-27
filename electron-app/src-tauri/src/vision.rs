//! Ephemeral viewport images. Never persist frames or include them in telemetry.
use crate::error::{AppError, AppResult};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Wry};

pub fn capture(app: &AppHandle<Wry>, tab: &str) -> AppResult<Value> {
    let raw = crate::native_webview::call(
        app,
        tab,
        "Page.captureScreenshot",
        r#"{"format":"jpeg","quality":80,"captureBeyondViewport":false}"#,
    )?;
    let encoded = raw["data"]
        .as_str()
        .ok_or_else(|| AppError::new("VISION_EMPTY", "No frame returned"))?;
    if encoded.len() > 24_000_000 {
        return Err(AppError::new(
            "VISION_TOO_LARGE",
            "Viewport exceeds frame limit",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| AppError::new("VISION_INVALID", "Invalid frame"))?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AppError::new("VISION_INVALID", "Invalid image format"))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    reader.limits(limits);
    let img = reader
        .decode()
        .map_err(|_| AppError::new("VISION_INVALID", "Unable to decode frame"))?;
    let (width, height) = (img.width(), img.height());
    let reduced = img.thumbnail(1600, 1600);
    let mut out = Vec::new();
    reduced
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut out, 80,
        ))
        .map_err(|_| AppError::new("VISION_ENCODE_FAILED", "Unable to encode frame"))?;
    crate::run_guard::check()?;
    Ok(
        json!({"capturedAt":haydev_poker_core::now_ms(),"tabId":tab,"hash":digest,
        "sourceWidth":width,"sourceHeight":height,"imageWidth":reduced.width(),"imageHeight":reduced.height(),
        "_imageBase64":base64::engine::general_purpose::STANDARD.encode(out)}),
    )
}
/// Extract the private image field BEFORE serializing any tool result to history.
pub fn take_image(v: &mut Value) -> Option<String> {
    v.as_object_mut()?
        .remove("_imageBase64")?
        .as_str()
        .map(str::to_string)
}
pub fn image_message(image: &str, metadata: &str) -> Value {
    json!({"role":"user","content":[
        {"type":"text","text":metadata},{"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{image}")}}
    ]})
}
pub fn discard_old_images(messages: &mut [Value]) {
    for message in messages {
        if let Some(parts) = message["content"].as_array() {
            // User-provided reference attachments remain available; only live
            // viewport frames are replaced by the next observation.
            if !parts
                .first()
                .and_then(|p| p["text"].as_str())
                .is_some_and(|s| s.starts_with("Current viewport:"))
            {
                continue;
            }
            let text = parts
                .iter()
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n");
            message["content"] = json!(text);
        }
    }
}
