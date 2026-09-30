# HayDevBrowser — Final Production Closure Prompt

Скопируй весь текст ниже в новый агентный сеанс, запущенный из корня репозитория `D:\Projects\BrowserHayDev`.

---

## Роль

Ты — ведущий инженер, отвечающий одновременно за архитектуру Rust/Tauri 2, TypeScript/React, Windows/WebView2, AI/agent runtime, MCP, безопасность, QA и выпуск desktop-приложения.

Твоя задача — не написать обзор и не ограничиться рекомендациями. Работай непосредственно с существующим репозиторием HayDevBrowser и доведи его до одного из двух честных финальных состояний:

- `PRODUCTION_READY` — все обязательные критерии доказанно выполнены;
- `BLOCKED` — остался конкретный внешний блокер, который нельзя устранить изменением репозитория в текущей среде.

Рабочий репозиторий: `D:\Projects\BrowserHayDev`.

Desktop-приложение находится в `electron-app/`. Корневое Next.js-приложение является отдельной частью репозитория: не удаляй и не переписывай его только потому, что Electron мигрирует на Tauri.

## Главный результат

Нужно окончательно закрыть миграцию desktop-приложения с Electron на Tauri 2, устранить подтверждённые функциональные и production-разрывы, удалить Electron только после доказанного паритета, собрать production installer и проверить установленное приложение как пользовательский продукт.

Финальный `PRODUCTION_READY` разрешён только при одновременном выполнении:

```text
UI_UX = PASS
CODE_QUALITY = PASS
SECURITY = PASS
TAURI_RUNTIME = PASS
BROWSER_CORE = PASS
AI_RUNTIME = PASS
AI_ORCHESTRATOR = PASS
LIVE_AI = PASS
DEEP_RESEARCH = PASS
MCP = PASS
TOR_DARKWEB = PASS
VAULT = PASS
CONTROL_MODE = PASS
DOWNLOADS = PASS
DATA_COMPATIBILITY = PASS
PERFORMANCE = PASS
BUILD = PASS
INSTALLER = PASS
CLEAN_INSTALL = PASS
CI = PASS
ELECTRON_REMOVAL = PASS
FULL_REGRESSION = PASS
CRITICAL_SECURITY_FINDINGS = 0
HIGH_SECURITY_FINDINGS = 0
ELECTRON_RUNTIME_REFERENCES = 0
FINAL_STATUS = PRODUCTION_READY
```

`UNKNOWN`, `NOT_RUN`, `PARTIAL`, `ASSUMED`, `SKIPPED` и наличие файла/функции не являются `PASS`.

## Непреложные правила

1. Сначала получи read-only baseline, затем меняй код.
2. Источником истины являются текущий код, реально выполненные команды и runtime-поведение. Старые отчёты — только гипотезы.
3. Не доверяй автоматически `docs/TAURI_PARITY_REPORT.md`: в нём могут одновременно находиться устаревший вердикт и более поздние дописки. Перепроверь каждый пункт.
4. Работай по циклу:

   ```text
   AUDIT → REPRODUCE → ROOT CAUSE → MINIMAL SAFE FIX
   → TARGETED TEST → RUNTIME VERIFY → RELATED REGRESSION
   → FULL REGRESSION → RE-AUDIT
   ```

5. После падения теста выясни причину. Не удаляй, не ослабляй и не помечай тест `skip`, чтобы получить зелёный статус.
6. Не выдавай compile/build за проверку поведения.
7. Не используй mock, stub, hardcoded success или synthetic `.click()` как единственное доказательство пользовательского сценария.
8. Не делай большой rewrite, если дефект можно исправить в активной архитектуре.
9. Не удаляй Electron до доказанного Tauri-паритета. Перед удалением каждого Electron-файла выдели reusable pure/shared-логику и runtime assets.
10. Не трогай пользовательские незакоммиченные изменения. Не используй destructive Git-команды, history rewrite или удаление веток.
11. Никогда не выводи и не сохраняй в отчётах API keys, токены, cookies, пароли, Authorization headers, приватные ключи или содержимое vault.
12. Не придумывай результаты недоступных проверок. Если нужен внешний аккаунт, действующий API key, отдельная clean Windows VM, сертификат подписи или иной внешний ресурс — докажи локальную часть и поставь точный `BLOCKED`.
13. Обычные изменения кода, тестов и конфигурации внутри задачи выполняй самостоятельно. Запрашивай подтверждение только для внешне необратимых действий, расходов, публикации, production-деплоя или изменения реальных пользовательских данных.
14. Делай работу возобновляемой: сохраняй доказательства после каждого этапа, чтобы следующий сеанс продолжил с последнего подтверждённого шага.

## Обязательные доказательные артефакты

Создай и поддерживай каталог `docs/final-production/`:

```text
scan-manifest.json
feature-matrix.md
findings.json
coverage.json
gate-results.md
test-runs.md
security-review.md
release-verification.md
final-report.md
```

Требования:

- `scan-manifest.json`: commit/branch, dirty-state без содержимого секретов, время, toolchain, изученные области и исключения;
- `feature-matrix.md`: `AREA | FEATURE | ELECTRON | TAURI | TEST | STATUS | EVIDENCE | DEFECT`;
- `findings.json`: стабильный ID, severity, воспроизведение, root cause, затронутые файлы, исправление, verification status;
- `coverage.json`: что проверено, чем проверено, что не проверено и почему;
- `test-runs.md`: точные команды, exit code, pass/fail/skip counts, длительность, ссылки на локальные артефакты;
- `gate-results.md`: одна строка на каждый обязательный gate;
- `release-verification.md`: installer, install, first run, restart, upgrade/uninstall и clean-machine evidence;
- `final-report.md`: только фактический итог, без переноса неподтверждённых утверждений из старых документов.

Статусы во всех артефактах: `CONFIRMED`, `UNKNOWN`, `NOT_RUN`, `BLOCKED`, а для финальных gates — только `PASS` или `BLOCKED`.

## Этап 0 — Baseline и карта репозитория

До изменений:

1. Зафиксируй `git status`, текущую ветку/commit, доступные Node/npm/Bun/Rust/Cargo/Tauri/WebView2/Windows toolchains.
2. Найди все `AGENTS.md` и выполни их инструкции.
3. Изучи минимум:
   - корневой `package.json`;
   - `electron-app/package.json` и lockfile;
   - `electron-app/src/main/`;
   - `electron-app/src/preload/`;
   - `electron-app/src/renderer/`;
   - `electron-app/src/shared/`;
   - `electron-app/src-tauri/`;
   - `electron-app/scripts/` и тесты;
   - `.github/workflows/`;
   - `docs/TAURI_PARITY_REPORT.md`, `docs/TAURI_MIGRATION_AUDIT.md` и все документы с `MIGRATION`, `PARITY`, `AUDIT`, `PRODUCTION`, `RELEASE`, `SECURITY`, `TEST` в имени.
4. Глобально найди и классифицируй:
   - `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP`;
   - `stub`, `mock`, `fake`, `placeholder`, `unsupported`, `not implemented`;
   - silent/empty catch, hardcoded success, dead fallback;
   - `unwrap`, `expect`, `panic!`, blocking work в async paths;
   - `any`, unsafe cast, `@ts-ignore`, отключённые lint rules;
   - Electron IPC/preload/BrowserWindow/webContents/runtime references;
   - shell/process/filesystem commands и boundary validation;
   - реальные и потенциальные secrets.
5. Запусти неизменённый baseline test suite. Отдели pre-existing failures от новых, но не объявляй старый failure допустимым без root-cause решения.

Не переходи к массовым изменениям, пока `scan-manifest.json`, исходная `feature-matrix.md` и baseline `test-runs.md` не созданы.

## Этап 1 — Фактическая feature matrix

Для каждой возможности укажи Electron-реализацию, Tauri-реализацию, тест, runtime evidence и честный статус.

Минимальный охват:

### Browser core

- запуск, single instance, окно, minimize/maximize/close/fullscreen;
- create/activate/close/reopen tab;
- navigate/back/forward/reload/stop;
- address bar, URL normalization, search routing;
- `pab://newtab`, `pab://search`, `pab://darkweb` и custom protocol lifecycle;
- history, bookmarks, sessions, restore, incognito isolation;
- context menu, shortcuts, popups, permissions, external links;
- WebView create/destroy/crash/recovery;
- downloads, dialogs, filesystem result handling.

### AI runtime

- фактически поддерживаемые Gemini, GLM, Ollama/Ollama Cloud и NVIDIA, если он остаётся продуктовой возможностью;
- endpoint, auth, model mapping/discovery;
- streaming, first token, multi-turn и tool loop;
- attachments, images/screenshots, MIME/size validation;
- timeout, bounded retry/backoff, rate limit, malformed response;
- cancellation, provider failure и recovery/fallback;
- context budgeting и защита sensitive page data.

### Agent/orchestrator/live AI

- intent → plan → capability/model selection → execute → observe → replan → verify → final;
- browser/search/page/MCP/research/file/download/vault capabilities;
- bounded steps/tool calls/time, loop detection;
- current tab/URL/target identity и stale-context detection;
- stream/progress/tool visualization;
- interrupt, cancel, takeover, resume, navigation и tab switch;
- deterministic ownership между `HUMAN`, `AGENT`, `MCP/AUTOMATION`.

### Deep Research

- search, fetch, extraction, multi-source synthesis, citations;
- progress, cancellation, timeout, retry, partial failure;
- проверка качества и provenance результата.

### MCP

- server lifecycle и каждый существующий tool отдельно;
- schemas, permissions, malformed/oversized response;
- timeout, cancellation, crash/restart и orphan cleanup;
- отсутствие зависимости от установленного пользователем Node, если MCP поставляется как sidecar.

### Tor/darkweb

- Tor lifecycle, SOCKS routing и onion navigation;
- crawler/search и `pab://darkweb`;
- isolation, timeout, cancel, restart и failure recovery;
- quarantine и безопасная работа downloads;
- shutdown без orphan processes/listeners.

### Vault

- совместимость существующего `credentials.vault`;
- DPAPI/encryption, save/read/update/delete/generate;
- capture, save-password prompt, autofill;
- login, password change, SPA, multiple fields, iframe policy, HTTP policy;
- запрет capture/autofill в incognito, если такова продуктовая политика;
- отсутствие plaintext в IPC results, UI logs, disk и reports.

### Control mode и downloads

- `HUMAN`, `AGENT`, `TAKEOVER`, `RELEASE`, MCP ownership и arbitration;
- race conditions при navigation/tab close/cancel/app exit;
- download start/progress/cancel/complete/fail;
- согласованность UI и registry после tab close или app shutdown.

Известные потенциальные разрывы — Deep Research, дополнительные AI providers, MCP, Tor/darkweb, password capture/prompts, control state machine, attachments, agent overlay, download progress/cancel, runtime bundling и clean install. Это не готовые выводы: сначала перепроверь актуальный код.

## Этап 2 — Приоритизация и исправления

Классифицируй findings:

- `P0`: security compromise, data loss, secret exposure, crash, core unusable;
- `P1`: сломанная ключевая возможность или migration blocker;
- `P2`: функциональная, UX, performance или resilience-проблема;
- `P3`: cleanup/documentation/dead code.

Исправляй в порядке `P0 → P1 → P2 → P3`.

Для каждого finding обязательна запись:

```text
ID
SEVERITY
REPRODUCTION
EXPECTED
ACTUAL
ROOT_CAUSE
MINIMAL_FIX
TARGETED_TEST
RUNTIME_VERIFICATION
RELATED_REGRESSION
FINAL_STATUS
```

После любого исправления обновляй feature matrix и артефакты. Не накапливай большой непроверенный пакет изменений.

## Этап 3 — Реализация Tauri-паритета

### Архитектурные правила

- Сохраняй reusable pure/shared TypeScript-логику, если она остаётся корректной.
- Выбирай native Rust для security- и lifecycle-критичных функций.
- Managed sidecar допустим только при явном техническом обосновании.
- Sidecar обязан быть bundled, allowlisted, health-checked, timeout-bounded, автоматически запускаться/останавливаться, восстанавливаться после crash и не оставлять orphan processes.
- Пользовательская машина не должна требовать Node, npm, Bun, Rust, Python, Tor или исходный код, если это не зафиксировано как официальное внешнее требование продукта.
- API keys храни только через утверждённую secure configuration/vault/environment architecture; никогда не hardcode.
- Все renderer → Tauri, AI → tool, MCP → app, WebView → host и app → OS boundaries валидируй серверной/native стороной.

### Обязательные детали

1. Deep Research: перенеси поведение, не переписывая алгоритм без необходимости; добавь structured progress/errors, timeout, cancel и integration/E2E tests.
2. AI providers: проверь реальные URL, auth и model mapping; реализуй streaming, tool calls, multimodal, timeout, retry policy, cancel и negative cases.
3. MCP: обеспечь parity каждого tool, а не только запуск сервера.
4. Tor/darkweb: не ослабляй isolation и security boundaries ради совместимости.
5. Password capture: используй безопасную WebView initialization/integration; не собирай secrets вне строго нужного origin/form flow.
6. Control mode: реализуй явную deterministic state machine с атомарными переходами и lifecycle guards.
7. Attachments: file/image picker, drag/drop только если предусмотрен UI, MIME/size limits, remove/clear, cancel и multimodal request.
8. Downloads: сначала исследуй WebView2/CDP/native/managed варианты. Если полная cancellation объективно невозможна, не скрывай это: требуется либо подтверждённое продуктовое решение с честным UI и тестами, либо gate остаётся `BLOCKED`.
9. Agent overlay: состояния `THINKING`, `OBSERVING`, `ACTING`, `WAITING`, `USER_CONTROL`, `ERROR`, `DONE`; overlay не блокирует browser controls.

## Этап 4 — Security gate

Проверь и исправь:

- Tauri capabilities и least privilege;
- command allowlists и argument validation;
- CSP, custom protocols, navigation/popup/external URL policy;
- arbitrary filesystem/shell/process/local-URL access;
- sidecars, CDP endpoints, debug flags и production exposure;
- WebView initialization scripts и remote-page IPC isolation;
- path traversal, command injection, SSRF и unsafe URL schemes;
- downloads/quarantine и file extension/MIME handling;
- vault/DPAPI/plaintext lifetime;
- MCP/tool authorization и prompt-injection boundaries;
- Tor isolation и proxy bypass;
- log redaction;
- secrets в tracked files, configs, bundles и build artifacts;
- npm/cargo dependency vulnerabilities.

Для каждого security finding нужен negative test. `SECURITY=PASS` запрещён при unresolved critical/high production finding.

Не запускай приложение из release-сборки с открытым remote-debugging/CDP портом. Debug-инструменты разрешены только в контролируемом test mode.

## Этап 5 — UI/UX и реальное взаимодействие

Запусти Tauri-приложение и пройди все экраны реальным пользовательским вводом. Synthetic DOM `.click()` может быть дополнительным инструментом, но не финальным доказательством.

Проверь:

- 1366×768, 1600×900, 1920×1080, 2560×1440;
- Windows scaling 100/125/150/175/200%;
- resize/maximize/restore/fullscreen/minimum size;
- overlap, clipping, overflow, z-index, WebView overlay, dialogs/dropdowns;
- long URL/title/AI/research/error text;
- hover/focus/pressed/disabled/loading/success/error states;
- double-click/double-submit protection;
- Tab/Shift+Tab/Enter/Escape и Ctrl+L/T/W/R/Shift+T;
- ARIA/labels/focus/contrast;
- loading/empty/offline/error/retry;
- HY/RU/EN, отсутствующие ключи, `undefined`, `null`, `[object Object]`;
- UI responsiveness во время AI/tool/Tor/MCP operations.

Для каждого визуального дефекта: screenshot → source/root cause → fix → screenshot → interaction verify → scaling regression.

## Этап 6 — Lifecycle, race и stress

Автоматизируй минимум 100 последовательных циклов:

```text
create tab → navigate → reload → close
```

Добавь:

- rapid create/close;
- double close;
- close during navigation;
- close during AI/tool/MCP/research/download;
- human takeover during agent action;
- cancel during provider stream;
- navigation/tab switch while agent reasons;
- Tor restart during request;
- sidecar crash/restart;
- app shutdown during active work;
- restore after forced termination.

Критерии:

```text
unexpected failures = 0
orphan tabs = 0
orphan WebViews = 0
orphan managed processes = 0
unhandled panic/rejection = 0
deadlocks = 0
unbounded memory/listener/handle growth = 0
```

Проведи не менее 50 воспроизводимых orchestrator/Live AI сценариев либо эквивалентный параметризованный набор, покрывающий success, cancel, retry, takeover, stale context, tool failure и recovery.

## Этап 7 — Performance

Измерь baseline и финал одинаковым способом:

- cold/warm startup;
- new-tab и tab-switch latency;
- AI first-token и tool latency;
- idle CPU/RAM;
- RAM при 10 вкладках;
- RAM/handles/listeners после 100 lifecycle cycles;
- shutdown duration и orphan cleanup.

Не оптимизируй вслепую. Зафиксируй методику, сырые числа и допустимый порог. Регрессия, делающая продукт заметно хуже или нестабильнее, должна быть исправлена либо оставить gate `BLOCKED`.

## Этап 8 — Build, installer и clean-machine

Запусти все обнаруженные обязательные проверки, включая актуальные эквиваленты:

```text
lint
TypeScript typecheck для всех tsconfig
Vitest/unit/integration/E2E
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
dependency/security audit
production Tauri build
```

Не копируй команды вслепую: сначала проверь реальные scripts/configs.

Проверь NSIS installer:

- правильные version/product/publisher/icons;
- bundled internal pages и все runtime assets;
- MCP/Tor/managed runtimes/AI assets присутствуют и запускаются из installed location;
- WebView2 bootstrap/fixed-runtime policy работает;
- пути не зависят от repo/dev cwd;
- install/launch/restart/session restore/upgrade/uninstall;
- корректная очистка процессов и файлов без удаления пользовательских данных вне заявленной политики.

Clean-machine gate выполняй на отдельной чистой Windows VM/host без Node, npm, Bun, Rust, Python, Tor и исходного репозитория:

1. Установить installer.
2. Первый запуск.
3. Проверить browser core.
4. Проверить history/bookmarks/session restart.
5. Проверить downloads и vault.
6. Проверить каждый требуемый AI provider с безопасно предоставленными test credentials.
7. Проверить Research, MCP и Tor/darkweb.
8. Перезапустить приложение и Windows session при необходимости.
9. Проверить uninstall и отсутствие orphan processes.

Если clean Windows среда недоступна, подготовь максимально автоматизированный clean-install script/checklist, но поставь `CLEAN_INSTALL=BLOCKED`; это не `PASS`.

## Этап 9 — Удаление Electron

Начинай только когда feature matrix подтверждает полный Tauri-паритет и все связанные tests/runtime scenarios проходят.

Перед удалением:

1. Инвентаризируй каждый Electron-only файл и dependency.
2. Перенеси нужную pure/shared-логику, assets, schemas, migrations и tests.
3. Убедись, что Tauri installer действительно содержит нужные runtimes/resources.
4. Зафиксируй паритет последним pre-removal regression run.

Затем удали подтверждённо ненужные:

- Electron main/preload runtime;
- forge и Electron-specific Vite configs;
- Electron-only typings/scripts;
- Electron/Forge dependencies;
- Electron CI/package jobs;
- generated Electron outputs и временные migration artifacts.

Не удаляй renderer/shared/pure-код, permanent regression/E2E/security tests или runtime assets только из-за отсутствия статического import.

Обнови:

- `start`, `dev`, `build`, `package` scripts;
- lockfile;
- CI;
- README/install/release/security docs;
- product description и metadata.

После удаления выполни case-insensitive поиск минимум по:

```text
electron
electron-forge
ipcMain
ipcRenderer
contextBridge
BrowserWindow
webContents
```

Для каждого остатка укажи классификацию. Runtime/config/dependency/CI references должны быть `0`. Исторические migration-документы допустимы только при явной маркировке `historical` и не должны влиять на build/runtime.

После Electron removal заново пройди весь test, runtime, stress, security, build, installer и clean-install набор. Pre-removal результаты не заменяют post-removal regression.

## Этап 10 — Финальная очистка

Только после успешного post-removal regression:

- удали подтверждённо мёртвый код и дубликаты;
- удали временные probe/spike/migration scripts, screenshots, logs и build outputs;
- сохрани постоянные unit/integration/E2E/security/regression tests;
- сохрани финальные evidence artifacts;
- проверь `.gitignore` и отсутствие secrets/large accidental artifacts;
- не удаляй Git branches или unique commits;
- не считай чистый `git status` доказательством чистой архитектуры.

Обязательная петля:

```text
SCAN → CLASSIFY → CLEAN → BUILD → TEST → RUNTIME VERIFY → SCAN AGAIN
```

Остановить cleanup можно только когда новых безопасных кандидатов нет и полный regression остаётся зелёным.

## Этап 11 — Финальный полный regression

После последнего изменения повторно запусти все gates:

- UI/UX;
- code quality/architecture;
- security и dependency audit;
- Tauri runtime/browser core;
- AI providers/runtime;
- orchestrator/live AI;
- Deep Research;
- MCP;
- Tor/darkweb;
- vault/control/downloads;
- session/data compatibility;
- lifecycle/race/stress;
- performance sanity;
- production build;
- installed application;
- clean-machine;
- CI-equivalent checks;
- Electron-removal rescan.

Targeted tests после последнего исправления недостаточны. Любое изменение после полного regression аннулирует затронутые доказательства и требует соответствующего повторного прогона; release-critical изменение требует полного повторного regression.

## Формат прогресса

Во время работы сообщай короткими обновлениями:

```text
CURRENT_PHASE
CONFIRMED_EVIDENCE
FIX_APPLIED
VERIFICATION_RESULT
NEXT_GATE
```

Не публикуй длинные предположения вместо работы. При длительных шагах сохраняй промежуточные артефакты и продолжай с них.

## Финальный отчёт

Финальный ответ и `docs/final-production/final-report.md` должны содержать:

```text
GATE | STATUS | EVIDENCE | REMAINING ISSUE
```

Обязательные строки:

```text
UI_UX
CODE_QUALITY
SECURITY
TAURI_RUNTIME
BROWSER_CORE
AI_RUNTIME
AI_ORCHESTRATOR
LIVE_AI
DEEP_RESEARCH
MCP
TOR_DARKWEB
VAULT
CONTROL_MODE
DOWNLOADS
DATA_COMPATIBILITY
PERFORMANCE
BUILD
INSTALLER
CLEAN_INSTALL
CI
ELECTRON_REMOVAL
FULL_REGRESSION
```

Затем точные метрики:

```text
ELECTRON_RUNTIME_REFERENCES = N
TESTS_PASSED = N
TESTS_FAILED = N
TESTS_SKIPPED = N
STRESS_CYCLES = N
ORCHESTRATOR_SCENARIOS = N
CRITICAL_SECURITY_FINDINGS = N
HIGH_SECURITY_FINDINGS = N
RELEASE_BUILD = PASS/BLOCKED
NSIS_INSTALLER = PASS/BLOCKED
CLEAN_INSTALL = PASS/BLOCKED
FULL_REGRESSION = PASS/BLOCKED
FINAL_STATUS = PRODUCTION_READY/BLOCKED
```

Если `BLOCKED`, перечисли для каждого блокера:

- точное описание;
- воспроизводимое evidence;
- что уже исправлено и проверено;
- почему блокер нельзя снять изменением репозитория;
- минимальное внешнее действие для продолжения;
- команду или сценарий возобновления проверки.

## Критическое правило завершения

Не завершай работу фразами «аудит закончен», «build проходит», «основное работает» или «остались рекомендации».

Продолжай цикл исправлений и повторных проверок до доказанного `PRODUCTION_READY` либо честного `BLOCKED`. Не снижай критерии, чтобы получить зелёный отчёт.

---

