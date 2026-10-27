# Gemini Live and strategic architecture

The Gemini Live transport is implemented in this branch. A short direct network probe on KOMPUTER passed ephemeral ticket issuance, WebSocket setup, a function call and response, five audio chunks, output transcription and turn completion with `gemini-3.8-live`. This does not measure playing strength or verify Windows WebView2 audio devices.

## Run and credentials

Use the Tauri runtime, open the Poker panel, select a table and **Live Human**, enable Gemini Live, and start. Microphone sharing is explicit; text works with the microphone disabled. Stop revokes the native generation, closes audio/media and the socket. Human mode has no table-action tools.

Native startup already reads `electron-app/.env` in development and the existing app-data `.env` in installed builds. `GEMINI_API_KEY` is used only in Rust for ticket issuance. Alternatively the native **Connect .token (Gemini)** picker accepts a plain Google key, `GEMINI_API_KEY=...`, or a JSON property of that name; imported keys remain in memory until application exit. GitHub tokens are rejected. The desktop `.token` observed in this session is a GitHub credential, while the Gemini key was present in the project's existing `.env`. Neither value was copied into source code, patches, logs or this document.

`GEMINI_LIVE_MODEL` defaults to `gemini-3.8-live`. Override with another verified Live model ID if necessary. The native privacy mode must allow direct model egress; this mode rejects proxy-only configurations instead of bypassing them silently.

Raw REST token provisioning uses `bidiGenerateContentSetup` plus a field mask locking the model and audio response modality. The SDK alias `liveConnectConstraints` is not a REST field; a real request caught this distinction. Temporary tokens connect to `BidiGenerateContentConstrained`, not the ordinary key-authenticated endpoint. Tickets are single-use, with Google's default connection and session expiration limits. New tickets and resumption handles renew a continuing conversation; resumption failures stop it. The renderer never receives the long-lived key.

The capture interval is 1.2 seconds, with no overlapping captures. Microphone input is 16 kHz mono signed little-endian PCM; model output is decoded at the rate in each PCM part, normally 24 kHz. Queued playback clears on interruption. Tool calls are serialized, deduplicated by call ID and constrained by native run generation, mode and existing poker guards. A disconnected renderer loses authority through a 20-second native heartbeat watchdog; old sockets cannot stop or act through a newer generation.

`node scripts/verify-gemini-live.cjs` performs a small billable network probe using the existing `.env` or process environment. It prints only booleans and counts, requires both audio and transcript output before passing, and never sends screenshots or microphone audio. The probe uses a harmless addition tool. Actual UI/device testing remains separate.

## Solver choice for this PC

KOMPUTER reported 63.9 GiB RAM and an Intel Xeon E5-2699 v3 (18 physical cores / 36 logical processors). No Pio/HRC installation was found in the inspected standard program folders or matching project/download folder names; this was not an exhaustive disk scan.

- **PioSOLVER Pro** is the starting choice for heads-up postflop equilibrium analysis. Its UPI is a documented external-process interface. Configure ranges, board, pot, effective stack, rake and allowed bet sizes; a mismatched tree is not a valid answer. Pro is limited to 16 threads.
- **HRC Pro** complements it for tournament/ICM and knockout work. HRC scripting customizes Monte Carlo tree construction; it is not a general external solve/query API. Stacks and equity models still need setup through its UI.
- **Pio Edge** adds preflop solving and broader CPU support. Its minimum 64 GB requirement does not mean arbitrary preflop games fit this older 64 GB workstation. Start with bounded postflop trees and measure memory/time before paying for larger work.

No commercial licence was purchased and no licensed engine is bundled. Pio Free is suitable only for evaluation on its two supported example flops. This branch does not yet query Pio/HRC or claim a connected strategic solver. A future adapter should run as a separate worker for study/review, load known solved trees, return action distributions and EVs with exact applicability metadata, and reject uncovered spots. Interactive voice latency is not a guarantee of solve latency.

## Books and learning

The separate reference pack contains notes from official samples of *Modern Poker Theory*, *Exploitative Play in Live Poker*, and *Secrets of Professional Tournament Poker: The Essential Guide*. Sources, PDF page counts, hashes and converter version are recorded. It contains neither full books nor copied range charts. The extractor's numeric-heading heuristic also detected contents/page numbers; its chapter count is not trustworthy. Formula/card-font extraction needs visual verification. Full licensed PDF/EPUB editions are still required for complete conversion, including *Beyond GTO* and *Endgame Poker Strategy*.

Import one reference folder through **Import Book-to-Skill**. These folders supply explanations and source lookup, not trusted action labels or executable agent instructions. FTS5 retrieval is the initial knowledge layer. Books should not be pasted wholesale into every live prompt.

## Weight training plan

Keep four distinct components:

1. Gemini Live handles speech, visual interpretation, questions and explanations.
2. A deterministic state validator checks cards, units, pot/stack arithmetic, legal actions, history and uncertainty. Unknown opponent cards stay unknown.
3. A solver worker and a cache of validated solved spots provide strategic action distributions and EVs. Cache keys include format, board, stack, pot, ranges, rake/ICM, legal sizings, action history and solver/configuration version. No matching entry means “unsupported”, not an invented GTO answer.
4. SQLite stores observations, decisions, evidence, opponent statistics when implemented, and candidate lessons. Review can change retrieval and hypotheses; it does not mutate production model weights.

Do not use hand profit/win-loss as supervised action labels: a good decision can lose and a bad decision can win. Generate offline examples from solver distributions and per-action EVs under explicit assumptions. Reject unconverged solves, impossible states, inconsistent units and out-of-range situations. Store configuration hashes, convergence measures, legal-action masks and source versions with every example.

Only after the baseline works should a separate small policy model be distilled from those examples. Use probabilities as soft targets and EV regret as the primary quality metric; imitation loss alone is insufficient. Split training and evaluation by board/spot/tree families, not randomly across nearly identical nodes. Test suit permutations, blockers, varying stacks, legal-action consistency, unsupported inputs and p95 inference time. Gate release on held-out EV loss and zero invalid actions; compare against the previous policy and retain rollback. Online play may gather review data, but weights remain fixed until a new evaluated version is promoted.

Current Google documentation says ordinary Gemini Developer API tuning has no supported model; `gemini-3.8-live` does not support tuning. Separate Cloud tuning products/model lists are a different workflow. An ordinary Gemini API key therefore does not provide online weight updates for this Live model. A policy model with accessible weights can be trained separately later; doing so requires an actual solver-labelled dataset and evaluation budget. No model was trained in this change.

Sources: [Google Live reference](https://ai.google.dev/api/live), [model tuning](https://ai.google.dev/gemini-api/docs/model-tuning), [Pio product comparison](https://piosolver.com/docs/product_comparison/), [Pio UPI](https://piosolver.com/docs/upi/), [HRC scripting](https://www.holdemresources.net/docs/scripting/).
