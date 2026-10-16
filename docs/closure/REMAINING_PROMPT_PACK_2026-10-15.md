# HayDevBrowser — промпт-пак оставшихся работ

> Исторический пакет после r08. После сверки r09 использовать [обновлённый пакет N00–N08](REMAINING_PROMPT_PACK_AFTER_R09_2026-10-15.md). Этот файл сохранён для истории.

Срез: 15 октября 2026, после `20261015-stabilization-r08`. Итог продукта: **INCOMPLETE**.

Это продолжение текущего рабочего дерева, а не повтор первоначального аудита. Использовать MASTER и затем R00–R08 по порядку. Если работа продолжается в одном контексте, не останавливаться между этапами за подтверждением локальных исправлений. Внешние блокеры не останавливают независимые этапы.

## Проверенное исходное положение

- Репозиторий: `D:\Projects\BrowserHayDev`, приложение: `electron-app/`; Tauri 2 + Rust + WebView2, React + TypeScript.
- Ветка `main`, HEAD `55f175593c67e8effb622c6c4c87871660e96ae6`. Большое dirty tree, включая прежние удаления. Commit/push не выполнялись.
- Доказательства текущего запуска: `artifacts/closure/20261015-stabilization-r08/`. Состав дерева до передачи: `handoff-source.json`; первоначальный снимок: `baseline-source.json`.
- Последний debug exe: SHA-256 `661fc7382e9b772c01379c78512c609e1e235a7e35c9470128376816de8bf7e4`. Это **не финальный release**. Во время инженерного этапа исходники менялись между проверками; отдельные успешные проверки не образуют единую сертифицированную сборку.
- Старый `src-tauri/target/release/app.exe` датирован 3 октября 2026. Он не подтверждает нынешний продукт. Новый release/installer в r08 не собран.
- Последний собранный runtime manifest: SHA-256 `20974cf795977eecd8e28306ded2c870d495b6f912bbe242da4f64e6d58f64c4`, 10614 файлов. Последняя пересборка с ограничением ожидания DNS прошла; offline smoke именно после этой пересборки ещё нужен.

| Область | Актуальное доказательство | Практический предел |
|---|---|---|
| TypeScript, lint | `preflight-types-fixed.log`, `preflight-lint.log`, exit 0 | Повторить совместно на окончательном дереве; lint предшествует последним правкам UI |
| Unit | `post-prune-unit.log`: 1186 passed, 5 skipped | Skipped не считать PASS; это не native E2E |
| Rust | `post-prune-rust.log`: 141 passed | Не заменяет приёмку установленного приложения |
| Perplexica integration | `integration-dns-types.log`, `integration-dns-deadline.log`: 14 passed | Синтетический провайдер; не live search/LLM |
| Нативный общий прогон | `native-expanded-suite.log`: 16 passed, 1 failed | Провален P13 по памяти; этот прогон до последних правок |
| Дополнительная сеть/STOP | P14 в `network-vault-shield-context.log`: PASS | В том же файле P15 сначала упал из-за ошибки WS-fixture |
| Vault/Shield compatibility | `vault-shield-context-fixed.log`: P15 PASS | Исправлен fixture `req.socket.localPort`; login/OAuth/WS/video синтетические |
| Runtime без системного Node/Python | `runtime-complete-offline.log`: PASS | Предшествует последнему DNS-изменению и пересборке; не чистая VM |

Уже реализованы и имеют локальные доказательства: отмена запусков и защита от устаревших DOM-действий; атомарные хранилища с backup; exact-host vault с PSL; маскирование аргументов; streaming и thought signatures; проверяемые редиректы и привязка соединения к проверенному DNS; явный отказ неподдерживаемого proxy Research; Agent/Private SOCKS; конкретный WebView target; настоящие downloads; PDF/DOCX extraction и registry вложений; native Shield; восстановление вкладок после аварии; фиксированная интеграция Perplexica и bundled Node/Python/Tor/SearXNG. Не переписывать эти механизмы заново без воспроизводимого дефекта.

## MASTER — передать исполнителю первым

```text
Ты продолжаешь завершение HayDevBrowser в D:\Projects\BrowserHayDev.
Основное приложение electron-app/, runtime Tauri 2 + Rust + WebView2.

Прочитай применимые AGENTS.md, затем:
docs/closure/REMAINING_PROMPT_PACK_2026-10-15.md
docs/closure/STATE.md
docs/closure/ACCEPTANCE_MATRIX.md
docs/closure/DECISIONS.md
docs/closure/BLOCKERS.md
docs/HAYDEVBROWSER_END_TO_END_PROMPT_PACK.md
artifacts/closure/20261015-stabilization-r08/run-manifest.json

Работай с текущим dirty tree. Сохрани пользовательские изменения и удаления.
Запрещены reset --hard, clean, автоматический stash и восстановление из HEAD
без проверки назначения изменений. Не удаляй src/main: он используется
внутренними страницами, общими модулями и тестами.

Порядок: переиспользовать → расширить → создать. Сохрани UI и архитектуру.
Не заменяй функции заглушками, не скрывай ошибки, не ослабляй защиту,
не поднимай тайм-ауты и пороги производительности ради зелёных проверок.
Не переносить старый PASS на новый build автоматически.

Все данные синтетические, профили изолированные через HAYDEV_DATA_DIR.
Не трогай пользовательские cookies, vault, историю и рабочие профили.
Не печатай секреты, тексты реальных вложений и ключи провайдеров.
Локальные исправления и проверки разрешены. Commit, push, публикация,
production, платные запросы и реальные внешние аккаунты требуют отдельного
разрешения. Не запускай live Tor/LLM/search под видом локального теста.

Используй существующие harness, closure-документы и evidence helper.
Для продолжения создай новый run-id, не перезаписывай логи r08.
Фиксируй фактический рабочий набор, команды, exit codes, hashes бинарников,
состав runtime и точную идентичность установленного exe.
Изолированная копия должна включать относящиеся к задаче dirty-файлы.
Не меняй исходники одновременно с финальной сборкой или её приёмкой.

Выполняй R00–R08, исправляя найденные дефекты. Не ограничивайся аудитом.
Каждое требование: PASS / FAIL / NOT_RUN / BLOCKED_EXTERNAL.
Unit, debug, portable runtime и installed release — разные уровни доказательств.
Если внешний этап недоступен, зафиксируй причину и продолжай остальные.
Итог: INCOMPLETE при инженерных дефектах/невыполненных обязательных работах;
RELEASE_CANDIDATE лишь после завершения доступной инженерной части;
PRODUCTION_READY лишь после всех обязательных проверок конкретного артефакта.
```

## R00 — зафиксировать единый исходный набор и закрыть поздние изменения

```text
Проверь Git root/branch/HEAD/status, сравни текущие файлы с handoff-source.json.
Отдели наследованные изменения от изменений r08 по baseline-source.json.
Не делай новый широкий аудит вместо продолжения работы.

Проверь последние изменения, которые ещё не проходили весь общий набор вместе:
- run_host.rs и commands.rs: неизменяемый document ID, vault recheck,
  завершение lease при ошибке attachment, полный контракт раннего agent_run отказа;
- attachments.rs: ошибка timeout вместо attachment:null, cancel/poll contract;
- native-errors.ts, App.tsx, VaultPanel, vault-store, browser-store:
  локализованные ошибки, сохранение error codes, очистка вложений после отказа;
- Cargo.toml/lock: image features ограничены реально поддерживаемыми форматами;
- Perplexica publicFetch.ts: ограничение ожидания DNS тем же общим deadline;
- P14/P15 fixtures и Windows workflow.

Проверь early rejected run, failed attachment binding, repeat run и завершение:
нет действующего старого lease, нет потерянного сообщения об ошибке,
нет оставшегося доступного ID после завершения/отмены, нет unhandled rejection.
Не добавляй тесты, которые только повторяют код. Проверяй наблюдаемое поведение.

Создай новый source snapshot. Выполни все TypeScript проекты, lint, unit,
integration types/tests, Rust tests, build internal pages и renderer.
В Vitest оставь maxWorkers=4: прежний дефолт запускал около 70 workers и
давал timeout импорта при одновременной тяжёлой сборке. Тайм-ауты не увеличивать.

Интеграция только из integrations/perplexica/source-lock.json через
scripts/prepare-perplexica.mjs. Не использовать соседний D:/Projects/Perplexica.
Если marker generated checkout устарел, сначала проверить его локальные правки,
затем сохранить/перенести generated каталог с проверенным абсолютным путём;
не reset/clean. Не менять source-lock произвольно ради прохождения проверки.

Gate: все проверки относятся к одному зафиксированному текущему набору.
```

## R01 — выпустить актуальный debug и повторить общий native набор

```text
Собери свежий debug из snapshot R00 и дождись завершения команды с exit 0.
Не запускай тесты, пока линкер пишет exe. Укажи SHA-256 и --build-identity.
Прогони существующие P01–P15 через настоящий WebView2 последовательно.
Не запускать native suites параллельно: они используют общие порты.

Проверить: вкладки/навигация/закрытие/restart; ошибки создания WebView без
пустой успешной записи; авария и corrupt-session; private не восстанавливается;
STOP/takeover при LLM, DOM и HTTP; ноль реальных поздних побочных эффектов;
vault restart/fill/delete/host/document; downloads файл/hash/progress/cancel/fail;
Research redirects/broken reads/source excerpts; IPC/MCP negatives;
Agent/Private proxy и storage isolation; target mapping одинаковых URL;
Shield до навигации, site exceptions, login/OAuth/WS/video.

P14 уже подтвердил отсутствие follow-up redirect и скрипта отложенной страницы
после отмены. P15 уже подтвердил document guard и локальную совместимость Shield.
Повтори их с общим набором, не переписывай успешные проверки без причины.

Дополнить отсутствующее фактическое доказательство:
- reload/navigation между запросом vault fill и выполнением, включая same-URL;
  уже проверенный re-entrant URL change не исчерпывает эту гонку;
- повреждение/прерывание сохранения vault/settings/session с рестартом процесса,
  исходный повреждённый файл и валидный backup сохраняются;
- ProcessFailed/lost interceptor → честный Shield UI и отсутствие ложного active;
- сохранение Shield enable/allowlist после restart;
- полный back/forward/reload, SPA history; проверить необходимость сохранения
  navigation stack: NavStack::to_session/from_session есть, но bootstrap_session
  не восстанавливает стек, а SessionStore сохранял пустую navigation.

Если выявлен функциональный дефект, исправь и повтори затронутые проверки.
Последний общий прогон после всех исправлений обязателен.
```

## R02 — закрыть производительность без изменения порогов

```text
Изучи P13 и сохранённый performance.json. Зафиксированный debug FAIL:
idle RAM 862208000 bytes (~822 MiB) > 600 MiB.
Остальные измерения того прогона: cold 1621 ms, warm 1502 ms,
navigate ack ~4.76 ms, idle CPU ~0.36%, 20 tabs ~1.82 GiB,
20-tab CPU ~0.49%, Shield overhead ~2.13%, cycles RAM ratio ~1.056.

Не объявляй это дефектом release без измерения release, но не скрывай FAIL.
Тот debug использовал Vite/HMR, и исходники менялись во время общего этапа.
Финальные измерения проводить на замороженном release без Vite/HMR,
без параллельных сборок и со всеми процессами приложения/WebView2 в учёте.
Не вычитать неудобные процессы, не менять метрику памяти или нормировку CPU.

Пороги: cold <=10 s; warm <=5 s; 5 min idle CPU <=3%; RAM <=600 MiB;
20 tabs RAM <=2.5 GiB, CPU <=15%; nav ack <=1.5 s;
STOP ack <=250 ms, controller drain <=2 s;
extract <=5 s для страницы <=200 KB; Shield median overhead <=15%;
после 10 open/close RAM <= первоначальный idle +20%.

При провале установить вклад процессов/окружений/WebView2, утечки listeners,
неосвобождённые tab handles, профили и ресурсы; исправить причину и повторить.
Проверка RAM после циклов сравнивается с первоначальным idle, не с памятью
после открытия 20 вкладок. Сохранять исходные и исправленные замеры.
```

## R03 — документы, нативный выбор и жизненный цикл вложений

```text
Не реализовывай PDF/DOCX заново. Rust parser, изолированный worker, корпус
и P09 уже есть. P09 проверяет реальный текст через оба bridge, но подставляет
файл через debug-only HAYDEV_TEST_PICK_FILE; OS dialog не проверен.

Пройди на release оба пользовательских пути настоящим Windows file dialog:
AgentPanel и internal newtab/search. Выбрать synthetic PDF/DOCX, получить
ответ по реальному содержимому: сумма 7319 AMD, Москва, Երևան, таблица Copper.
Проверь отмену диалога, отмену чтения, повреждённый/пустой/protected/scanned PDF,
лимиты, тайм-аут, worker kill и отсутствие дочерних процессов/временных файлов.
Не заменять подтверждение чтения анализом имени/MIME.

Проверить обнаруженный code-level разрыв: parsing cancellation регистрируется
после возврата run_file_dialog. STOP/cancel/timeout пока диалог открыт может
не отменять выбор; поздно выбранный файл может зарегистрироваться после отмены.
Воспроизвести, затем при необходимости добавить идентификатор и отмену pick job
до открытия диалога, запрет поздней регистрации и очистку по owner/navigation.

Проверить TTL, unknown ID, чужой owner, чужой run, повторное использование,
run rejected до binding, закрытие owner-tab, удаление pending attachment,
STOP/timeout, завершение/ошибка. Одинаковый контракт обоих путей.
Проверить, что worker действительно не выполняет внешние запросы/макросы;
различать отсутствие такого кода и доказанную OS-level изоляцию.

В UI уже есть уведомление: parsing локально, по Send содержимое идёт выбранной
LLM. Сопоставить это с обязательным gate data-sharing/opt-in в исходной матрице.
Если явное подтверждение не обеспечено, довести существующий поток и backend
контракт без молчаливой отправки. Никаких реальных документов или платных LLM.

Для Windows UI использовать доступный Computer Use skill/API; он был только
инициализирован в r08, действия с диалогом ещё не выполнялись.
Если доступ к desktop отсутствует, не подменять OS-dialog приёмку fixture.
```

## R04 — локализация и пользовательские ошибки

```text
Доведи HY/RU/EN на существующих поверхностях: chrome, AgentPanel, vault,
downloads, history/bookmarks, newtab/search/darkweb, attachment states,
privacy route, Shield, Research partial/conflicting/empty/error.
Не переводить пользовательские URL/имена файлов/контент и названия продукта.

Проверь переключение языка и restart во всех трёх языках на native приложении.
Ранее P05 проверял главным образом RU; наличие словарей не равно полной приёмке.
Проверь live error UI: corrupt store, WebView failure, отказ vault origin,
нет маршрута, неподдерживаемый Research proxy, timeout/ошибка документа,
отказ запуска агента и недоступный runtime.
Ошибки должны быть видимы, не [object Object], не успешная пустота,
не сырой provider payload/путь/пароль. Сохранять безопасный diagnostic code.
Проверить копирование ошибок и timeline на отсутствие чувствительных аргументов.
```

## R05 — зависимости, runtime и Windows CI

```text
Используй зафиксированные runtime-lock, python-requirements.lock,
Perplexica source-lock/overlay/npm lock и rust-toolchain.toml.
Bundled Node обязателен: runtime не должен требовать системный Node.
Проверь bundled SQLite ABI, Next startup/API/CORS и SearXNG health
скриптом scripts/check-bundled-runtimes.mjs после последней пересборки.
Tor только --version в локальном gate, без bootstrap/внешних запросов.

Повтори npm audit для приложения, production и полного Perplexica дерева,
cargo audit после pruning image features и Python advisory check по lock.
Составь DEPENDENCY_REVIEW с разделением app/runtime/dev/unused legacy.
Предыдущие результаты: app npm 0; Perplexica production 0; полное integration
дерево 11 dev advisories (braces/fast-glob/Tailwind3 и старый esbuild через
drizzle-kit). Проверить применимость: недоверенные glob patterns/dev server
не должны попадать в поставку. Не считать high advisory закрытым без triage.
Не делать audit fix --force и случайный major upgrade всего стека.

Предыдущий cargo audit: 0 vulnerabilities, 9 warnings. После image pruning
перепроверить граф: paste мог исчезнуть; glib/proc-macro-error Windows не входят;
ttf-parser относится к PDF parser, unic* — к Tauri. Unmaintained не скрывать
и не выдавать за отсутствие риска. Сохранить target-specific cargo tree.

Сверить checksums архивов, license/notices/inventory и состав shipped files.
Tor archive hash совпал с официальным sha256sums.txt; GPG signature не проверялась.
Оценить воспроизводимость сборки runtime, включая генерацию .next/pyc/native addons.

Windows workflow уже есть: .github/workflows/windows-closure.yml.
Проверить его команды и paths, fail-fast exit codes, pinning, artifact upload,
нативную доступность desktop и сохранение identity/evidence.
Tauri cargo flag: npm run build:tauri -- --ci -- --locked.
Обновить CI для release/native/picker gates без попытки включить debug exceptions
в release. Workflow в файле не считать выполненным GitHub Actions run.
Remote CI требует отдельного разрешения на push/dispatch, если его ещё нет.
```

## R06 — свежая Windows release/NSIS сборка и приёмка точного exe

```text
После R00–R05 заморозь исходный набор. Снимок должен включать dirty изменения.
Собери internal pages, renderer, runtimes, затем release + NSIS.
Сохрани exe/installer SHA-256, --build-identity, versions toolchain/WebView2,
runtime-manifest SHA и состав ресурсов. Проверь, что пакет не содержит .env,
ключи, synthetic provider data, соседние checkout и тестовые профили.
Не использовать старый release от 3 октября.

Проверь повторную сборку в изолированной копии текущих входов.
Не обещай побитную воспроизводимость без сравнения outputs и объяснения
недетерминированных полей. Для каждого артефакта свой hash и provenance.

Прогони native acceptance на release через HAYDEV_E2E_MODE=release и
HAYDEV_APP_BIN при необходимости. Сначала убедись, что app использует
встроенные assets, не Vite и не случайные resources рабочего checkout.

Не запускать весь debug набор вслепую: P06/P14 positive loopback web_fetch
и P09 fixture picker рассчитаны на debug-only exclusions. В release:
- доказать, что QA env не разрешают private/loopback SSRF;
- документы выбирать настоящим OS dialog;
- положительный public fetch проверять только разрешённым сетевым сценарием;
- сохранить все остальные применимые native/negative проверки.
Не делать эти ограничения skip-and-PASS.

Отдельно запусти release без HAYDEV_AUTOMATION_DEBUG и проверь отсутствие
debug CDP ports при работающих browser actions/screenshot/Shield/downloads.
Automation mode допускается только с изолированным data-root.
Повтори P13 release performance без параллельных сборок/изменений исходников.
```

## R07 — установленное приложение и внешние gates

```text
Подготовь воспроизводимый сценарий install → launch installed exe → native
acceptance → upgrade с synthetic data → uninstall → проверка остатков/процессов.
Проверь сохранение vault/session/settings/downloads при upgrade и определённую
политику пользовательских данных при uninstall. Данные только синтетические.
Installer SHA и hash запущенного installed exe должны совпадать с manifest.

Нужна выделенная Windows VM/тестовая машина без dev Node/Python.
На текущем host clean VM недоступна: Sandbox не включён, доступ к Hyper-V
инвентарю ранее отказан. Это не разрешение включать компоненты, менять security
или устанавливать поверх рабочего приложения. Зафиксировать BLOCKED_EXTERNAL,
если выделенное окружение не предоставлено; подготовку сценария всё равно завершить.

Отдельно: реальные LLM/thought_signature, search upstream, Tor/IP/DNS egress,
real OAuth и code signing. Только в явно разрешённом объёме/бюджете.
Синтетический SOCKS/OAuth/LLM и Tor --version не заменяют live acceptance.
Ключи не спрашивать в открытом тексте и не записывать в evidence.
Без разрешения записать BLOCKED_EXTERNAL с минимальным условием снятия.
```

## R08 — итоговая матрица и проверяемая передача

```text
Обнови STATE.md, ACCEPTANCE_MATRIX.md, DECISIONS.md, BLOCKERS.md и run-manifest.
Для каждого исходного MUST укажи PASS/FAIL/NOT_RUN/BLOCKED_EXTERNAL,
уровень проверки, build hash, log и фактический результат.
Старые таблицы 9 октября — история, не текущий сертификат.

Сохрани failed/superseded logs и объясни конкретную причину исправления:
P05 redundant navigation race; P12 Chromium loopback proxy bypass;
P15 fixture localPort; APISearchAgent setup-vs-runtime и ограничение workers.
Не включать fixture/harness исправление в список исправленных product defects.

Сформируй changed-files с назначением относительно baseline рабочего дерева,
а не только git diff относительно старого HEAD. Сохрани package/runtime
provenance, artifact hashes, установочный протокол и оставшиеся внешние gates.

Финал: что исправлено, что завершено функционально, чем подтверждено,
что осталось и почему, один честный итоговый статус.
INCOMPLETE при обязательном инженерном FAIL/NOT_RUN;
RELEASE_CANDIDATE только когда доступные инженерные работы завершены;
PRODUCTION_READY только при полной приёмке конкретного установленного артефакта.
Не объявляй готовность по количеству тестов или наличию exe.
```

## Команды для начала продолжения

Команды ниже запускать из `electron-app/`, последовательно проверяя exit codes. Создать новый run-id. Перед каждой финальной сборкой — свежий snapshot. Не запускать native acceptance одновременно с компиляцией того же exe.

```powershell
$runId = '20261015-continuation-r09'
node scripts/closure-evidence.mjs $runId snapshot baseline
node scripts/closure-evidence.mjs $runId run types npm run typecheck
node scripts/closure-evidence.mjs $runId run lint npm run lint
node scripts/closure-evidence.mjs $runId run unit npm test
# integration:prepare нужен при отсутствии/несоответствии generated checkout;
# сначала прочитать его проверку marker и сохранить любые локальные изменения.
node scripts/closure-evidence.mjs $runId run integration-types npm run typecheck:integration
node scripts/closure-evidence.mjs $runId run integration-tests npm run test:integration
node scripts/closure-evidence.mjs $runId run rust cargo test --locked --manifest-path src-tauri/Cargo.toml
node scripts/closure-evidence.mjs $runId run internal npm run build:internal-pages
node scripts/closure-evidence.mjs $runId run renderer npm run build:vite
node scripts/closure-evidence.mjs $runId run debug cargo build --locked --manifest-path src-tauri/Cargo.toml
node scripts/closure-evidence.mjs $runId run native npm run test:e2e
node scripts/closure-evidence.mjs $runId run runtime-offline node scripts/check-bundled-runtimes.mjs
# После исправлений, заморозки входов и завершения runtime bundle:
node scripts/closure-evidence.mjs $runId snapshot release-inputs
$env:HAYDEV_E2E_MODE = 'release'
node scripts/closure-evidence.mjs $runId run release npm run build:tauri -- --ci -- --locked
# Далее — адаптированная release acceptance; не слепой запуск debug fixtures.
Remove-Item Env:HAYDEV_E2E_MODE
```
