//! Read-only WebView host predicate. It exposes no commands, data or secrets.
//! Synchronous evaluation closes the gap between native script dispatch and
//! actual renderer execution (which can be delayed by a busy page).
use windows::core::{implement, GUID, PCWSTR};
use windows::Win32::System::Com::*;
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::Foundation::{E_NOTIMPL, E_INVALIDARG};

#[implement(IDispatch)]
pub struct RunHost { pub shared: crate::agent::SharedAgent }
impl IDispatch_Impl for RunHost_Impl {
    fn GetTypeInfoCount(&self) -> windows::core::Result<u32> { Ok(0) }
    fn GetTypeInfo(&self, _: u32, _: u32) -> windows::core::Result<ITypeInfo> { Err(E_NOTIMPL.into()) }
    fn GetIDsOfNames(&self, _: *const GUID, names: *const PCWSTR, count: u32, _: u32, ids: *mut i32) -> windows::core::Result<()> {
        if count != 1 || names.is_null() || ids.is_null() { return Err(E_INVALIDARG.into()); }
        unsafe {
            if (*names).to_string()?.eq_ignore_ascii_case("current") { *ids = 1; Ok(()) }
            else { Err(E_INVALIDARG.into()) }
        }
    }
    fn Invoke(&self, id: i32, _: *const GUID, _: u32, flags: DISPATCH_FLAGS, params: *const DISPPARAMS, result: *mut VARIANT, _: *mut EXCEPINFO, _: *mut u32) -> windows::core::Result<()> {
        if id != 1 || params.is_null() || result.is_null() { return Err(E_INVALIDARG.into()); }
        unsafe {
            if (*params).cArgs != 0 || flags != DISPATCH_PROPERTYGET { return Err(E_INVALIDARG.into()); }
            let active = self.shared.active.lock().unwrap_or_else(|p| p.into_inner());
            let current = active.as_ref().filter(|g| g.check().is_ok()).map(|g| g.id.to_string()).unwrap_or_default();
            *result = VARIANT::from(windows::core::BSTR::from(current));
            Ok(())
        }
    }
}

pub const INIT: &str = r#"(() => {
  Object.defineProperty(window, '__haydevDocumentId', {
    value: Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join(''), configurable: false, writable: false
  });
  const host = chrome.webview.hostObjects.sync.haydevRunLease;
  Object.defineProperty(window, '__haydevRunAllowed', {
    value: (id) => host.getHostProperty('current') === String(id), configurable: false, writable: false
  });
})()"#;
