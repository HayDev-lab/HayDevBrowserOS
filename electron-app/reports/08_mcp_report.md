# 08 — Local MCP Server Report
## Personal Agentic Browser — Production v1

**Stage:** Local MCP Server (PROMPT 8)
**Stack:** unchanged + `@modelcontextprotocol/sdk` (the ONLY new dependency)
**Implementation host (this run):** Windows 10 x64 desktop (real display — live GUI verification was possible)
**Final Status:** `STATIC_VERIFIED + UNIT_VERIFIED + INTEGRATION_VERIFIED + DEFERRED_RUNTIME(narrowed)`
**REAL_MCP_PROTOCOL:** `PASS` (real SDK client ↔ real SDK server over real HTTP)
**MCP_TO_REAL_BROWSER:** `PASS LIVE` (verified against the packaged Electron app on this machine)

---

## FACT

- Repository at start of PROMPT 8: PROMPT 1–7 complete, 759/759 tests passing (29 files), clean git tree.
- `BrowserActionService` is the single browser execution layer: `dispatch(input)` + typed convenience methods; every action requires an ACTIVE EXECUTION CONTEXT (the action router rejects context-less dispatches with `no_execution_context`); the internal agent opens one context per run (`agent-loop.ts:151`).
- `AgentController` is the single agent runtime: `run/stop/takeControl/getStatus`; TAKE CONTROL = abort signal + `stopExecutionContext` + mode→HUMAN + latch; browser state preserved.
- Existing validators to REUSE (no parallel rules): `validateAction` (URL whitelist `isAddressBarSafe`/`isValidUrl`, `PATTERNS.ELEMENT_ID`, text/scroll/limits bounds), `AGENT_LOOP_BOUNDS` (maxSteps 1–30).
- MCP SDK was NOT installed at start. Installed during this stage: `@modelcontextprotocol/sdk@1.30.0` (runtime-verified, see below).
- Implementation host has a real Windows desktop — the packaged app can be launched, so runtime verification of the MCP server AND of real browser actions was possible on this machine (unlike the Linux sandbox of PROMPT 1–7).

## ASSUMPTION

- Streamable HTTP on `127.0.0.1` with a single configurable port is the right V1 transport for a local trusted client (future Jarvis): stdio would require spawning the long-lived Electron app as a subprocess.
- The MCP client is a TRUSTED local operator: browser tools are governed by execution ownership (not by the internal agent's HUMAN/AGENT tool authorization); `agent.run` goes through `AgentController.run`, which itself enforces AGENT mode — MCP never switches control modes silently.
- MCP browser tools take an EXPLICIT `tabId` (same V1 rule as the internal agent — `resolveActiveTabId` returns null in agent-loop). This keeps the "exactly ONE service call per MCP action" contract honest.

## UNKNOWN

- Behavior of the streamable transport inside a real Electron main process → RESOLVED LIVE this run (PASS).
- Real WebContents action behavior through MCP → RESOLVED LIVE this run (PASS; and it exposed a pre-existing PROMPT 2 bug — see Confirmed Errors).
- Renderer chrome packaging (`.vite/renderer/index.html` missing from the forge package) — PRE-EXISTING quirk since PROMPT 2 (manual `vite build` writes `.vite/build/renderer/`, forge expects `.vite/renderer/`); the GUI chrome cannot load in the packaged app, but main-process browser + MCP are unaffected. Out of PROMPT 8 scope, documented as a Remaining Blocker for the GUI.

## MCP SDK Evidence

GATE passed with runtime evidence (no API assumed from memory):

```
MCP_SDK_INSTALLED = YES
MCP_SDK_VERSION   = @modelcontextprotocol/sdk@1.30.0 (bun add; engines node>=18; MIT; exports map verified)
AVAILABLE_SERVER_API:
  - Server                              ← '@modelcontextprotocol/sdk/server/index.js'      (node -e keys: ['Server'])
  - StreamableHTTPServerTransport       ← '@modelcontextprotocol/sdk/server/streamableHttp.js'
  - ListToolsRequestSchema / CallToolRequestSchema ← '@modelcontextprotocol/sdk/types.js' (both present)
  - Server.setRequestHandler(schema, handler)      (protocol.d.ts:389)
  - StreamableHTTPServerTransport ctor: { sessionIdGenerator: undefined → STATELESS; enableJsonResponse: true }
  - Node transport handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?) — bridges to the
    web-standard implementation internally (streamableHttp.d.ts:107) — NO manual Request/Response bridge needed.
AVAILABLE_TRANSPORTS:
  - server: stdio / streamableHttp / webStandardStreamableHttp / sse
  - client: StreamableHTTPClientTransport ('@modelcontextprotocol/sdk/client/streamableHttp.js'), Client.listTools/callTool
  - smoke test: real Server + stateless transport + both handlers constructed OK (node -e, exit 0)
```

## MCP SDK Version

`@modelcontextprotocol/sdk@1.30.0` — the official Anthropic TypeScript SDK, the ONLY new dependency (`bun add @modelcontextprotocol/sdk`; `package.json` dependencies +1; no other packages added by hand).

## Transport Decision

**Streamable HTTP (stateless) on 127.0.0.1, single configurable port (default 27301, env `MCP_SERVER_PORT`).**

- Chosen over stdio (wrong shape for a long-lived Electron host) and InMemory (no external client can attach).
- SDK-documented stateless pattern: one fresh `Server` + one fresh `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` per POST request; both disposed when the response closes; GET/DELETE → 405.
- Port occupied → EXPLICIT `EADDRINUSE` startup error (tested); no port-range scanning; no WebSocket; no Event Bus.

## MCP Architecture

```
Local MCP Client (trusted, same machine)
        ↓  HTTP POST http://127.0.0.1:<port>/mcp  (JSON-RPC, stateless streamable)
   McpServerRuntime            (src/main/browser/mcp/runtime/mcp-server.ts — real SDK Server + node:http)
        ↓  tool name + args
   McpToolHandler              (runtime/mcp-tool-handler.ts — REQUEST FLOW)
        ↓ ownership → authorization → ports
   BrowserActionService        (EXISTING single execution layer; dispatch inside its own execution context)
   AgentController             (EXISTING single agent runtime: run / stop / takeControl)
        ↓
   BrowserCore / WebContents   (reachable ONLY through BrowserActionService — never from MCP)

Request flow per tool call:
  REQUEST → SCHEMA VALIDATION (registry lookup + parseMcpArgs + the EXISTING validateAction)
          → EXECUTION OWNERSHIP CHECK (McpOwnershipGuard)
          → AUTHORIZATION (authorizeMcpTool)
          → EXISTING SERVICE (McpBrowserPort / McpAgentPort)
          → SAFE RESULT (McpToolPayload — serializable, secret-free)
```

No second automation layer, no second agent loop, no second tool registry for AI (the internal agent's `TOOL_DEFINITIONS` is untouched).

## Network Boundary

- `MCP_HOST = '127.0.0.1'` — pinned constant; `server.listen(this.port, MCP_HOST, ...)`. NOT configurable.
- Forbidden binds absent: `0.0.0.0` / `'::'` → 0 matches in source AND in the built `main.js` (grep-verified).
- LIVE check: probing the machine's LAN interface on the MCP port → connection refused (000).
- Remote MCP in V1: absent. No WebSocket, no Event Bus, no scheduler.

## Tool Registry

Exactly the 13 approved V1 tools (registry tests prove the set is EXACT; no duplicates; audit passes):

| Tool | Routes to |
|---|---|
| `browser.status` | aggregate of `AgentController.getStatus()` + guard (read-only, no dispatch) |
| `browser.navigate` / `browser.read` | BrowserActionService (`navigate` / `readPage`) |
| `tabs.list` / `tabs.open` / `tabs.activate` / `tabs.close` | BrowserActionService tab actions |
| `page.click` / `page.type` / `page.scroll` | BrowserActionService DOM actions |
| `agent.run` / `agent.stop` | AgentController (`run` / `stop`) |
| `browser.take_control` | AgentController.takeControl (EXISTING takeover logic) |

Forbidden and absent (registry + tests + bundle): `execute_js`, `eval`, `shell`, `filesystem`, `environment`, `process_env`, `vault.*` (ALL vault tools — decrypt/get_password/has/fill/generate_and_store/save/list/delete).

Schemas: JSON Schema objects (`type: object`, `additionalProperties: false`, `required ⊆ properties`); `page.scroll.direction` enum-constrained; tab-scoped tools require explicit `tabId`.

## Execution Ownership

`pure/mcp-ownership.ts` — `ExecutionOwner = NONE | INTERNAL_AGENT | MCP`, single synchronous owner field (no scheduler/queue/lock):

```
NONE            → MCP action allowed            (guard.beginMcpBrowserOperation: NONE→MCP)
MCP             → conflicting execution rejected ('mcp_execution_in_progress', status 'busy')
INTERNAL_AGENT  → direct MCP browser action rejected ('internal_agent_active')
agent.run       → NONE→INTERNAL_AGENT for the whole run (concurrent browser tools rejected)
take_control    → ALWAYS allowed (P0 brake); aborts agent via EXISTING logic; owner released → NONE
operation end   → try/finally ALWAYS releases the owner (success, failure, throw — tested)
UI agent runs   → wired: AgentController.onStateChange → markInternalAgentActive(isAgentStateActive)
```

18 dedicated tests cover the full policy table + wiring mapping (RUNNING/STOPPING active).

## BrowserActionService Integration

- `McpBrowserPort` = `dispatch` + `startExecutionContext` + `stopExecutionContext` — satisfied by the EXISTING BrowserActionService (wired in `main/index.ts`).
- Each MCP browser tool call = EXACTLY ONE `dispatch` with a typed `ActionInput` (proven per-tool by routing tests; live-proven by real navigate/read/scroll/click).
- Each browser operation opens ONE execution context and stops it in `finally` — mirroring how the agent's runs use the service (the router rejects context-less dispatches; this was caught LIVE and fixed — see Fix Loop History).
- `browser.read` returns the EXISTING `PageSnapshot` (limits, stable `el_<n>` ids, password redaction) — no second extraction engine.
- Incognito: MCP uses the same service and the same tabs; no `incognito.*` tools; PROMPT 7 policies apply automatically (same partition/history/vault policy paths).

## AgentController Integration

- `agent.run` → `AgentController.run({command, maxSteps})` — exactly one call; result mapped (`COMPLETED`→success; anything else→honest failure with the controller's reason, e.g. `not_in_agent_mode`).
- `agent.stop` → `AgentController.stop(reason)`.
- No new agent loop, no Ollama client, no AI tool registry in the MCP layer (statically proven: no `runAgentLoop`/`ollama` references in mcp/ sources).

## TAKE CONTROL Integration

`browser.take_control` → `AgentController.takeControl(reason)` — the EXISTING logic: abort signal set, execution context stopped, mode→HUMAN, takeover latch set, browser state PRESERVED. The MCP handler additionally releases the execution owner. Scenario proven by tests AND live (accepted, controlMode HUMAN, owner NONE, tabs preserved).

## Changed Files

```
NEW  src/shared/mcp-types.ts                                  — ExecutionOwner, McpBrowserPort/McpAgentPort, McpToolPayload, McpServerStatus
NEW  src/main/browser/mcp/pure/mcp-tool-registry.ts           — 13 approved tools + JSON schemas + FORBIDDEN list + audit
NEW  src/main/browser/mcp/pure/mcp-ownership.ts               — McpOwnershipGuard + pure policy functions
NEW  src/main/browser/mcp/pure/mcp-args.ts                    — raw args → typed requests (reuses existing bounds)
NEW  src/main/browser/mcp/pure/mcp-result.ts                  — safe McpToolPayload mapping (no stacks, no secrets)
NEW  src/main/browser/mcp/runtime/mcp-tool-handler.ts         — request-flow orchestrator (no electron import)
NEW  src/main/browser/mcp/runtime/mcp-server.ts               — real SDK Server + node:http on 127.0.0.1 (no electron import)
UPD  src/main/index.ts                                        — MCP wiring: guard, ports, callbacks composition, start/stop lifecycle
UPD  src/main/browser/pure/tab-manager.ts                     — FIX: openTab ALWAYS emits onTabOpened (pre-existing bug, see below)
UPD  src/shared (unchanged) / tsconfig.test.json              — include mcp/ + actions/pure paths
UPD  package.json + bun.lock                                  — +@modelcontextprotocol/sdk@1.30.0
NEW  tests/mcp-tool-registry.test.ts (14) / mcp-ownership.test.ts (18) / mcp-args.test.ts (15)
NEW  tests/mcp-handler-routing.test.ts (26) / mcp-static-boundary.test.ts (12) / mcp-real-protocol.test.ts (10)
UPD  tests/tab-manager.test.ts                                — lifecycle contract updated (onTabOpened always fires)
UPD  tests/ui-logic.test.ts                                   — timezone-independent date assertion (environment fix, see below)
```

## Commands Actually Run

```
bun install                                                     (deps restore)
bun add @modelcontextprotocol/sdk                               (sdk 1.30.0)
node -e "...require sdk modules, list exports, smoke-test Server+transport"
tsc --noEmit -p tsconfig.{node,web,test}.json                  → PASS ×3
eslint "src/**/*.{ts,tsx}"                                      → PASS
vitest run --config vitest.config.ts                            → 854/854 PASS (35 files)
vite build --config vite.{main,preload,renderer}.config.ts      → PASS ×3
electron-forge package                                          → PASS (win32 x64)
# LIVE verification (this machine has a real desktop):
PersonalAgenticBrowser.exe → curl JSON-RPC http://127.0.0.1:27301/mcp
  initialize / tools/list(13) / browser.status / tabs.list / tabs.open /
  browser.navigate(example.com, example.org) / browser.read(PageSnapshot) /
  page.scroll / page.click(el_0) / browser.take_control / invalid URL rejection /
  unknown tool rejection / LAN-interface unreachable
grep security baselines (source + built main.js)                → all 0 / as specified
```

## Tests Added

95 new tests across 6 files (759 → 854 total; +1 net from the updated tab-manager contract assertions):

- **Tool Registry (14)** — exact approved set (13), no duplicates, forbidden absent (incl. all `vault.*`), schemas well-formed, unknown-tool lookup rejected.
- **Ownership (18)** — full V1 policy table, idempotent release, take_control from any state, agent-state mapping.
- **Validation (15)** — valid args per tool; malformed (non-object/wrong types/missing required); bounds (command 2000, reason 200, maxSteps 1–30); unknown tool.
- **Browser Routing (26)** — exactly ONE dispatch per tool with correct ActionInput; invalid URL/elementId/size → rejected with ZERO dispatches (REUSE of existing validators); service-failure mapping; execution-context bracket (1 start + 1 stop, incl. failure path); agent routing (1 controller.run, honest FAILED mapping); TAKE CONTROL scenario (abort+HUMAN+owner cleared+browser preserved); ownership end-to-end (busy conflict via hanging dispatch, INTERNAL_AGENT rejections, try/finally release on throw).
- **Static Boundary (12)** — NO BYPASS (no BrowserCore/WebContents/NavigationController/TabManager/executeJavaScript refs, no electron import in mcp/), network (127.0.0.1 pinned, no 0.0.0.0/::, single listen), secret safety (no vault imports, no process.env in mcp/, no secret fields in the result contract, wiring env allow-list).
- **Real Protocol (10)** — REAL SDK Client over real HTTP: listTools(13), browser.status, navigate routing, invalid URL isError, unknown tool isError, INTERNAL_AGENT rejection over the wire, take_control, disconnect→stop→status, restart-after-stop, EADDRINUSE explicit error, double-start rejection, idempotent stop.

## STATIC_VERIFIED

typecheck ×3 PASS; lint PASS; static boundary tests PASS; security greps: `nodeIntegration:true`/`contextIsolation:false`/`sandbox:false`/`webSecurity:false` → 0; electron imports in pure/+mcp/ → 0; `eval(` in agent/+mcp/ → 0; `0.0.0.0`/`'::'` → 0; bundle `main.js` contains `127.0.0.1` (1 bind site) and no `0.0.0.0`.

## UNIT_VERIFIED

All pure MCP modules (registry / ownership / args / result) fully unit-tested (47 tests) without Electron or SDK.

## INTEGRATION_VERIFIED

Handler-over-fakes routing suite (26) proves single-layer routing + ownership + takeover semantics; real-protocol suite (10) proves the SDK client↔server↔handler chain over HTTP; LIVE run against the packaged Electron app proves the production wiring (navigate/read/scroll/click/status/take_control against real WebContents).

## REAL_MCP_PROTOCOL

**PASS** — real `Client` + `StreamableHTTPClientTransport` ↔ real `Server` + `StreamableHTTPServerTransport` over real HTTP on `127.0.0.1` (10/10 tests), and the same flow verified with raw JSON-RPC (curl) against the packaged desktop app.

## DEFERRED_RUNTIME

Narrowed this run — the implementation host HAS a working desktop, so:

```
MCP_TO_REAL_BROWSER        = PASS LIVE  (navigate/read/scroll/click via real WebContents, packaged app)
REAL_TAKEOVER_IN_GUI       = PASS LIVE  (take_control: HUMAN, owner released, tabs preserved)
REAL_MCP_IN_ELECTRON       = PASS LIVE  (server boots with the app, port 27301)
DEFERRED (unchanged, GUI-chrome bound):
  - renderer chrome in the forge package (.vite/renderer path mismatch — pre-existing since PROMPT 2)
  - real Ollama round-trip via agent.run (no OLLAMA_API_KEY configured here; controller honestly reports
    AI_PROVIDER_NOT_CONFIGURED — verified live via browser.status: providerConfigured:false)
```

## Security Review

| Check | Result |
|---|---|
| localhost-only bind (127.0.0.1 pinned) | ✅ source + bundle + live LAN probe refused |
| no public bind (0.0.0.0 / ::) | ✅ 0 matches |
| no arbitrary JavaScript tool | ✅ execute_js/eval absent & rejected as unknown tools |
| no shell / filesystem / environment / process_env tools | ✅ absent (registry + tests) |
| no Vault plaintext / any vault tool over MCP | ✅ zero vault imports in mcp/; all vault.* rejected |
| no Electron object exposure | ✅ results JSON-round-tripped (non-serializable dropped); no WebContents in payloads |
| no direct BrowserCore bypass | ✅ static NO-BYPASS tests; single dispatch contract |
| no duplicate automation layer | ✅ mcp/ imports neither BrowserCore nor adapters; routes only via ports |
| no duplicate agent loop | ✅ no runAgentLoop/ollama in mcp/; agent.run → existing controller |
| execution ownership protected | ✅ try/finally, busy/rejected paths tested incl. over the real protocol |
| TAKE CONTROL preserved | ✅ existing takeover logic invoked; tested + live |
| secrets in outputs/logs | ✅ no stack traces (mapped to bounded safeMessage); no env/key/password fields |
| Electron security flags (regression) | ✅ all 5 correct, 0 anti-patterns |

## Confirmed Errors

1. **`tabs.list` → `no_execution_context`** (live, packaged app) — MCP dispatched browser actions without an execution context; the router requires one (the agent opens one per run). FIX: MCP browser handler opens/stops one context per operation via the service's public API (try/finally). Verified: live tabs.list/open now succeed.
2. **`browser.navigate/read/scroll` → `tab_not_found` for existing tabs** (live) — root cause: PRE-EXISTING PROMPT 2 bug in `TabManager.openTab`: the activated path (default) SKIPPED the `onTabOpened` event, so BrowserCore never created the per-tab `WebContentsView` runtime (`tabRuntimes` empty — proven by temporary diagnostics: `handleTabOpened` never ran, `mapSize=0`). The entire GUI browser was non-functional at runtime since PROMPT 2 (hidden by DEFERRED_RUNTIME). FIX (one line + contract): `openTab` ALWAYS emits `onTabOpened` before activation; 2 tab-manager test expectations updated to the corrected lifecycle contract. Verified: live navigate/read/scroll/click against real WebContents succeed; full regression PASS.
3. **`ui-logic` date test timezone flakiness** — expected value used `toISOString()` (UTC) while the formatter uses local date; passed on the original UTC sandbox, failed on this UTC+4 machine. FIX: anchor the test timestamp to 12:00 UTC (local and UTC dates coincide in any timezone). Verified under TZ=UTC+14 and TZ=UTC-12.

## Fix Loop History

```
Loop 1: tabs.list → no_execution_context
  ROOT CAUSE: router requires an active execution context; MCP opened none
  MINIMAL FIX: start/stopExecutionContext around each MCP browser op (same public API as the agent)
  VERIFY: live tabs.list + tabs.open succeed; new routing test asserts 1 start + 1 stop (incl. failure path)

Loop 2: navigate/read/scroll → tab_not_found (tabs exist)
  ROOT CAUSE: TabManager.openTab skipped onTabOpened on the activate path → BrowserCore never created
             WebContentsView runtimes (pre-existing PROMPT 2 bug; diagnosed with temporary logging,
             logs removed after)
  MINIMAL FIX: openTab always emits onTabOpened (then activates); tab-manager contract tests updated
  VERIFY: live navigate/read/scroll/click on real pages succeed; 854/854 regression PASS

Loop 3: ui-logic date assertion failed (environment: UTC+4 vs original UTC sandbox)
  ROOT CAUSE: UTC-vs-local date comparison in the TEST expectation
  MINIMAL FIX: noon-UTC anchoring; verified under extreme TZs
```

## Regression Results

```
Tests:        854/854 PASS (35 files) — was 759/759 (29 files); +95 MCP tests; 0 previous tests lost
Typecheck:    node / web / test — all PASS
Lint:         PASS
Vite builds:  main 506,245 B (SDK bundled) / preload 2,497 B / renderer 173.64 kB JS + 31.71 kB CSS — all PASS
Forge package:PASS — out/Personal Agentic Browser-win32-x64/resources/app.asar 718,202 B
Regression confirmed clean for: Browser Core (incl. fixed tab lifecycle), Neural Cockpit,
BrowserActionService, Agent Runtime, TAKE CONTROL, WebContents resolver, Credential Vault, Incognito
```

## Remaining Blockers

- GUI chrome not present in the forge package (pre-existing `.vite/renderer` path mismatch since PROMPT 2) — main-process browser + MCP fully functional; the React chrome needs the packaging path fixed (or `electron-forge start` for dev) in a future stage.
- Real Ollama round-trip through `agent.run` requires `OLLAMA_API_KEY` (+ reachable endpoint) — provider honestly reports unconfigured; no fake responses by design.
- MCP auth token: V1 trusts localhost-only binding; an explicit token handshake for the local client is a candidate for V1.1 (documented, not required by the spec).

## Final Status

**`PROMPT_8 = STATIC_VERIFIED + UNIT_VERIFIED + INTEGRATION_VERIFIED + DEFERRED_RUNTIME`** (DEFERRED_RUNTIME narrowed: MCP↔real-browser verified LIVE on this machine)
**`REAL_MCP_PROTOCOL = PASS`**
**`MCP_TO_REAL_BROWSER = PASS LIVE`**
**`PROMPT_9 = READY`** (Deep Research Lite)
