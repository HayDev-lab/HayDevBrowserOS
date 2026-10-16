//! A run owns an immutable cancellation token. It can never be reset.
use std::sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}};
use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct RunGuard {
    pub id: u64,
    pub cancelled: Arc<AtomicBool>,
    pub generation: Arc<AtomicU64>,
    pub dispatch: Arc<Mutex<()>>,
    pub deadline: std::time::Instant,
}
impl RunGuard {
    pub fn current(&self) -> bool { self.generation.load(Ordering::SeqCst) == self.id }
    pub fn check(&self) -> AppResult<()> {
        if self.cancelled.load(Ordering::SeqCst) || !self.current() || std::time::Instant::now() >= self.deadline {
            Err(AppError::new("AGENT_CANCELLED", "The run no longer owns this action"))
        } else { Ok(()) }
    }
    pub fn cancel(&self) {
        let _gate = self.dispatch.lock().unwrap_or_else(|p| p.into_inner());
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn effect<T>(&self, f: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
        let _gate = self.dispatch.lock().unwrap_or_else(|p| p.into_inner());
        self.check()?; f()
    }
    /// Final status may acknowledge cancellation, but must still belong to
    /// this generation. Keep event emission inside the same dispatch gate.
    pub fn current_effect(&self, f: impl FnOnce()) {
        let _gate = self.dispatch.lock().unwrap_or_else(|p| p.into_inner());
        if self.current() { f(); }
    }
}
thread_local! { static CURRENT: std::cell::RefCell<Option<RunGuard>> = const { std::cell::RefCell::new(None) }; }
pub fn current() -> Option<RunGuard> { CURRENT.with(|v| v.borrow().clone()) }
pub fn check() -> AppResult<()> { current().map_or(Ok(()), |v| v.check()) }
pub fn scoped<T>(guard: RunGuard, f: impl FnOnce() -> T) -> T {
    struct Reset(Option<RunGuard>);
    impl Drop for Reset { fn drop(&mut self) { CURRENT.with(|v| *v.borrow_mut() = self.0.take()); } }
    let _reset = Reset(CURRENT.with(|v| v.replace(Some(guard)))); f()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_worker_cannot_perform_real_effect_after_revoke_or_new_run() {
        let generation = Arc::new(AtomicU64::new(1));
        let guard = RunGuard { id: 1, generation: generation.clone(), cancelled: Arc::new(AtomicBool::new(false)), dispatch: Arc::new(Mutex::new(())), deadline: std::time::Instant::now() + std::time::Duration::from_secs(5) };
        let path = std::env::temp_dir().join(format!("haydev-stale-{}", uuid::Uuid::new_v4()));
        let (tx, rx) = std::sync::mpsc::channel(); let g = guard.clone(); let p = path.clone();
        let worker = std::thread::spawn(move || { rx.recv().unwrap(); g.effect(|| { std::fs::write(p, b"forbidden")?; Ok(()) }) });
        guard.cancel(); generation.store(2, Ordering::SeqCst); tx.send(()).unwrap();
        assert!(worker.join().unwrap().is_err()); assert!(!path.exists());
    }
}
