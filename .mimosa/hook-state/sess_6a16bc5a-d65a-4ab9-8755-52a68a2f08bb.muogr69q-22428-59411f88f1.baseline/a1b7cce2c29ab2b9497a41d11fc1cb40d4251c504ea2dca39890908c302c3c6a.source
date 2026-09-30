//! Control authorization — Rust port of `agent/pure/control-authorization.ts`.
//!
//! Enforces the HUMAN/AGENT boundary:
//!   - HUMAN mode denies browser tools (agent.stop stays allowed);
//!   - AGENT mode allows the V1 tool set;
//!   - TAKE CONTROL → HUMAN + latch (denies everything until acknowledged);
//!   - switching back to AGENT clears the latch (user acknowledgment);
//!   - browser state is NEVER destroyed here — only new agent actions gate.
//!
//! Every mode transition emits `control:mode:update`
//! `{ mode, takeover, reason }` — the exact payload the renderer's
//! agent-store subscribes to.

use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ControlMode {
    Human,
    Agent,
}

impl ControlMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ControlMode::Human => "HUMAN",
            ControlMode::Agent => "AGENT",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ControlState {
    pub mode: ControlMode,
    /// True if TAKE CONTROL happened — denies tool calls until acknowledged.
    pub takeover_latched: bool,
    /// True while an agent run is active.
    pub agent_run_active: bool,
}

impl Default for ControlState {
    fn default() -> Self {
        Self { mode: ControlMode::Human, takeover_latched: false, agent_run_active: false }
    }
}

/// Managed Tauri state handle (Arc so command handlers can clone it into
/// worker threads).
pub type SharedControl = Arc<Mutex<ControlState>>;

impl ControlState {
    /// A new run can start only in AGENT mode with no active run and no latch.
    pub fn can_start_run(&self) -> bool {
        self.mode == ControlMode::Agent && !self.agent_run_active && !self.takeover_latched
    }

    /// Authorization decision for one tool call (parity: authorizeToolCall).
    pub fn authorize_tool_call(&self, tool_stop_only: bool) -> Result<(), &'static str> {
        if self.takeover_latched {
            return Err("takeover_latched");
        }
        if self.mode == ControlMode::Human {
            if tool_stop_only {
                return Ok(());
            }
            return Err("human_mode_denies_browser_tools");
        }
        Ok(())
    }

    pub fn mark_run_started(&mut self) -> bool {
        if !self.can_start_run() {
            return false;
        }
        self.agent_run_active = true;
        true
    }

    pub fn mark_run_ended(&mut self) {
        self.agent_run_active = false;
    }

    /// Switch to AGENT. Refused while a run is active (parity: switchToAgent
    /// returns the unchanged state); pressing AGENT again after a takeover
    /// acknowledges and clears the latch.
    pub fn switch_to_agent(&mut self) -> bool {
        if self.agent_run_active {
            return false;
        }
        self.mode = ControlMode::Agent;
        self.takeover_latched = false;
        true
    }

    /// Plain switch to HUMAN (no takeover latch) — stops any active run.
    pub fn switch_to_human(&mut self) {
        self.mode = ControlMode::Human;
        self.agent_run_active = false;
    }

    /// TAKE CONTROL — unconditional, latches, run considered inactive.
    pub fn take_control(&mut self) {
        self.mode = ControlMode::Human;
        self.takeover_latched = true;
        self.agent_run_active = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_human_and_denies_tools() {
        let mut s = ControlState::default();
        assert_eq!(s.mode, ControlMode::Human);
        assert!(s.authorize_tool_call(false).is_err());
        assert!(s.authorize_tool_call(true).is_ok()); // agent.stop allowed
        assert!(!s.can_start_run());
        assert!(!s.mark_run_started());
    }

    #[test]
    fn agent_mode_allows_and_runs_gate() {
        let mut s = ControlState::default();
        assert!(s.switch_to_agent());
        assert!(s.authorize_tool_call(false).is_ok());
        assert!(s.mark_run_started());
        // Second run refused while active; AGENT switch refused while active.
        assert!(!s.mark_run_started());
        assert!(!s.switch_to_agent());
        s.mark_run_ended();
        assert!(s.switch_to_agent());
    }

    #[test]
    fn take_control_latches_until_acknowledged() {
        let mut s = ControlState::default();
        s.switch_to_agent();
        s.mark_run_started();
        s.take_control();
        assert_eq!(s.mode, ControlMode::Human);
        assert!(s.takeover_latched);
        assert!(s.authorize_tool_call(false).is_err());
        // Even in AGENT the latch denies until a fresh AGENT press clears it.
        s.mode = ControlMode::Agent;
        assert!(s.authorize_tool_call(false).is_err());
        s.switch_to_agent();
        assert!(!s.takeover_latched);
        assert!(s.authorize_tool_call(false).is_ok());
    }

    #[test]
    fn switch_to_human_stops_run_without_latch() {
        let mut s = ControlState::default();
        s.switch_to_agent();
        s.mark_run_started();
        s.switch_to_human();
        assert_eq!(s.mode, ControlMode::Human);
        assert!(!s.agent_run_active);
        assert!(!s.takeover_latched);
    }
}
