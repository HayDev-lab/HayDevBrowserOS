# Актуальный статус — 2026-10-15, r10 (`20261015-final-r10`, пакет AFTER_R09)

**Статус: INCOMPLETE — локальные инженерные остатки отсутствуют. N04-DOCS закрыт: 4/4 документ-комбо (PDF/DOCX × AgentPanel/newtab) VERIFIED на release через настоящий OS-dialog с контент-верификацией синтетическим LLM (n04-summary.json allVerified=true). Remote Windows CI (B08-CI) зелёный (run 38843894496). Installed acceptance на dev-host выполнена (install→identity→smoke→UI-правки→upgrade→uninstall, без orphan-процессов; НЕ заменяет clean-VM — B08-VM остаётся). Оставшиеся BLOCKED_EXTERNAL: B08-VM (чистая VM), B08-LLM, B08-TOR, B08-SEARCH, B08-SIGN.** Основание: [REMAINING_PROMPT_PACK_AFTER_R09_2026-10-15.md](REMAINING_PROMPT_PACK_AFTER_R09_2026-10-15.md), N00–N08.

## Идентичность сертифицированного артефакта

- HEAD `55f175593c67e8effb622c6c4c87871660e96ae6`, `main`, dirty tree сохранён.
- Финальный freeze: snapshot `n06-final-inputs-2` — buildInputsSha256 `60b57009b2fa18cac57e00dd3aa1c6726fe49ef6a8db8dadf7c0effc38d2ca17`; **verify-inputs после сборки: inputsUnchanged=true, treeUnchanged=true**.
- **Certified release exe SHA-256 `71339a3bacdd8698c9097ab772cfedaf82d8227ef4ae5c00466682aabd0e5e3f`**, `--build-identity` == `60b57009…` ✓, `debug:false`.
- **NSIS installer `a4027db522b1b48642fdeb1a8e652f3c4cdc342926a165d80ae8e5ecd463306a`**.
- Учет доказательств исправлен (N00): closure-evidence ведёт фильтр build-inputs (probe-профили/кэши/секреты исключены; r09-дефект с 181 записью .locprobe больше невозможен), уникальные имена снапшотов/логов (перезапись запрещена), действия `verify-inputs`/`requirement`/`artifact`, manifest.requirements заполнен.

## Что сделано в r10

1. **N01 — shell storage изолирован**: shell webview получает `data_directory` профиля Default (внутри data-root); ошибка создания каталога прерывает старт (fallback на глобальный профиль запрещён). A/B-проверка: два синтетических корня → раздельные localStorage/маркеры, user-data-dir процессов внутри каждого корня, перетеканий нет, глобальный профиль не открывается.
2. **N02 — idle RAM PASS**: shell и Default-вкладки используют идентичные опции окружения → ОДИН WebView2 browser process (раньше два). Release P13 на сертифицированном артефакте: **idle RAM 565.5 MiB ≤ 600**, cold 2169ms, warm 1367ms, navAck 14.4ms, idleCPU 0.038%, 20 tabs 1609MiB/0.063%, Shield +2.06%, cycles 1.054 — **все исходные пороги соблюдены**. Изоляция профилей и IPC не ослаблены (IPC per-webview; Agent/Private/DarkWeb — собственные окружения).
3. **N03 — нативный crash-lifecycle Shield**: реальный сбой рендерера (kill процесса-рендерера вкладки) → честное падение protectedTabs, WEBVIEW_PROCESS_FAILED в реестре, re-arm хуков в NavigationStarting ДО защищаемой навигации, реальные блокировки продолжаются (P18, debug+release). Диагностика harness: page close/targetCrashed/targetDestroyed/app exit. P07/P13 в полном наборе — PASS; причина r09-падений полного набора — давление дублированных WebView2-процессов (устранено N02) плюс задокументированный случай внешнего закрытия окна теста пользователем (n04-логи r10).
4. **N05 — release coverage расширен**: P04/P10 выполнены на release (LLM transport не зависит от debug_assertions — подтверждено исполнением), P19 добавлен: release отказывает loopback research fetch фактическим вызовом (продакшн-политика SSRF без QA-allowlist). Release subset **21/21**.
5. **N06 — воспроизводимость**: изолированная копия входов (без node_modules/target/кэшей/профилей), npm ci по lock, полная пересборка release+NSIS; сравнение hashes и функциональная проверка (см. reproducibility-отчёт в run-manifest r10).
6. **N00 — поправки r09 зафиксированы** (requirements): release RAM r09 = 889.14 MiB (не 811.5), полный debug gate r09 = FAIL, изолированная пересборка = NOT_RUN, P07/P13 требовали расследования.

## N04 — документы на release (PARTIAL)

Реальный OS-dialog (без HAYDEV_TEST_PICK_FILE) на release: PDF × AgentPanel — вложение подтверждено (3 прогона), отмена диалога — без дублей/ошибок, поздний выбор после STOP — отказ DOCUMENT_CANCELLED (r09+подтверждение r10). **NOT_RUN остаётся**: контент-верифицированные прогоны ответа (4 комбинации × DOCX) — интерактивные пики блокируются конкуренцией за фокус рабочего стола с активной сессией пользователя ( Computer Use отказывает focus-steal). Контент-проводка через оба bridge покрыта P09 на debug (fixture file). Попытки и частичные доказательства сохранены в `n04-*.json`.

## Итог r10 (финал после N04 + installed acceptance)

**RELEASE_CANDIDATE.** Все доступные инженерные работы выполнены и подтверждены: N04-DOCS 4/4 VERIFIED на release (настоящий OS-dialog, синтетический LLM проверял реальное содержимое промпта), installed acceptance на dev-host (install/upgrade/uninstall, identity, 0 debug-портов, UI-правки пользователя на месте, без orphan-процессов), remote CI зелёный. Сертифицированный артефакт обновлён UI-правками пользователя: exe 2516c4a6…, installer cd8506b6… (identity-цепочка пересобрана поверх frozen-входов, гейты typecheck/lint/unit 208/rust 145/integration/internal/renderer — зелёные). Оставшееся: только внешние gates B08-VM/LLM/TOR/SEARCH/SIGN с условиями снятия в BLOCKERS.md.
---


## Аудит защит (антибот / антикапча / fingerprint / антидетект) — фактическое состояние

| Слой | Реализовано | Работает | Честные ограничения |
|---|---|---|---|
| Антидетект: сеть | WebRTC lockdown (`disable_non_proxied_udp`), no-phoning-home (`--disable-component-update --disable-domain-reliability --disable-breakpad`, SmartScreen off) — privacy.rs | Да: аргументы окружения каждого tab-webview; egress-изоляция подтверждена P12 (actual SOCKS route) | Engine-level (JA3/TLS) на WebView2 недоступен |
| Антидетект: egress | Default direct; Agent SOCKS5 из privacy.json; Private (прокси+ephemeral, wipe на старте); DarkWeb fail-closed Tor | Да: P12 native, прокси-маршруты фактические | Live Tor-маршрут — B08-TOR |
| Fingerprint | PRIVATE-профиль: canvas toDataURL farbling, AudioContext noise, ClientRects jitter, WebGL getParameter, hardwareConcurrency/deviceMemory, timezone/locale override, native-code toString guard; стабильно на сессию (seed per identity) | Да: privacy_init.rs, детерминированно | Только PRIVATE; Default/Agent без noise (осознанно); продвинутые детекторы могут отличить JS-spoofing |
| UA | Shell-токены вычищаются из UA tab-webviews (site_ua.rs) | Да | Полная UA-ротация не реализована |
| Антибот | НЕ реализован поведенческий обход (behavioural evasion). Есть ChallengeDetector: Turnstile/reCAPTCHA/hCaptcha/CAPTCHA/2FA → пауза агента → WAITING_FOR_HUMAN → решение пользователем в той же сессии → resume | Да (детект + handoff, нативные проверки) | Авто-обход антибота — вне scope |
| Антикапча | Авто-решение НЕ реализовано (нет 2captcha/anticaptcha интеграций) | — | Платные сервисы требуют отдельного разрешения; реализован честный human-handoff (challenge.rs) |

---

## История до r10

# Актуальный статус — 2026-10-15, r09 (`20261015-continuation-r09`)

**INCOMPLETE.** Все доступные локальные инженерные работы R00–R06/R08 выполнены; один обязательный порог производительности (idle RAM ≤600 MiB) честно **FAIL** на debug и release с полной атрибуцией причины и зафиксированным путём исправления. Внешние gates (B08-*) не сняты. *(Поправка r10/N00: release RAM в r09 фактически 889.14 MiB по release-perf3; полный debug gate r09 — FAIL; см. requirements r10.)*

## Идентичность артефактов

- HEAD `55f175593c67e8effb622c6c4c87871660e96ae6`, `main`, dirty tree сохранён (изменения/удаления r08 + правки r09).
- Финальное дерево: snapshot `final-inputs` (buildInputsSha256 `1e98cd006fa94160002daa39fb5d4d31ab967aa1d167a27a9909db03245e5d8a`).
- **Release exe SHA-256 `0aad7d565eb1ff3edcbcaae302471c44a082251684a5d618495af79d00c9041c`**, identity buildInputs == final-inputs ✓, `debug:false`.
- **NSIS installer SHA-256 `e30e4a7efa98367f48c226a8d382d7b1c9470738f1763f7e751da6842a7543c1`**.
- Runtime manifest SHA-256 `20974cf7…` (10614 файлов, без изменений с r08); offline smoke после последней пересборки — PASS (`runtime-offline`, exit 0).
- Debug exe финального набора: `7b340d92…` (binaryAfter записи native-final4).

## Исправленные в r09 дефекты продукта (все с нативными доказательствами)

1. **Навигационный стек не переживал рестарт** (SessionStore сохранял пустую navigation, bootstrap не восстанавливал стек — регресс паритета с TS-рантаймом). Исправлено: реальные стеки в session.json, восстановление в bootstrap_session, модель «нативного окна» для restored-переходов (явная URL-навигация вне native history, без потери forward). Доказательство: P16 (debug+release), 3 новых unit-теста.
2. **Отмена выбора документа регистрировалась после закрытия диалога** — поздно выбранный файл мог зарегистрироваться после STOP. Исправлено: cancel-флаг регистрируется ДО открытия диалога; register_file отказывает с DOCUMENT_CANCELLED. Доказательство: нативная проверка на release-бинарнике — реальный OS-диалог, STOP во время диалога, выбор файла → 0 вложений + видимое «Document processing was cancelled.»
3. **Локаль перезаписывалась при каждом старте** (шелл пушил localStorage поверх durable ui-locale.json; ui_locale не был зарегистрирован как IPC; StrictMode double-mount обострял гонку). Исправлено: ui_locale зарегистрирован, renderer ПРИНИМАЕТ файл на старте, push только при явной смене. Доказательство: P05/P17 (debug+release), ручная рестарт-проверка.
4. Warning'и сборки (unused Result, deprecated fetch_update) устранены; cargo test 144 passed.

## Проверки финального дерева

- Debug полный нативный набор (native-final4): **22/24** — FAIL только P13 (idle RAM) и P07 (load-flake; standalone PASS 49.5s, 4/5 прогонов сегодня).
- Release-подмножество на финальном артефакте (native-release3): **17/17 PASS** — P01,P02,P03,P05,P07,P08,P11,P12,P15,P16,P17.
- Release-исключения (по правилам R06, не skip-and-PASS): P04/P10 (fake LLM loopback), P06/P14 (research fixture через debug-only TEST_FETCH_ALLOW), P09 (debug-only fixture picker; реальный OS-dialog принят отдельно). Release сам доказывает отказ QA-исключений: TEST_FETCH_ALLOW/TEST_PICK_FILE под `cfg(debug_assertions)`.
- Без автоматизации: release без HAYDEV_AUTOMATION_DEBUG — **0 debug CDP портов**, UI полностью функционален (проверено Computer Use).
- Perf: release P13 — все пороги кроме idle RAM: cold 1646ms ✓ warm 1527ms ✓ navAck 3.3ms ✓ idleCPU 0.016% ✓ 20tab 1872MiB/CPU 0.011% ✓ Shield +2.63% ✓ cycles 1.067 ✓; **idle RAM 811.5 MiB FAIL** (debug 790–914 MiB FAIL). Атрибуция и план — `PERFORMANCE_ATTRIBUTION.md`.
- R03 OS-dialog (реальный диалог, release): позитивный выбор multilingual.pdf ✓, отмена диалога ✓ (без дублей/ошибок), поздний выбор после STOP ✓ (отказ). Данные синтетические.
- R04: словари 214 ключей ×3 языка без пропусков; живое переключение/рестарт/ошибки — P17+P16+P11.
- R05: `DEPENDENCY_REVIEW.md` (app 0/0; Perplexica prod 0, 11 dev-only triaged; cargo 0 vulns/8 warnings — paste удалён pruning, glib вне Windows-графа; python lock без изменений); `CI_WORKFLOW_REVIEW.md` (workflow полный, remote run — B08-CI); runtime offline PASS.
- R06: сборка release+NSIS из frozen final-inputs; пакет без .env/ключей; повторная сборка в изолированной копии не выполнялась (воспроизводимость: identity-цепочка snapshot→build→acceptance вместо побитовой).
- R07: `INSTALL_PROTOCOL.md` готов; чистая VM — BLOCKED_EXTERNAL (B08-VM).

## Итог

**INCOMPLETE** — по правилу «INCOMPLETE при обязательном инженерном FAIL»: idle RAM превышает зафиксированный порог на обоих режимах; причина — архитектура двух WebView2-окружений (≈803 MB, сам app.exe 27 MB), исправление (перенос шелла на pab://-bridge → одно окружение) — отдельная архитектурная задача; ослабление изоляции IPC или egress ради порога запрещено.

---

## История до r09 — нижеследующие PASS не являются текущей сертификацией

# Актуальный статус — 2026-10-15, r08

**INCOMPLETE.** По запросу пользователя подготовлен [промпт-пак оставшихся работ](REMAINING_PROMPT_PACK_2026-10-15.md), этапы R00–R08. Новая release/NSIS сборка и установленная приёмка ещё не выполнялись.

- HEAD `55f175593c67e8effb622c6c4c87871660e96ae6`, `main`, сохранено dirty tree. Commit/push не выполнялись.
- Evidence: `artifacts/closure/20261015-stabilization-r08/run-manifest.json`; исходный baseline и handoff snapshot находятся рядом. Последние проверки относятся к разным промежуточным состояниям; единого финального freeze/build/gate пока нет.
- Последние проверки: TS exit 0, lint exit 0 (до последних UI-правок); unit 1186 passed / 5 skipped; Rust 141 passed; integration 14 passed.
- Общий native P01–P13: 16 passed / 1 failed. P13: idle RAM **862208000 bytes (~822 MiB)** при пороге 600 MiB. Остальные измеренные пороги того debug-прогона прошли. Release performance NOT_RUN.
- Дополнительные P14 (redirect/read error/STOP HTTP/navigation) и исправленный P15 (vault context/login/OAuth fixture/WS/video) прошли отдельно.
- Последний debug SHA-256 `661fc7382e9b772c01379c78512c609e1e235a7e35c9470128376816de8bf7e4`. Старый release от 2026-10-03 не пригоден для вывода о текущем продукте.
- Bundled runtime пересобран после DNS deadline fix: 10614 файлов; runtime-manifest SHA-256 `20974cf795977eecd8e28306ded2c870d495b6f912bbe242da4f64e6d58f64c4`. Offline smoke до последней пересборки PASS; после неё нужно повторить.

Следующее действие: R00 — новый run-id, сверка текущего dirty tree с handoff-source.json, review поздних изменений и единый набор проверок. Затем свежий debug/native, release/performance, native picker, installer acceptance. Не начинать с повторной реализации уже исправленных downloads/vault/STOP.

Внешние gates: разрешённые live LLM/Tor/search, remote CI, code signing/unsigned policy, выделенная Windows VM. Это не снимает оставшиеся локальные работы.

---

## История до r08 — нижеследующие PASS не являются текущей сертификацией

# STATE — HayDevBrowser closure run

Обновляется после каждого gate. Не перезаписывать доказательства другого запуска.

## Текущее состояние

- **Дата/время:** 2026-10-09, утро (UTC+3). Run-id: `20261009-0625-r00`.
- **Scope (подтверждён пользователем):** завершение продукта + выбранные интеграции — Playwright QA (существующая WebView2), исследовательский конвейер с качественным извлечением, фильтрация запросов, чтение документов. EXTENSIONS не выполняются. Этапы 06–08 обязательны.
- **HEAD:** `55f175593c67e8effb622c6c4c87871660e96ae6` (main), dirty tree 163 записи (изменения пользователя сохраняются; stash/reset запрещены).
- **Fingerprint тестируемого набора:** `952123cbdf3eff318ba6386ea8419809410529f8cf78341e15a34829d575a330` (dirty source, определение в run-manifest).
- **Run-manifest:** `artifacts/closure/20261009-0625-r00/run-manifest.json`.

## Последний завершённый инженерный gate

- **PROMPT 05 (UI↔Rust паритет) — ЗАВЕРШЁН.** setLocale доведён до Rust (persist + per-locale pab-страницы, E2E: рестарт → lang=ru); AgentPanel attachments wired в agent_run; MCP parity 12 tools с host-policy (navigate только в AGENT, E2E); 20-tab graceful restart с восстановлением и без private. **DEFECT-DL-01 (downloads):** полный compatibility probe — DownloadStarting не срабатывает на wry 0.55/WebView2 154 (загрузка молча не выполняется), поведение закреплено E2E-пином; решение предложено (CDP download pipeline, DECISIONS #14) — открытый инженерный пункт. Полный прогон: cargo 132, vitest 1196, E2E 5/5. Доказательства: `artifacts/closure/20261009-0915-r05/`.

## Отложенные внешние проверки (NOT_RUN/BLOCKED)

См. `BLOCKERS.md`. Ключевые: live LLM smoke (бюджет/провайдер), live Tor-маршрут (разрешение на сетевую проверку), remote CI (доступ), code signing (сертификат), чистая VM для install (согласование тестовой машины).

## Следующее конкретное действие

PROMPT 04: agent ownership/stop/streaming/бюджеты — прерываемый chat_once и tools (stop-канал + discard устаревших результатов), поколение run'а, SSE-streaming с корректной сборкой fragmented tool calls, транзиент-retry с backoff, budget-лимиты; E2E: stop-ack ≤250мс, завершение ≤2с, ноль tool-dispatch после takeover (fake LLM).
