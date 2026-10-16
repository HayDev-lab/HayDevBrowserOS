# Дополнение r10 — 2026-10-15

16. **Один общий WebView2 environment для shell + Default-вкладок (N01+N02).** Shell webview получает `data_directory` профиля Default и идентичные additional_browser_args (включая единый automation-порт) → WebView2 держит ОДИН browser process для шелла и default-вкладок. Инварианты сохранены: remote-контексты не получают shell-привилегий (IPC инжектируется per-webview), Agent/Private/DarkWeb — собственные окружения со своими egress-args, direct fallback отсутствует. Эффект: idle RAM release 889→565.5 MiB (исходный порог ≤600 соблюдён БЕЗ ослаблений); устранена и причина нестабильности полного нативного набора (ресурсное давление дублей процессов). Диагностика r09 #13 («перенос шелла на pab:// — единственное решение») опровергнута: достаточно выравнивания опций окружения.
17. **Единый automation-порт.** Ранее два порта (9220 chrome / 9330 tabs) поддерживали два окружения; после слияния — один порт в 9220-диапазоне, `chrome_debug_port()`/`tab_debug_port()` — алиасы `automation_debug_port()`. CDP-классификация harness переведена на один endpoint с фильтрацией по URL (shell = tauri.localhost/5180, tabs = остальные).
18. **Shield re-arm при NavigationStarting.** ProcessFailed удаляет вкладку из protected-набора (честный UI); хуки фильтрации переживают сбой рендерера на стороне браузерного процесса, а членство восстанавливается в НАЧАЛЕ следующей навигации — до первого защищаемого запроса восстановленного документа. Доказано P18 (реальный kill процесса-рендерера, т.к. Page.crash отсутствует в CDP-подмножестве WebView2).
19. **Durable-локаль.** `ui-locale.json` — единственный durable-источник; `ui_locale` зарегистрирован как IPC; renderer принимает файл на старте (StrictMode-безопасно: push только после adoption и только при явной смене пользователя). Известный остаток: user-data folder chrome-окружения ДО слияния (r10 #16) лежал глобально; после слияния shell делит папку профиля Default внутри data-root — глобальный профиль больше не используется.
20. **Evidence-дисциплина (N00).** build-input fingerprint исключает probe-профили/кэши/секреты/деривации; имена снапшотов и логов уникальны (перезапись запрещена); `verify-inputs` фиксирует неизменность входов до/после сборки; `requirement` заполняет manifest.requirements по исходным MUST; `artifact` связывает hash артефакта со снапшотом. Учёт r09 (пустой requirements, коллизии имён, .locprobe в final-inputs) исправлен; r09-факты поправлены явными requirements (release RAM 889.14 MiB; полный debug gate FAIL; repro NOT_RUN).

---

# Дополнение r09 — 2026-10-15

Решения ниже фиксируют выборы прохода `20261015-continuation-r09`. Проверенный статус — STATE и ACCEPTANCE_MATRIX (матрица r09).

11. **Локаль: ui-locale.json — единственный durable-источник.** Шелл хранил выбор в localStorage chrome-окружения и пуш его на каждом старте, перезаписывая файл (гонка с загрузкой внутренних страниц; в release шелл грузится быстрее — дефект воспроизводился стабильно). Исправлено: `ui_locale` зарегистрирован как IPC; renderer на старте ПРИНИМАЕТ значение хоста (StrictMode-безопасно: push только после adoption), push при явной смене пользователя. localStorage остаётся fast-path для первой отрисовки. ИЗВЕСТНЫЙ ОСТАТОК: chrome-окружение использует user-data folder по умолчанию (core.rs), т.е. localStorage шелла живёт вне HAYDEV_DATA_DIR — тестовая изоляция и контракт «реальный профиль не открывается» нарушаются на уровне шелла; перенос папки chrome-окружения под data-root — отдельная инженерная задача (не делалось в r09, чтобы не трогать создание окружений без необходимости).
12. **Навигация после рестарта: модель «нативного окна».** WebView2 не даёт восстановить нативную историю; restored-соседи помечаются вне native-окружения (native_lo/hi в NavStack) и переходят явной URL-навигацией (`begin_explicit` + commit как fresh navigation). Явный переход НЕ обрезает forward — forward остаётся доступным последующими явными переходами. Компромисс: после явного перехода нативный порядок расходится со стеком, все соседи переоцениваются от новой позиции (каждый переход реально работает, никогда не молчит).
13. **Idle RAM FAIL признан архитектурным, а не утечкой.** app.exe 27 MB; два WebView2-окружения (IPC-шелл vs без-IPC вкладки, DECISIONS #4) дают ≈803 MB из-за дублей browser/GPU/utility процессов. Слияние окружений или общий user-data folder ослабляют IPC-изоляцию или ломают per-profile egress — запрещено. Путь исправления: перенос шелла на pab://-bridge (одно окружение, ожидаемо <600 MiB) — отдельная архитектурная задача; альтернатива MemoryUsageTargetLevel недоступна в pinned webview2-com. Порог 600 MiB НЕ менялся.
14. **Отмена выбора документа до диалога.** parsing-cancel флаг регистрируется до открытия диалога; register_file проверяет флаг на входе и после парсинга — поздний выбор после STOP отказывает (DOCUMENT_CANCELLED), не регистрируя вложение. Доказано на release-бинарнике с реальным OS-диалогом.
15. **Release-приёмка без debug-фактures.** P06/P09/P14 в release не запускались (их позитивные пути требуют debug-only TEST_FETCH_ALLOW/TEST_PICK_FILE — в release они физически недоступны, что и проверялось код-гейтом). Взамен: release-подмножество 11 наборов 17/17, нативный OS-dialog acceptance (R03), no-automation проверка портов. Fake-LLM тесты (P04/P10) в release не запускались по той же причине.

---

# Дополнение r08 — 2026-10-15

Решения ниже уточняют/заменяют противоречащие им старые записи. Проверенный статус — в STATE и run-manifest.

1. **STOP:** immutable per-run guard, отмена перед UI-thread dispatch и renderer effect; unfinished HTTP изолирован и ограничен; takeover/STOP останавливает навигацию owned tabs. Ни один timeline-only тест не является доказательством отсутствия эффекта.
2. **Хранилища:** транзакционная блокировка, write/fsync/atomic rename без remove destination, валидный backup; повреждённый оригинал не перезаписывается. Текущий формат vault сохранён.
3. **Vault:** exact host + pinned PSL, no implicit subdomain/www trust; readonly document ID устанавливается до page scripts, повторная проверка до записи полей. Старые широкие записи не авторизуют fill.
4. **Network:** verified DNS answer используется самим transport; каждый redirect проверяется заново. Research через неподдерживаемый proxy явно отказывает, без direct fallback. Perplexica Scraper использует ограниченный static HTTP, без невключённого Chromium.
5. **Native hooks:** Shield и downloads подключаются к конкретному WebView до protected navigation. Downloads реализованы нативно, старое предложение CDP workaround и статус UNSUPPORTED устарели. Причина части старых проб — Playwright download deny.
6. **Profiles:** route определяется один раз на environment и совпадает с badge; SOCKS применяет --proxy-bypass-list=<-loopback>. CDP target определяется у конкретного WebView; production debug ports по умолчанию выключены.
7. **Documents:** Rust PDF/DOCX worker, bounded inputs/runtime/memory/child processes, no macros; content extraction через оба bridge. Native picker и полная отмена pending pick ещё требуют приёмки. UI notification внешней LLM есть; gate opt-in нужно завершить явно.
8. **Runtime:** immutable source/lock/checksum, bundled Node, local font вместо build-time Google fetch, exact production inventory/notices. HAYDEV_NO_ENGINES блокирует также on-demand Tor. Windows Job Objects заменили broad orphan sweep.
9. **Tests:** optional integration исключается до import, mandatory integration получает pinned source. Provider runtime bound не повышался; setup импорт отделён. maxWorkers=4 ограничивает ресурсную конкуренцию Vitest.
10. **Передача:** по запросу пользователя подготовлен REMAINING_PROMPT_PACK_2026-10-15.md. Полная работа не объявлена завершённой: отсутствует финальная release/installed acceptance, debug memory gate FAIL.

---

## Предыдущие решения

# DECISIONS — фиксация решений scope и реализации

Каждое решение: дата, контекст, решение, обоснование. Новые решения добавляются в конец.

## Унаследованные (зафиксированы в коде/аудите, признаются действующими)

1. **2026-10-03 (унаследовано):** Deep Research не навигирует видимую пользовательскую вкладку; исследование идёт невидимым web_fetch. Продолжаем; search-tool добавится к невидимому конвейеру.
2. **2026-10-03 (унаследовано):** Auto-escalation HUMAN→AGENT при клике Deep Research chip — явная авторизация пользователя; авто-возврат в HUMAN после завершения (`pab.rs:462-505`).
3. **DarkWeb fail-closed:** без Tor-гейтвея вкладка не создаётся. Распространяется на TorStrict в privacy.json.
4. **Tab webviews без Tauri IPC:** только pab:// API с Referer-атрибуцией. Сохраняется; Playwright QA идёт через CDP существующих webviews, не через новые IPC-дыры.

## Новые решения этого прохода

14. **2026-10-09 — Downloads cancel: compatibility probe завершён, решение предложено (требует реализации).** Факты (evidence r05): Tauri 2.11.6 `DownloadEvent` = только Requested/Finished (нет Progress/cancel); wry 0.55 подписывается на `add_DownloadStarting` только при наличии хендлера; НА ЭТОМ СТЕКЕ (WebView2 154, tab-окружение в изолированном профиле) событие DownloadStarting не срабатывает ВООБЩЕ — ни top-level навигация на Content-Disposition, ни клик по ссылке; загрузка молча не выполняется (вкладка остаётся на прежнем URL, файла нет нигде). Проверены и исключены: machine-политики Edge/WebView2 (только SmartScreenEnabled=0), флаг msWebOOUI (не влияет). **Предложенное решение:** CDP download pipeline поверх уже имеющегося cdp.rs: `Browser.setDownloadBehavior(allowAndName)` + события `Browser.downloadWillBegin`/`Browser.downloadProgress` → реальный progress + `Browser.cancelDownload` (настоящая отмена) + запись в реестр; перехват через导航 до WebView2. Это инженерная работа без новых зависимостей; до её реализации кнопка cancel остаётся честным `DOWNLOAD_CANCEL_UNSUPPORTED`. Статус: открытый инженерный пункт (не внешний блокер).

15. **2026-10-09 — MCP parity (финальный список):** 8 darkweb tools + 4 браузерных: `browser_tabs_list`, `browser_active_tab_snapshot`, `browser_navigate` (AGENT-режим + нет takeover — тот же authorize_tool_call), `agent_status` (без ключей). Старый TS-список из 22 не переносится целиком: инструменты, дублирующие UI-функции без host-policy смысла (bookmarks/history-мутации через MCP), не входят — расширение списка отдельным решением.

16. **2026-10-09 — Research extractor:** ОДИН локальный extractor `extract.rs` (UTF-8-safe, strip script/style, предпочтение article/main, entities, collapse). Crawl4AI/Jina НЕ внедряются: контрольный корпус (кириллица/армянский, script-мусор, nav-chrome, пустые/битые документы, лимит размера) пройден локальным вариантом (12 unit-тестов); старый `crawl::extract_text` сохранён для crawl-джоб (отдельный контекст), research использует extract.rs. Rollback: вернуть web_fetch на crawl::extract_text одной строкой.

17. **2026-10-09 — Исправлен регресс P02 в web_fetch:** после внедрения SSRF-guard fetch ходил на `base_url()` (без пути). Теперь GET идёт по валидированному исходному URL (путь сохранён), каждый redirect разрешается абсолютно и повторно проходит netguard.

5. **2026-10-09 — Исправление Private egress:** явный `--proxy-server` в `additional_browser_args` (паттерн DarkWeb `core.rs:312-315`), удаление пары `additional_browser_args`+`proxy_url`. Обоснование: wry 0.55.1 применяет proxy_config только когда args не заданы (webview2/mod.rs:294-322).
6. **2026-10-09 — Vault RNG:** OS CSPRNG через `getrandom` crate (уже в графе зависимостей через uuid; проверить прямую зависимость) — заменяет xorshift-от-времени. Поле `generated` в ответе generate_and_store сохраняется ТОЛЬКО как явный возврат созданного пароля в момент создания (пользователь должен увидеть пароль, который приложение сохранило) — НО не в list/has/metadata. Это соответствует контракту «сгенерированный секрет не возвращается renderer/agent в metadata-ответе».
7. **2026-10-09 — Vault domain policy:** exact-host match + публичные поддомены не разрешаются автоматически; capture сохраняет полный hostname (без www), а не «последние две метки». Для старых записей с широким доменом (напр. `co.uk`) fill запрещён до пересохранения.
8. **2026-10-09 — CDP:** debug-порты (9220/9330) переводятся в test-mode gate (env `HAYDEV_QA_MODE=1` + отдельный data-root); production-сборка без `--remote-debugging-port` и без `--remote-allow-origins=*`. Если проверка покажет, что bridge-функции (screenshot/sitе UA warmup) требуют CDP в production — минимальный документированный lifecycle с loopback-only, БЕЗ wildcard Origin.
9. **2026-10-09 — MCP hardening:** Host/Origin allowlist (loopback origins), сессионный токен, лимиты body/concurrency, тот же 8-tool surface + перенос выбранных browser/tabs/agent/runtime tools по PROMPT 05 (безопасные контракты, не число ради числа). Финальный список tools фиксируется до реализации.
10. **2026-10-09 — Research extraction:** сравнение текущего `crawl::extract_text` против одного локального кандидата; Crawl4AI/Jina — только если локальный вариант не проходит контрольный набор. Решение фиксируется после измерений PROMPT 06.
11. **2026-10-09 — Filtering:** сначала compatibility probe WebView2 extensions (AddBrowserExtension API доступен в WebView2, но wry 0.55 не экспортирует его в Tauri — проверить); если недоступно из Tauri — минимальный native filtering path (WebView2 WebResourceRequested через доступные API или локальный прокси-перехват БЕЗ TLS MITM: только CONNECT/SNI-level блокировка домена или in-process сетевой фильтр на уровне CDP-доменов). TLS MITM/root cert/global proxy/firewall — запрещены без отдельного решения пользователя.
12. **2026-10-09 — Документы:** один парсер (MarkItDown-совместимый путь или нативный Rust extractor) в изолированном worker-процессе без сети; выбор после контрольного набора PROMPT 08. Не менять зависимости bundled SearXNG Python.
13. **2026-10-09 — Внешние gates (NOT_RUN/BLOCKED):** live LLM, live Tor-маршрут, remote CI, code signing, чистая VM — не блокируют независимые инженерные работы; соответствующие строки матрицы остаются открытыми.

## Открытые вопросы к пользователю (не блокируют текущие работы)

- Бюджет/провайдер для live LLM smoke (P04-05).
- Разрешение на фактическую сетевую проверку Tor-маршрута (P02-07).
- Сертификат подписи (P11-03).
