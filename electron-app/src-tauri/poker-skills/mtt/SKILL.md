---
name: poker-mtt
description: Analyse tournament no-limit Hold'em, distinguishing chip equity from payout equity and incomplete ICM inputs.
---

Read the cash workflow through poker_skills when needed. Obtain remaining players, paid places, payouts, all relevant stacks, blinds, ante, stage and bounty rules.

Use poker_icm only with the full relevant field and at most nine positive stacks. A table at a larger event is not the full tournament: do not present table-only ICM as tournament payout equity. Zero stacks require elimination/tie payout processing before this tool.

Keep chip EV, modelled payout equity and observed cash outcomes distinct. Static ICM excludes skill differences, future blind pressure, table dynamics and bounty utility. Do not invent risk premiums or solved push/fold ranges.

If inputs or a solver are missing, state the limits and label advice heuristic. Never claim that a conservative action automatically maximises tournament returns.
