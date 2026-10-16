//! Windows-only hooks attached to the concrete WebView before navigation.
use tauri::{AppHandle, Emitter, Manager, Wry};
use windows::core::{HSTRING, Interface, PWSTR};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::*;
use crate::error::{AppError, AppResult};
use std::collections::HashMap;

thread_local! {
    static DOWNLOADS: std::cell::RefCell<HashMap<String, ICoreWebView2DownloadOperation>> = std::cell::RefCell::new(HashMap::new());
}
fn failure(_: windows::core::Error) -> AppError { AppError::new("WEBVIEW_NATIVE_ERROR", "Native WebView operation failed") }
unsafe fn string(read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> windows::core::Result<String> {
    let mut value = PWSTR::null(); read(&mut value)?;
    Ok(take_pwstr(value))
}
fn emit_downloads(app: &AppHandle<Wry>) {
    if let Ok(items) = crate::core::list_downloads(app) { let _ = app.emit("browser:downloads:changed", &items); }
}
unsafe fn progress(app: &AppHandle<Wry>, id: &str, op: &ICoreWebView2DownloadOperation) {
    let mut received = 0; let mut total = 0; let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
    let _ = op.BytesReceived(&mut received); let _ = op.TotalBytesToReceive(&mut total); let _ = op.State(&mut state);
    let _ = crate::core::with_state(app, |s| s.downloads.progress(id, received.max(0) as u64, total.max(0) as u64,
        if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED { Some(true) } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED { Some(false) } else { None }));
    emit_downloads(app);
    if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
        if let Ok(path) = string(|p| op.ResultFilePath(p)) {
            if let Some(q) = app.try_state::<crate::downloads::SharedQuarantine>() {
                q.lock().unwrap_or_else(|p| p.into_inner()).finished(std::path::Path::new(&path), state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED);
            }
        }
        DOWNLOADS.with(|m| { m.borrow_mut().remove(id); });
    }
}

/// Called on the UI thread. No protected target is loaded before this succeeds.
pub unsafe fn install(app: &AppHandle<Wry>, native: &tauri::webview::PlatformWebview, tab_id: &str) -> AppResult<()> {
    let wv = native.controller().CoreWebView2().map_err(failure)?;
    let settings: ICoreWebView2Settings2 = wv.Settings().map_err(failure)?.cast().map_err(failure)?;
    let ua = string(|p| settings.UserAgent(p)).map_err(failure)?;
    settings.SetUserAgent(&HSTRING::from(crate::site_ua::build_site_user_agent(&ua))).map_err(failure)?;
    let host: windows::Win32::System::Com::IDispatch = crate::run_host::RunHost { shared: app.state::<crate::agent::SharedAgent>().inner().clone() }.into();
    let mut host = windows::Win32::System::Variant::VARIANT::from(host);
    wv.AddHostObjectToScript(&HSTRING::from("haydevRunLease"), &mut host).map_err(failure)?;
    let env = native.environment();
    let shield = app.state::<crate::shield::SharedShield>().inner().clone();
    let tab = tab_id.to_string(); let handle = app.clone();
    let nav_shield = shield.clone();
    let nav_tab = tab.clone();
    let top_url = std::rc::Rc::new(std::cell::RefCell::new(String::new()));
    let top = top_url.clone();
    wv.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args { *top.borrow_mut() = string(|p| args.Uri(p))?; }
        // A renderer crash (ProcessFailed) drops the tab from the protected
        // set; WebView2 keeps the browser-side hooks alive and auto-reloads.
        // Re-arm membership at the START of the next navigation — before any
        // request of the recovered document can be evaluated.
        nav_shield.attached.lock().unwrap_or_else(|p| p.into_inner()).insert(nav_tab.clone());
        Ok(())
    })), &mut 0).map_err(failure)?;
    wv.AddWebResourceRequestedFilter(&HSTRING::from("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL).map_err(failure)?;
    wv.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
        let (Some(sender), Some(args)) = (sender, args) else { return Ok(()); };
        let request = args.Request()?;
        let request_url = string(|p| request.Uri(p))?;
        // NavigationStarting is the TOP document event. An iframe request must
        // never choose the visited-site exception from its own request URL.
        let page_url = if top_url.borrow().is_empty() { string(|p| sender.Source(p))? } else { top_url.borrow().clone() };
        let host = url::Url::parse(&request_url).ok().and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_default();
        let page_host = url::Url::parse(&page_url).ok().and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_default();
        if crate::shield::should_block_on_site(&shield, &host, &page_host) {
            let response = env.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked by HayDev Shield"), &HSTRING::from("Content-Length: 0\r\n"))?;
            args.SetResponse(&response)?;
            crate::shield::record_block(&shield, &host);
            let _ = handle.emit("shield:stats", crate::shield::status_payload(&shield));
        }
        let _ = &tab;
        Ok(())
    })), &mut 0).map_err(failure)?;

    let handle = app.clone(); let tab = tab_id.to_string();
    wv.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, _| {
        let shield = handle.state::<crate::shield::SharedShield>();
        shield.attached.lock().unwrap_or_else(|p| p.into_inner()).remove(&tab);
        let _ = handle.emit("shield:stats", crate::shield::status_payload(&shield));
        let _ = crate::core::with_state(&handle, |s| { if let Some(t) = s.registry.get_mut(&tab) { t.load_state = crate::types::TabLoadState::Error; t.error = Some("WEBVIEW_PROCESS_FAILED".into()); } });
        Ok(())
    })), &mut 0).map_err(failure)?;
    let handle = app.clone(); let tab = tab_id.to_string();
    wv.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |_, args| {
        if let Some(args) = args {
            let mut success = windows::core::BOOL::default(); args.IsSuccess(&mut success)?;
            if !success.as_bool() {
                let _ = crate::core::with_state(&handle, |s| { if let Some(t) = s.registry.get_mut(&tab) { t.load_state = crate::types::TabLoadState::Error; t.error = Some("NAVIGATION_FAILED".into()); } });
            }
        }
        Ok(())
    })), &mut 0).map_err(failure)?;

    let handle = app.clone(); let tab = tab_id.to_string();
    let v4: ICoreWebView2_4 = wv.cast().map_err(failure)?;
    v4.add_DownloadStarting(&DownloadStartingEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else { return Ok(()); };
        let op = args.DownloadOperation()?;
        let url = string(|p| op.Uri(p))?;
        let suggested = string(|p| args.ResultFilePath(p))?;
        let item = crate::core::with_state(&handle, |s| {
            let mut dest = s.downloads.destination_for(&url, std::path::Path::new(&suggested));
            if s.registry.get(&tab).and_then(|t| t.is_dark_web).unwrap_or(false) {
                let q = handle.state::<crate::downloads::SharedQuarantine>();
                dest = q.lock().unwrap_or_else(|p| p.into_inner()).intercept(&crate::lib_app_data_dir().join("darkweb"), &url, &dest).1;
            }
            let id = s.downloads.started(&url, &dest);
            s.downloads.set_tab(&id, &tab);
            (id, dest)
        });
        let Ok((id, dest)) = item else { args.SetCancel(true)?; return Ok(()); };
        args.SetResultFilePath(&HSTRING::from(dest.as_os_str()))?; args.SetHandled(true)?;
        DOWNLOADS.with(|m| { m.borrow_mut().insert(id.clone(), op.clone()); });
        let h = handle.clone(); let i = id.clone();
        op.add_BytesReceivedChanged(&BytesReceivedChangedEventHandler::create(Box::new(move |op, _| {
            if let Some(op) = op { progress(&h, &i, &op); } Ok(())
        })), &mut 0)?;
        let h = handle.clone(); let i = id.clone();
        op.add_StateChanged(&StateChangedEventHandler::create(Box::new(move |op, _| {
            if let Some(op) = op { progress(&h, &i, &op); } Ok(())
        })), &mut 0)?;
        progress(&handle, &id, &op);
        Ok(())
    })), &mut 0).map_err(failure)?;
    let handle = app.clone(); let tab = tab_id.to_string();
    wv.CallDevToolsProtocolMethod(&HSTRING::from("Target.getTargetInfo"), &HSTRING::from("{}"),
        &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, body| {
            if result.is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    if let Some(id) = v.pointer("/targetInfo/targetId").and_then(|v| v.as_str()) {
                        let _ = crate::core::with_state(&handle, |s| { s.target_ids.insert(tab.clone(), id.to_string()); });
                    }
                }
            } Ok(())
        }))).map_err(failure)?;
    let shield = app.state::<crate::shield::SharedShield>();
    shield.attached.lock().unwrap_or_else(|p| p.into_inner()).insert(tab_id.to_owned());
    Ok(())
}

pub fn cancel(app: &AppHandle<Wry>, id: String) -> AppResult<()> {
    let handle = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = DOWNLOADS.with(|m| {
            let operation = m.borrow().get(&id).cloned();
            let op = operation.ok_or_else(|| AppError::new("DOWNLOAD_NOT_ACTIVE", "Download is no longer active"))?;
            unsafe { op.Cancel() }.map_err(failure)?;
            crate::core::with_state(&handle, |s| s.downloads.cancelled(&id))?;
            emit_downloads(&handle);
            Ok(())
        });
        let _ = tx.send(result);
    })?;
    rx.recv_timeout(std::time::Duration::from_secs(2)).map_err(|_| AppError::new("DOWNLOAD_CANCEL_TIMEOUT", "Download cancellation was not acknowledged"))?
}

pub fn call(app: &AppHandle<Wry>, tab_id: &str, method: &str, params: &str) -> AppResult<serde_json::Value> {
    let wv = app.get_webview(&crate::core::BrowserState::tab_label(tab_id)).ok_or_else(|| AppError::new("TAB_NOT_FOUND", "Tab not found"))?;
    let (tx, rx) = std::sync::mpsc::channel(); let method = method.to_owned(); let params = params.to_owned();
    let guard = crate::run_guard::current(); let pending = guard.clone();
    wv.with_webview(move |native| {
        let send = tx.clone();
        let dispatch = || -> AppResult<()> { unsafe {
            let wv = native.controller().CoreWebView2().map_err(failure)?;
            wv.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params),
                &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, body| {
                    let _ = send.send(result.map_err(failure).and_then(|_| serde_json::from_str(&body).map_err(AppError::from))); Ok(())
                }))).map_err(failure)?;
        } Ok(()) };
        let result = if let Some(g) = pending { g.effect(dispatch) } else { dispatch() };
        if let Err(e) = result { let _ = tx.send(Err(e)); }
    })?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Some(g) = &guard { g.check()?; }
        match rx.recv_timeout(std::time::Duration::from_millis(50)) {
            Ok(v) => return v,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) if std::time::Instant::now() < deadline => {},
            _ => return Err(AppError::new("CDP_TIMEOUT", "Native target did not answer")),
        }
    }
}
pub fn screenshot(app: &AppHandle<Wry>, tab_id: &str, path: &std::path::Path) -> AppResult<std::path::PathBuf> {
    use base64::Engine;
    let v = call(app, tab_id, "Page.captureScreenshot", r#"{"format":"png"}"#)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(v["data"].as_str().ok_or_else(|| AppError::new("SCREENSHOT_FAILED", "No image returned"))?)
        .map_err(|_| AppError::new("SCREENSHOT_FAILED", "Invalid image"))?;
    crate::run_guard::check()?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(path, bytes)?; Ok(path.to_owned())
}
