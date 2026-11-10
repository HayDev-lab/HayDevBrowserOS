//! Explicit, audited local diagnostics. A debug build does not itself enable CDP.
use std::{path::Path,io::Write};

fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
pub fn requested(args:impl Iterator<Item=String>,enabled:Option<&str>,data:Option<&str>)->bool{
    args.into_iter().any(|a|a=="--debug") && enabled==Some("1") && data.is_some_and(|p|Path::new(p).is_absolute())
}
pub fn enabled()->bool{
    static ENABLED:std::sync::OnceLock<bool>=std::sync::OnceLock::new();
    *ENABLED.get_or_init(||{
        let allowed=requested(std::env::args(),std::env::var("HAYDEV_AUTOMATION_DEBUG").ok().as_deref(),std::env::var("HAYDEV_DATA_DIR").ok().as_deref());
        if !allowed{return false;}
        let root=std::env::var_os("HAYDEV_DATA_DIR").unwrap();
        let dir=Path::new(&root).join("logs");
        let audit=(||->std::io::Result<()>{
            std::fs::create_dir_all(&dir)?;
            let mut file=std::fs::OpenOptions::new().create(true).append(true).open(dir.join("cdp-audit.jsonl"))?;
            let row=serde_json::json!({"atMs":now_ms(),"event":"debug_requested","pid":std::process::id(),"address":"127.0.0.1","session":std::env::var("HAYDEV_DEBUG_SESSION").unwrap_or_else(|_|"explicit-qa".into()),"scope":"diagnostics only; listener opening and closure must be verified by the owning launcher"});
            writeln!(file,"{row}")?;file.sync_data()
        })();
        if audit.is_err(){eprintln!("CDP disabled: audit file is not writable");return false;}true
    })
}
/// Called before WebView2 initialization. The launcher's explicit configuration
/// is the only supported source of remote debugging flags.
pub fn initialize(){
    if let Ok(args)=std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"){
        let lower=args.to_ascii_lowercase();
        if lower.contains("remote-debugging")||lower.contains("remote-allow-origins"){
            // Process-local only: never change user environment or registry.
            std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
        }
    }
    let _=enabled();
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn cdp_needs_explicit_flag_and_isolated_data_root(){
        let args=||vec!["app.exe".into(),"--debug".into()].into_iter();
        assert!(!requested(vec!["app.exe".into()].into_iter(),Some("1"),Some("D:\\isolated")));
        assert!(!requested(args(),None,Some("D:\\isolated")));
        assert!(!requested(args(),Some("1"),Some("relative")));
        assert!(requested(args(),Some("1"),Some("D:\\isolated")));
    }
}
