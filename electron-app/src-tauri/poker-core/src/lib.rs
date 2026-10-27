//! Independent, testable poker arithmetic and durable session/knowledge storage.
//! Equity is showdown simulation, NOT a GTO solver or an action recommendation.
pub mod guard;
pub mod credentials;
pub mod math;
pub mod store;
pub use store::Store;
pub type Result<T> = std::result::Result<T, String>;
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
