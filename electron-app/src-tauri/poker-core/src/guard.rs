//! Fail closed when a model's interpretation omits necessary betting data.
//! This validates consistency, not the accuracy of image recognition.
use crate::{math::card, Result};
use serde_json::Value;

fn number(state: &Value, key: &str) -> Result<f64> {
    state[key]
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .ok_or_else(|| format!("INVALID_OR_UNKNOWN_{key}"))
}
pub fn validate_state(state: &Value, action: &str, amount: Option<f64>) -> Result<()> {
    if state["isHeroTurn"] != true || number(state, "confidence")? < 0.98 {
        return Err("UNCERTAIN_OR_NOT_HERO_TURN".into());
    }
    if state["handId"].as_str().is_none_or(str::is_empty) {
        return Err("HAND_ID_REQUIRED".into());
    }
    let hero = state["hero"].as_array().ok_or("HERO_CARDS_UNKNOWN")?;
    let board = state["board"].as_array().ok_or("BOARD_UNKNOWN")?;
    if hero.len() != 2 || ![0, 3, 4, 5].contains(&board.len()) {
        return Err("INVALID_VISIBLE_CARDS".into());
    }
    let mut known = Vec::new();
    for s in hero.iter().chain(board) {
        let c = card(s.as_str().ok_or("INVALID_CARD")?)?;
        if known.contains(&c) {
            return Err("DUPLICATE_CARD".into());
        }
        known.push(c);
    }
    let _pot = number(state, "pot")?;
    let call = number(state, "call")?;
    let stack = number(state, "heroStack")?;
    if stack == 0.0 {
        return Err("NO_CHIPS_TO_ACT".into());
    }
    if let Some(amount) = amount {
        let min = number(state, "minRaiseTo")?;
        let max = number(state, "maxRaiseTo")?;
        if !amount.is_finite() || min > max || amount < min || amount > max {
            return Err("AMOUNT_OUT_OF_RANGE".into());
        }
        return Ok(());
    }
    if !["fold", "check", "call", "bet", "raise", "all-in"].contains(&action)
        || !state["legalActions"]
            .as_array()
            .is_some_and(|a| a.iter().any(|a| a.as_str() == Some(action)))
    {
        return Err("ACTION_NOT_LEGAL".into());
    }
    if action == "check" && call != 0.0 {
        return Err("CANNOT_CHECK_FACING_BET".into());
    }
    if action == "call" && (call == 0.0 || call > stack) {
        return Err("INVALID_CALL_PRICE".into());
    }
    if ["bet", "raise"].contains(&action) {
        let amount = number(state, "displayedBetTo")?;
        let min = number(state, "minRaiseTo")?;
        let max = number(state, "maxRaiseTo")?;
        if min > max || amount < min || amount > max {
            return Err("DISPLAYED_BET_OUT_OF_RANGE".into());
        }
    }
    Ok(())
}
pub fn validate_frame(
    mode: &str,
    id: &str,
    requested: &str,
    age_ms: u128,
    hash: &str,
    current_hash: &str,
) -> Result<()> {
    if mode != "auto" {
        return Err("LIVE_HUMAN_READ_ONLY".into());
    }
    if id != requested || age_ms > 12_000 {
        return Err("STALE_FRAME".into());
    }
    if hash.is_empty() || hash != current_hash {
        return Err("FRAME_CHANGED".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn state() -> Value {
        json!({"handId":"h1","isHeroTurn":true,"confidence":1.0,"hero":["As","Ks"],"board":["Js","Ts","2d"],"pot":150,"call":50,"heroStack":500,"legalActions":["fold","call","raise"],"minRaiseTo":100,"maxRaiseTo":500,"displayedBetTo":150})
    }
    #[test]
    fn action_consistency_and_uncertainty() {
        assert!(validate_state(&state(), "call", None).is_ok());
        assert!(validate_state(&state(), "raise", None).is_ok());
        assert!(validate_state(&state(), "check", None).is_err());
        assert!(validate_state(&state(), "", Some(999.0)).is_err());
        let mut s = state();
        s["hero"] = json!(["As", "As"]);
        assert!(validate_state(&s, "call", None).is_err());
        s = state();
        s["confidence"] = json!(0.9);
        assert!(validate_state(&s, "call", None).is_err());
        s = state();
        s["isHeroTurn"] = json!(false);
        assert!(validate_state(&s, "call", None).is_err());
        s = state();
        s.as_object_mut().unwrap().remove("displayedBetTo");
        assert!(validate_state(&s, "raise", None).is_err());
    }
    #[test]
    fn read_only_expired_changed_or_wrong_frame_cannot_act() {
        assert!(validate_frame("auto", "id", "id", 100, "abc", "abc").is_ok());
        assert!(validate_frame("human", "id", "id", 100, "abc", "abc").is_err());
        assert!(validate_frame("auto", "id", "id", 12001, "abc", "abc").is_err());
        assert!(validate_frame("auto", "id", "other", 100, "abc", "abc").is_err());
        assert!(validate_frame("auto", "id", "id", 100, "abc", "def").is_err());
    }
}
