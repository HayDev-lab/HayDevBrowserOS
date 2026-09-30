# PROMPT 9 — Deep Research Lite (Pre-Verify Corrections Applied)

## Final Status

```
PROMPT_9 =
STATIC_VERIFIED
+ UNIT_VERIFIED
+ INTEGRATION_VERIFIED
+ RUNTIME_VERIFIED_PARTIAL

REAL_BROWSER_RESEARCH_PIPELINE = PASS   (Windows live evidence)
OLLAMA_CLOUD = BLOCKED
REAL_OLLAMA_RESEARCH = BLOCKED_CREDENTIAL
```

PROMPT 10 is NOT auto-started. Stopping after this report.

---

## Corrections Applied (this session)

### 1. Source Ledger — only after REAL read
- `ResearchSession.recordFromAction` records a source ONLY on a successful
  `readPage` action with a non-empty `snapshot.url`. `navigate` alone marks
  a `failed` source on failure but NEVER a `visited` source on success.
- Empty/whitespace URLs are now ignored (defensive guard) so a malformed
  snapshot cannot pollute the ledger.
- Proven by: `research-source-ledger.test.ts` (14 tests) +
  `research-browser-pipeline.test.ts` ("navigate alone is NOT enough").

### 2. Cross-check does NOT trust a model phrase
- Introduced a structured evidence model in `@shared/research-types`:
  ```ts
  ResearchEvidence { sourceId, claimKey, stance: SUPPORT|CONTRADICT|NEUTRAL }
  ```
- The parser extracts an optional `evidence: [{source, stance}]` block per
  finding. Stance strings are normalized via `normalizeStance` — unknown
  /empty/malformed values default to `NEUTRAL` (fail-closed: the model
  cannot invent stances).
- `validateCitations` resolves each evidence `source` against the ledger
  (numeric id OR URL) — hallucinated evidence is dropped and reported in
  `rejections`. SUPPORT/CONTRADICT evidence also counts as a citation.
- `crossCheckClaims` derives status DETERMINISTICALLY from the structured
  evidence:
  - SUPPORT + SUPPORT → SUPPORTED
  - SUPPORT + CONTRADICT (different sources) → CONFLICTING
  - only NEUTRAL / no evidence / no citations → INSUFFICIENT
- A model-declared `conflicts` block is KEPT only when the structural
  evidence actually marks at least one of its claims as CONFLICTING.
  Otherwise it is downgraded to `uncorroboratedConflicts` and surfaced in
  `unknowns` — never presented as a confirmed conflict.
- No semantic knowledge graph is built.
- Proven by: `research-cross-check.test.ts` (22 tests) +
  `research-pure-pipeline.test.ts` (model-declared conflict WITHOUT
  evidence is downgraded).

### 3. Citation Integrity — fail closed
- `validateCitations` resolves every draft citation against the visited
  ledger:
  - numeric id → `ledger.byId` (visited only — failed sources return null)
  - URL → `ledger.byUrl` (canonicalized match)
- Hallucinated ids/URLs are REJECTED and reported in `rejections`; they
  are NOT added to the ledger.
- A finding left with zero valid citations is downgraded to
  `INSUFFICIENT` (reported via `insufficientIndexes`).
- `buildResearchReport` copies `sources` verbatim from the ledger —
  fictitious URLs are structurally impossible in the report.
- Proven by: `research-cross-check.test.ts` ("REJECTS URL citations not
  in the ledger (does NOT add the URL)") + `research-pure-pipeline.test.ts`
  ("report sources come ONLY from the ledger").

### 4. Live test states separated
- **PURE_RESEARCH_PIPELINE** — `research-pure-pipeline.test.ts` (9 tests)
  runs ledger → cross-check → citation validator → report builder over
  deterministic fixtures (no Electron, no Ollama).
- **REAL_BROWSER_RESEARCH_PIPELINE** — `research-browser-pipeline.test.ts`
  (7 tests) runs the real `BrowserActionService` + `ResearchSession`
  against a fake adapter (structural proof). On Windows, the live MCP
  smoke confirmed two real WebContents reads (example.com +
  www.iana.org/help/example-domains) and fed the actual PageSnapshots
  through the SAME pure pipeline in `_live_research_smoke.test.ts`
  (4 tests) → `REAL_BROWSER_RESEARCH_PIPELINE = PASS`.
- **REAL_OLLAMA_RESEARCH** — `research-ollama-and-takecontrol.test.ts`
  (10 tests) exercises the real `AgentController` + DEEP_RESEARCH profile
  with `FakeOllamaClient` (PASS) and the BLOCKED_CREDENTIAL path with an
  unconfigured provider (BLOCKED_CREDENTIAL — honest failure, no fake
  report). On this Windows host `OLLAMA_API_KEY` is not set, so
  `REAL_OLLAMA_RESEARCH = BLOCKED_CREDENTIAL`.

### 5. TAKE CONTROL P0 — reuses existing abort
- DEEP_RESEARCH does NOT introduce a `researchAbortController`. The
  existing `AgentController.takeControl()` is the single abort path:
  1. Sets `abortSignal.aborted = true`
  2. Stops the BrowserActionService execution context
  3. Transitions control state to HUMAN + latches takeover
  4. Preserves all browser state (no destruction)
- The agent loop polls `abortSignal` every step; the run settles as
  STOPPED; a partial research report is still built from the collected
  ledger.
- Proven by: `research-ollama-and-takecontrol.test.ts` (3 dedicated
  TAKE_CONTROL P0 tests, including the structural contract that no
  separate `researchAbortController` field exists).

### 6. Incognito — ledger is memory-only; cleared on private context end
- `ResearchSourceLedger` has NO persistence methods (verified by test).
- `AgentController.setIncognitoContext(false)` calls `clearResearchState()`
  which drops `lastResearchReport` and `researchSession` (the ledger lives
  inside the session and is dropped with it).
- No `research.json`, no persistent cache, no long-term memory.
- Proven by: `research-browser-pipeline.test.ts` ("ledger is memory-only")
  + inherited from PROMPT 7 `incognito-integration.test.ts`.

### 7. RESEARCH_BOUNDS centralized
- `@shared/research-types.ts` exports a single `RESEARCH_BOUNDS` object:
  - `MAX_QUERY_LENGTH`, `DEFAULT_MAX_STEPS`, `HARD_MAX_STEPS`
  - `MAX_SOURCES`, `MAX_EVIDENCE_ITEMS`, `MAX_FINDINGS`
  - `MAX_EXCERPT_LENGTH`, `MAX_SUMMARY_LENGTH`, `MAX_CLAIM_LENGTH`
  - `MAX_CONFLICT_DESCRIPTION`, `MAX_UNKNOWN_ITEMS`, `MAX_UNKNOWN_LENGTH`
  - `MAX_REPORT_SIZE`, `TIMEOUT_MS`
- `maxSteps` and `timeoutMs` reuse `AGENT_LOOP_BOUNDS` hard caps
  (clamped upstream in `runAgentLoop`). No second parallel limiter.

### 8. UI — DEEP_RESEARCH uses the SAME `agent.run`
- The renderer calls `window.api.agent.run({ command, profile: 'DEEP_RESEARCH' })`
  via `useAgentStore().runResearch(query)`. NO separate IPC endpoint, NO
  new agent loop.
- A single read-only IPC channel `agent:research:report` fetches the last
  report (in-memory only). Push events (`agent:state:update`,
  `agent:timeline:update`, `control:mode:update`) are reused from PROMPT 5.

---

## Verification

### Static
- `tsc --noEmit -p tsconfig.node.json` → PASS
- `tsc --noEmit -p tsconfig.web.json` → PASS
- `tsc --noEmit -p tsconfig.test.json` → PASS
- `eslint "src/**/*.{ts,tsx}"` → PASS

### Unit + Integration
- `vitest run` → **932 / 932 PASS** across 42 files
  - +78 new research tests across 7 new files
  - +1 fixed static-a11y test (pre-existing hex-color regression resolved
    by adding research design tokens)

### Targeted research tests
- `research-source-ledger.test.ts` — 14 tests
- `research-cross-check.test.ts` — 22 tests
- `research-report-parser.test.ts` — 12 tests
- `research-pure-pipeline.test.ts` — 9 tests
- `research-browser-pipeline.test.ts` — 7 tests
- `research-ollama-and-takecontrol.test.ts` — 10 tests
- `_live_research_smoke.test.ts` — 4 tests (live Windows evidence)

### Vite builds
- `vite build --config vite.main.config.ts` → main.js 519.15 kB
- `vite build --config vite.preload.config.ts` → preload.js 2.57 kB
- `vite build --config vite.renderer.config.ts` → 177.19 kB JS + 34.44 kB CSS
- (Fixed: vite alias `@shared` now uses `path.resolve(__dirname, ...)` so
  the renderer build can resolve `@shared/research-phase` — the previous
  `/src/shared` literal was filesystem-root-relative and broke the
  renderer build on Windows.)

### Forge package
- `electron-forge package --platform=win32` →
  `out/Personal Agentic Browser-win32-x64/PersonalAgenticBrowser.exe` produced.

### Windows live smoke (real WebContents)
Launched the packaged app on this Windows desktop. MCP server started on
`127.0.0.1:27301`. Confirmed via JSON-RPC over HTTP:
1. `tabs.open` → tab created
2. `browser.navigate` to `https://example.com/` → navigationStarted:true
3. `browser.read` → real PageSnapshot:
   - url: `https://example.com/`
   - title: `Example Domain`
   - visibleText: `Example Domain...`
   - interactiveElements: `[el_0 link "Learn more" → https://iana.org/domains/example]`
4. `browser.navigate` to `https://iana.org/domains/example` → redirected to
   `https://www.iana.org/help/example-domains`
5. `browser.read` → real PageSnapshot:
   - url: `https://www.iana.org/help/example-domains`
   - title: `Example Domains`
   - visibleText: `As described in RFC 2606 and RFC 6761...`
6. Fed both real PageSnapshots through the SAME pure pipeline
   (`ResearchSourceLedger` → `validateCitations` → `crossCheckClaims` →
   `buildResearchReport`):
   - ledger contains exactly the two visited URLs
   - cross-check derives SUPPORTED from two SUPPORT stances
   - report sources are EXACTLY the two visited URLs (no hallucinated URLs)
   - a hallucinated URL in the model answer is REJECTED → finding INSUFFICIENT

→ `REAL_BROWSER_RESEARCH_PIPELINE = PASS`

### Ollama credential
- `process.env.OLLAMA_API_KEY` is not set on this Windows host.
- `OllamaClient.isConfigured()` returns false.
- `AgentController.run({ profile: 'DEEP_RESEARCH' })` returns
  `{ state: 'FAILED', reason: 'provider_not_configured', error: 'AI_PROVIDER_NOT_CONFIGURED' }`.
- No fake research report is produced.

→ `OLLAMA_CLOUD = BLOCKED`
→ `REAL_OLLAMA_RESEARCH = BLOCKED_CREDENTIAL`
→ This does NOT block PROMPT 9 implementation closure.

---

## Artifacts produced (this session)

### New test files
- `tests/research-source-ledger.test.ts` (14 tests)
- `tests/research-cross-check.test.ts` (22 tests)
- `tests/research-report-parser.test.ts` (12 tests)
- `tests/research-pure-pipeline.test.ts` (9 tests)
- `tests/research-browser-pipeline.test.ts` (7 tests)
- `tests/research-ollama-and-takecontrol.test.ts` (10 tests)
- `tests/_live_research_smoke.test.ts` (4 tests — Windows live evidence)

### Updated source files
- `src/shared/research-types.ts` — added `EvidenceStance`, `ResearchEvidence`,
  `MAX_EVIDENCE_ITEMS` bound.
- `src/main/browser/research/pure/research-report-parser.ts` — extracts
  optional `evidence` block per finding; `normalizeStance` helper
  (fail-closed: unknown → NEUTRAL).
- `src/main/browser/research/pure/citation-validator.ts` — resolves
  structured evidence against the ledger; hallucinated evidence rejected
  and reported; SUPPORT/CONTRADICT evidence counts as a citation.
- `src/main/browser/research/pure/cross-check.ts` — derives status
  deterministically from structured stances; model-declared conflicts
  must be corroborated by evidence or are downgraded to
  `uncorroboratedConflicts` and surfaced in unknowns.
- `src/main/browser/research/pure/report-builder.ts` — surfaces
  `uncorroboratedConflicts` in unknowns; fixed `serialize` signature so
  the size guard typechecks.
- `src/main/browser/research/runtime/research-session.ts` — empty/whitespace
  URL guard in the recorder (a source is recorded only after a REAL read
  with a valid URL).
- `src/main/browser/agent/runtime/agent-controller.ts` — fixed
  `finishResearch` `now` resolution (`nowFn()` instead of passing the
  function).
- `src/renderer/src/design-tokens.css` — added research color tokens
  (`--nc-research-accent`, `--nc-research-success`, `--nc-research-warning`,
  `--nc-research-danger`, `--nc-research-link` + dim/faint variants).
- `src/renderer/src/styles.css` — replaced 7 raw hex colors in the
  research block with the new design tokens (fixes the pre-existing
  static-a11y regression).
- `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`
  — `@shared` alias now uses `path.resolve(__dirname, 'src/shared')`
  instead of the literal `/src/shared` (renderer build was broken on
  Windows by the filesystem-root-relative path).

### Pre-existing research modules (already implemented before this session)
- `src/shared/research-types.ts` (RESEARCH_BOUNDS, AgentRunProfile,
  ResearchSource, ResearchClaim, ResearchReport, ResearchPhase)
- `src/shared/research-phase.ts` (pure phase derivation)
- `src/main/browser/research/pure/{source-ledger, url-canonicalizer,
  research-query, research-prompt, research-report-parser,
  citation-validator, cross-check, report-builder}.ts`
- `src/main/browser/research/runtime/research-session.ts`
- `src/main/browser/agent/runtime/agent-controller.ts` DEEP_RESEARCH wiring
- `src/main/agent-ipc-handlers.ts` `agent:research:report` read-only IPC
- `src/preload/index.ts` `researchReport()` exposed API
- `src/renderer/src/store/agent-store.ts` `runResearch()`
- `src/renderer/src/research-phase-view.ts` + AgentPanel research UI

---

## Security / Honesty Audit

- WebContents never leaves the main process (inherited from PROMPT 5R).
- The model never sees API keys, system prompts, or tool internals as
  page content (inherited from PROMPT 5).
- Page content is UNTRUSTED DATA: excerpts are size-capped, structured
  evidence stances are normalized (fail-closed), citations are validated
  against the visited ledger (hallucinated refs rejected).
- The source ledger is memory-only (no persistence methods, no
  `research.json`, no long-term cache).
- Incognito: `setIncognitoContext(false)` clears the ledger + report
  (inherited from PROMPT 7 + extended here).
- TAKE CONTROL reuses the existing abort path — no second abort
  controller, no second agent loop.
- `REAL_OLLAMA_RESEARCH = BLOCKED_CREDENTIAL` is reported honestly — no
  fake research report is ever produced.

---

## NEXT_ALLOWED

`PROMPT_10_*` — but NOT auto-started. Stopping per user directive.