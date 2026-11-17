//! Windows integration for the official Proton VPN client.
use crate::error::{AppError, AppResult};

#[cfg(windows)]
mod windows_client {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Seek};
    use std::os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::OpenOptionsExt,
        io::AsRawHandle,
    };
    use std::path::{Path, PathBuf};
    use std::time::Duration;
    use windows::core::{w, Interface, BSTR, PCWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_CANCELLED, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0,
    };
    use windows::Win32::Security::Cryptography::{
        CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE,
    };
    use windows::Win32::Security::WinTrust::*;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IServiceProvider,
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Threading::{
        CreateMutexW, GetExitCodeProcess, ReleaseMutex, WaitForSingleObject, INFINITE,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Shell::{
        FOLDERID_ProgramFiles, IShellBrowser, IShellDispatch2, IShellFolderViewDual, IShellWindows,
        SHGetKnownFolderPath, SID_STopLevelBrowser, ShellExecuteExW, ShellWindows, CSIDL_DESKTOP,
        KF_FLAG_DEFAULT, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
        SHELLEXECUTEINFOW, SVGIO_BACKGROUND, SWC_DESKTOP, SWFO_NEEDDISPATCH,
    };

    const DOWNLOAD_URL: &str =
        "https://github.com/ProtonVPN/win-app/releases/download/v5.1.9/ProtonVPN_v5.1.9_x64.exe";
    const DOWNLOAD_BYTES: u64 = 130_022_392;
    const DOWNLOAD_SHA256: &str =
        "8454eba06a37c0a636ec8dcfe6a7a823a68a78ee8fe2eeda2d651cd5cd6c3d70";

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn publisher_is_proton(path: &Path, file: &File, allow_online_check: bool) -> bool {
        let name = wide(path);
        let mut subject = WINTRUST_FILE_INFO {
            cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: PCWSTR(name.as_ptr()),
            hFile: HANDLE(file.as_raw_handle()),
            ..Default::default()
        };
        let mut data = WINTRUST_DATA {
            cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
            dwUIChoice: WTD_UI_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            Anonymous: WINTRUST_DATA_0 {
                pFile: &mut subject,
            },
            dwStateAction: WTD_STATEACTION_VERIFY,
            // Permit launching the installed, signed client while offline.
            dwProvFlags: if allow_online_check {
                WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT
            } else {
                WTD_CACHE_ONLY_URL_RETRIEVAL
            },
            ..Default::default()
        };
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
        // The signer certificate is owned by the trust state until CLOSE.
        unsafe {
            let verified = WinVerifyTrustEx(Default::default(), &mut action, &mut data) == 0;
            let proton = verified && signer_is_proton(data.hWVTStateData);
            data.dwStateAction = WTD_STATEACTION_CLOSE;
            WinVerifyTrustEx(Default::default(), &mut action, &mut data);
            proton
        }
    }

    // The trust state has already verified this chain on the opened file.
    unsafe fn signer_is_proton(state: HANDLE) -> bool {
        let provider = WTHelperProvDataFromStateData(state);
        if provider.is_null() {
            return false;
        }
        let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
        if signer.is_null() {
            return false;
        }
        let certificate = WTHelperGetProvCertFromChain(signer, 0);
        if certificate.is_null() || (*certificate).pCert.is_null() {
            return false;
        }
        let mut publisher = [0u16; 128];
        let count = CertGetNameStringW(
            (*certificate).pCert,
            CERT_NAME_SIMPLE_DISPLAY_TYPE,
            0,
            None,
            Some(&mut publisher),
        ) as usize;
        (2..=publisher.len()).contains(&count)
            && String::from_utf16_lossy(&publisher[..count - 1]) == "Proton AG"
    }

    fn launcher_path() -> AppResult<PathBuf> {
        // Program Files comes from Windows, independent of PATH and process
        // environment. Proton's installer stores its launcher at this location.
        let program_files = unsafe {
            let value = SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, None)
                .map_err(|_| AppError::new("PROTON_VPN_PATH", "Could not locate Program Files."))?;
            let path = std::ffi::OsString::from_wide(value.as_wide());
            CoTaskMemFree(Some(value.0.cast()));
            path
        };
        Ok(PathBuf::from(program_files)
            .join("Proton")
            .join("VPN")
            .join("ProtonVPN.Launcher.exe"))
    }

    fn open_read_only(path: &Path) -> std::io::Result<File> {
        // Disallow opening to write/delete until verification and launch finish.
        const FILE_SHARE_READ: u32 = 1;
        OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(path)
    }

    fn trusted_launcher() -> AppResult<Option<(PathBuf, File)>> {
        let path = launcher_path()?;
        let file = match open_read_only(&path) {
            Ok(file) => file,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        if !publisher_is_proton(&path, &file, false) {
            return Err(AppError::new(
                "PROTON_VPN_UNVERIFIED",
                "Windows could not verify the Proton VPN launcher.",
            ));
        }
        Ok(Some((path, file)))
    }

    pub(super) fn installed() -> AppResult<bool> {
        Ok(trusted_launcher()?.is_some())
    }

    pub(super) fn open() -> AppResult<()> {
        let Some((path, _verified_file)) = trusted_launcher()? else {
            return Err(AppError::new(
                "PROTON_VPN_MISSING",
                "Proton VPN needs to be installed.",
            ));
        };
        let directory = path.parent().ok_or_else(|| {
            AppError::new("PROTON_VPN_PATH", "Invalid Proton VPN installation path.")
        })?;
        // Ask the desktop shell to launch Proton so it stays independent
        // of the Windows job that owns HayDev's Tor and search processes.
        unsafe { run_from_desktop(&path, directory) }.map_err(|_| {
            AppError::new(
                "PROTON_VPN_OPEN_FAILED",
                "Windows could not open Proton VPN.",
            )
        })
    }

    unsafe fn run_from_desktop(path: &Path, directory: &Path) -> windows::core::Result<()> {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = (|| {
            let windows: IShellWindows =
                CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER)?;
            let empty = VARIANT::default();
            let mut hwnd = 0;
            let desktop = windows.FindWindowSW(
                &VARIANT::from(CSIDL_DESKTOP as i32),
                &empty,
                SWC_DESKTOP,
                &mut hwnd,
                SWFO_NEEDDISPATCH,
            )?;
            let browser: IShellBrowser = desktop
                .cast::<IServiceProvider>()?
                .QueryService(&SID_STopLevelBrowser)?;
            let view: IShellFolderViewDual = browser
                .QueryActiveShellView()?
                .GetItemObject(SVGIO_BACKGROUND)?;
            let shell = view.Application()?.cast::<IShellDispatch2>()?;
            shell.ShellExecute(
                &BSTR::from_wide(&path.as_os_str().encode_wide().collect::<Vec<_>>()),
                &empty,
                &VARIANT::from(BSTR::from_wide(
                    &directory.as_os_str().encode_wide().collect::<Vec<_>>(),
                )),
                &VARIANT::from(BSTR::from("open")),
                &VARIANT::from(1),
            )
        })();
        CoUninitialize();
        result
    }

    fn download_setup(path: &Path) -> AppResult<()> {
        let agent = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(Duration::from_secs(180))
            .build();
        let error = || {
            AppError::new(
                "PROTON_VPN_DOWNLOAD_FAILED",
                "Could not download Proton VPN from the official release.",
            )
        };
        let response = agent.get(DOWNLOAD_URL).call().map_err(|_| error())?;
        let response = if response.status() == 302 {
            let url = response.header("Location").ok_or_else(error)?;
            let target = url::Url::parse(url).map_err(|_| error())?;
            if target.scheme() != "https"
                || target.host_str() != Some("release-assets.githubusercontent.com")
                || !target.username().is_empty()
                || target.password().is_some()
                || target.port().is_some()
            {
                return Err(error());
            }
            agent.get(url).call().map_err(|_| error())?
        } else {
            response
        };
        if response.status() != 200 {
            return Err(error());
        }
        let mut out = OpenOptions::new().write(true).create_new(true).open(path)?;
        let mut body = response.into_reader().take(DOWNLOAD_BYTES + 1);
        if std::io::copy(&mut body, &mut out).map_err(|_| error())? != DOWNLOAD_BYTES {
            return Err(error());
        }
        Ok(())
    }

    fn verified_setup(path: &Path) -> AppResult<File> {
        let mut file = open_read_only(path)?;
        let invalid = || {
            AppError::new(
                "PROTON_VPN_UNVERIFIED",
                "Windows could not verify the downloaded Proton VPN installer.",
            )
        };
        if file.metadata()?.len() != DOWNLOAD_BYTES {
            return Err(invalid());
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        file.rewind()?;
        if format!("{:x}", hash.finalize()) != DOWNLOAD_SHA256
            || !publisher_is_proton(path, &file, true)
        {
            return Err(invalid());
        }
        Ok(file)
    }

    struct SetupMutex(HANDLE);
    impl Drop for SetupMutex {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseMutex(self.0);
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub(super) fn install() -> AppResult<()> {
        if installed()? {
            return Ok(());
        }
        let lock =
            unsafe { CreateMutexW(None, false, w!("Local\\HayDevBrowser-ProtonVPN-Install")) }
                .map_err(|_| {
                    AppError::new(
                        "PROTON_VPN_SETUP_FAILED",
                        "Could not start Proton VPN setup.",
                    )
                })?;
        let acquired = unsafe { WaitForSingleObject(lock, 0) };
        if acquired != WAIT_OBJECT_0 && acquired != WAIT_ABANDONED {
            unsafe {
                let _ = CloseHandle(lock);
            }
            return Err(AppError::new(
                "PROTON_VPN_BUSY",
                "Proton VPN setup is already running.",
            ));
        }
        let _lock = SetupMutex(lock);
        if installed()? {
            return Ok(());
        }
        let temp = tempfile::Builder::new()
            .prefix("haydev-proton-vpn-")
            .tempdir()?;
        let setup = temp.path().join("ProtonVPN_v5.1.9_x64.exe");
        download_setup(&setup)?;
        let _verified_file = verified_setup(&setup)?;

        let file = wide(&setup);
        let directory = wide(temp.path());
        let mut exec = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpVerb: w!("runas"),
            lpFile: PCWSTR(file.as_ptr()),
            // Silent mode also omits the offers for other Proton apps. The
            // Windows elevation dialog is still shown when admin rights are needed.
            lpParameters: w!("/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /RESTARTEXITCODE=3010"),
            lpDirectory: PCWSTR(directory.as_ptr()),
            nShow: 1,
            ..Default::default()
        };
        let launched = unsafe {
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = ShellExecuteExW(&mut exec);
            if initialized {
                CoUninitialize();
            }
            result
        };
        launched.map_err(|err| {
            if err.code() == ERROR_CANCELLED.to_hresult() {
                AppError::new(
                    "PROTON_VPN_CANCELLED",
                    "Windows cancelled Proton VPN setup.",
                )
            } else {
                AppError::new(
                    "PROTON_VPN_SETUP_FAILED",
                    "Windows could not start Proton VPN setup.",
                )
            }
        })?;
        let mut code = 1;
        let completed = !exec.hProcess.is_invalid()
            && unsafe {
                let waited = WaitForSingleObject(exec.hProcess, INFINITE);
                let status = GetExitCodeProcess(exec.hProcess, &mut code);
                let _ = CloseHandle(exec.hProcess);
                waited == WAIT_OBJECT_0 && status.is_ok()
            };
        if completed && code == 3010 {
            return Err(AppError::new(
                "PROTON_VPN_RESTART_REQUIRED",
                "Restart Windows to finish Proton VPN setup.",
            ));
        }
        if !completed || code != 0 || !installed()? {
            return Err(AppError::new(
                "PROTON_VPN_SETUP_FAILED",
                "The Proton VPN installation could not be verified.",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        #[ignore = "downloads the official installer without running it"]
        fn downloads_and_verifies_pinned_proton_installer() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("ProtonVPN_v5.1.9_x64.exe");
            download_setup(&path).unwrap();
            assert!(verified_setup(&path).is_ok());
            {
                use std::io::Write;
                let mut file = OpenOptions::new().write(true).open(&path).unwrap();
                file.write_all(b"BAD").unwrap();
            }
            assert!(verified_setup(&path).is_err());
        }
    }
}

#[cfg(not(windows))]
mod windows_client {
    use super::*;

    pub(super) fn installed() -> AppResult<bool> {
        Ok(false)
    }

    pub(super) fn open() -> AppResult<()> {
        Err(AppError::new(
            "PROTON_VPN_UNSUPPORTED",
            "Proton VPN setup requires Windows.",
        ))
    }

    pub(super) fn install() -> AppResult<()> {
        open()
    }
}

#[tauri::command]
pub async fn proton_vpn_installed() -> AppResult<bool> {
    tauri::async_runtime::spawn_blocking(windows_client::installed).await?
}

#[tauri::command]
pub async fn proton_vpn_open() -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(windows_client::open).await?
}

#[tauri::command]
pub async fn proton_vpn_install() -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(windows_client::install).await?
}

// Called by NSIS before any browser profile or runtime is initialized.
pub fn setup_command(arg: Option<&str>) -> Option<i32> {
    match arg {
        Some("--proton-vpn-installed") => Some(if windows_client::installed().unwrap_or(false) {
            0
        } else {
            1
        }),
        Some("--install-proton-vpn") => Some(match windows_client::install() {
            Ok(()) => 0,
            Err(err) if err.code == "PROTON_VPN_CANCELLED" => 2,
            Err(err) if err.code == "PROTON_VPN_RESTART_REQUIRED" => 3,
            Err(err) => {
                eprintln!("{}", err.code);
                1
            }
        }),
        _ => None,
    }
}
