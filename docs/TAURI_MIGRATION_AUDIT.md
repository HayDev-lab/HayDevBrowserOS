# Tauri Migration Audit — HayDevBrowser

Full re-audit **2026-09-29** (replaces the earlier stub-level audit).
Repo: `D:\Projects\BrowserHayDev`, production target: **Windows (WebView2)**.

## 1. Measured inventory

| Area | Where | Size / count |
| --- | --- | --- |
| Main process (Node) | `electron-app/src/main/**` (99 files) | **21,692 lines** |
| Renderer (React+TS) | `electron-app/src/renderer/src` | App + 8 stores + components |
| Shared contracts | `electron-app/src/shared` | `ipc-types.ts`, `browser-types.ts`, `agent-types.ts`, … |
| Preload bridges | `src/preload/index.ts` (chrome, 280 ln), `vite.tab-preload.config.ts` (tab pages) | 2 bridges |
| IPC channels (ipcMain) | `src/main/**` | **42** (list below) |
| Internal protocol | `pab://newtab`, `pab://search`, `pab://darkweb` | 3 privileged pages, generated HTML (2,061 ln of builders) |
| Managed child processes | `HayDevRuntimeManager` → Perplexica (Next standalone), SearXNG (portable Python), Tor (tor.exe) | 3 services, port-probe health, tree-kill cleanup |
| Local servers | MCP server (localhost, 22 tools), pab mini-API | 2 |
| Data stores (userData) | `history.json`, `bookmarks.json`, `session.json`, `memory.json`, `vault.json` (safeStorage-encrypted), `darkweb-*.json` | atomic JSON via FileStorageAdapter |
| Tests | vitest, 72 files / 1189 tests | 1183 pass (baseline) |

### IPC channel inventory (42)

`app:version`, `app:runtimeStatus`, `foundation:ping`,
`browser:tabs:list|open|close|activate`, `browser:navigate|back|forward|reload|stop`,
`browser:history:query|delete|clear|add`, `browser:bookmarks:list|add|delete`,
`browser:downloads:list|cancel|remove`,
`agent:run|stop|status`, `agent:timeline:list`, `agent:research:report`,
`control:setMode|takeControl|getMode`,
`vault:save|has|list|generateAndStore|fill|delete|form-submitted|prompt:current|prompt:resolve`,
`memory:prompt:current|prompt:resolve`,
`window:minimize|toggleMaximize|close` (fire-and-forget sends).
Push channels to renderer: `agent:state:update`, `agent:timeline:update`, `control:mode:update`, `vault:prompt:update`, `memory:prompt:update`.
Tab state reaches the UI by **800 ms polling** of `browser:tabs:list` (no tab push channels) — simplifies the Tauri port.

## 2. Electron API → Tauri 2 mapping (verified against tauri 2.11.6 source)

Verified API surface read from `~/.cargo/registry/src/.../tauri-2.11.6/src/webview/mod.rs`:

| Electron API | Use | Tauri 2 replacement (verified) | Complexity | Risk | Status |
| --- | --- | --- | --- | --- | --- |
| `BrowserWindow` (frameless) | main shell, React chrome | `WebviewWindow` config in `tauri.conf.json` (`decorations:false`), controls via `minimize/maximize/close` | Low | Low | **DONE** (Rust) |
| `WebContentsView` per tab | remote content per tab | `tauri::webview::WebviewBuilder::new` child webviews; `set_bounds`, `hide`, `show` | High | High | **IN PROGRESS** |
| tab rect layout | chrome `CHROME_LAYOUT` | same token: renderer view full-window; active tab at `y=128`, right rail 360 if width ≥ 980, bottom footer 24 | Medium | Medium | **IN PROGRESS** |
| `webContents.loadURL` | navigation | `Webview::navigate(url)` (verified) | Low | Low | **DONE** |
| back/forward | nav stack | **no direct API** → `eval("history.back()")` + in-Rust nav-stack (`canGoBack/Forward` from our own stack, same model as TS `NavigationStack`) | Medium | Medium | **IN PROGRESS** |
| `webContents.reload/stop` | reload | `eval("location.reload()")` / `eval("window.stop()")` | Low | Low | **DONE** (semantics differ: reload keeps cache semantics of the page) |
| `did-navigate` / `did-finish-load` / title | tab state | `on_page_load(PageLoadPayload: Started/Finished + url)`, `on_document_title_changed(String)` (both verified) | Low | Low | **IN PROGRESS** |
| `session.fromPartition('persist:…')` | profiles | `WebviewBuilder::data_directory(PathBuf)` per profile + `incognito(true)` for private tabs | High | High | **PHASE 5** (cookie DB formats differ Electron↔WebView2 — documented fresh-profile migration, no Chromium DB surgery) |
| `session.setProxy` (SOCKS5, Tor) | darkweb tabs | `WebviewBuilder::proxy_url(socks5://…)` per webview (verified) — tab-scoped, not global | Medium | Medium | **PHASE 7** (needs managed Tor in Rust) |
| `session.on('will-download')` | downloads | `WebviewBuilder::on_download(DownloadEvent::{Requested{url,destination}->bool, Finished{url,path,success}})` (verified) | Medium | Medium | **IN PROGRESS** |
| `session.protocol.handle('pab')` | internal pages | `tauri::Builder::register_uri_scheme_protocol("pab")`; pages generated from the SAME TS builders via a build step; `api/news`+`api/topsites` served by Rust | Medium | Medium | **PHASE 5** |
| `contextBridge` preload | typed contract | renderer `platform/` adapter + `@tauri-apps/api/core::invoke` (no preload in Tauri; capability ACL replaces channel allowlist) | Low | Low | **DONE** (needs electron.ts proxy fix) |
| `ipcMain.handle` | 42 channels | `#[tauri::command]` (serde-typed DTOs in `src/shared/ipc-types.ts` ↔ Rust structs) | Medium | Medium | **IN PROGRESS** |
| `webContents.send` push | 5 push channels | `app.emit` + `listen` (typed payload passthrough) | Low | Low | **DONE** (adapter) |
| `app.getPath('userData')` | data dir | `app.path().app_data_dir()` — **format parity required**: stores must keep the same JSON file formats (`{version:1, entries:[…]}`) so profiles survive runtime switch | Medium | Medium | **IN PROGRESS** |
| `safeStorage` (DPAPI) | vault encryption | Electron-only. Rust side: vault **not migrated** this phase (agent/vault remain Electron-side; no secrets move to frontend) | High | High | **DEFERRED** |
| `child_process` ProcessSupervisor | Perplexica/SearXNG/Tor | Rust process manager (allowlisted executables only) — same spawn args/env as Node supervisor, connect-probe health | High | Medium | **PHASE 7** |
| `setWindowOpenHandler` | popups → OS browser | `on_navigation` + WebView2 new-window default (opens in default browser via `opener` policy) | Medium | Medium | **PHASE 5** |
| `executeJavaScript` (agent actions, overlay, vault capture) | agent browser automation | needs CDP or `eval_with_callback` — **architecture gap**; agent stays on Electron runtime | High | High | **DEFERRED** (documented) |
| `shell.openExternal` | external links | `tauri-plugin-opener` | Low | Low | **PHASE 5** |
| Electron auto-update / tray / shortcuts / notifications / clipboard | not used by this app | — | — | — | NOT_APPLICABLE |

## 3. Node dependency classification (§15 of the migration contract)

| Category | Items | Disposition |
| --- | --- | --- |
| A frontend-compatible | react, react-dom | unchanged |
| B replaceable by Web API | — | — |
| C → Rust | tab/webview orchestration, history/bookmarks/session stores (JSON, same format), downloads registry, window controls, port probing, pab:// serving, process supervision (later) | this migration |
| D stays sidecar | Perplexica (Next standalone), SearXNG (portable Python), tor.exe — spawned as managed children **by Rust** with the same argv/env contract | PHASE 7 |
| E Electron-only (kept until parity) | AgentController + AI clients, CredentialVault/safeStorage, MCP server, DarkWebService crawler, PasswordCaptureService (executeJavaScript-dependent) | **retained on Electron runtime** — Tauri runtime boots without them (no stubs lying about success; commands return honest NOT_AVAILABLE errors) |

## 4. Security model translation

- Electron: sandbox+contextIsolation preload, channel allowlists, per-session `pab` privilege, webSecurity baseline on every view.
- Tauri: **capabilities ACL split per surface** (shell/main vs none for remote webviews), CSP scoped to real resources, remote tab webviews get **no** Tauri IPC bindings (only the chrome webview holds capabilities), secrets stay out of the frontend bundle (keys are read from env on the backend side only — unchanged).

## 5. What is explicitly NOT being migrated now (strangler pattern)

Per migration contract §1/§15/§45: Electron remains the primary, fully-working
runtime. The Tauri runtime migrates the **browser core** (priority #1–3:
browser reliability, session persistence, multi-webview stability). Agent/AI,
vault, MCP, and darkweb remain Electron-only until their Rust-side
architecture (CDP/automation layer, native secret storage) is designed and
verified. No feature is stubbed to fake success in either runtime.
