use crate::error::{AppError, AppResult};
use crate::media_image;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
const VIDEO_TIMEOUT: Duration = Duration::from_secs(600);
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "webm", "mkv"];
static MEDIA_PICKER: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanedMedia {
    file_name: String,
}

#[tauri::command]
pub fn media_cleaner_video_available() -> bool {
    ffmpeg_path().is_some()
}

#[tauri::command]
pub async fn media_cleaner_run(
    app: AppHandle<Wry>,
    kind: MediaKind,
) -> AppResult<Option<CleanedMedia>> {
    tauri::async_runtime::spawn_blocking(move || select_and_clean(&app, kind))
        .await
        .map_err(|_| error("MEDIA_CLEAN_FAILED", "The media cleaner stopped"))?
}

fn file_dialog(app: &AppHandle<Wry>) -> FileDialogBuilder<Wry> {
    let dialog = app.dialog().file();
    match app.get_window("main") {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}

fn select_and_clean(app: &AppHandle<Wry>, kind: MediaKind) -> AppResult<Option<CleanedMedia>> {
    let _picker = MEDIA_PICKER
        .try_lock()
        .map_err(|_| error("MEDIA_BUSY", "A media operation is already in progress"))?;

    let (label, extensions) = match kind {
        MediaKind::Image => ("Images", IMAGE_EXTENSIONS),
        MediaKind::Video => ("Videos", VIDEO_EXTENSIONS),
    };
    let ffmpeg = if matches!(kind, MediaKind::Video) {
        Some(
            ffmpeg_path()
                .ok_or_else(|| error("MEDIA_FFMPEG_MISSING", "FFmpeg is required for video"))?,
        )
    } else {
        None
    };
    let Some(source) = file_dialog(app)
        .add_filter(label, extensions)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = source
        .into_path()
        .map_err(|_| error("MEDIA_READ_FAILED", "Choose a local file"))?;

    let output = match ffmpeg {
        None => {
            let bytes = read_image(&source)?;
            let (format, cleaned) = media_image::clean(&bytes).map_err(|issue| match issue {
                media_image::ImageError::Unsupported => error(
                    "MEDIA_IMAGE_UNSUPPORTED",
                    "Choose a JPEG, PNG or WebP image",
                ),
                media_image::ImageError::Invalid => {
                    error("MEDIA_IMAGE_INVALID", "The image container is damaged")
                }
            })?;
            let Some(destination) = pick_output(app, &source, label, format.extensions())? else {
                return Ok(None);
            };
            let mut temporary = temporary_file(&destination)?;
            temporary.write_all(&cleaned).map_err(write_error)?;
            publish(temporary, &destination)?;
            destination
        }
        Some(ffmpeg) => {
            let format = video_format(&source)?;
            if !source.is_file() {
                return Err(error("MEDIA_READ_FAILED", "Choose a local video file"));
            }
            let Some(destination) = pick_output(app, &source, label, &[format.extension])? else {
                return Ok(None);
            };
            let temporary = temporary_file(&destination)?;
            remux_video(&ffmpeg, &source, temporary.path(), format)?;
            publish(temporary, &destination)?;
            destination
        }
    };
    Ok(Some(CleanedMedia {
        file_name: output
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
    }))
}

fn pick_output(
    app: &AppHandle<Wry>,
    source: &Path,
    label: &str,
    extensions: &[&str],
) -> AppResult<Option<PathBuf>> {
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let Some(selection) = file_dialog(app)
        .set_file_name(format!("{stem}-clean.{}", extensions[0]))
        .add_filter(label, extensions)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = selection
        .into_path()
        .map_err(|_| error("MEDIA_WRITE_FAILED", "Choose a local output file"))?;
    if path.extension().is_none() {
        path.set_extension(extensions[0]);
    }
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| {
            extensions
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        })
    {
        return Err(error(
            "MEDIA_OUTPUT_FORMAT",
            "Save the copy using the original format",
        ));
    }
    if path.exists() {
        return Err(error(
            "MEDIA_OUTPUT_EXISTS",
            "Choose a new file name to keep existing files",
        ));
    }
    Ok(Some(path))
}

fn read_image(path: &Path) -> AppResult<Vec<u8>> {
    let failed = |_| error("MEDIA_READ_FAILED", "Could not read the selected image");
    let file = File::open(path).map_err(failed)?;
    let info = file.metadata().map_err(failed)?;
    if !info.is_file() {
        return Err(error("MEDIA_READ_FAILED", "Choose a local image file"));
    }
    if info.len() > MAX_IMAGE_BYTES {
        return Err(error(
            "MEDIA_IMAGE_TOO_LARGE",
            "Images may be at most 64 MiB",
        ));
    }
    let mut bytes = Vec::with_capacity(info.len() as usize);
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(failed)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(error(
            "MEDIA_IMAGE_TOO_LARGE",
            "Images may be at most 64 MiB",
        ));
    }
    Ok(bytes)
}

fn temporary_file(destination: &Path) -> AppResult<tempfile::NamedTempFile> {
    let parent = destination
        .parent()
        .ok_or_else(|| error("MEDIA_WRITE_FAILED", "Choose an output folder"))?;
    tempfile::Builder::new()
        .prefix(".haydev-media-")
        .tempfile_in(parent)
        .map_err(write_error)
}

fn publish(file: tempfile::NamedTempFile, destination: &Path) -> AppResult<()> {
    if file.as_file().metadata().map_err(write_error)?.len() == 0 {
        return Err(error("MEDIA_CLEAN_FAILED", "The cleaned file is empty"));
    }
    file.as_file().sync_all().map_err(write_error)?;
    file.persist_noclobber(destination)
        .map_err(|failure| write_error(failure.error))?;
    Ok(())
}

fn write_error(issue: io::Error) -> AppError {
    if issue.kind() == io::ErrorKind::AlreadyExists {
        error(
            "MEDIA_OUTPUT_EXISTS",
            "Choose a new file name to keep existing files",
        )
    } else {
        error("MEDIA_WRITE_FAILED", "Could not save the cleaned copy")
    }
}

fn error(code: &str, message: &str) -> AppError {
    AppError::new(code, message)
}

fn ffmpeg_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let program = "ffmpeg.exe";
    #[cfg(not(windows))]
    let program = "ffmpeg";
    let path = std::env::var_os("PATH")?;
    let current_dir = std::env::current_dir().ok();
    std::env::split_paths(&path)
        .filter(|dir| dir.is_absolute() && Some(dir) != current_dir.as_ref())
        .map(|dir| dir.join(program))
        .filter(|file| file.is_file())
        .find_map(|file| file.canonicalize().ok())
}

#[derive(Clone, Copy)]
struct VideoFormat {
    extension: &'static str,
    muxer: &'static str,
    quicktime: bool,
}

fn video_format(source: &Path) -> AppResult<VideoFormat> {
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (extension, muxer, quicktime) = match extension.as_str() {
        "mp4" => ("mp4", "mp4", true),
        "mov" => ("mov", "mov", true),
        "webm" => ("webm", "webm", false),
        "mkv" => ("mkv", "matroska", false),
        _ => {
            return Err(error(
                "MEDIA_VIDEO_UNSUPPORTED",
                "Choose an MP4, MOV, WebM or MKV video",
            ))
        }
    };
    Ok(VideoFormat {
        extension,
        muxer,
        quicktime,
    })
}

fn remux_video(
    ffmpeg: &Path,
    source: &Path,
    destination: &Path,
    format: VideoFormat,
) -> AppResult<()> {
    let mut command = Command::new(ffmpeg);
    if let Some(directory) = ffmpeg.parent() {
        command.current_dir(directory);
    }
    command.env_remove("FFREPORT");
    command.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file",
    ]);
    if format.quicktime {
        command.args([
            "-format_whitelist",
            "mov,mp4,m4a,3gp,3g2,mj2",
            "-enable_drefs",
            "0",
        ]);
    } else {
        command.args(["-format_whitelist", "matroska,webm"]);
    }
    command
        .arg("-i")
        .arg(source)
        .args([
            "-map",
            "0:V",
            "-map",
            "0:a?",
            "-map",
            "0:s?",
            "-c",
            "copy",
            "-map_metadata",
            "-1",
            "-map_metadata:s",
            "-1",
            "-map_chapters",
            "-1",
            "-fflags",
            "+bitexact",
            "-f",
            format.muxer,
            "-y",
        ])
        .arg(destination)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = command
        .spawn()
        .map_err(|_| error("MEDIA_FFMPEG_FAILED", "Could not start FFmpeg"))?;
    #[cfg(windows)]
    let _job = match crate::runtime_manager::RuntimeJob::for_child(&child) {
        Ok(job) => job,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error(
                "MEDIA_FFMPEG_FAILED",
                "Could not manage the FFmpeg process",
            ));
        }
    };

    let deadline = Instant::now() + VIDEO_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                return Err(error(
                    "MEDIA_VIDEO_FAILED",
                    "FFmpeg could not copy the video streams",
                ))
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            pending => {
                let _ = child.kill();
                let _ = child.wait();
                return if pending.is_ok() {
                    Err(error(
                        "MEDIA_VIDEO_TIMEOUT",
                        "Video cleanup exceeded the time limit",
                    ))
                } else {
                    Err(error("MEDIA_VIDEO_FAILED", "Could not monitor FFmpeg"))
                };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_replaces_an_existing_destination() {
        let folder = tempfile::tempdir().unwrap();
        let destination = folder.path().join("example.png");
        let mut cleaned = temporary_file(&destination).unwrap();
        cleaned.write_all(b"clean copy").unwrap();
        std::fs::write(&destination, b"original").unwrap();

        assert_eq!(
            publish(cleaned, &destination).unwrap_err().code,
            "MEDIA_OUTPUT_EXISTS"
        );
        assert_eq!(std::fs::read(&destination).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}
