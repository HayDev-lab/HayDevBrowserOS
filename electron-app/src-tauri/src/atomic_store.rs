//! Locked read/modify/replace transactions. Never unlink the destination.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use crate::error::{AppError, AppResult};

pub struct Transaction { path: PathBuf, _lock: File }
fn io_error(_: std::io::Error) -> AppError {
    AppError::new("STORE_IO_ERROR", "Store IO failed; existing data was preserved")
}
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut p = path.as_os_str().to_os_string(); p.push(suffix); PathBuf::from(p)
}
pub fn transaction(path: &Path) -> AppResult<Transaction> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(io_error)?; }
    let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true)
        .open(sibling(path, ".lock")).map_err(io_error)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline =>
                std::thread::sleep(std::time::Duration::from_millis(5)),
            Err(_) => return Err(AppError::new("STORE_BUSY", "Another store transaction is active")),
        }
    }
    Ok(Transaction { path: path.to_owned(), _lock: lock })
}
fn read(path: &Path) -> AppResult<Option<Vec<u8>>> {
    match File::open(path) {
        Ok(file) => {
            if file.metadata().map_err(io_error)?.len() > 32 * 1024 * 1024 {
                return Err(AppError::new("STORE_TOO_LARGE", "Store exceeds size limit; original preserved"));
            }
            let mut bytes = Vec::new(); file.take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(io_error)?;
            Ok(Some(bytes))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_error(e)),
    }
}
fn replace(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = sibling(path, &format!(".{}.pending", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(io_error)?;
        f.write_all(bytes).map_err(io_error)?; f.sync_all().map_err(io_error)?; drop(f);
        // Windows std::fs::rename uses MoveFileExW(REPLACE_EXISTING).
        fs::rename(&tmp, path).map_err(io_error)?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() { File::open(parent).and_then(|f| f.sync_all()).map_err(io_error)?; }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&tmp); }
    result
}
impl Transaction {
    pub fn read_json<T: serde::de::DeserializeOwned>(&self) -> AppResult<Option<T>> {
        let bytes = match read(&self.path)? {
            Some(b) => b,
            None => match read(&sibling(&self.path, ".bak"))? {
                Some(b) => {
                    let value = serde_json::from_slice::<T>(&b).map_err(|_| corrupt())?;
                    replace(&self.path, &b)?; return Ok(Some(value));
                }
                None => return Ok(None),
            },
        };
        serde_json::from_slice(&bytes).map(Some).map_err(|_| corrupt())
    }
    pub fn write_json<T: serde::Serialize>(&self, value: &T) -> AppResult<()> {
        let bytes = serde_json::to_vec(value)?;
        if let Some(previous) = read(&self.path)? {
            serde_json::from_slice::<serde_json::Value>(&previous).map_err(|_| corrupt())?;
            replace(&sibling(&self.path, ".bak"), &previous)?;
        }
        replace(&self.path, &bytes)
    }
}
pub fn corrupt() -> AppError {
    AppError::new("STORE_CORRUPT", "Store is damaged or unsupported; original and backup preserved")
}
#[cfg(test)]
mod tests {
    use super::*;
    fn path() -> PathBuf { std::env::temp_dir().join(format!("haydev-atomic-{}", uuid::Uuid::new_v4())).join("store.json") }
    #[test]
    fn replacement_backup_and_interrupted_write() {
        let p = path();
        { let t = transaction(&p).unwrap(); t.write_json(&vec![1]).unwrap(); t.write_json(&vec![2]).unwrap(); }
        fs::write(sibling(&p, ".abandoned.pending"), b"truncated").unwrap();
        assert_eq!(transaction(&p).unwrap().read_json::<Vec<u8>>().unwrap(), Some(vec![2]));
        assert_eq!(read(&sibling(&p, ".bak")).unwrap().unwrap(), b"[1]");
        fs::remove_file(&p).unwrap();
        assert_eq!(transaction(&p).unwrap().read_json::<Vec<u8>>().unwrap(), Some(vec![1]));
    }
    #[test]
    fn corrupt_original_is_never_overwritten() {
        let p = path(); let t = transaction(&p).unwrap(); fs::write(&p, b"broken").unwrap();
        assert_eq!(t.read_json::<Vec<u8>>().unwrap_err().code, "STORE_CORRUPT");
        assert!(t.write_json(&vec![1]).is_err()); assert_eq!(fs::read(&p).unwrap(), b"broken");
    }
    #[test]
    fn concurrent_transactions_do_not_lose_updates() {
        let p = path(); let threads: Vec<_> = (0..12).map(|i| {
            let p = p.clone(); std::thread::spawn(move || {
                let t = transaction(&p).unwrap(); let mut v = t.read_json::<Vec<u8>>().unwrap().unwrap_or_default();
                v.push(i); t.write_json(&v).unwrap();
            })
        }).collect();
        for t in threads { t.join().unwrap(); }
        assert_eq!(transaction(&p).unwrap().read_json::<Vec<u8>>().unwrap().unwrap().len(), 12);
    }
}
