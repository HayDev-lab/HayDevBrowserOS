use crate::Result;
use serde::Deserialize;
use serde_json::{json, Value};

pub(crate) fn card(s: &str) -> Result<u8> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return Err("CARD_FORMAT: use As, Td, 2c".into());
    }
    let rank = b"23456789TJQKA"
        .iter()
        .position(|r| *r == b[0].to_ascii_uppercase());
    let suit = b"cdhs".iter().position(|r| *r == b[1].to_ascii_lowercase());
    match (rank, suit) {
        (Some(r), Some(s)) => Ok((r * 4 + s) as u8),
        _ => Err("CARD_FORMAT".into()),
    }
}

fn encode(cat: u32, ranks: &[u8]) -> u32 {
    (0..5).fold(cat, |v, i| {
        v * 15 + ranks.get(i).copied().unwrap_or(0) as u32
    })
}
fn five(cards: &[u8; 5]) -> u32 {
    let mut counts = [0u8; 15];
    for c in cards {
        counts[(c / 4 + 2) as usize] += 1;
    }
    let flush = cards.iter().all(|c| c % 4 == cards[0] % 4);
    let mut unique: Vec<u8> = (2..=14).filter(|r| counts[*r as usize] > 0).collect();
    unique.sort_unstable_by(|a, b| b.cmp(a));
    let straight = if unique.len() == 5 && unique[0] - unique[4] == 4 {
        unique[0]
    } else if unique == [14, 5, 4, 3, 2] {
        5
    } else {
        0
    };
    let mut groups: Vec<(u8, u8)> = (2..=14)
        .filter(|r| counts[*r as usize] > 0)
        .map(|r| (counts[r as usize], r))
        .collect();
    groups.sort_unstable_by(|a, b| b.cmp(a));
    if flush && straight > 0 {
        return encode(8, &[straight]);
    }
    if groups[0].0 == 4 {
        return encode(7, &[groups[0].1, groups[1].1]);
    }
    if groups[0].0 == 3 && groups[1].0 == 2 {
        return encode(6, &[groups[0].1, groups[1].1]);
    }
    if flush {
        return encode(5, &unique);
    }
    if straight > 0 {
        return encode(4, &[straight]);
    }
    let ranks: Vec<u8> = groups.iter().map(|g| g.1).collect();
    if groups[0].0 == 3 {
        return encode(3, &ranks);
    }
    if groups[0].0 == 2 && groups[1].0 == 2 {
        return encode(2, &ranks);
    }
    if groups[0].0 == 2 {
        return encode(1, &ranks);
    }
    encode(0, &unique)
}
fn seven(c: &[u8]) -> u32 {
    let mut best = 0;
    for a in 0..3 {
        for b in a + 1..4 {
            for d in b + 1..5 {
                for e in d + 1..6 {
                    for f in e + 1..7 {
                        best = best.max(five(&[c[a], c[b], c[d], c[e], c[f]]));
                    }
                }
            }
        }
    }
    best
}
// OS randomness, rejection sampling (no modulo bias). No timing/humanisation.
fn index(n: usize) -> Result<usize> {
    let limit = u32::MAX - u32::MAX % n as u32;
    loop {
        let mut bytes = [0; 4];
        getrandom::getrandom(&mut bytes).map_err(|_| "RNG_UNAVAILABLE")?;
        let x = u32::from_le_bytes(bytes);
        if x < limit {
            return Ok(x as usize % n);
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquityRequest {
    pub hero: Vec<String>,
    pub board: Vec<String>,
    /// One list of equally weighted exact combos per opponent. Empty list = uniform random.
    pub ranges: Vec<Vec<[String; 2]>>,
    pub samples: Option<usize>,
}
pub fn equity(req: EquityRequest, check: impl Fn() -> Result<()>) -> Result<Value> {
    if req.hero.len() != 2
        || ![0, 3, 4, 5].contains(&req.board.len())
        || !(1..=8).contains(&req.ranges.len())
    {
        return Err("INVALID_EQUITY_INPUT".into());
    }
    let known: Vec<u8> = req
        .hero
        .iter()
        .chain(req.board.iter())
        .map(|s| card(s))
        .collect::<Result<_>>()?;
    let mut unique = known.clone();
    unique.sort();
    unique.dedup();
    if unique.len() != known.len() {
        return Err("DUPLICATE_CARDS".into());
    }
    let mut ranges = Vec::new();
    for range in req.ranges {
        if range.len() > 1326 {
            return Err("RANGE_TOO_LARGE".into());
        }
        let mut parsed = Vec::new();
        for combo in &range {
            let a = card(&combo[0])?;
            let b = card(&combo[1])?;
            if a == b {
                return Err("DUPLICATE_RANGE_CARD".into());
            }
            if !known.contains(&a) && !known.contains(&b) {
                parsed.push([a.min(b), a.max(b)]);
            }
        }
        parsed.sort();
        parsed.dedup();
        if !range.is_empty() && parsed.is_empty() {
            return Err("EMPTY_RANGE_AFTER_BLOCKERS".into());
        }
        ranges.push(parsed);
    }
    let n = req.samples.unwrap_or(2000).clamp(100, 10000);
    let mut sum = 0.0;
    let mut sum2 = 0.0;
    let mut accepted = 0;
    let mut attempts = 0;
    while accepted < n {
        if attempts % 32 == 0 {
            check()?;
        }
        attempts += 1;
        if attempts > n * 100 {
            return Err("INCOMPATIBLE_OR_SPARSE_RANGES".into());
        }
        let mut used = known.clone();
        let mut opponents = Vec::new();
        let mut conflict = false;
        // Independently sample ranges, reject the entire joint draw on collisions.
        // Conditional sequential resampling would bias multiway range probabilities.
        for range in &ranges {
            let pair = if range.is_empty() {
                let a = index(52)? as u8;
                let b = index(51)? as u8;
                [a, if b >= a { b + 1 } else { b }]
            } else {
                range[index(range.len())?]
            };
            if used.contains(&pair[0]) || used.contains(&pair[1]) {
                conflict = true;
                break;
            }
            used.extend(pair);
            opponents.push(pair);
        }
        if conflict {
            continue;
        }
        let mut board = known[2..].to_vec();
        while board.len() < 5 {
            let c = index(52)? as u8;
            if !used.contains(&c) {
                used.push(c);
                board.push(c);
            }
        }
        let mut h = board.clone();
        h.extend(&known[..2]);
        let hero = seven(&h);
        let mut tied = 1;
        let mut lost = false;
        for p in opponents {
            let mut c = board.clone();
            c.extend(p);
            let score = seven(&c);
            if score > hero {
                lost = true;
                break;
            }
            if score == hero {
                tied += 1;
            }
        }
        let share = if lost { 0.0 } else { 1.0 / tied as f64 };
        sum += share;
        sum2 += share * share;
        accepted += 1;
    }
    let mean = sum / n as f64;
    let se = ((sum2 / n as f64 - mean * mean).max(0.0) / n as f64).sqrt();
    Ok(
        json!({"equity":mean,"samples":n,"standardError":se,"method":"monte-carlo-showdown-v1","assumption":"Equally weighted supplied combos; empty ranges are uniform random. No fold equity, future betting, rake or ICM. Not a strategy solver."}),
    )
}
pub fn pot_odds(pot_before_call: f64, call: f64, rake: f64) -> Result<Value> {
    if ![pot_before_call, call, rake]
        .iter()
        .all(|n| n.is_finite() && *n >= 0.0)
        || rake >= pot_before_call + call
    {
        return Err("INVALID_POT_ODDS".into());
    }
    Ok(
        json!({"breakEvenEquity":call/(pot_before_call+call-rake),"assumption":"pot includes opponent bet; call is additional chips; no future bets or tournament utility"}),
    )
}
pub fn icm(stacks: &[f64], payouts: &[f64]) -> Result<Vec<f64>> {
    if stacks.is_empty()
        || stacks.len() > 9
        || payouts.len() > stacks.len()
        || !stacks.iter().all(|s| s.is_finite() && *s > 0.0)
        || !payouts.iter().all(|p| p.is_finite() && *p >= 0.0)
        || payouts.windows(2).any(|p| p[0] < p[1])
    {
        return Err("INVALID_ICM_INPUT: 1..9 positive stacks; descending payouts".into());
    }
    fn walk(stacks: &[f64], payouts: &[f64], mask: u16, depth: usize, prob: f64, out: &mut [f64]) {
        if depth >= payouts.len() {
            return;
        }
        let total: f64 = stacks
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) == 0)
            .map(|(_, s)| s)
            .sum();
        for (i, s) in stacks.iter().enumerate() {
            if mask & (1 << i) == 0 {
                let p = prob * s / total;
                out[i] += p * payouts[depth];
                walk(stacks, payouts, mask | (1 << i), depth + 1, p, out);
            }
        }
    }
    let mut out = vec![0.0; stacks.len()];
    walk(stacks, payouts, 0, 0, 1.0, &mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn score(s: &str) -> u32 {
        seven(
            &s.split_whitespace()
                .map(|c| card(c).unwrap())
                .collect::<Vec<_>>(),
        )
    }
    #[test]
    fn ranks_wheel_kickers_and_best_five() {
        assert!(score("As 2s 3s 4s 5s Kd Qd") > score("Ah Ac Ad As Kh Kc 2d"));
        assert!(score("As Kd Qh Jc Ts 2d 3c") > score("As 2d 3h 4c 5s Kd Qc"));
        assert!(score("As Ac Ad Ks Kc Kd 2s") > score("As Ac Ad Qs Qc Qd 2s"));
        assert!(score("As Ac Ks Qc Js 3d 2c") > score("Ah Ad Kh Qd Ts 9d 2h"));
    }
    #[test]
    fn ties_and_blockers() {
        let request = |hero: Vec<&str>, board: Vec<&str>| EquityRequest {
            hero: hero.iter().map(|s| s.to_string()).collect(),
            board: board.iter().map(|s| s.to_string()).collect(),
            ranges: vec![vec![["2c".into(), "3c".into()]]],
            samples: Some(100),
        };
        let r = equity(
            request(vec!["As", "Ad"], vec!["Ts", "Js", "Qs", "Ks", "9s"]),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(r["equity"], 1.0);
        let r = equity(
            request(vec!["Ah", "Ad"], vec!["Ts", "Js", "Qs", "Ks", "As"]),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(r["equity"], 0.5);
        assert!(equity(request(vec!["As", "As"], vec![]), || Ok(())).is_err());
        assert!(equity(request(vec!["2c", "Ad"], vec![]), || Ok(())).is_err());
        assert!(equity(
            request(vec!["As", "Ad"], vec![]),
            || Err("cancelled".into())
        )
        .is_err());
    }
    #[test]
    fn icm_and_price() {
        assert_eq!(icm(&[100.0, 100.0], &[100.0, 0.0]).unwrap(), [50.0, 50.0]);
        let v = icm(&[10.0, 20.0, 30.0], &[60.0, 30.0, 10.0]).unwrap();
        assert!((v.iter().sum::<f64>() - 100.0).abs() < 1e-8);
        assert!(
            (pot_odds(100.0, 50.0, 0.0).unwrap()["breakEvenEquity"]
                .as_f64()
                .unwrap()
                - 1.0 / 3.0)
                .abs()
                < 1e-8
        );
        assert!(icm(&[0.0, 10.0], &[10.0]).is_err());
    }
}
