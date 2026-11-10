# WebView2: CDP только на время диагностики

Обычный `app.exe` запускается без CDP, в том числе в debug-сборке. Нативный агент использует `CoreWebView2.ExecuteScript` и захват кадров внутри процесса; постоянный Playwright/CDP ему не требуется.

## Схема

1. Агент запускает обычный процесс без `--debug` и CDP-аргументов.
2. По запросу диагностики `DebugBroker` штатно закрывает свой процесс через WM_CLOSE, сохраняя вкладки.
3. Запускает диагностический экземпляр с тем же выбранным каталогом данных, `--debug`, `HAYDEV_AUTOMATION_DEBUG=1` и выделенным портом. Аргументы WebView2 заданы до создания браузерного процесса.
4. Проверяет `/json/version`, фактическую привязку listener к loopback и принадлежность PID своему Windows Job Object. `0.0.0.0`, `::` и внешние адреса отклоняются. Endpoint — `http://127.0.0.1:<port>`.
5. Записывает подтверждённое открытие в `<data-dir>/logs/cdp-audit.jsonl`, затем подключает Playwright.
6. После disconnect, исключения, завершения контекста или тайм-аута закрывает диагностическое дерево, проверяет исчезновение listener и возвращает обычный процесс без CDP.

Закрытие соединения Playwright само по себе не выключает listener WebView2. Порт закрывает завершение диагностического браузерного процесса. Предусмотрено до 8 секунд для штатного выхода и затем очистка собственного дерева; тайм-аут инициирует закрытие, а не обещает нулевую задержку освобождения сокета.

Диагностический процесс создаётся приостановленным и до запуска помещается в Windows Job Object с `KILL_ON_JOB_CLOSE`. Авария контроллера завершает это дерево; восстановление обычного UI после жёсткой аварии контроллера требует внешнего supervisor. Нормальный процесс не имеет этого флага и может продолжать работать после выхода запускатора.

Флаг не является границей доверия между процессами одного Windows-пользователя. Очистка наследуемых CDP-аргументов меняет только окружение текущего процесса. Системные переменные и реестр не изменяются. Если строка дополнительных аргументов содержит CDP, очищается вся строка; строки без CDP сохраняются.

## Реализация

- `src-tauri/src/debugging.rs`: явное разрешение, очистка наследуемых CDP-параметров и аудит запроса.
- `src-tauri/src/core.rs`: loopback CDP-аргументы только для разрешённой диагностики; `browser_debug_port` возвращает `0` в обычном режиме.
- `scripts/diagnostics/windows_process.py`: приостановленный запуск, Windows Job Object, штатное закрытие и очистка своего дерева.
- `scripts/diagnostics/webview2_debug.py`: Python-контроллер, проверка listener, аудит, timeout и возврат к обычному режиму.
- `scripts/diagnostics/cdp-endpoint.mjs`: Node-подключение только к endpoint текущей диагностической сессии.

Для стандартного Python нужен пакет `playwright`; загружать Chromium не нужно, используется установленный WebView2.

```python
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(r"D:\Projects\BrowserHayDev\electron-app")
sys.path.insert(0, str(project / "scripts" / "diagnostics"))
from webview2_debug import DebugBroker

broker = DebugBroker(
    project / "src-tauri" / "target" / "debug" / "app.exe",
    project / "output" / "diagnostic-profile",
    max_seconds=300,
    extra_environment={"HAYDEV_QA_MODE": "1", "HAYDEV_NO_ENGINES": "1"},
)
broker.start_normal()  # Без CDP.

def diagnose_on_agent_request():
    with sync_playwright() as playwright:
        with broker.connect_playwright(playwright) as browser:
            return {"browser": browser.version, "contexts": len(browser.contexts)}
    # При выходе диагностический процесс закрывается, обычный восстанавливается.

# Агент вызывает функцию при необходимости, а не при обычном старте:
# diagnose_on_agent_request()
# Для Node: broker.run_node(project / "scripts" / "diagnostics" / "probe.mjs")
```

Контроллер управляет только созданным им экземпляром. Для release с single-instance сначала требуется штатно закрыть предыдущий экземпляр. Присоединение к чужому процессу и его завершение не выполняются.

## Проверка

`scripts/diagnostics/verify_debug_lifecycle.py` проверяет настоящий WebView2 и Python Playwright. Зафиксированы PASS:

- обычный процесс без CDP, включая попытку наследования `--remote-debugging-port`;
- реальное подключение Python `connect_over_cdp`;
- listener `127.0.0.1`, принадлежащий диагностическому дереву;
- закрытие порта после явного disconnect;
- сохранение вкладок при штатном перезапуске;
- очистка при исключении и по тайм-ауту;
- выполнение Node-скрипта через временный endpoint;
- четыре открытия/закрытия в отдельном аудите.

Внешняя модель не вызывалась. Проверка не устанавливает необнаружимость автоматизации или прохождение GeoComply.

Установленная сборка `D:\HayDevAcceptance\app.exe` также проверена через `verify_installed_normal.py`: UI доступен, Start включён, зашифрованный файл AI-настроек не изменился. После проверки остался обычный процесс PID `27548`, семь принадлежащих ему процессов WebView2 без CDP-аргументов; временный порт `60745` закрыт. SHA-256 установленного файла: `36DC49E8F4B16236EEADBE44F6AB9D39FB7FF2735BD30BC3D4AC4E1FEA5F1F9A`. PID относится только к моменту проверки. Предыдущий exe сохранён как `D:\HayDevAcceptance\app-before-demand-cdp-20261030.exe`.

## Почему постоянный CDP нежелателен

CDP предоставляет широкие возможности управления браузером. Команда Chrome описывает злоупотребления remote debugging для извлечения cookies и рекомендует изолировать отладку от реальных профилей: [Chrome for Developers](https://developer.chrome.com/blog/remote-debugging-port). Это основание сокращать время работы listener. Правила Chrome 136 не следует автоматически переносить на WebView2.

GeoComply описывает проверки целостности устройства, удалённого доступа, виртуализации, отладочных инструментов и манипуляций браузером: [официальный материал](https://www.geocomply.com/blog/compliance-readiness-playbook-why-your-geolocation-signal-is-the-foundation-under-every-compliance-control/). Источник не устанавливает конкретное правило «открыт 9222 — обнаружен бот». Поведение этой антифрод-системы здесь не тестировалось.

Документация API: [Playwright WebView2](https://playwright.dev/docs/webview2), [Python connect_over_cdp](https://playwright.dev/python/docs/api/class-browsertype#browser-type-connect-over-cdp), [Microsoft WebView2 flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags).
