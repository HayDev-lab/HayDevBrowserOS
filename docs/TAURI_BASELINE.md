# Tauri Migration Baseline

Frozen **2026-09-29** before any migration edits in this session.
Commands executed on the working tree as-is (which already contains prior
in-flight Tauri scaffolding under `electron-app/src-tauri/` — see audit).

## Electron app (`electron-app`) — the runtime being replaced

| Check | Command | Result |
| --- | --- | --- |
| install | node_modules present (npm + bun locks) | OK (pre-installed) |
| typecheck (node/main) | `node_modules/.bin/tsc --noEmit -p tsconfig.json` | **PASS** |
| typecheck (web) | `node_modules/.bin/tsc --noEmit -p tsconfig.web.json` | **PASS** |
| unit tests | `node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers=2` | **1183 passed / 1 failed / 5 skipped** |
| electron package | (not re-run this session; forge packaging verified in earlier sessions) | PASS (historical) |

### PRE-EXISTING FAILURE (not a migration regression)

- `tests/gemini-thought-signature.test.ts > provider error normalization > APISearchAgent: a provider 400 emits a controlled session error and settles` — **timed out after 20000ms** (actual 30832ms; the suite sets a 20s cap). Identical failure recorded in the previous baseline freeze; it exercises live provider latency and is unrelated to the Tauri migration. Classification: **PRE-EXISTING FAILURE**.

## Rust side (`electron-app/src-tauri`, scaffold state at freeze)

| Check | Command | Result |
| --- | --- | --- |
| compile | `cargo check` | **PASS** (exit 0) |
| lints | `cargo clippy` | **PASS** (exit 0, no warnings) |
| format | `cargo fmt --check` | **1 diff** in `build.rs` (2-space indent) — fixed in Phase 1 rewrite |
| tests | `cargo test` | 0 tests exist (`0 passed; 0 failed`) |

Toolchain: `cargo 1.98.1 (797e8a9bc 2026-08-05)` / `rustc 1.98.1 (48a229cea 2026-09-01)`, tauri crate 2.11.6, tauri-build 2.6.3.

## Working-tree policy

The git working tree contains ~168 modified/untracked paths of prior user and
migration work (darkweb subsystem, MCP, gemini provider, matrix NTP, managed
runtimes, `src-tauri/` scaffold). Per migration contract: **no destructive
reset, no wiping user changes**. All migration edits are additive or surgical.

## Regression labeling rule (applies to every later phase)

- **PRE-EXISTING FAILURE** — reproduced above at freeze, before the edit.
- **MIGRATION REGRESSION** — anything new that fails after a migration edit.
