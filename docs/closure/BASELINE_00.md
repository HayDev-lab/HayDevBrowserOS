# BASELINE 00 — восстановленные факты (2026-10-09, run 20261009-0625-r00)

Read-only baseline поверх HEAD `55f1755` + незакоммиченные изменения пользователя (163 записи). Все находки аудита `PRODUCT_AUDIT_JARVIS_INTEGRATIONS_2026-10-09.md` перепроверены по текущему коду. Fingerprint тестируемого набора: `952123cbdf3eff318ba6386ea8419809410529f8cf78341e15a34829d575a330` (dirty source, см. run-manifest).

## 1. Команды и границы

- `start` → `dev:tauri` (`tauri dev`); сборка — `npm run build:tauri` (`tauri build`), target NSIS.
- `beforeBuildCommand`: `build:internal-pages` (TS-билдеры из `src/main` через esbuild → `.vite/build/internal/*.html`) + `build:vite` (renderer). **`bundle:runtimes` в beforeBuildCommand НЕ входит** — `resources/runtimes` (node/searxng/perplexica/tor, gitignored, локально присутствуют) должны быть подготовлены отдельно (подтверждено: `tauri.conf.json`).
- Границы: renderer chrome = единственный webview с `invoke` (capabilities); tab webviews — ноль Tauri IPC, только pab:// API с атрибуцией по Referer (`attachments.rs::BRIDGE_INIT_SCRIPT`, `pab.rs`).
- Sidecars: `runtime_manager.rs` управляет Perplexica/SearXNG/Tor из `resources/runtimes`; sweep orphans при старте, tree-kill при выходе; маркер `*<product>*resources\runtimes*`.
- Electron остаётся dev-зависимостью (package.json:44 `electron ^44.3.0`); `src/main` используется билдером внутренних страниц — удалять нельзя.
- CI: `.github/workflows/app-ci.yml` (untracked) — только JS typecheck/lint/test на Ubuntu. Rust/Windows/NSIS в CI нет.

## 2. Перепроверка находок аудита — все подтверждены в текущем коде

| ID | Находка | Текущее доказательство | Статус |
|---|---|---|---|
| A | Private: `additional_browser_args(PRIVACY_ARGS)` затем `proxy_url()` — wry 0.55.1 применяет proxy только в `unwrap_or_else`-ветке (webview2/mod.rs:294-322) → прокси молча теряется | `core.rs:265` + `core.rs:274`; DarkWeb и Agent используют явный `--proxy-server` в args (`core.rs:312-315,336-340`) | ПОДТВЕРЖДЕНА, не исправлена |
| B1 | UI шлёт `{input}`, Rust принимает `req` (vault_save/has/generate) | `tauri.ts:65-68` vs `commands.rs:826,840,852` | ПОДТВЕРЖДЕНА |
| B2 | `vault_fill` игнорирует `{tabId,domain}` из UI, берёт `input.id` и АКТИВНУЮ вкладку | `tauri.ts:69` + `vault-store.ts:91` vs `commands.rs:869-895` | ПОДТВЕРЖДЕНА |
| B3 | Домен: `page_url.contains(&record.domain)` | `commands.rs:903` | ПОДТВЕРЖДЕНА |
| B4 | Capture: registrable domain = последние 2 метки (`example.co.uk→co.uk`) | `vault_capture.rs:85-90` | ПОДТВЕРЖДЕНА |
| B5 | Генератор пароля: xorshift от SystemTime; plaintext возвращается в поле `generated` | `commands.rs:807-823,860` | ПОДТВЕРЖДЕНА |
| C | Research tools = `web_fetch`+`finish`; search-tool нет; report всегда `claims/conflicts/unknowns: []` | `agent.rs:247-255`, `agent.rs:896-905` | ПОДТВЕРЖДЕНА |
| D | `chat_once` блокирующий (ureq, 120s), stop-флаг проверяется только между шагами; streaming нет | `agent.rs:493-545`, `agent.rs:676` | ПОДТВЕРЖДЕНА |
| E1 | CDP всегда включён в production: chrome `--remote-debugging-port + --remote-allow-origins=*` | `lib.rs:229`, `core.rs:329` (tab env), `core.rs:130-146` (порты 9330/9220) | ПОДТВЕРЖДЕНА |
| E2 | MCP: loopback, но без auth/Host/Origin/лимитов concurrency | `mcp.rs:31-54,136-184` | ПОДТВЕРЖДЕНА |
| E3 | `web_fetch` без SSRF-защиты (http(s)-prefix only; локальные/metadata IP доступны; редиректы ureq не проверяются) | `agent.rs:385-430` | ПОДТВЕРЖДЕНА |
| F1 | Download cancel всегда `DOWNLOAD_CANCEL_UNSUPPORTED` | `commands.rs:547-554` | ПОДТВЕРЖДЕНА |
| F2 | AgentPanel `agent_run` не передаёт attachmentIds (`images: Vec::new()`); newtab research путь передаёт | `commands.rs:624` vs `pab.rs:433-540` | ПОДТВЕРЖДЕНА |
| F3 | PDF/DOCX разрешены в picker, но не извлекаются (только text-like + images) | `attachments.rs:140-151,157-204,325-337` | ПОДТВЕРЖДЕНА |
| F4 | `setLocale` — no-op; выбранный язык не доходит до внутренних страниц | `tauri.ts:88-90` | ПОДТВЕРЖДЕНА (пользователем начата i18n: untracked `src/renderer/src/i18n/`, `src/shared/app-locale.ts`; канал `ui:setLocale` в Rust не найден) |
| F5 | Agent-profile: enum есть, в создании вкладки не выбирается | `core.rs:237-243` (только Private/DarkWeb/Default) | ПОДТВЕРЖДЕНА |
| F6 | MCP parity: 8 darkweb tools в Rust vs 22 в старом TS registry; MCP-клиента нет | `mcp.rs:190-259` | ПОДТВЕРЖДЕНА |
| G | CI без Rust/Windows; runtimes вне beforeBuildCommand | `app-ci.yml`, `tauri.conf.json:10-13` | ПОДТВЕРЖДЕНА |

## 3. Интеграции каталога — факт

- **Playwright: ОТСУТСТВУЕТ** (нет в package.json, нет в src). Подключение — работа PROMPT 01.
- **Camofox, Agent-Reach: ОТСУТСТВУЮТ**. Не упоминать как существующие.

## 4. Feature inventory (capability → UI → command → native → data → тест → статус)

| Capability | UI entry | Command/API | Native | Persisted | Тест | Статус |
|---|---|---|---|---|---|---|
| Вкладки/навигация | TabStrip/CommandBar | browser_tabs_* / browser_navigate… | core.rs (child webviews, registry) | session JSON | platform.test, tab-manager.test | работает, нет свежего native E2E |
| History/Bookmarks | panels | browser_history_*/bookmarks_* | stores.rs | history/bookmarks JSON | history-store.test | работает |
| Session restore | автозапуск | — | core.rs bootstrap/persist | session JSON | session-store.test (TS) | private/darkweb исключены; crash-restore не проверен live |
| Agent run/stop/status | AgentPanel | agent_run/stop/status/timeline | agent.rs (ureq loop) | in-memory timeline | agent-*.test (TS, fake) | контракты в fake; native отмена HTTP не реализована (D) |
| Deep Research | pab://newtab+search chip | pab API /api/research/run | pab.rs→agent.rs DEEP_RESEARCH | in-memory report | research-*.test (TS) | нет search-tool, отчёт без claims (C) |
| Attachments | newtab/picker | pab API /api/attachment/*; agent_pick_attachment | attachments.rs | in-memory registry TTL 30m | attachments-*.test | text+images; PDF/DOCX не читаются (F3); AgentPanel путь не передаёт (F2) |
| Vault | VaultPanel/PasswordPrompt | vault_save/has/list/generate/fill/delete/prompt_* | vault.rs (DPAPI) + vault_capture.rs | credentials.vault | credential-vault.test, vault-security.test | IPC-контракт сломан UI→Rust (B1/B2), домен/RNG (B3-B5) |
| Memory | MemoryPrompt | memory_prompt_*; agent tool memory.save | memory.rs | memory JSON | memory-store.test | работает, propose-only |
| Control HUMAN/AGENT | ControlModule | control_set_mode/take_control/get_mode | control.rs | in-memory | control-authorization.test | takeover latch есть; stop не прерывает HTTP (D) |
| Downloads | DownloadsPanel | browser_downloads_list/cancel/remove | core.rs (WebView2 download bridge) + downloads.rs (quarantine) | in-memory registry | download-state-machine.test | cancel = UNSUPPORTED (F1) |
| Search UI | pab://search | pab:// страницы + runtime_manager | runtime_manager.rs (Perplexica/SearXNG) | — | search-*.test | live-доступность не проверена |
| DarkWeb | pab://darkweb | pab API + MCP 8 tools | darkweb.rs, socks_http.rs, crawl.rs | darkweb/ JSON + index | darkweb-*.test | Tor fail-closed у вкладок; MCP без auth (E2) |
| Privacy/Egress | privacy.json | resolve_egress | privacy.rs, privacy_init.rs | privacy.json | privacy tests (Rust) | Private-прокси теряется (A); TorStrict есть; Direct/TorIfAvailable/TorStrict/Socks5 разделены |
| Locale | titlebar pill | renderer i18n (untracked) | setLocale no-op | localStorage | — | HY/RU/EN в chrome частично; внутренние страницы EN (F4) |
| MCP server | внешний порт 27301 | /mcp JSON-RPC | mcp.rs | — | darkweb-mcp.test (TS) | 8 tools, без auth (E2/F6) |
| Runtime diagnostics | runtime manager UI | runtime_manager_status/start/stop | runtime_manager.rs | — | runtime-engine.test | sweep/kill реализованы |

Пути AgentPanel и newtab research — РАЗНЫЕ: AgentPanel → `invoke('agent_run')` (без attachments), newtab → `fetch('/api/research/run')` (с attachments + auto-escalation HUMAN→AGENT, `pab.rs:462-480`, решение 2026-10-03).

## 5. Точки изменения (для этапов 02–08)

1. `core.rs` Private-ветка: заменить `proxy_url` на явный `--proxy-server` в args (паттерн DarkWeb). 
2. `commands.rs` vault: унифицировать имена аргументов (`req`), fill по tabId+origin, hostname-match, CSPRNG (`getrandom`/`ring`), не возвращать plaintext.
3. `vault_capture.rs`: registrable domain через PSL-подход (известные multi-part суффиксы) или консервативный full-host.
4. `agent.rs`: search-tool через локальные SearXNG/Perplexica API; SSRF-guard для web_fetch (запрет private/loopback/metadata, проверка редиректов); отмена через `ureq` timeout + abrupt drop / отдельный поток с каналом; streaming по поддерживаемым провайдерам; report claims/conflicts из ledger.
5. `lib.rs`/`core.rs`: CDP-порты только в test-mode (env-гейт), production без `--remote-allow-origins=*`.
6. `mcp.rs`: Host/Origin проверка, токен сессии, лимиты.
7. `commands.rs:547` downloads cancel — compat probe WebView2 download API.
8. `tauri.ts` + i18n: `ui:setLocale` канал → Rust → pab builder locale.
9. `attachments.rs`: PDF/DOCX extraction (изолированный worker, PROMPT 08).
10. CI/сборка: Windows/Rust job; `bundle:runtimes` в beforeBuildCommand или явный preflight.

## 6. Безопасные проверки (свежие, этот run)

| Проверка | Результат |
|---|---|
| typecheck:node / web / test | PASS / PASS / PASS |
| eslint (src/**) | PASS (0 ошибок) |
| Vitest (live-переключатели off) | 1192 passed / 5 skipped / 0 failed (69 файлов passed, 4 skipped) |
| cargo test --offline --lib | 99 passed / 0 failed |

Историческое «1192 JS / 99 Rust passed» совпало с текущим прогоном, но принято как свежий результат этого run, не как перенос старого PASS.
