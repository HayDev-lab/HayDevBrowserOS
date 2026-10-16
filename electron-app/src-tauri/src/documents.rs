//! Data-only PDF/DOCX parser in a bounded child process. No document links,
//! macros, scripts, embedded programs or remote relationships are executed.
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::error::{AppError, AppResult};
const MAX_FILE: usize = 25 * 1024 * 1024;
const MAX_TEXT: usize = 256 * 1024;
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DocumentText { pub text: String, pub status: String }
fn err(code: &str) -> AppError { AppError::new(code, code) }

fn parse(bytes: &[u8], kind: &str) -> AppResult<DocumentText> {
    if bytes.len() > MAX_FILE { return Err(err("DOCUMENT_TOO_LARGE")); }
    if bytes.is_empty() { return Err(err("DOCUMENT_EMPTY")); }
    let mut text = match kind {
        "pdf" => {
            if !bytes.starts_with(b"%PDF-") { return Err(err("DOCUMENT_CORRUPT")); }
            let doc = pdf_extract::Document::load_mem(bytes).map_err(|_| err("DOCUMENT_CORRUPT"))?;
            if doc.is_encrypted() { return Err(err("DOCUMENT_PROTECTED")); }
            if doc.get_pages().len() > 300 { return Err(err("DOCUMENT_PAGE_LIMIT")); }
            let text = pdf_extract::extract_text_from_mem(bytes).map_err(|_| err("DOCUMENT_CORRUPT"))?;
            if text.trim().is_empty() {
                let has_image = doc.objects.values().any(|o| match o { pdf_extract::Object::Stream(s) => s.dict.get(b"Subtype").ok().and_then(|v| v.as_name().ok()) == Some(b"Image"), _ => false });
                return Err(err(if has_image { "DOCUMENT_SCAN_REQUIRES_OCR" } else { "DOCUMENT_EMPTY" }));
            }
            text
        }
        "docx" => {
            if bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0]) { return Err(err("DOCUMENT_PROTECTED")); }
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| err("DOCUMENT_CORRUPT"))?;
            if archive.len() > 5000 { return Err(err("DOCUMENT_ARCHIVE_LIMIT")); }
            let mut expanded = 0u64;
            for i in 0..archive.len() {
                let f = archive.by_index(i).map_err(|_| err("DOCUMENT_CORRUPT"))?;
                expanded = expanded.saturating_add(f.size());
                if expanded > 64 * 1024 * 1024 { return Err(err("DOCUMENT_ARCHIVE_LIMIT")); }
            }
            let mut xml = String::new();
            archive.by_name("word/document.xml").map_err(|_| err("DOCUMENT_CORRUPT"))?.take(8 * 1024 * 1024 + 1)
                .read_to_string(&mut xml).map_err(|_| err("DOCUMENT_CORRUPT"))?;
            if xml.len() > 8 * 1024 * 1024 { return Err(err("DOCUMENT_ARCHIVE_LIMIT")); }
            parse_docx_xml(&xml)?
        }
        _ => return Err(err("DOCUMENT_UNSUPPORTED")),
    };
    if text.trim().is_empty() { return Err(err("DOCUMENT_EMPTY")); }
    let partial = text.len() > MAX_TEXT;
    if partial { let mut end = MAX_TEXT; while !text.is_char_boundary(end) { end -= 1; } text.truncate(end); }
    Ok(DocumentText { text, status: if partial { "partial" } else { "ready" }.into() })
}
fn parse_docx_xml(xml: &str) -> AppResult<String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml); let mut text = String::new(); let mut in_text = false;
    loop {
        match reader.read_event().map_err(|_| err("DOCUMENT_CORRUPT"))? {
            Event::Start(e) => { if e.local_name().as_ref() == "t" { in_text = true; } }
            Event::End(e) => match e.local_name().as_ref() {
                "t" => in_text = false,
                "p" | "tr" => text.push('\n'),
                "tc" => text.push('\t'),
                _ => {},
            },
            Event::Empty(e) => match e.local_name().as_ref() { "tab" => text.push('\t'), "br" => text.push('\n'), _ => {} },
            Event::Text(e) if in_text => text.push_str(&e.xml10_content()),
            Event::GeneralRef(e) if in_text => {
                let value: &str = e.as_ref();
                text.push_str(&quick_xml::escape::unescape(&format!("&{value};")).map_err(|_| err("DOCUMENT_CORRUPT"))?);
            }
            Event::DocType(_) => return Err(err("DOCUMENT_EXTERNAL_ENTITIES_FORBIDDEN")),
            Event::Eof => break,
            _ => {},
        }
        if text.len() > MAX_TEXT + 4096 { break; }
    }
    Ok(text)
}

/// Worker mode runs before Tauri, plugins, profiles, engines or networking.
pub fn worker_main() -> bool {
    let mut args = std::env::args(); args.next();
    if args.next().as_deref() != Some("--document-worker") { return false; }
    let kind = args.next().unwrap_or_default(); let mut bytes = Vec::new();
    let result = std::io::stdin().take(MAX_FILE as u64 + 1).read_to_end(&mut bytes)
        .map_err(|_| err("DOCUMENT_READ_FAILED")).and_then(|_| parse(&bytes, &kind));
    let result = match result { Ok(v) => serde_json::json!({"ok":true,"document":v}), Err(e) => serde_json::json!({"ok":false,"error":e.code}) };
    let _ = std::io::stdout().write_all(result.to_string().as_bytes());
    true
}

pub fn extract(path: &Path, cancel: &AtomicBool) -> AppResult<DocumentText> {
    use std::process::{Command, Stdio};
    if std::fs::metadata(path)?.len() > MAX_FILE as u64 { return Err(err("DOCUMENT_TOO_LARGE")); }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?.take(MAX_FILE as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_FILE { return Err(err("DOCUMENT_TOO_LARGE")); }
    if cancel.load(Ordering::SeqCst) { return Err(err("DOCUMENT_CANCELLED")); }
    let kind = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut command = Command::new(std::env::current_exe()?);
    command.args(["--document-worker", &kind]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let _job = match Job::attach(&child) { Ok(j) => j, Err(e) => { let _ = child.kill(); let _ = child.wait(); return Err(e); } };
    let mut input = child.stdin.take().ok_or_else(|| err("DOCUMENT_WORKER_FAILED"))?;
    let input_worker = std::thread::spawn(move || { let _ = input.write_all(&bytes); });
    let output = child.stdout.take().ok_or_else(|| err("DOCUMENT_WORKER_FAILED"))?;
    let output_worker = std::thread::spawn(move || { let mut b = Vec::new(); let _ = output.take((MAX_TEXT * 6 + 4096) as u64).read_to_end(&mut b); b });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let exit = loop {
        if cancel.load(Ordering::SeqCst) || std::time::Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait(); let _ = input_worker.join(); let _ = output_worker.join();
            return Err(err(if cancel.load(Ordering::SeqCst) { "DOCUMENT_CANCELLED" } else { "DOCUMENT_TIMEOUT" }));
        }
        if let Some(code) = child.try_wait()? { break code; }
        std::thread::sleep(std::time::Duration::from_millis(25));
    };
    let _ = input_worker.join(); let output = output_worker.join().map_err(|_| err("DOCUMENT_WORKER_FAILED"))?;
    if !exit.success() { return Err(err("DOCUMENT_WORKER_FAILED")); }
    let value: serde_json::Value = serde_json::from_slice(&output).map_err(|_| err("DOCUMENT_WORKER_FAILED"))?;
    if value["ok"] != true { return Err(err(value["error"].as_str().unwrap_or("DOCUMENT_WORKER_FAILED"))); }
    serde_json::from_value(value["document"].clone()).map_err(|_| err("DOCUMENT_WORKER_FAILED"))
}
#[cfg(windows)]
struct Job(windows::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Job {
    fn attach(child: &std::process::Child) -> AppResult<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(None, None).map_err(|_| err("DOCUMENT_SANDBOX_FAILED"))?;
            let job = Self(handle); let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            limits.BasicLimitInformation.ActiveProcessLimit = 1; limits.ProcessMemoryLimit = 256 * 1024 * 1024;
            SetInformationJobObject(handle, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32).map_err(|_| err("DOCUMENT_SANDBOX_FAILED"))?;
            AssignProcessToJobObject(handle, windows::Win32::Foundation::HANDLE(child.as_raw_handle())).map_err(|_| err("DOCUMENT_SANDBOX_FAILED"))?;
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for Job { fn drop(&mut self) { unsafe { let _ = windows::Win32::Foundation::CloseHandle(self.0); } } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_tables_and_entities() {
        let text = parse_docx_xml(r#"<w:document xmlns:w="x"><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Երևան &amp; Москва</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>"#).unwrap();
        assert!(text.contains("Երևան & Москва")); assert!(text.contains('\t')); assert!(text.contains("42"));
        assert!(parse_docx_xml("<!DOCTYPE x SYSTEM 'https://evil.test/'><x/>").is_err());
    }
}
