//! Credential vault (migration Phase H) — Windows DPAPI storage, format
//! compatible with the Electron runtime's `credentials.vault`:
//! `{"version":1,"records":[{id,domain,username,encryptedPassword,createdAt,
//!   updatedAt,metadata?}...]}` where encryptedPassword is
//! base64(safeStorage.encryptString(...)) — on Windows safeStorage IS DPAPI
//! (CryptProtectData), so records written by either runtime decrypt in both.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRecord {
    pub id: String,
    pub domain: String,
    pub username: String,
    /// base64(DPAPI blob). NEVER plaintext.
    pub encrypted_password: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedVault {
    version: u8,
    records: Vec<CredentialRecord>,
}

pub struct Vault {
    path: PathBuf,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Vault {
    pub fn new(app_data: &Path) -> Self {
        Self {
            path: app_data.join("credentials.vault"),
        }
    }

    fn load(tx: &crate::atomic_store::Transaction) -> AppResult<Vec<CredentialRecord>> {
        match tx.read_json::<PersistedVault>()? {
            Some(v) if v.version == 1 => Ok(v.records),
            None => Ok(Vec::new()),
            _ => Err(crate::atomic_store::corrupt()),
        }
    }

    fn persist(tx: &crate::atomic_store::Transaction, records: &[CredentialRecord]) -> AppResult<()> {
        let payload = PersistedVault {
            version: 1,
            records: records.to_vec(),
        };
        tx.write_json(&payload)
    }

    pub fn save(
        &self,
        domain: &str,
        username: &str,
        password: &str,
        id_gen: impl Fn() -> String,
    ) -> AppResult<CredentialRecord> {
        let encrypted = dpapi_encrypt(password)?;
        let tx = crate::atomic_store::transaction(&self.path)?;
        let mut records = Self::load(&tx)?;
        // Upsert by (domain, username) — same semantics as the TS vault.
        let now = now_millis();
        if let Some(existing) = records
            .iter_mut()
            .find(|r| r.domain == domain && r.username == username)
        {
            existing.encrypted_password = encrypted;
            existing.updated_at = now;
            let out = existing.clone();
            Self::persist(&tx, &records)?;
            return Ok(out);
        }
        let record = CredentialRecord {
            id: id_gen(),
            domain: domain.to_string(),
            username: username.to_string(),
            encrypted_password: encrypted,
            created_at: now,
            updated_at: now,
            metadata: None,
        };
        records.push(record.clone());
        Self::persist(&tx, &records)?;
        Ok(record)
    }

    /// Safe metadata list (no encrypted blobs — parity with TS `vault:list`).
    pub fn list(&self) -> AppResult<Vec<CredentialRecord>> {
        let tx = crate::atomic_store::transaction(&self.path)?;
        let mut records = Self::load(&tx)?;
        for r in &mut records {
            r.encrypted_password = String::new();
            // Legacy free-form metadata is untrusted and can contain secrets.
            r.metadata = None;
        }
        Ok(records)
    }

    pub fn has(&self, domain: &str, username: Option<&str>) -> AppResult<bool> {
        let tx = crate::atomic_store::transaction(&self.path)?;
        Ok(Self::load(&tx)?
            .iter()
            .any(|r| r.domain == domain && username.map(|u| r.username == u).unwrap_or(true)))
    }

    pub fn delete(&self, id: &str) -> AppResult<bool> {
        let tx = crate::atomic_store::transaction(&self.path)?;
        let mut records = Self::load(&tx)?;
        let before = records.len();
        records.retain(|r| r.id != id);
        let removed = before != records.len();
        if removed {
            Self::persist(&tx, &records)?;
        }
        Ok(removed)
    }

    /// Decrypt a record's password (vault-internal use only — never sent to
    /// LLM/UI; the TS contract exposes it only to fill-in flows).
    pub fn decrypt_password(&self, id: &str) -> AppResult<String> {
        let tx = crate::atomic_store::transaction(&self.path)?;
        let records = Self::load(&tx)?;
        let record = records
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| AppError::new("VAULT_RECORD_NOT_FOUND", format!("no record {id}")))?;
        dpapi_decrypt(&record.encrypted_password)
    }
}

// ---------------------------------------------------------------------------
// DPAPI (CryptProtectData / CryptUnprotectData) — no external crates.
// ---------------------------------------------------------------------------

/// base64(std) — small local impl to avoid a new dependency.
pub fn b64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

pub fn b64_decode(input: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in input.bytes() {
        if c.is_ascii_whitespace() || c == b'=' {
            continue;
        }
        if let Some(v) = val(c) {
            acc = (acc << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((acc >> bits) as u8);
            }
        }
    }
    out
}

#[cfg(windows)]
mod dpapi {
    use super::*;

    // Crypt32.dll, base "C" ABI — declared inline to avoid the windows crate.
    #[link(name = "Crypt32")]
    extern "system" {
        fn CryptProtectData(
            pdata_in: *const Blob,
            szdatadescr: *const u16,
            puntoptentropy: *const Blob,
            pvreserved: *const core::ffi::c_void,
            ppromptstruct: *const core::ffi::c_void,
            dwflags: u32,
            pdataout: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            pdata_in: *const Blob,
            ppszdatadescr: *mut *mut u16,
            puntoptentropy: *const Blob,
            pvreserved: *const core::ffi::c_void,
            ppromptstruct: *const core::ffi::c_void,
            dwflags: u32,
            pdataout: *mut Blob,
        ) -> i32;
        fn LocalFree(hmem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }

    #[repr(C)]
    struct Blob {
        cb: u32,
        pb: *mut u8,
    }

    fn from_blob(b: &Blob) -> Vec<u8> {
        if b.pb.is_null() || b.cb == 0 {
            return Vec::new();
        }
        unsafe { std::slice::from_raw_parts(b.pb, b.cb as usize).to_vec() }
    }

    pub fn encrypt(plaintext: &str) -> AppResult<String> {
        let plain = plaintext.as_bytes();
        let in_blob = Blob {
            cb: plain.len() as u32,
            pb: plain.as_ptr() as *mut u8,
        };
        let mut out = Blob {
            cb: 0,
            pb: std::ptr::null_mut(),
        };
        // CRYPTPROTECT_UI_FORBIDDEN
        let ok = unsafe {
            CryptProtectData(
                &in_blob,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                &mut out,
            )
        };
        if ok == 0 {
            return Err(AppError::new(
                "DPAPI_ENCRYPT_FAILED",
                "CryptProtectData failed",
            ));
        }
        let bytes = from_blob(&out);
        unsafe { LocalFree(out.pb as *mut _) };
        Ok(b64_encode(&bytes))
    }

    pub fn decrypt(encoded: &str) -> AppResult<String> {
        let bytes = b64_decode(encoded);
        let in_blob = Blob {
            cb: bytes.len() as u32,
            pb: bytes.as_ptr() as *mut u8,
        };
        let mut out = Blob {
            cb: 0,
            pb: std::ptr::null_mut(),
        };
        let mut descr: *mut u16 = std::ptr::null_mut();
        let ok = unsafe {
            CryptUnprotectData(
                &in_blob,
                &mut descr,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                &mut out,
            )
        };
        if ok == 0 {
            return Err(AppError::new(
                "DPAPI_DECRYPT_FAILED",
                "CryptUnprotectData failed (record written by another user/machine?)",
            ));
        }
        if !descr.is_null() {
            unsafe { LocalFree(descr as *mut _) };
        }
        let bytes = from_blob(&out);
        unsafe { LocalFree(out.pb as *mut _) };
        String::from_utf8(bytes).map_err(|e| AppError::new("DPAPI_DECRYPT_FAILED", e.to_string()))
    }
}

#[cfg(not(windows))]
mod dpapi {
    use super::*;
    pub fn encrypt(_plaintext: &str) -> AppResult<String> {
        Err(AppError::new("DPAPI_UNAVAILABLE", "DPAPI is Windows-only"))
    }
    pub fn decrypt(_encoded: &str) -> AppResult<String> {
        Err(AppError::new("DPAPI_UNAVAILABLE", "DPAPI is Windows-only"))
    }
}

pub fn dpapi_encrypt(plaintext: &str) -> AppResult<String> {
    dpapi::encrypt(plaintext)
}

pub fn dpapi_decrypt(encoded: &str) -> AppResult<String> {
    dpapi::decrypt(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_vault() -> (PathBuf, Vault) {
        let dir = std::env::temp_dir().join(format!("hd-vault-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        (dir.clone(), Vault::new(&dir))
    }

    #[test]
    fn base64_roundtrip() {
        let data = b"The quick brown fox \xE2\x82\xAC";
        assert_eq!(b64_decode(&b64_encode(data)), data.to_vec());
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let enc = dpapi_encrypt("p@ss!").unwrap();
        let dec = dpapi_decrypt(&enc).unwrap();
        assert_eq!(dec, "p@ss!");
    }

    #[cfg(windows)]
    #[test]
    fn save_list_has_delete_persistence() {
        let (dir, vault) = tmp_vault();
        let rec = vault
            .save("example.com", "alice", "secret1", || "cred-1".into())
            .unwrap();
        assert_eq!(rec.id, "cred-1");
        assert!(vault.has("example.com", Some("alice")).unwrap());
        // persisted → new instance sees it
        let vault2 = Vault::new(&dir);
        assert!(vault2.has("example.com", None).unwrap());
        let list = vault2.list().unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].encrypted_password.is_empty(), "list hides blobs");
        // upsert by (domain, username)
        vault2
            .save("example.com", "alice", "secret2", || "cred-2".into())
            .unwrap();
        assert_eq!(vault2.list().unwrap().len(), 1);
        assert_eq!(vault2.decrypt_password("cred-1").unwrap(), "secret2");
        assert!(vault2.delete("cred-1").unwrap());
        assert!(!vault2.has("example.com", None).unwrap());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn file_format_matches_electron_shape() {
        let (dir, vault) = tmp_vault();
        vault.save("a.io", "u", "p", || "x".into()).unwrap();
        let raw = std::fs::read_to_string(dir.join("credentials.vault")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["version"], 1);
        assert!(v["records"].is_array());
        assert!(v["records"][0]["encryptedPassword"].is_string());
        assert_eq!(v["records"][0]["domain"], "a.io");
        assert!(v["records"][0]["createdAt"].is_u64());
        std::fs::remove_dir_all(&dir).ok();
    }
}
