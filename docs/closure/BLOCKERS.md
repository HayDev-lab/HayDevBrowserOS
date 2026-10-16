# Актуальные блокеры и открытые gates — 2026-10-15 (r10)

**Локальный остаток r10 (не внешний блокер, но окружение):** контент-верифицированные документ-комбо на release (N04-DOCS) — интерактивные пики OS-dialog требуют монопольного фокуса рабочего стола; во время прогона десктоп занят активной сессией пользователя (focus-steal отклоняется UIA). Повтор возможен при свободном десктопе без каких-либо разрешений.

| ID | Область | Статус | Условие снятия |
|---|---|---|---|
| B08-LLM | Реальный провайдер LLM / signature / ответ на документ через выбранного провайдера | BLOCKED_EXTERNAL | Явно разрешённый провайдер, синтетические данные и бюджет; безопасный канал ключей |
| B08-TOR | Реальная Tor/IP/DNS сеть | BLOCKED_EXTERNAL | Отдельное разрешение на live сетевой тест; Tor --version/SOCKS fixture не заменяют его |
| B08-SEARCH | Live upstream search / real OAuth | BLOCKED_EXTERNAL | Разрешённый объём внешних запросов/аккаунтов |
| B08-CI | Remote Windows CI run | **CLEARED r10** — push разрешён, run 38843894496 success на windows-2025; последующие push перезапускают его автоматически | — |
| B08-VM | Чистая Windows install/upgrade/uninstall (протокол: INSTALL_PROTOCOL.md) | BLOCKED_EXTERNAL | Выделенная VM/машина |
| B08-SIGN | Signing или согласованный unsigned channel | BLOCKED_EXTERNAL | Сертификат либо явная unsigned policy |

---

# Актуальные блокеры и открытые gates — 2026-10-15 (r09, история)

**Внешние условия не оправдывают остановку доступных локальных этапов.** Локальные инженерные остатки r09: idle RAM архитектурное исправление (перенос шелла на pab://-bridge, DECISIONS #13); перенос user-data folder chrome-окружения под HAYDEV_DATA_DIR (DECISIONS #11, изоляция шелла); повторная сборка в изолированной копии (воспроизводимость); ProcessFailed нативная симуляция (сейчас code-path + защищённый lifecycle).

| ID | Область | Статус | Условие снятия |
|---|---|---|---|
| B08-LLM | Реальный провайдер LLM / signature / ответ на документ через выбранного провайдера | BLOCKED_EXTERNAL | Явно разрешённый провайдер, синтетические данные и бюджет; безопасный канал ключей |
| B08-TOR | Реальная Tor/IP/DNS сеть | BLOCKED_EXTERNAL | Отдельное разрешение на live сетевой тест; Tor --version/SOCKS fixture не заменяют его |
| B08-SEARCH | Live upstream search / real OAuth | BLOCKED_EXTERNAL | Разрешённый объём внешних запросов/аккаунтов |
| B08-CI | Remote Windows CI run (workflow готов и отревьюен локально) | BLOCKED_EXTERNAL | Отдельное разрешение на push/dispatch и доступный runner |
| B08-VM | Clean Windows installed acceptance/upgrade/uninstall (протокол готов: INSTALL_PROTOCOL.md) | BLOCKED_EXTERNAL | Выделенная VM/машина; Sandbox не включён, Hyper-V inventory ранее недоступен. Host install не выполнен |
| B08-SIGN | Signing или согласованный unsigned channel (installer unsigned) | BLOCKED_EXTERNAL | Подписывающая инфраструктура/сертификат либо явная unsigned policy |

Инструментальное ограничение из r08 (read-only `Get-CimInstance` «Отказано в доступе») в r09 НЕ воспроизводилось: процессные проверки (P13 sample, orphan-проверки, port scan) выполнялись штатно.

---

# Актуальные блокеры и открытые gates — 2026-10-15 (r08, история)

**Внешние условия не оправдывают остановку доступных локальных этапов R00–R06/R08.** Локальные инженерные остатки перечислены отдельно.

| ID | Область | Статус | Условие снятия |
|---|---|---|---|
| B08-LLM | Реальный провайдер LLM / signature | BLOCKED_EXTERNAL | Явно разрешённый провайдер, синтетические данные и бюджет; безопасный канал ключей |
| B08-TOR | Реальная Tor/IP/DNS сеть | BLOCKED_EXTERNAL | Отдельное разрешение на live сетевой тест; Tor --version/SOCKS fixture не заменяют его |
| B08-SEARCH | Live upstream search / real OAuth | BLOCKED_EXTERNAL | Разрешённый объём внешних запросов/аккаунтов |
| B08-CI | Remote Windows CI run | BLOCKED_EXTERNAL | Отдельное разрешение на push/dispatch и доступный runner; workflow локально уже создан |
| B08-VM | Clean Windows installed acceptance/upgrade/uninstall | BLOCKED_EXTERNAL | Выделенная VM/машина; Sandbox не включён, Hyper-V inventory ранее недоступен. Host install не выполнен |
| B08-SIGN | Signing или согласованный unsigned channel | BLOCKED_EXTERNAL | Подписывающая инфраструктура/сертификат либо явная unsigned policy |

Локальные незавершённые работы: общий freeze/build/native regression; idle RAM FAIL debug и неизвестный release; native OS picker и отмена pending pick; полная HY/RU/EN/error UI; итоговый dependency applicability review; свежий release/installer; preparation install/upgrade/uninstall сценария; финальная матрица на точный артефакт.

В конце сессии permission profile сменился на managed. Новый read-only `Get-CimInstance Win32_Process` вернул «Отказано в доступе». Это ограничение текущего инструмента, не найденный дефект приложения. При продолжении native process/performance checks использовать разрешённый доступ или явную процедуру расширения доступа, не выкидывать процессные проверки. Auto-review rejection не получен; новая escalation не запрашивалась.

---

## Исторические записи до r08

# BLOCKERS — внешние препятствия (инженерная работа продолжается независимо)

Формат: ID | gate | что нужно | минимальное действие для закрытия | статус.

| ID | Gate | Что нужно | Минимальное действие | Статус |
|---|---|---|---|---|
| B-01 | P04-05 live LLM smoke | Согласованный провайдер + тестовые данные + лимит расходов | Указать провайдера/ключ/бюджет | BLOCKED (ожидание решения) |
| B-02 | P02-07 реальный egress/DNS/IP-маршрут | Разрешение на фактический сетевой тест через Tor/прокси (замер внешнего IP, DNS) | Явное разрешение на сетевую live-проверку | BLOCKED (ожидание решения) |
| B-03 | P06-06 live search | Доступность upstream-провайдеров SearXNG/Perplexica из сети | Разрешение на live-запросы к поисковым upstream | BLOCKED (ожидание решения) |
| B-04 | P09-04 remote CI | Настроенный remote + доступ к GitHub Actions | Предоставить репозиторий/раннер | BLOCKED (нет настроенного remote) |
| B-05 | P11-03 code signing | Сертификат подписи | Предоставить сертификат или принять unsigned-канал с документацией | BLOCKED (сертификата нет) |
| B-06 | P11-01/02 чистая VM | Выделенная тестовая Windows-машина/VM без dev-инструментов | Согласовать тестовое окружение; до того — установка в изолированный профиль этой машины НЕ считается чистой-VM приёмкой | BLOCKED (окружение не согласовано) |

Правило: BLOCKED здесь не останавливает независимые инженерные части. Ни один BLOCKED не превращается в PASS.
