# AI settings

Current local selection, 29 October 2026: `gemini-3.5-flash-lite` is saved in the normal profile, with Adaptive reasoning. Credentials were preserved. The older quota observations below are historical results for other models/runs.

Fresh verification on 27 October: [completion report](implementation-completion-2026-10-27.md). Native P21 passed again. The real Gemini catalog and Live connection were verified; OpenAI/OpenRouter routing and encrypted persistence were tested with synthetic keys. Saves and token import are rejected during Live startup as well as an active session.

Open the gear button in the browser toolbar (Настройки AI / AI settings / AI կարգավորումներ).

## Model configuration in 0.1.2

The main agent defaults to `gemini-3.6-flash`. Gemini Live remains a separate voice transport with its own model; the user's explicit transport choice is remembered.

The Gemini reasoning setting supports Adaptive, Model default, Low, Medium and High. Adaptive sends OpenAI-compatible `reasoning_effort: low` after ordinary tool interaction and `medium` for deep research. It never silently replaces the selected model. Low requests have a 20-second deadline, medium 60 seconds and other modes 120 seconds; these are deadlines, not latency guarantees. Both streaming and non-streaming paths use the same policy. One retry is allowed for 502/503/504; quota errors are not automatically retried.

Stopping a run releases the settings lock once the run's authority is revoked; a completed STOPPED state no longer leaves the UI in STOPPING. Saving credentials remains blocked during an active run or Live startup.

Fresh provider verification found that 3.6 Flash accepted function calls, while 3.8 Flash returned 503. The subsequent native 3.2 run hit the project's **20 requests/day free-tier quota**, confirmed by the provider's structured QuotaFailure response. No new latency guarantee is claimed. For continuous use, inspect the project's actual limits in AI Studio. Limits are per project, so a second key in the same project does not supply new quota. See [Google's rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

## Historical verification of 0.1.1 on 28 October 2026

The installed 0.1.1 browser now has Gemini selected for the main agent in the normal Windows profile. The current working model is `gemini-3.5-flash-lite`. Native settings saves, encrypted key storage, restart persistence and actual provider replies were verified. Gemini Live remains independently configured as `gemini-3.8-live`.

The recommended upgrade candidate is `gemini-3.8-flash` for stronger browser-agent work. It is listed for this account, but the live acceptance attempts returned overload errors/timeouts, so it was not selected as the working default. `gemini-3.1-pro-preview` and `gemini-4-argon` are also listed, but requests returned HTTP 429 with zero free-tier quota. Catalog visibility is not generation access. There is no measured quality comparison against these unavailable models.

On a small native browser task involving reading a fresh code, finding controls, filling a field, clicking once and reading the receipt, Flash-Lite completed six steps in 4.699 seconds; `gemini-3.5-flash` took 48.672 seconds. These are single observations, not general latency guarantees.

Full results, limitations and exact installed-binary identity: [Gemini agent verification](../artifacts/closure/gemini-agent-20261028/acceptance.md).

1. Paste a Gemini, OpenRouter or OpenAI API key and save. Blank key fields preserve existing credentials.
2. Load the provider's model list, select a model using the model input's suggestions or enter its exact ID, then save again.
3. Select the agent provider. Gemini Live has its own model field and always uses Gemini credentials; selecting OpenAI/OpenRouter does not change the Live transport.

Keys are encrypted using the existing Windows DPAPI implementation and persisted with the atomic store in the active app-data directory's `ai-settings.json`. The UI receives only configuration/source flags and model IDs, never stored keys or ciphertext. Key inputs are cleared after save attempts. Saved preferences override environment selection; Automatic / environment restores the previous selection mechanism. Deleting a saved key does not edit environment variables or `.env` files.

Changes apply to subsequent agent runs; saves during an active run are rejected. Catalog fetches use fixed HTTPS endpoints, disable redirects, sanitize HTTP errors, enforce response limits and respect the app's direct-egress requirement. No generation request is made when saving a key or retrieving a catalog.

Model catalog sources: [Gemini models](https://ai.google.dev/api/models), [OpenRouter models](https://openrouter.ai/docs/api/api-reference/models/get-models), [OpenAI models](https://developers.openai.com/api/reference/resources/models/methods/list). Gemini generation and Live entries are separated by reported methods. OpenRouter suggestions require tool support. OpenAI's catalog does not provide full capability metadata; model presence does not prove tool/vision/Chat Completions compatibility. Manual IDs are supported. The agent requires tool calling.

Scope: agent settings. Existing managed-search service configuration is not replaced by these preferences. Existing environment-only search warmup behavior is retained; newly saved agent keys do not enable automatic search probes.

Verification: TypeScript checks, ESLint, 216 existing unit tests (2 skipped), Rust model-catalog test and Windows build passed. `tests/e2e/p21-ai-settings.e2e.test.mjs` PASSED in the real Windows/WebView2 runtime with an isolated profile: native UI, ciphertext-only storage, provider routing, invalid input rejection without file modification, restart persistence and independent key removal with synthetic keys. The first UI test exposed an ambiguous accessible name on the provider selector; it was fixed and the full test passed. Real provider authentication/catalog access requires the user's credentials and is not inferred from fixture tests.
