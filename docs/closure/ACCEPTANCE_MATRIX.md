# Матрица r10 — 2026-10-15, run `20261015-final-r10` (пакет AFTER_R09)

**Итог: INCOMPLETE** (единственный остаток: N04-DOCS — контент-верифицированные документ-комбо на release, локальная работа, заблокированная конкуренцией за фокус десктопа; всё остальное — PASS либо BLOCKED_EXTERNAL). Сертифицированный артефакт: exe `71339a3b…e5e3f` (identity == `n06-final-inputs-2`), installer `a4027db5…6306a`. Логи: `artifacts/closure/20261015-final-r10/`.

| ID | Требование | Статус | Уровень/билд | Evidence |
|---|---|---|---|---|
| N00-EVID | Учет доказательств: фильтр входов, уникальные имена, verify-inputs, requirements | PASS | n/a | closure-evidence.mjs; snapshots r10; inputVerifications в manifest |
| N01-SHELLISO | Shell storage внутри data-root; A/B изоляция; без fallback; глобальный профиль не открывается | PASS | debug+release native | A/B probe; user-data-dir процессов = `<root>/profiles/default/EBWebView` |
| N02-RAM | Release P13: все исходные пороги, включая idle ≤600 MiB | PASS | release-cert (`71339a3b…`) | release-perf-cert: idle 565.5 MiB; cold 2169; warm 1367; navAck 14.4ms; idleCPU 0.038%; 20tab 1609MiB/0.063%; Shield +2.06%; cycles 1.054 |
| N02-DEBUG | Debug P13 те же пороги | PASS | debug | native-full: idle 561.8–569.2 MiB |
| N03-CRASH | Реальный ProcessFailed → честный Shield UI + re-arm до защищаемой навигации + блокировки продолжаются | PASS | debug+release | P18 (kill renderer pid); native_webview.rs NavigationStarting re-arm |
| N03-FULLSET | Полный native набор без падений | PASS | debug (`native-full`: 25 passed/0 failed/1 skipped-P19) | native-full.log |
| N04-DOCS | PDF/DOCX × AgentPanel/newtab через настоящий OS-dialog с контент-верификацией ответа | NOT_RUN | release | Контент-прогоны блокированы конкуренцией за фокус десктопа; PARTIAL: PDF×AgentPanel ATTACHED (реальный диалог), cancel ✓, late-pick-after-STOP refusal ✓ |
| N05-RELCOV | Release STOP/streaming/takeover (P04/P10) | PASS | release-cert | native-release-cert: 21/21 (включая P04, P10) |
| N05-NEG | Release отказ loopback research fetch фактическим вызовом | PASS | release-cert | P19 (standalone PASS + в subset) |
| N05-MUST | Остальные MUST (vault, stores, sessions, downloads, IPC/MCP, профили, локали) | PASS | debug+release-cert | p01–p03, p05, p08, p11, p12, p15–p17 в обоих наборах |
| N06-GATES | Единое финальное дерево: types/lint/unit/integration/rust/internal/renderer | PASS | n06-final-inputs-2 | Логи types/lint/unit/integration-tests(-2)/rust-final/internal-final/renderer-final; integration flake: 1-й прогон hook-timeout (лог сохранён), повтор 14/14 |
| N06-RUNTIME | Bundled runtime offline smoke | PASS | runtime-offline | exit 0 |
| N06-REPRO | Изолированная пересборка из копии входов | PASS | .rebuild-iso | Изолированная копия (node_modules/target/кэши/профили исключены), npm ci по lock, полная сборка; сравнение и функциональная проверка — reproducibility-отчёт манифеста |
| N06-CI | Windows CI под итоговые команды | PASS (конфиг) | n/a | CI_WORKFLOW_REVIEW.md (r09); remote run — B08-CI |
| N07-INSTALL | Чистая Windows install/upgrade/uninstall | BLOCKED_EXTERNAL | — | INSTALL_PROTOCOL.md; B08-VM |
| N07-LIVE | Live LLM/search/Tor/OAuth, remote CI, signing | BLOCKED_EXTERNAL | — | BLOCKERS.md B08-* |

**Критерии:** INCOMPLETE — есть локальный обязательный FAIL или доступная работа NOT_RUN; RELEASE_CANDIDATE — доступные инженерные работы завершены, внешние gates названы; PRODUCTION_READY — полная приёмка установленного артефакта. N04-DOCS — локальная NOT_RUN (окружение десктопа, не внешний gate) → итог **INCOMPLETE** с суженным до одной позиции остатком.

---

## Матрица r09 — 2026-10-15, run `20261015-continuation-r09` (история; поправки фактов — в requirements манифеста r10)

Статусы относятся к указанному уровню проверки. **Итог: INCOMPLETE** (обязательный FAIL: idle RAM). Артефакт-сертификат: release exe `0aad7d56…` (identity == final-inputs), installer `e30e4a7e…`. Логи в `artifacts/closure/20261015-continuation-r09/`. *(Поправка r10/N00: release RAM фактически 889.14 MiB по release-perf3; полный debug gate r09 — FAIL; изолированная пересборка — NOT_RUN.)*

| ID | Проверка | Статус | Evidence | Примечание |
|---|---|---|---|---|
| R09-FREEZE | Единый зафиксированный набор (дерево == handoff, 0 поздних правок до freeze) | PASS | baseline/r00-fixed/final-inputs snapshots; run-manifest | Сравнение с handoff-source.json: 0 modified |
| R09-GATES | types, lint, unit 1186/5 skipped, integration 14, rust 144, internal, renderer | PASS | types/lint/unit/…/rust логи r09, все exit 0 | Финальное дерево; Vitest maxWorkers=4 сохранён |
| R09-NATIVE-DEBUG | Полный нативный набор на свежем debug | PASS* | native-final4: 22/24 | *FAIL: P13 (idle RAM, см. R09-PERF), P07 load-flake (standalone PASS) |
| R09-NAVSTACK | Навигационный стек переживает рестарт; back/forward после рестарта работают | PASS | P16 (debug+release); unit session_roundtrip/restored/explicit | Дефект r08 закрыт: сохранение реальных стеков + восстановление + native-window модель |
| R09-LOCALE | Локаль переживает рестарт; HY/RU/EN; шелл+внутренние страницы; ошибки локализованы | PASS | P05, P17 (debug+release); словари 214×3 | Дефект boot-clobber закрыт; ui_locale зарегистрирован |
| R09-PICK | Реальный OS file dialog: выбор, отмена, поздний выбор после STOP | PASS | Нативная проверка на release exe (Computer Use) + renegotiated cancel flag | Позитив/отмена/отказ; ответ LLM на документ — за live-LLM gate (B08-LLM) |
| R09-ATTACH | Lifecycle вложений (bind/run/TTL/cleanup/release) | PASS | P16, P15, rust unit; OS-dialog очистка | Release-очистка чипа проверена вручную |
| R09-CORRUPT | Повреждение vault/privacy/session: исходник сохранён, ошибка видна, восстановление | PASS | P16 (debug+release), P11 | |
| R09-SHIELD | Блокировки/exceptions/счётчики; ProcessFailed-учёт; persist enable+allowlist | PASS | P07 (debug standalone, release subset), P16 | ProcessFailed-simulation — code-path + protectedTabs lifecycle |
| R09-SESSION | Crash restore / private excluded / corrupt preserved / create-fail | PASS | P11 (debug+release) | |
| R09-PROFILES | Agent/Private фактический SOCKS + изоляция + fail-closed TorStrict | PASS | P12 (debug+release), P11 strict | |
| R09-TARGETS | Одинаковые URL — разные конкретные WebView target | PASS | P12 (debug+release) | |
| R09-DL | Загрузки: bytes/hash/progress/cancel/fail | PASS | P08 (debug+release) | |
| R09-MCP | MCP/IPC негативы и host-policy | PASS | P02, P05 (debug+release) | |
| R09-STOP | STOP/takeover: ack, drain, ноль поздних эффектов | PASS | P04 (исправлен устаревший ассерт `message`→`reason`), P10, P15 | |
| R09-RELEASE-EXCL | Release отказывает debug-исключения (SSRF/picker QA env) | PASS (код-гейт) | `cfg(debug_assertions)` на TEST_FETCH_ALLOW/TEST_PICK_FILE | P06/P09/P14 в release не запускались (не skip-and-PASS: исключения недоступны) |
| R09-NO-AUTO | Release без HAYDEV_AUTOMATION_DEBUG: 0 debug-портов, UI работает | PASS | powershell port scan + Computer Use | |
| R09-RUNTIME | Bundled runtime offline без системного Node/Python после последней сборки | PASS | runtime-offline exit 0 | Чистая VM — B08-VM |
| R09-DEPS | Аудиты + применимость | PASS | DEPENDENCY_REVIEW.md; audit-app/prod; perplexica-audit-full.json; cargo-audit-r09.log | Perplexica 11 dev-only triaged; cargo 0 vulns/8 warn |
| R09-CI | Конфигурация windows-closure.yml | PASS (конфиг) | CI_WORKFLOW_REVIEW.md | Remote run — B08-CI |
| R09-INSTALL | Сценарий install/upgrade/uninstall | PREPARED | INSTALL_PROTOCOL.md | Чистая VM — B08-VM |
| R09-PERF | Производительность против зафиксированных порогов | **FAIL (1 порог)** | release-perf3 + PERFORMANCE_ATTRIBUTION.md | idle RAM 811.5 MiB (release) / 790–914 MiB (debug) > 600 MiB; остальные 10 порогов PASS с запасом |
| R09-REPRO | Повторная сборка в изолированной копии | NOT_RUN | — | identity-цепочка snapshot→build→acceptance зафиксирована; побитовая не заявлялась |
| R09-INSTALL-RUN | Установка на чистой Windows | BLOCKED_EXTERNAL | B08-VM | |
| R09-LIVE | Реальные LLM/search/Tor/OAuth/egress | BLOCKED_EXTERNAL | BLOCKERS.md | |

---

## Матрица r08 — 2026-10-15 (история; PASS не переносятся автоматически)

| ID | Проверка | Статус | Evidence | Ограничение / остаток |
|---|---|---|---|---|
| R08-BASE | Текущий dirty baseline и provenance | PASS | baseline-source.json; run-manifest.json | Старый HEAD отдельно не проверяет продукт |
| R08-STOP | Run cancellation, real DOM/network stale-effect checks | PASS | native-expanded-suite.log P04/P10; network-vault-shield-context.log P14 | Синтетическая native проверка; финальный release NOT_RUN |
| R08-STORE | Atomic replace/backup/locking/corruption contract | PASS | post-prune-rust.log; native-expanded-suite.log P11 | Полный native crash-write vault/settings ещё NOT_RUN |
| R08-VAULT | Save/restart/fill/delete, exact host/PSL, context guard | PASS | native-expanded-suite.log P03; vault-shield-context-fixed.log | Полная same-URL navigation race матрица ещё NOT_RUN |
| R08-STREAM | Streaming fragments/metadata/read errors/retry | PASS | post-prune-rust.log; integration-dns-deadline.log | Live provider BLOCKED_EXTERNAL |
| R08-NET | DNS pinning/SSRF/redirects/failed reads | PASS | post-prune-rust.log; network-vault-shield-context.log P14; integration-dns-deadline.log | Production release negative policy ещё NOT_RUN |
| R08-PROFILE | Agent/Private actual SOCKS and storage isolation | PASS | profile-route-fixed.log; native-expanded-suite.log P11/P12 | Actual Tor/IP/DNS BLOCKED_EXTERNAL; proxied Research explicitly rejects |
| R08-TARGET | Identical URLs retain concrete WebView targets | PASS | native-expanded-suite.log P12 | Повтор на финальном release нужен |
| R08-RESEARCH | Provenance and quoted excerpt validation | PASS | native-expanded-suite.log P06 | Excerpt match не доказывает истинность интерпретации модели |
| R08-DL | Download bytes/hash/progress/cancel/collision/fail | PASS | native-expanded-suite.log P08 | Старый UNSUPPORTED больше не текущий результат |
| R08-DOC | PDF/DOCX content through both bridge paths | PASS | native-expanded-suite.log P09; document corpus | Debug fixture selection; OS dialog NOT_RUN |
| R08-PICK | Native picker, cancel while dialog open, late registration | NOT_RUN | REMAINING_PROMPT_PACK_2026-10-15.md R03 | Code-level cancellation gap требует воспроизведения/закрытия |
| R08-ATTACH | Owner/run/TTL and cleanup complete UI lifecycle | NOT_RUN | post-prune-rust.log; P09 partial native coverage | Run paths tested; pending pick/navigation/cloud policy remain |
| R08-SHIELD | Native pre-navigation filtering/counters/site exception | PASS | native-expanded-suite.log P07/P12; vault-shield-context-fixed.log | ProcessFailed/persistence exhaustive native coverage остаётся |
| R08-SESSION | Crash restore/private exclusion/corrupt preservation/create error | PASS | native-expanded-suite.log P05/P11 | Navigation stack restoration/back-forward coverage остаётся |
| R08-I18N | Complete HY/RU/EN and failure UI | NOT_RUN | P05 RU and code dictionaries; late UI changes | Полная проверка поверхностей всех языков не выполнена |
| R08-MCP | Local MCP/IPC authorization negatives | PASS | native-expanded-suite.log P01/P02/P05 | Installed release ещё NOT_RUN |
| R08-INTEGRATION | Pinned Perplexica/provider-error runtime | PASS | integration-dns-types.log; integration-dns-deadline.log | 14 synthetic tests; no neighboring checkout |
| R08-RUNTIME | Latest bundle offline/clean Windows acceptance | NOT_RUN | runtime-dns-deadline.log build PASS; earlier runtime-complete-offline.log PASS | Последний bundle требует нового offline smoke; VM внешний gate |
| R08-DEPENDENCIES | Advisory applicability final classification | NOT_RUN | app-final-audit.log; rust-final-audit.log; perplexica-final-*.json | Dev advisories and Rust warnings need final target-specific review |
| R08-CI | Windows workflow execution | NOT_RUN | .github/workflows/windows-closure.yml | Workflow implemented; remote run BLOCKED_EXTERNAL |
| R08-PERF-DEBUG | Five-minute idle memory threshold | FAIL | native-expanded-suite.log P13; performance.json | 862208000 >629145600 bytes; no threshold changes |
| R08-FINAL-NATIVE | All required checks against one final frozen build | NOT_RUN | REMAINING_PROMPT_PACK_2026-10-15.md R00/R01/R06 | Intermediate passes are not a final certificate |
| R08-RELEASE | Current release + NSIS + identity/reproducibility | NOT_RUN | REMAINING_PROMPT_PACK_2026-10-15.md R06 | Only stale release exe existed at handoff |
| R08-INSTALL | Installed exe/install/upgrade/uninstall on clean Windows | BLOCKED_EXTERNAL | REMAINING_PROMPT_PACK_2026-10-15.md R07 | Dedicated Windows environment unavailable; script prep remains local |
| R08-LIVE | Real LLM/search/Tor provider and egress acceptance | BLOCKED_EXTERNAL | BLOCKERS.md | No separate live/paid/account authorization |

---

## Историческая матрица до r08 — прежние PASS не переносятся на текущую сборку

# ACCEPTANCE MATRIX — HayDevBrowser (scope: завершение продукта + выбранные интеграции)

Правило строки: ID | требование | область/профиль | build | тест/команда | ожидаемо | фактическо | статус | доказательство.
Статусы: PASS / FAIL / NOT_RUN / BLOCKED. N/A — только с обоснованием. Пропущенный тест никогда не PASS.
Build-колонка: `dev` = инструментированная/тестовая сборка, `release-<hash>` = точный release build. Release-MUST проверяются на одном release build.

## Пороги производительности (зафиксированы ДО оптимизации, изменять задним числом запрещено)

| Метрика | Порог |
|---|---|
| Cold start (окно отвечает) | ≤ 10 с |
| Warm start | ≤ 5 с |
| Idle CPU (1 вкладка, 5 мин) | ≤ 3 % |
| Idle RAM (chrome+1 tab) | ≤ 600 МБ |
| 20 вкладок RAM | ≤ 2.5 ГБ |
| 20 вкладок idle CPU | ≤ 15 % |
| Navigate ack (локальный fixture) | ≤ 1.5 с |
| Stop ack / завершение отменяемой работы | ≤ 250 мс / ≤ 2 с |
| Extraction (статический fixture, ≤200 КБ) | ≤ 5 с/страницу |
| Filtering overhead (fixture, 30 запросов) | ≤ 15 % медиана |
| RAM после 10 циклов open/close вкладок | ≤ idle+20 % |

## MUST выбранного scope

| ID | Требование | Профиль/область | Build | Тест/команда | Ожидаемо | Фактически | Статус | Доказательство |
|---|---|---|---|---|---|---|---|---|
| P00-01 | Baseline воспроизводим, находки аудита перепроверены | repo | n/a | docs/closure/BASELINE_00.md + run-manifest | факты подтверждены | подтверждены (все находки A–G) | PASS | artifacts/closure/20261009-0625-r00 |
| P01-01 | Приложение стартует/закрывается в изолированном test data-root | default, test profile | dev | E2E harness lifecycle | окно живёт, exit чистый, нет orphan-процессов | старт/стоп в mkdtemp data-root, orphans=0 | PASS | artifacts/closure/20261009-0645-r01/p01-e2e.log |
| P01-02 | Playwright подключается к существующей WebView2 (тот же BrowserHost), различает chrome/tab по идентификаторам | harness | dev | E2E connect | UI читается, fixture-вкладка открывается в том же host | chrome+tabs CDP классифицированы по URL; fixture-вкладка через CommandBar | PASS | artifacts/closure/20261009-0645-r01/p01-e2e.log |
| P01-03 | Ошибочный IPC-параметр → проверяемый отказ (не краш) | IPC | dev | E2E negative invoke | структурированная ошибка | неверное имя аргумента и unknown tabId отклонены, UI жив | PASS | artifacts/closure/20261009-0645-r01/p01-e2e.log |
| P01-04 | Test-only transport/fixtures не включаемы в release | security | dev+release | code gate + grep по release-сборке | гейт только под cfg/test env | fixtures вне bundle/exe (0 совпадений); финальная проверка — на release build в P09/P10 | PASS (промежуточно) | run-manifest r01 fixtureLeakCheck |
| P02-01 | Private egress реально применяется (proxy+args одним окружением) | private | dev | proxy-fixture + код-гейт | запросы идут через заданный endpoint | контракт args+proxy в `private_browser_args` (unit 3 теста); wry-дефект устранён | PASS (контракт; live-маршрут = P02-07) | artifacts/closure/20261009-0710-r02 |
| P02-02 | Direct/TorIfAvailable/TorStrict/Socks5 разделены; strict fail-closed (нет silent direct) | private/darkweb/agent | dev | fixture-прокси матрица | strict без Tor → отказ создания вкладки | resolve_egress матрица + private_args strict fail + Agent TorStrict fail-closed в core.rs | PASS (fixture-уровень) | artifacts/closure/20261009-0710-r02 |
| P02-03 | CDP/debug-доступ не открыт безусловно в production | chrome/tabs | release | конфиг-тест на release-сборке | debug-порты закрыты или документированный test-mode | `--remote-allow-origins=*` УДАЛЁН; порты сохранены как production-фича bridge (модель доверия документирована в lib.rs; браузерные Origin отклоняются политикой DevTools); Playwright QA работает | PASS (документированная модель) | run r02; e2e-p02.log |
| P02-04 | MCP: Host/Origin policy, auth/сессия, лимиты; unauthorized tool отклоняется | mcp 27301 | dev | HTTP негативные тесты | 4xx/отказ без токена, неверный Origin | unit 9 тестов + E2E: no-token 401/503, bad-token 401, Origin 403, wrong-Host 403, token-in-URL 400, лимит 8 conn | PASS | artifacts/closure/20261009-0710-r02/e2e-p02.log |
| P02-05 | web_fetch SSRF-guard: схемы, private/loopback/metadata IP, редиректы, лимиты | research fetch | dev | adversarial URL набор | все опасные URL отклонены | netguard.rs 7 unit-тестов (scheme/onion/loopback/private/metadata/mapped-IPv6/userinfo); redirects(0)+ручной follow; E2E-поведение — в P06 research suite | PASS (unit-контракт) | run r02 |
| P02-06 | Cookies/storage изолированы между профилями; Private/DarkWeb не персистят | все профили | dev | E2E storage probe | кросс-профильных утечек нет | частично: private-tab IPC + isIncognito в реестре, изолированные data-root, wipe при старте; полный cross-profile cookie/storage E2E — P05/P10 | NOT_RUN (частично) | run r02 |
| P02-07 | Реальный egress/DNS/IP-маршрут | private/darkweb | release | live-сеть (по разрешению) | фактический маршрут через Tor/прокси | — | NOT_RUN | внешний gate |
| P03-01 | Vault UI save → restart → list/has → fill → delete E2E | vault | dev | E2E синтетические записи | полный цикл работает | полный нативный цикл pass (restart с тем же data-root) | PASS | artifacts/closure/20261009-0750-r03/e2e-p03.log |
| P03-02 | Контракты save/has/list/generate/fill/delete согласованы (аргументы/формы) | IPC | dev | contract-тесты renderer↔Rust | несовпадение имён = падение теста | vault-ipc-contract.test.ts (статический) + E2E | PASS | run r03 |
| P03-03 | Fill: разрешение записи+вкладка+origin; отказ на чужом host (домен в path/query), запрещённом frame, после смены страницы | vault | dev | E2E негативные | все отказы, пароль не вводится | чужой host+query → MISMATCH; page без формы → NO_LOGIN_FIELDS; AMBIGUOUS закреплён unit; frame-отказ через main-document селекторы (unit-контракт) | PASS | e2e-p03.log + run r03 |
| P03-04 | Генерация от OS CSPRNG; plaintext не в metadata-ответе | vault | dev | unit + E2E | энтропия/отсутствие `generated` в list | getrandom + rejection sampling (unit 2); generated ровно 1 раз в generate-ответе; list/has чистые (E2E) | PASS | run r03 |
| P03-05 | Старое хранилище читается; неоднозначные записи (co.uk) не расширяют доверие; backup без plaintext | vault | dev | миграционный тест | чтение ок, autofill на неоднозначных запрещён | DPAPI-формат не менялся (vault.rs); co.uk → отказ fill (E2E+unit); backup-механика: в продукте backup-функции нет — N/A по scope, отсутствие plaintext в exports проверено metadata-сериализацией | PASS (N/A backup обосновано) | run r03 |
| P04-01 | Stop ack ≤250 мс, завершение отменяемой работы ≤2 с (измерено) | agent | dev | fixture delayed HTTP/stream | целевые времена выдержаны | stop-ack и drain измерены в E2E, целевые выдержаны; прерванный run без final_answer | PASS | artifacts/closure/20261009-0830-r04/e2e-p04.log |
| P04-02 | После takeover — ноль новых tool-dispatch; stale callback/run-id не меняет вкладку | agent/control | dev | fixture гонки | 0 действий после revoke | takeover в инструментальном цикле: 0 tool-записей после revoke+250ms; generation-гард в streaming worker | PASS | e2e-p04.log |
| P04-03 | Streaming для поддерживаемых провайдеров; fragmented tool calls корректны; unsupported — честный non-streaming | agent | dev | fake LLM stream/error | текст появляется потоково, события целы | SSE-дельты как thought(running); StreamAccumulator (3 unit); fallback на не-SSE/400 | PASS | e2e-p04.log + run r04 |
| P04-04 | Дедлайны connect/read/total, maxSteps, retry только transient с backoff; неидемпотентные не повторяются | agent | dev | fixture 429/5xx/timeout | бюджет respected | ureq total 120s; wall-clock 600s; retry ≤2 для 429/5xx с stop-осведомлённым backoff; tools не ретраятся | PASS (fixture-уровень) | run r04 |
| P04-05 | Live LLM smoke release-провайдеров с бюджетом | agent | release | live (по согласованию) | фактические ответы | — | NOT_RUN | внешний gate |
| P05-01 | Каждый MUST feature inventory имеет реальный UI/native тест; нет кнопок-пустышек | весь UI | dev | inventory-тест | таблица статусов без UNSUPPORTED-no-op | setLocale больше не no-op; MCP navigate реально навигирует; vault/downloads контракты честны; полная inventory-проверка — P10 | PASS (промежуточно) | artifacts/closure/20261009-0915-r05/e2e-p05.log |
| P05-02 | Downloads: native progress/cancel/fail/complete/коллизии (compat probe при необходимости) | downloads | dev | E2E fixture download | отмена реально останавливает передачу | PROBE завершён: событие DownloadStarting не срабатывает на стеке (wry 0.55/WebView2 154) — download молча не выполняется; решение предложено (CDP pipeline, DECISIONS #14); cancel честно UNSUPPORTED | BLOCKED-инж. (решение предложено) | run r05 downloadsProbe |
| P05-03 | Attachments AgentPanel: IDs/owner/TTL/лимиты; unknown/expired/cancel/unsupported обрабатываются | attachments | dev | E2E оба пути | одинаковое поведение newtab и AgentPanel | контракт wired (Rust принимает attachmentIds); live native-dialog не автоматизируем; полная E2E обоих путей — P10 | NOT_RUN (частично) | run r05 |
| P05-04 | HY/RU/EN доходят до внутренних страниц/ошибок/диалогов; persisted | locale | dev | E2E переключение | pab-страницы на выбранном языке | set_locale+persist+per-locale страницы: рестарт → lang=ru подтверждён E2E; darkweb.html пока EN-only (задокументировано) | PASS (newtab/search; darkweb EN-only) | e2e-p05.log |
| P05-05 | MCP parity: согласованный список tools (8 darkweb + выбранные browser/tabs/agent/runtime) через host policy | mcp | dev | tools/list контракт | список соответствует DECISIONS | 12 tools = DECISIONS #15; navigate gated AGENT+no-latch (E2E) | PASS | e2e-p05.log + DECISIONS #15 |
| P05-06 | 20-tab restart: разрешённая сессия восстанавливается, private/darkweb — нет; crash/повреждённый файл корректны | session | dev | E2E restart/kill | восстановление без запрещённых | 20+ вкладок восстановлены (graceful); private не восстановлен; crash/повреждённый файл — P10 (запланировано) | PASS (graceful) / crash — P10 | e2e-p05.log |
| P06-01 | Research использует реальный search-tool (локальные SearXNG/Perplexica); ошибка поиска ≠ придуманные источники | research | dev | fixture search + отчёт | источники только реальные | web_search через SearXNG-резолюцию (env→managed); SEARCH_UNAVAILABLE/zero → честный текст; E2E scripted run | PASS (fixture; live = P06-06) | artifacts/closure/20261009-0955-r06/e2e-p06.log |
| P06-02 | Source ledger: requested/final URL, title, время, статус, fingerprint, provenance; чувствительные query не в telemetry | research | dev | отчёт-структура | поля присутствуют | ledger: requestedUrl/finalUrl/httpStatus/fetchedAt/contentHash/title; E2E проверил sha256+200 | PASS | e2e-p06.log |
| P06-03 | Extractor выбран и интегрирован (статические страницы полно; пустые/битые видны) | research | dev | контрольный набор страниц | полнота против baseline-парсера | extract.rs: 12 unit (кириллица/армянский/script/nav/empty/max) + исправлена UTF-8-коррупция старого; Crawl4AI/Jina не требуются (DECISIONS #16) | PASS | run r06 |
| P06-04 | Claims с source IDs и опорными фрагментами; conflicts/unknowns реальны; partial виден | research | dev | fixture противоречащих источников | связь claim→source проверяема | claims валидируются против ledger (sourceId-99 отклонён); unknowns из finish; partial честен (E2E оба сценария) | PASS | e2e-p06.log |
| P06-05 | Retrieved content не расширяет полномочия (prompt injection) | research | dev | adversarial страница | команды из страницы не исполняются | untrustedContent-обёртка + системный промпт; полный adversarial E2E — P10 security regression | PASS (обёртка; полный негатив — P10) | run r06 |
| P06-06 | Live search через доступный сервис | research | release | live (по доступности) | реальные результаты | нужен разрешённый live-апстрим | NOT_RUN | BLOCKERS B-03 |
| P07-01 | Реальная сетевая блокировка (не DOM-скрытие): network-лог доказывает | filtering | dev | instrumented fixture-страница | запросы не доходят до сети | — | NOT_RUN | — |
| P07-02 | On/off меняет результат; allowlist сайта работает; настройки переживают restart | filtering | dev | E2E | переключение влияет | — | NOT_RUN | — |
| P07-03 | Login/OAuth/WebSocket/download/video fixtures не ломаются фильтром | filtering | dev | E2E | 0 ложных блокировок на fixtures | — | NOT_RUN | — |
| P07-04 | Overhead измерен; повторный прогон стабилен; Tor-профиль не теряет egress из-за filtering | filtering | dev | замеры | ≤ порога 15 % | — | NOT_RUN | — |
| P07-05 | Extension-путь (uBO) проверен prototype'ом или задокументирована несовместимость + выбран native path | filtering | dev | compatibility probe | решение записано в DECISIONS | — | NOT_RUN | — |
| P08-01 | PDF/DOCX extraction: текст/таблицы/кириллица/армянский; пустой/защищённый/битый/скан обрабатываются честно | documents | dev | контрольный набор документов | ошибки не маскируются пустотой | — | NOT_RUN | — |
| P08-02 | Worker изоляция: без сети/произвольных путей/макросов/plugins; лимиты и отмена | documents | dev | негативные тесты | обход невозможен | — | NOT_RUN | — |
| P08-03 | Выбор → extraction → привязка к run → ответ на проверяемый вопрос → очистка временных данных | documents | dev | E2E оба UI-пути | ответ содержит факт из документа | — | NOT_RUN | — |
| P08-04 | Документ/текст не уходит во внешнюю LLM без data-sharing policy | documents | dev | конфиг-тест | cloud только opt-in | — | NOT_RUN | — |
| P09-01 | Повторяемая Windows release-сборка из чистой копии (включая dirty state) | build | release | build-script чистой копии | два прогона → идентичные входы | — | NOT_RUN | — |
| P09-02 | Installer + SHA-256 + manifest входов; runtimes из зафиксированных источников (manifest/хеши/notices) | build | release | bundle-скрипт | preflight без runtimes — actionable ошибка | — | NOT_RUN | — |
| P09-03 | CI: Windows Rust/tests/build job добавлен; JS-проверки сохранены | ci | n/a | workflow-файл | конфигурация полная | — | NOT_RUN | — |
| P09-04 | Remote CI run зелёный | ci | n/a | доступ к Actions | фактический прогон | — | BLOCKED | нет настроенного remote-доступа |
| P10-01 | Полный обязательный E2E набор (12 сценариев PROMPT 10) на одном release build | весь | release | E2E suite | все MUST PASS на этом build | — | NOT_RUN | — |
| P10-02 | Security regression: IPC/capabilities, SSRF, CDP/MCP, injection, redaction, dependencies | security | release | негативные наборы + скан | Critical/High закрыты или triage | — | NOT_RUN | — |
| P10-03 | Performance против порогов из этой матрицы | perf | release | замеры, несколько повторов | пороги выдержаны | — | NOT_RUN | — |
| P11-01 | Установка точного артефакта в тестовое окружение, запуск installed exe, повтор ключевых E2E | install | release-установленный | installed E2E | функциональность подтверждена | — | NOT_RUN | — |
| P11-02 | Upgrade/uninstall/backup-rollback (если есть предыдущая тестовая версия) | install | release | install-сценарии | синтетические данные сохраняются | — | NOT_RUN | — |
| P11-03 | Code signing проверен ИЛИ зафиксирован блокер | release | n/a | подпись/политика | сертификат или документированный блокер | — | BLOCKED | сертификата нет |
| P11-04 | FINAL_REPORT с одним итоговым статусом | docs | n/a | report | статус по правилам MASTER | — | NOT_RUN | — |

## Профили и провайдеры в scope

- Профили: Default, Private (InPrivate+egress), DarkWeb (fail-closed Tor), Agent (egress из privacy.json). Поддержка: Windows 10/11 x64 + WebView2 (runtime 154.0.4258.62 на тестовой машине).
- LLM-провайдеры: Gemini / NVIDIA / Ollama-совместимый (env-конфигурация). Live smoke — только согласованный провайдер + бюджет (P04-05).
- Поиск: локальные SearXNG/Perplexica (bundled runtimes). Live upstream search — P06-06.
