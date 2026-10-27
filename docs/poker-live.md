# Poker live sessions — implementation status

This change adds a native poker session mode to the existing Tauri agent. It is a foundation for testing, not a demonstrated strong poker player. No real-money table was used during verification. The subsequent Gemini Live work was tested with a real Google connection and an isolated local fixture page.

## Available

- **Poker tab in the agent panel:** choose a browser tab, cash/MTT and Live Human/Auto; start/stop, ask questions, import references and inspect session memory.
- **Live Human:** the backend exposes observation and analysis tools only. Auto action tools are absent from its declarations and rejected by the dispatcher even if requested manually.
- **Auto:** a separate tool surface for setting an amount and clicking a unique visible DOM element. Each attempt consumes a frame token, requires a recorded consistent hand state, hero's turn and high interpretation confidence. A fresh screenshot must exactly match the previous frame; changes or ambiguity require a new observation. Dispatch is recorded separately from acceptance and must be checked by observing again.
- **Vision:** actual ephemeral JPEG image parts reach the model. Tab, capture time and original/displayed dimensions accompany each frame. Only the newest live viewport image remains in context; user reference attachments remain available. Frame bytes are not written to disk, SQLite or the action log. The normal agent's screenshot tool receives this fix too.
- **Long sessions:** up to six hours or 10,000 model rounds, with existing cancellation/run ownership; history compacts at complete tool boundaries. Plain conversational answers do not end a poker session. `finish` does.
- **SQLite:** `<app-data>/poker/poker.sqlite3`, WAL, foreign keys, sessions, interpreted states, decisions, results, questions, advice, candidate lessons, source documents and FTS5. A session is bound to one tab, mode and format. Nothing automatically resumes play on startup.
- **Tools:** observe, record state, showdown equity, pot odds, ICM, session recall, candidate learning, knowledge search/read, skill catalog/read, speak/reply, wait, finish; Auto additionally sets bet amount and acts.
- **Original bundled workflows:** cash, MTT and review. Imported Book-to-Skill folders are inert Markdown references with source paths and content hashes; their scripts never run. Chapters can be retrieved progressively.
- **Voice UI:** optional Web Speech recognition and browser speech synthesis. Final recognised questions are sent to the session; the exact spoken command “stop”, “стоп” or “կանգ” requests takeover. Text remains available when WebView2 does not provide speech recognition. The regular provider path uses Web Speech. The new Gemini Live path streams PCM audio and native viewport frames through a direct WebSocket; see [Gemini Live setup](poker-gemini-live.md).

## Calculations and boundaries

The independent `src-tauri/poker-core` crate implements best-five-of-seven Hold'em ranking, Monte Carlo showdown equity against explicitly supplied equally weighted exact-combo ranges, immediate pot odds and exact static ICM for up to nine positive stacks. It rejects duplicate cards and impossible blocked ranges. Multiway range draws use whole-joint rejection to avoid sequential conditional sampling bias; equity reports sample count and sampling error.

Equity is not an optimal policy. The calculator does not solve future betting, fold equity, side-pot allocation, unequal eligibility, rake schedules, tournament bounties or large-field ICM. Empty opponent ranges mean uniformly random hands, not a learned opponent model. Static ICM requires all relevant players, not just the current table of a larger event.

Auto state checking validates internal consistency, not image-recognition accuracy. Exact screenshot matching will reject moving timers/animations as changed frames. Generic DOM targets do not support every canvas/iframe poker client. A platform adapter and Windows runtime testing are needed before relying on table parsing or action acknowledgement. The implementation contains no anti-bot evasion or mouse-humanisation layer.

## Knowledge and learning

“Import book / knowledge” accepts Markdown, text, PDF and DOCX through a native picker. The existing bounded document parser reports partial PDFs and OCR requirements. “Import Book-to-Skill” accepts a folder containing `SKILL.md` and up to 200 Markdown files, depth three, total 5 MB; symlinks and executable files are ignored. Individual text imports are capped at 2 MB. Search returns source-bearing excerpts; chapter reads are paginated.

The external converter is [book-to-skill](https://github.com/virgiliojr94/book-to-skill). This release imports its output; it does **not** run its extraction/generation pipeline. Three official publisher samples were subsequently extracted with book-to-skill (50 PDF pages in total) and converted into short source-bearing reference folders. Full editions of the five titles remain unavailable. The private reference pack is delivered separately; books and full extracted texts are not committed to this repository. Verify card glyphs, diagrams, ranges and applicability conditions in any imported conversion.

Memory accumulation is automatic for recorded states and decisions. `poker_learn` requires an existing same-session state/decision/result event and always stores a **candidate**. A bounded pool of candidates is recalled across sessions of the same format, retaining source session/event IDs. It cannot modify model weights, promote lessons to verified strategy or rewrite the bundled workflows. A benchmarked solver, held-out hands and an offline evaluation/promotion process are still needed for strategic learning. There is no opponent-statistics engine or downloaded hand-history dataset in this change.

## Provider setup

The session uses the browser's existing configured provider and model. Choose a model that accepts image parts and tools; a poker session fails honestly if the provider rejects images instead of pretending to see the screen. Existing Gemini configuration is supported through the existing compatible endpoint. The separate Gemini Live mode now provisions single-use ephemeral tickets in Rust, streams microphone PCM and viewport JPEGs, plays model PCM audio, handles tools and session resumption, and revokes native authority on Stop or disconnection. A connection probe on the user’s Windows PC passed token issuance, setup, a tool exchange, audio output and transcription with gemini-3.8-live. WebView2 microphone/speaker behavior and real-table accuracy still need runtime validation. No GPT Realtime transport is included.

SQLite is local; no Supabase infrastructure or embedding index is created. FTS5 is the initial retrieval layer.

## Verification

Run from `electron-app`:

```sh
npm run typecheck
npm run lint
npm test
npm run build:internal-pages
npm run build:vite
cargo test --manifest-path src-tauri/poker-core/Cargo.toml
```

On a Windows build host, also run `cargo check --locked --manifest-path src-tauri/Cargo.toml`. This change was cross-checked for the Windows GNU target. Build resource directories must be prepared according to the existing application build process.

Before integration with any external table, verify on a local test table: Human cannot act, Auto acts once only, edited/expired frames block action, Stop revokes delayed work, ambiguous acceptance never retries, a tab switch does not change the bound target, and restart preserves memory without resuming play. Then measure observation accuracy, missed turns, latency, invalid actions and strategy EV separately. The native Windows Gemini Live probe passed real fixture capture, complete tool setup, two native tool calls, audio/transcription, Human action rejection, durable memory and Stop revocation. Physical audio devices, real table parsing and playing strength remain unverified.

`CHROMIUM_PATH=/path/to/chrome node scripts/verify-poker-ui.mjs` checks the React panel in Chromium with a mocked native boundary. It passed profile/tab binding, active tab lock, text questions, advice events, skill import and Stop checks. It does not exercise a model, WebView2, real speech or an external table.
