# Electron vs Tauri — measured benchmark (2026-09-29)

All numbers are REAL measurements taken on this machine (Windows 10 x64,
i-class desktop, WebView2 runtime installed). Methodology, scripts and raw
values below; nothing is extrapolated.

## Artifacts compared

| | Electron (forge+squirrel, packaged) | Tauri 2 (NSIS, release) |
| --- | --- | --- |
| Browser runtime | bundled Chromium (Electron 44) | system WebView2 |
| Host executable | `out/Personal Agentic Browser-win32-x64/` **369 MB** app dir (887 MB incl. bundled runtimes) | `app.exe` **4.29 MB** |
| Installer | `Setup.exe` **103.8 MB** (squirrel) | `HayDevBrowser_0.1.0_x64-setup.exe` **1.74 MB** (WebView2 via downloadBootstrapper) |
| Shared engine bundle (`resources/runtimes`, 518 MB: Perplexica+SearXNG+Tor) | inside app dir | **NOT inside the NSIS bundle yet** (resolved via exe-relative paths in tree installs — bundling-policy decision pending) |

## 1. Startup (warm, ms to first CDP target; median of 3)

| Runtime | runs | median |
| --- | --- | --- |
| Electron | 280 / 262 / 269 | **269 ms** |
| Tauri | 584 / 589 / 583 | **584 ms** |

Electron wins warm startup on this machine (~2×). One cold-cache first run
of Electron took 12.2 s (disk cache effects, excluded from median by design).
Tauri's number includes the Rust process start + WebView2 environment attach.

## 2. RAM — idle (process-tree WorkingSet sum, MB, after 45 s settle)

| Runtime | full tree | engine children | host (tree − engines) |
| --- | --- | --- | --- |
| Electron | 841.0 | 147.1 | **693.9** |
| Tauri | 930.6 | 421.6 | **509.0** |

**Host (browser-shell) RAM: Tauri ≈ 185 MB (27%) lower.**
Caveat: the engine sets differed between runs — Electron's managed Perplexica
hits the known better-sqlite3 ABI blocker and stayed down (engines ≈ tor +
searxng), while Tauri's system-node run brought Perplexica up too (engines
include the Next standalone). That is why ENGINE columns are not comparable;
the host column is the apples-to-apples browser-shell number.
Both apps idle with one restored `pab://newtab` tab (WebGL planet + matrix
rain running).

## 3. RAM — 3 example.com tabs

| Runtime | host RAM with 3 tabs | delta vs idle |
| --- | --- | --- |
| Tauri | 563.4 | **+54.4 MB** |
| Electron | 708.0 (+14.1) | **NOT RELIABLE** — the CDP tab-drive through `window.api` failed in this run (0/3 tabs confirmed opened); the +14 MB is noise, not a tab measurement. Recorded as NOT_MEASURED honestly. |

## 4. Not measured (honest gaps)

- **Cold startup after reboot** — requires a reboot; not performed.
- **CPU idle / CPU under WebGL, 5/10-tab RAM, FPS** — out of this session's time budget; the harness (`scripts/bench-tauri-vs-electron.mjs`, `scripts/bench-electron-fix.mjs`) is committed and re-runnable.
- **Installer-on-clean-Windows** (no WebView2) — the NSIS installer uses downloadBootstrapper; unverified on a WebView2-less machine.

## Raw data

```json
{ "tauri":   { "startupMsWarm": [584,589,583], "ramIdleTreeMb": 930.6, "ramIdleEnginesMb": 421.6,
               "ramIdleHostMb": 509.0, "ram3TabsTreeMb": 985.0, "ram3TabsHostMb": 563.4 },
  "electron":{ "startupMsWarm": [280,262,269], "rootPid": 25288, "ramIdleTreeMb": 841.0,
               "ramEnginesMb": 147.1, "ramIdleHostMb": 693.9, "ram3TabsTreeMb": 855.1,
               "ram3TabsHostMb": 708.0, "tabsDriveOk": 0 } }
```

(A first benchmark pass had a broken Electron root-pid selection — 51.6 MB
impossible values; fixed by selecting the process whose parent is not itself
a PersonalAgenticBrowser process, then re-measured. Broken pass discarded.)
