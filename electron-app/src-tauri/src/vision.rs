//! Ephemeral viewport images. Never persist frames or include them in telemetry.
use crate::error::{AppError, AppResult};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Wry};

fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

pub fn capture(app: &AppHandle<Wry>, tab: &str) -> AppResult<Value> {
    let mut value = capture_with_source(app, tab)?;
    value.as_object_mut().unwrap().remove("_sourceImageBase64");
    Ok(value)
}
pub fn capture_with_source(app: &AppHandle<Wry>, tab: &str) -> AppResult<Value> {
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
        json!({"capturedAt":now_ms(),"tabId":tab,"hash":digest,
        "sourceWidth":width,"sourceHeight":height,"imageWidth":reduced.width(),"imageHeight":reduced.height(),
        "_sourceImageBase64":encoded,"_imageBase64":base64::engine::general_purpose::STANDARD.encode(out)}),
    )
}
/// Magnify an existing observation without synthesizing card symbols.
pub fn detail(encoded: &str, args: &Value) -> AppResult<Value> {
    let n = |k: &str| args[k].as_f64().filter(|n|n.is_finite()).ok_or_else(||AppError::new("VISION_INVALID_REGION","Region values must be finite numbers"));
    let (x,y,w,h) = (n("x")?,n("y")?,n("width")?,n("height")?);
    if x < 0.0 || y < 0.0 || w <= 0.0 || h <= 0.0 || x+w > 1.0 || y+h > 1.0 || w*h > 0.5 || encoded.len() > 24_000_000 {
        return Err(AppError::new("VISION_INVALID_REGION","Choose a bounded region inside the observed image"));
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_|AppError::new("VISION_INVALID","Invalid frame"))?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|_|AppError::new("VISION_INVALID","Invalid image"))?;
    let mut limits = image::Limits::default(); limits.max_alloc=Some(128*1024*1024); limits.max_image_width=Some(8192); limits.max_image_height=Some(8192); reader.limits(limits);
    let img=reader.decode().map_err(|_|AppError::new("VISION_INVALID","Unable to decode frame"))?;
    detail_decoded(&img,args)
}
/// Reuse the already bounded/decoded observation for several reviewed crops.
pub fn detail_decoded(img:&image::DynamicImage,args:&Value)->AppResult<Value>{
    let n=|k:&str|args[k].as_f64().filter(|n|n.is_finite()).ok_or_else(||AppError::new("VISION_INVALID_REGION","Region values must be finite numbers"));
    let (x,y,w,h)=(n("x")?,n("y")?,n("width")?,n("height")?);
    if x<0.0||y<0.0||w<=0.0||h<=0.0||x+w>1.0||y+h>1.0||w*h>0.5{return Err(AppError::new("VISION_INVALID_REGION","Choose a bounded region inside the observed image"));}
    let left=(x*f64::from(img.width())).floor() as u32; let top=(y*f64::from(img.height())).floor() as u32;
    let right=((x+w)*f64::from(img.width())).ceil().min(f64::from(img.width())) as u32;
    let bottom=((y+h)*f64::from(img.height())).ceil().min(f64::from(img.height())) as u32;
    if right.saturating_sub(left)<2 || bottom.saturating_sub(top)<2 { return Err(AppError::new("VISION_INVALID_REGION","Region is too small")); }
    let crop=img.crop_imm(left,top,right-left,bottom-top);
    let scale=(1280.0/f64::from(crop.width().max(crop.height()))).min(4.0);
    let enlarged=crop.resize((f64::from(crop.width())*scale) as u32,(f64::from(crop.height())*scale) as u32,image::imageops::FilterType::Lanczos3);
    let mut out=Vec::new(); enlarged.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out,95)).map_err(|_|AppError::new("VISION_ENCODE_FAILED","Unable to encode detail"))?;
    Ok(json!({"imageKind":"detail","region":{"x":x,"y":y,"width":w,"height":h},"imageWidth":enlarged.width(),"imageHeight":enlarged.height(),"note":"Magnified pixels from the same observation; no new information or independent verification.","_imageBase64":base64::engine::general_purpose::STANDARD.encode(out)}))
}

pub fn take_image(v: &mut Value) -> Option<String> {
    v.as_object_mut()?.remove("_sourceImageBase64");
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
    discard_images(messages, false);
}
pub fn discard_old_details(messages: &mut [Value]) {
    discard_images(messages, true);
}
fn discard_images(messages: &mut [Value], detail_only: bool) {
    for message in messages {
        if let Some(parts) = message["content"].as_array() {
            // User-provided reference attachments remain available; only live
            // viewport frames are replaced by the next observation.
            if !parts
                .first()
                .and_then(|p| p["text"].as_str())
                .is_some_and(|s| s.starts_with("Current viewport detail:") || (!detail_only && s.starts_with("Current viewport:")))
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_bounds_dimensions_and_private_fields() {
        let img = image::DynamicImage::new_rgb8(200,100);
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png,image::ImageFormat::Png).unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
        let mut result = detail(&encoded,&json!({"x":0.25,"y":0.0,"width":0.5,"height":0.5})).unwrap();
        assert_eq!((result["imageWidth"].as_u64(),result["imageHeight"].as_u64()),(Some(400),Some(200)));
        result["_sourceImageBase64"] = json!(encoded);
        assert!(take_image(&mut result).is_some());
        assert!(!result.to_string().contains("Base64"));
        for region in [json!({"x":-0.1,"y":0,"width":0.5,"height":0.5}),json!({"x":0.9,"y":0,"width":0.5,"height":0.5}),json!({"x":0,"y":0,"width":1,"height":1}),json!({"x":0,"y":0,"width":0.001,"height":0.5})] {
            assert!(detail(&encoded,&region).is_err());
        }
    }
    #[test]
    fn detail_keeps_full_frame_and_new_frame_discards_both() {
        let mut messages=vec![image_message("full","Current viewport: a"),image_message("detail","Current viewport detail: a"),image_message("attachment","User attachment")];
        discard_old_details(&mut messages);
        assert!(messages[0]["content"].is_array());
        assert!(messages[1]["content"].is_string());
        messages.push(image_message("detail2","Current viewport detail: b"));
        discard_old_images(&mut messages);
        assert!(messages[0]["content"].is_string());
        assert!(messages[2]["content"].is_array());
        assert!(messages[3]["content"].is_string());
    }
}
