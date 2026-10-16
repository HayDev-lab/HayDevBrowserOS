# HayDe
vBrowser — промпт-пак оставшихся работ после r09

Дата сверки: 2026-10-15. Проект: `D:\Projects\BrowserHayDev`, приложение: `electron-app/`.
Основание: текущий код, документы closure и сохранённые логи `artifacts/closure/20261015-continuation-r09/`.
Это задание для следующего инженерного прохода. При подготовке пакета приложение не пересобиралось, E2E повторно не запускались.

## Что действительно осталось

| Пункт | Статус при передаче | Что закрывает пункт |
|---|---|---|
| Изоляция хранилища оболочки | FAIL по коду и признанному остатку r09 | Shell WebView использует свой каталог внутри выбранного data-root; два синтетических корня не разделяют storage |
| Idle RAM ≤600 MiB | FAIL | Финальный release укладывается в исходный порог при сохранённых функциях и защите |
| Полный native-набор | FAIL | Разобраны P07/P13; общий прогон проходит после исправлений |
| Shield при фактическом сбое WebView2 | NOT_RUN | Нативный сбой, честное состояние защиты, проверенное восстановление |
| Полный release-путь PDF/DOCX и вложений | NOT_RUN в полном объёме | Оба формата × оба UI-пути через настоящий picker, чтение содержания, ошибки и lifecycle |
| Release STOP/takeover и остальные пропуски | NOT_RUN для исключённых сценариев | Проверены допустимые локальные сценарии на release; остаток обоснован индивидуально |
| Повторная сборка из изолированной копии | NOT_RUN | Копия актуальных входов, locked build, сопоставление содержимого и артефактов |
| Итоговая идентичность и полная матрица MUST | NOT_RUN в требуемом качестве | Исправлен состав входов, уникальные логи, финальные проверки, заполнены requirements |
| Clean Windows install/upgrade/uninstall | BLOCKED_EXTERNAL | Выделенная машина/VM и выполненный установочный протокол |
| Live LLM/search/Tor/OAuth, remote CI, signing/channel policy | BLOCKED_EXTERNAL | Отдельно разрешённые внешние проверки и соответствующие ресурсы |

**Итог на момент передачи: INCOMPLETE.** Доступные локальные работы не завершены.

## Проверенные факты и поправки к отчёту r09

1. HEAD остаётся `55f175593c67e8effb622c6c4c87871660e96ae6`, ветка `main`; dirty tree сохранён.
2. SHA-256 фактического release exe: `0aad7d565eb1ff3edcbcaae302471c44a082251684a5d618495af79d00c9041c`.
3. SHA-256 фактического NSIS: `e30e4a7efa98367f48c226a8d382d7b1c9470738f1763f7e751da6842a7543c1`.
4. `app.exe --build-identity` действительно возвращает `debug:false` и buildInputsSha256 `1e98cd006fa94160002daa39fb5d4d31ab967aa1d167a27a9909db03245e5d8a` — значение r09 `final-inputs`.
5. `native-release3.log`: **17/17 PASS** для указанного подмножества. Это не полная release/installed acceptance.
6. `release-perf3.log` на этом же exe: **932331520 bytes = 889.140625 MiB**, порог **629145600 bytes = 600 MiB**. Cold 1710 ms, warm 1571 ms, cycles ratio 1.0581. Числа 811.5 MiB/1646 ms в STATE и PERFORMANCE_ATTRIBUTION относятся к более раннему прогону/артефакту.
7. `native-final4.log`: **22/24**, exit 1. P07 фактически заканчивается `Target page, context or browser has been closed` в `loadAdPage`, а P13 — `page.evaluate: Object`. Поэтому сводка «только RAM + установленный load-flake» неточна. Превышение RAM отдельно доказано release-perf3.
8. `run-manifest.json` r09 содержит **50 записей команд, но `requirements: {}`**. Повторные имена `types`, `debug`, `locale-fix2` перезаписывают соответствующие файлы; число записей не означает столько же сохранённых независимых доказательств.
9. В `final-inputs-source.json` попали 181 запись из `.locprobe/` и `.locprobe-tools/`, включая тестовый профиль. Именно эти 181 записи отличаются при текущей сверке build-input paths; прочих изменений среди входов `electron-app/` и `.github/` не найдено. Это дефект определения входов, а не доказанная поздняя правка продукта. Не распространять содержимое профиля или токены вместе с evidence.
10. Последние unit/Rust/integration/lint записи относятся к разным более ранним snapshots. Единый полный набор на финальном зафиксированном состоянии ещё требуется.
11. Shell создаётся в `electron-app/src-tauri/src/lib.rs` без явного `data_directory`. Исправление локали не закрывает изоляцию shell storage.
12. В r09 заявлены ручные выбор PDF, отмена и поздний выбор после STOP. Это полезное частичное доказательство; оно само по себе не покрывает DOCX, оба UI-пути, вопрос по содержимому и все ошибки документов.
13. Исключение P04/P10 из release нужно пересмотреть: harness задаёт `GEMINI_BASE_URL` локальному синтетическому серверу, а разрешение этого provider endpoint в `llm.rs` не находится под `cfg(debug_assertions)`. Не смешивать provider transport с debug-only исключениями Research `netguard`.

## Как использовать пакет

MASTER применяется ко всем этапам. Выполнять N00 → N01 → N02 → N03 → N04 → N05 → N06 → N07 → N08.
Внешний блокер в N07 не препятствует локальным этапам и финальной фиксации их результатов.
Не выполнять заново исправления r08/r09 без текущей регрессии: downloads, vault, streaming, навигационный стек и locale adoption уже имеют код и доказательства.

## MASTER — продолжение инженерных работ

```text
Ты отвечаешь за завершение HayDevBrowser после r09.
Корень: D:\Projects\BrowserHayDev. Приложение: electron-app/.
Runtime: Tauri 2 + Rust + WebView2; UI: React + TypeScript.
Часть src/main требуется сборке внутренних страниц и общим модулям.

Прочитай AGENTS.md, если они есть, исходный
docs/HAYDEVBROWSER_END_TO_END_PROMPT_PACK.md, этот пакет, STATE.md,
ACCEPTANCE_MATRIX.md, DECISIONS.md, BLOCKERS.md и фактический manifest r09.
Общие ограничения исходной задачи сохраняются.

Сохрани архитектуру, интерфейс, названия и пользовательские изменения.
Порядок: переиспользовать → расширить → создать.
Запрещены reset --hard, clean, auto-stash и восстановление из HEAD без
проверки назначения изменений. Не удаляй src/main целиком.
Не делай commit/push/publication/production mutation и платные запросы
без отдельного разрешения. Локальные исправления и проверки уже разрешены.
Реальные профили, пароли, cookies, история и аккаунты не используются.
Не копируй их в evidence и не выводи секреты.

Сначала отдели подтверждённые остатки от уже работающего кода, затем исправляй.
Не останавливайся на новом аудите, плане или описании архитектурной задачи.
Выполни все доступные необходимые локальные работы.
Не ослабляй IPC/capabilities, origin/SSRF policy, profile isolation или egress.
Не повышай пороги RAM/STOP/overhead и тестовые тайм-ауты ради PASS.
Не заменяй реальные функции заглушками и не считай standalone rerun
доказательством причины падения полного набора.

Используй новый уникальный run-id (например, следующий свободный r10).
Не переписывай r08/r09 evidence. Продолжай существующие closure-документы,
помечая старые выводы как историю и ссылаясь на исправляющее доказательство.
Для каждого требования только PASS / FAIL / NOT_RUN / BLOCKED_EXTERNAL.
Уровень проверки, build hash, команда, exit code и лог указываются отдельно.
PASS* и PREPARED не заменяют статус обязательного gate.
```

## N00 — достоверный baseline и исправление учёта доказательств

```text
Сначала read-only: Git root/branch/HEAD/status, lockfiles, build scripts,
capabilities, актуальные исходники и manifest r09. Проверь hashes имеющихся
exe/installer и --build-identity. Отдели результаты раннего release от final.

Исправь closure-evidence.mjs и использование harness там, где это необходимо:
- build-input fingerprint должен отражать реальные входы сборки;
- исключи runtime profiles, caches, временные probe-данные и секреты;
- учитывай незакоммиченные исходники, удаления, lockfiles, конфигурацию,
  генераторы, pinned integration/runtime inputs;
- отдельно храни source snapshot, toolchain/runtime provenance и hashes
  фактически собранных assets/resources/exe/installer;
- snapshot и log names уникальны; существующий evidence не перезаписывается;
- перед сборкой и после неё проверяй неизменность входов, не полагайся только
  на переданную через environment строку build identity;
- manifest requirements заполняется на уровне отдельных исходных MUST.

Не удаляй .locprobe* и старые evidence без проверки назначения. Не копируй
профиль или mcp-token в новые отчёты. Любую миграцию synthetic test-data
в artifacts/ или temp делай после проверки, что это именно данные теста.
Не применяй игнорирование ко всем новым файлам, скрывая рабочие изменения.

Проверь package.json, Cargo.toml, workflow и harness; составь минимальный
перечень непройденных MUST с конкретными доказательствами.
Поправь текущие выводы: release RAM 889.14 MiB; полный debug gate FAIL;
изолированная пересборка NOT_RUN; причины P07/P13 ещё требуют расследования.

Gate: проверяемый исходный snapshot, manifest с requirements, уникальные
evidence-файлы и корректная связь результат → artifact → source inputs.
```

## N01 — изолировать shell storage

```text
Устрани использование глобального WebView2 user-data folder оболочкой.
Точка создания shell — src-tauri/src/lib.rs, WebviewBuilder("main").
Используй отдельный устойчивый shell-каталог внутри уже выбранного data-root.
Сохрани раздельные профили Default/Agent/Private/DarkWeb и их маршруты.
Ошибка создания каталога/окружения должна быть видимой; fallback к глобальному
профилю недопустим. Не объединяй shell и remote-tab permissions ради этого fix.

Не читай и не переноси автоматически пользовательский глобальный профиль.
Если нужна миграция, опиши ограниченный безопасный контракт отдельно;
в проверках используй только синтетические каталоги.

Проверь два независимых HAYDEV_DATA_DIR A/B: различные locale, localStorage
и synthetic storage markers; restart A/B; отсутствие перетекания данных.
Подтверди фактический WebView2 user-data-dir/process ownership и то, что
запуск теста не открывает обычное хранилище оболочки пользователя.
Проверь параллельные/последовательные экземпляры в поддерживаемом контракте,
конфликт каталога, неуспешное создание WebView и отсутствие orphan-процессов.
Повтори locale adoption/StrictMode и session restart после изменения.

Gate: нативная изоляция A/B, корректный restart, видимые ошибки и отсутствие
побочных записей в обычном shell-профиле. Изоляцию поправить ДО новых UI E2E.
```

## N02 — довести RAM без ослабления безопасности

```text
Текущий подтверждённый FAIL финального release: idle 932331520 bytes,
лимит 629145600 bytes. Используй существующий P13 и исходные условия замера.
Измеряй только процессы данного изолированного экземпляра; без параллельных
сборок, других тестов и изменений исходников. Укажи версию WebView2 и режим QA.

Перепроверь атрибуцию памяти на финальном артефакте: host, browser, renderer,
GPU, utility, профили, количество environments и активные UI-компоненты.
Сохрани исходную метрику WorkingSet; private bytes и другие метрики могут
дополнить анализ, но не заменить её для прохождения порога.
Раздели стоимость окружений, содержимого newtab, ресурсов и lifecycle.

DECISIONS r09 #13 — гипотеза пути исправления, не доказательство, что перенос
всего shell на pab:// является единственным или достаточным решением.
Начни с минимальных совместимых изменений: лишние WebView/процессы,
загрузка/удержание ресурсов, закрытие неиспользуемых объектов, поддержанные
WebView2 lifecycle/memory API. Проверь реальные pinned bindings и официальную
документацию, прежде чем утверждать отсутствие API или менять зависимости.
Не используй принудительное урезание working set непосредственно перед замером.

Если нужна переработка окружений/bridge, сначала зафиксируй инварианты:
remote context не получает shell privilege; caller document/origin/owner
проверены; private/agent egress и storage изолированы; нет direct fallback;
MCP, vault, agent controls и file operations остаются защищены.
Сохрани существующий UI. Реализуй выбранный безопасный вариант и проверь
его отрицательными IPC/origin/profile тестами, а не обещанием экономии RAM.

Gate: release P13 проходит все исходные пороги, включая idle ≤600 MiB,
20 tabs, open/close cycles и Shield overhead ≤15%; функции и защита сохранены.
Одного короткого измерения недостаточно; сохрани штатный idle-интервал P13.
```

## N03 — устранить нестабильность native и доказать Shield failure lifecycle

```text
Разбери именно ошибки native-final4.log:
P07: Target page/context/browser closed в loadAdPage;
P13: page.evaluate: Object при invoke.
Не описывай их как waitForSelector timeout или RAM assertion без доказательств.

Добавь ограниченную диагностику к существующему harness: выход app/child,
WebView ProcessFailed, закрытие страницы, targetId/tabId, navigation/document
identity, фактическую причину IPC error. Не записывай чувствительные payloads.
Проверь захват старого Page после навигации, cleanup предыдущих тестов,
ресурсную конкуренцию, DNS fixture и падение renderer. Выбор страницы должен
учитывать конкретную вкладку/документ, а не первую совпавшую URL-подстроку.
Меняй product либо harness по установленной причине. Проверки не ослаблять.

Вызови настоящий контролируемый сбой WebView2/renderer только своего
synthetic экземпляра. Проверь Shield: потеря защиты отражается в UI, счётчик
не выдумывается, восстановление hooks выполняется до защищаемой навигации.
Проверь persisted enable/visited-site allowlist, все профили, login/OAuth fixture,
WebSocket/download/video и overhead. Не заменяй ProcessFailed вызовом handler
или одной проверкой protectedTabs.

Gate: воспроизводимая причина и fix, targeted regression, затем полный native
набор на неизменном бинарнике. При подтверждённом flaky-сценарии — ограниченный
повтор именно этого сценария; сохраняй все неуспешные попытки.
```

## N04 — завершить release PDF/DOCX, вложения и policy передачи

```text
Сохрани исправление r09: pick cancellation регистрируется до открытия диалога.
Проверь существующие ручные evidence; не объявляй всё R03 закрытым по одному PDF.

На реальном release с synthetic data пройди 4 комбинации:
PDF + AgentPanel; DOCX + AgentPanel; PDF + internal newtab/search;
DOCX + internal newtab/search. Выбор только настоящим Windows file dialog.
Проверь цепочку: выбор → текст/таблица RU/HY → bind к run → вопрос по содержимому
→ очистка. Примеры из существующего corpus: 7319 AMD, Москва, Երևան, Copper.
Существующий локальный synthetic LLM разрешён для проверки проводки:
он должен проверять реально полученное содержимое, а не безусловно возвращать
правильный ответ. Это не доказательство качества реального внешнего провайдера.

Пройди cancel dialog, STOP при открытом dialog → поздний выбор, cancel parsing,
закрытие owner-tab, смену документа, run rejection, completion/error/timeout,
повторное использование, неизвестный/просроченный ID, чужие owner/run.
Контракт AgentPanel и внутренних страниц одинаковый.
Проверь scan/protected/empty/corrupt, size/time/memory limits, worker termination,
временные файлы и отсутствие ненужных дочерних процессов.
Наличие локального parser не доказывает OS sandbox: отдельно проверь запрет
макросов/внешних обращений и фактические ограничения worker.

Сопоставь UI и backend с исходным data-sharing gate: пользователь понимает,
какому выбранному провайдеру уйдёт извлечённый текст, и явно инициирует передачу.
Один общий текст уведомления не подменяет проверку этого контракта.
Никаких настоящих документов, платных запросов или реальных ключей.

Gate: evidence по каждой комбинации и негативам с exe hash; OS-dialog selection
не подменяется HAYDEV_TEST_PICK_FILE. Live provider — отдельный внешний gate.
```

## N05 — закрыть пропуски release acceptance

```text
Разбери каждый пропущенный P04/P06/P09/P10/P14 отдельно.
P04/P10: в текущем коде configured LLM transport позволяет локальный endpoint
независимо от debug_assertions. Проверь и запусти применимые STOP/streaming/
takeover/stale-action тесты на release с существующим synthetic provider.
Не добавляй обход SSRF или скрытую production test backdoor ради теста.

P06/P14: Research positive loopback fixture действительно зависит от debug-only
TEST_FETCH_ALLOW. Сохрани production отказ; проверь negative cases на release
фактическими вызовами, а не только чтением cfg. Положительные сценарии раздели
на доступные локальные и требующие разрешённого public endpoint.
P09: настоящий picker по N04. Не смешивай отсутствие fixture selection с
невозможностью локального ответа по документу.

Перечитай исходные MUST и закрой не покрытые нативно проверки:
реальный сбой во время записи vault/stores и восстановление, конфликт сохранений,
same-document/origin races, session restore/crash/private exclusion,
download bytes/hash/cancel/fail/collisions, IPC/MCP разрешённые и запрещённые
контексты, фактические маршруты профилей, HY/RU/EN ошибок и состояний.
Повторяй только отсутствующее или затронутое изменениями; уже проверенное
включи в итоговую регрессию без переписывания работающей реализации.

Отдельно запусти release без HAYDEV_AUTOMATION_DEBUG: отсутствие CDP listeners
и работа реальных browser/agent/vault/Shield/download функций. Видимая лента
новостей и открывающиеся панели не доказывают все эти функции.

Gate: coverage matrix каждого MUST, все доступные release сценарии выполнены;
невыполненные не становятся PASS из-за успешных debug unit/E2E.
```

## N06 — итоговая сборка, воспроизводимость и локальная готовность CI

```text
После продуктовых исправлений заморозь корректно определённые входы.
На них последовательно проведи typecheck всех проектов, lint, unit/integration,
Rust tests, internal pages/renderer, debug/native, bundle runtime/offline smoke,
release+NSIS и применимые release/native/performance gates.
Используй package.json и pinned toolchain; проверяй каждый exit code.
Native тесты нельзя запускать одновременно со сборкой того же exe.

Исправления исходников после gate требуют новой сборки и затронутой регрессии.
Не заявляй «все проверки финального дерева», если unit/Rust/lint были на старых
snapshots. Сохрани unique log names и runtime-manifest SHA.

Создай изолированную копию текущих build inputs, включая нужные dirty изменения.
Не использовать один старый HEAD, соседний Perplexica checkout, системный Node
или профили/секреты из исходного каталога. Зависимости только pinned/locked.
Повтори сборку, сравни package content и hashes exe/installer/resources.
Если outputs отличаются, найди конкретные причины (timestamps/build IDs,
generated assets и т.п.). Не обещай побитовую воспроизводимость по совпадению
строки buildInputsSha256. Обе сборки должны быть функционально проверены.

Проверь применимость advisories после изменений зависимостей, runtime inventory,
checksums/licenses/notices, отсутствие тестовых профилей/.env/keys в поставке.
Обнови Windows CI под итоговые команды, capture evidence и корректные exit codes.
Remote CI пока BLOCKED_EXTERNAL без разрешения на push/dispatch.

Gate: два доказанных build executions из одних входов, объяснённое сравнение,
точная identity итогового кандидата и локально выполненные проверки.
```

## N07 — installed acceptance и внешние проверки

```text
Используй artifacts/closure/20261015-continuation-r09/INSTALL_PROTOCOL.md.
В выделенной чистой Windows VM/машине без dev Node/Python:
install → запуск установленного exe → native/UI acceptance → upgrade с
synthetic vault/session/settings/downloads → restart → uninstall → остатки,
процессы и согласованная политика сохранения пользовательских данных.
Проверяй hash именно установленного и запущенного exe, путь resources и runtime.
Не устанавливай поверх рабочего приложения и не меняй компоненты хоста
без отдельной авторизации. При отсутствии VM сохраняй BLOCKED_EXTERNAL.

Отдельные внешние gates: разрешённые LLM/signature/document answer, search,
Tor/IP/DNS и real OAuth; remote Windows CI; signing либо явная channel policy.
У каждого свой статус, условие снятия, артефакт и доказательство.
Ключи не проси открытым текстом, не сохраняй в logs. Расходы только в явно
разрешённом бюджете. Не выдавай fake provider/SOCKS fixture/Tor --version
за живую внешнюю приёмку. Внешние блокеры не останавливают N00–N06/N08.
```

## N08 — финальная фиксация без завышенных PASS

```text
Обнови docs/closure/STATE.md, ACCEPTANCE_MATRIX.md, DECISIONS.md, BLOCKERS.md.
Заполни artifacts/closure/<new-run-id>/run-manifest.json и changed-files.json
относительно baseline рабочего дерева, а не старого HEAD.
Каждый исходный MUST получает PASS / FAIL / NOT_RUN / BLOCKED_EXTERNAL,
проверенный build, уровень проверки, команду, exit code, лог/артефакт.
Не оставляй requirements пустым. Групповой FAIL не становится PASS*.

Исправь противоречия r09 явным дополнением; сохрани старые логи.
Раздели исправления продукта, harness, evidence и только подготовленные процедуры.
Две WebView2 среды — измеренная статья расхода, но не доказательство отсутствия
всех утечек и не освобождение от инженерного memory gate.

В финале: что исправлено; что завершено функционально; чем подтверждено;
что осталось и почему; hashes release/installer; один статус:
INCOMPLETE — есть локальный обязательный FAIL или доступная работа NOT_RUN;
RELEASE_CANDIDATE — доступные инженерные работы завершены, внешние gates названы;
PRODUCTION_READY — все обязательные проверки, включая установленный конкретный
артефакт, подтверждены. Число тестов, сборка и наличие exe недостаточны.
```

## Промпт для запуска всего пакета

```text
Продолжи HayDevBrowser в D:\Projects\BrowserHayDev по
docs/closure/REMAINING_PROMPT_PACK_AFTER_R09_2026-10-15.md.
Выполни MASTER и N00–N08. Сначала исправь evidence baseline и изоляцию shell,
затем RAM и причины падений native, заверши release coverage и воспроизводимость.
Сохрани dirty tree и рабочие исправления r08/r09. Не останавливайся на аудите
или документировании остатка, пока доступны локальные исправления и проверки.
Внешние действия — только в отдельно разрешённом объёме.
```
