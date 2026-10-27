---
name: poker-cash
description: Analyse visible no-limit Hold'em cash hands using poker tools, explicit ranges and stated assumptions.
---

1. Observe; establish hand ID, player count, position, effective stacks, blinds, rake and action history. Record unknowns rather than filling them in.
2. Record hero cards and board only when readable. Separate opponent ranges (hypotheses) from shown cards (observations).
3. Obtain showdown equity with poker_equity against stated ranges. Use poker_pot_odds for the immediate price; explain missing fold equity, realization, future bets and rake assumptions.
4. Label preflop charts by stack depth, table size, position and rake. Never apply a chart outside its conditions.
5. State a short heuristic recommendation with uncertainty. Do not claim solver precision: this release has no GTO solver.
6. In Auto mode, use only a fresh recorded frame. Set a bet amount separately, re-observe its visible value, then act once and re-observe for acceptance. Stop if acceptance is ambiguous.
7. Store decisions and evidence. Review decision quality independently from a won/lost pot.
