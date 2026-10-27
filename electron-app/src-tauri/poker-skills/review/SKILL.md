---
name: poker-review
description: Review session decisions and create evidence-backed candidate lessons without confusing outcomes with strategy validation.
---

Use poker_memory to inspect states, decision attempts and results. Deduplicate by handId and decision point. Describe only observable behaviour; do not infer hidden cards or permanent player traits from a few actions.

For each lesson, identify a state/decision/result event and exact applicability conditions (cash/MTT, stacks, position, assumptions). Save using poker_learn. Candidate lessons remain hypotheses; the agent cannot mark them validated.

Validate strategy changes offline against a chosen solver and held-out hands before promotion. Use independent opponent policies and adequate sample sizes. Report expected value, uncertainty, invalid-action rate, missed turns and observation errors separately from bankroll movement.

Knowledge retrieval and memory are not model-weight training. Do not rewrite skills or select new strategies merely because a hand won.
