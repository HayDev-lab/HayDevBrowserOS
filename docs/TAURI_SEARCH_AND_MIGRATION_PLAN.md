# План: все виды поиска + полная миграция в Tauri 2

> **СТАТУС (2026-10-01): Фазы 0, 1 и 2 ВЫПОЛНЕНЫ** — коммиты `9bcb90e`…`e482207`.
> Осталась Фаза 3 (финиш миграции: E2E-матрица, NSIS-бандл, чистая машина).
> Все live-проверки велись через CDP/MCP против работающего debug-билда.

Дата: 2026-09-30. Основа: аудит Electron (`src/main`) и Tauri (`src-tauri/src`) версий.
Главная предпосылка: код порта в хорошем состоянии, блокеры — среда сборки (MSVC) и
 остаточные пробелы parity.

---

## Фаза 0 — Разблокировать сборку (препосылка, без неё всё остальное стоит)

| # | Задача | Детали |
|---|--------|--------|
| 0.1 | Установить VS Build Tools 2022 + «Desktop development with C++» | Минимум: MSVC v143 + Windows 11 SDK. Дают `link.exe` и `rc.exe` |
| 0.2 | Развести порты dev-режима | `tauri.conf.json`: `devUrl` 5173 → **5180** (5173 занят vite проекта JARVIS-CLAW); закрепить `server.port` в `vite.renderer.config.ts` |
| 0.3 | Проверить сборку | `npm run dev:tauri` → окно открывается, оболочка грузится, cargo без паник |
| 0.4 | Закоммитить `src-tauri/` | Сейчас весь порт — untracked в git; риск потерять работу |

**Критерий готовности:** `npm run dev:tauri` и `cargo build --release` проходят с нуля на этой машине.

---

## Фаза 1 — Все виды поиска: довести до «идеально работает» (пп. 1–2 плана)

Инвентаризация поисков и их статус в Tauri:

| Поиск | Electron | Tauri | Статус |
|---|---|---|---|
| Адресная строка (URL vs запрос, движок) | `url-utils.ts` | `urlnorm.rs` | ✅ parity |
| История (подстрока) | `history-store.ts` | `stores.rs` | ✅ parity |
| SearXNG (метапоиск, порт 8888) | `search-services.ts` | `runtime_manager.rs` | ✅ parity |
| Perplexica AI-поиск (порт 3000) | `search-services.ts` | `runtime_manager.rs` | ⚠️ частично |
| Страница `pab://search` (режимы web/discussions/academic/Deep Research/Dark Web) | `search-page.ts` | `pab.rs` | ⚠️ Deep Research отключён |
| Стартовая `pab://newtab` (движки haydev/perplexity/darkweb, вложения) | `newtab-page.ts` | `pab.rs` | ⚠️ кнопки вложений скрыты |
| Darkweb-поиск (Ahmia + Tor66 через SOCKS) | `darkweb-service.ts` | `darkweb.rs` | ⚠️ работает, но с пробелами |
| Deep Research (агент) | `agent-controller` | `agent.rs` | ⚠️ без вложений |
| MCP-сервер с darkweb-инструментами (порт 27301) | `mcp-server.ts` | — | ❌ отсутствует |
| Darkweb: crawler / индекс / карантин загрузок | `crawler.ts` и др. | 501 | ❌ отсутствует |

### 1.1 Perplexica — надёжность ответа (S)
- Порт `resolvePreferredChatModel` (Electron: `search-services.ts:52-80`): живая проба
  моделей Gemini 1-токеновым запросом перед отдачей `pab://search` — иначе бесконечный
  спиннер на мёртвой модели. Tauri сейчас просто подставляет env/дефолт (`pab.rs:293-296`).
- Досеивать NVIDIA NIM-провайдер в конфиг Perplexica (Electron: `search-services.ts:301-315`),
  Taurи сеет только Gemini (`runtime_manager.rs:678-741`).

### 1.2 Мост `__pabNewTab` для pab-страниц (M)
Electron инжектит `window.__pabNewTab` (`pickAttachment`, `runResearch`) в `pab://newtab`
и `pab://search` (tab-preload). В Tauri инжекта нет → кнопки вложений прячутся, режим
Deep Research на странице поиска отключается. Сделать:
- Tauri-команды `newtab_pick_attachment(kind)` (диалог файла) и `newtab_run_research(...)`;
- инжект инициализирующего скрипта в pab-вебвью (init-script, как сделано для vault-capture
  в `core.rs:221`), повторяющий контракт `__pabNewTab`;
- фича-детект на страницах уже есть — после инжекта кнопки включатся сами.

### 1.3 Darkweb-поиск — жёсткость и честность (S–M)
- Применить `global_timeout_ms` в `DarkWebService::search()` (сейчас хранится, но не
  применяется — `darkweb.rs:898-1042`; Electron убивает джобу по бюджету:
  `search-service.ts:160-166`).
- Настраиваемые веса ранжирования из конфига (сейчас захардкожено 2.0 против
  конфигурируемого дефолта 3.0 — `darkweb.rs:613-614`).
- `api/preview`: отдавать санитизированный HTML (крейт `ammonia`), а не извлечённый
  текст — иначе оверлей предпросмотра на странице деградирует (`pab.rs:508-522`).

### 1.4 Tor — устойчивость (M)
- Bootstrap-процент через control-port + cookie auth (порт `tor-service.ts:97-113`).
- Поиск бинарника Tor: `PAB_TOR_PATH`, установка Tor Browser, PATH (порт
  `findTorBinary`, `tor-runtime.ts`) — сейчас только бандл (`runtime_manager.rs:802-806`).
- Настройка darkweb «запустить tor, если офлайн»: спавн tor по требованию
  (сейчас инертна — только runtime_manager).

**Критерий готовности фазы 1:** каждый вид поиска открывается, отвечает и не зависает:
адресная строка → SearXNG/Perplexica/darkweb; `pab://search` во всех 5 режимах;
newtab с движками и вложениями; darkweb-поиск с таймаутами и предпросмотром.

---

## Фаза 2 — Недоработки parity вне поиска (п. 2 плана) — ✅ ВЫПОЛНЕНА

Итоги (см. git-лог за деталями):
- 2.3 ✅ vision-вложения: image-pipeline на pick (≤1024 модель / 192 thumb),
  content-parts в первом сообщении агента, ретрай без картинок; `agent_pick_attachment` реальный
- 2.1 ✅ crawler (BFS, воркер-пул, дедуп FNV-1a parity) + локальный индекс
  (darkweb-index.json, keyword-скоринг) + карантин загрузок (intercept по
  darkweb-вкладке, Save/Discard, wipe на выходе); все /api/* эндпоинты реальны
- 2.2 ✅ MCP-сервер (std::net, 8 darkweb-тулов) — верифицирован живьём
- 2.4 ✅ memory prompts: стор + memory.save + KNOWN FACTS в промпте
- 2.5 ⚠️ download cancel: wry 0.55 не даёт cancel-хендла (проверено по исходникам
  wry) — остаётся честный DOWNLOAD_CANCEL_UNSUPPORTED; единственный осознанный gap
- 2.6 ⏸ dev-checkout Perplexica — не делался (dev-удобство, отложено)

Проверенный список honest-gaps (заявлен в `lib.rs:14-15` + найдено при аудите):

| # | Пробел | Electron-референс | Оценка |
|---|--------|--------------------|--------|
| 2.1 | Darkweb crawler + локальный индекс + карантин загрузок (un-501: `pab.rs:528-537`) | `crawler.ts`, `local-index.ts`, `download-quarantine.ts` | L |
| 2.2 | MCP-сервер + инструменты `darkweb_*` | `mcp-server.ts`, `mcp-tool-registry.ts:223-302` | M |
| 2.3 | Вложения агента (+ vision-изображения, дайджесты) | `newtab-ipc-handlers.ts:187-248` | M |
| 2.4 | Memory prompts | `ipc-handlers.ts` | S |
| 2.5 | Download cancel (исследовать API WebView2 через wry; иначе честный ERROR) | `ipc-handlers.ts` | S/M |
| 2.6 | Perplexica dev-checkout runtime (`PAB_PERPLEXICA_DIR`) — dev-удобство, низкий приоритет | `haydev-runtime-manager.ts:96-110` | S |

Порядок: 2.3 → 2.1 → 2.2 → 2.4 → 2.5 → 2.6 (вложения разблокируют Deep Research
на полную, crawler закрывает крупнейший функциональный блок).

---

## Фаза 3 — Завершить миграцию (п. 3 плана)

**Решение по Electron (3.4, зафиксировано 2026-10-01):** код Electron-рантайма
(`electron-app/src/main|preload`) ЗАМОРАЖИВАЕТСЯ в репозитории как эталон parity —
не удаляется. Tauri — единственный активный рантайм; Electron-исходники служат
справочником при будущих доработках и для golden-сверок. Синхронные правки в нём
допустимы только если чинят общий баг (пример: битый tor66-адрес исправлен в обоих).

| # | Задача | Статус |
|---|--------|--------|
| 3.1 | E2E-матрица всех поисков и команд ExposedApi на Tauri-сборке | выполняется 2026-10-01 |
| 3.2 | `tauri build` → NSIS-установщик; бандл `internal/` + `resources/runtimes/` | сборка 2026-10-01 |
| 3.3 | JSON-сторы (darkweb-config/history/index, memory, сессии) читаются обоими рантаймами из одного userData | ✅ подтверждено форматами (memory.json/darkweb-index.json — общая схема) |
| 3.4 | Electron замораживается (см. решение выше) | ✅ |
| 3.5 | Коммит, тег `tauri-v1` | после 3.1–3.2 |

Внимание при 3.2: НЕ запускать `cargo build` (debug) параллельно с `tauri build` —
build-скрипты конфликтуют за resources/runtimes/.tmp (проверено 2026-10-01).

**Приборка (2026-10-01):** старый `target/` (22 ГБ) удалён; актуальный артефакт и
тёплый кэш релиза — в `target2/` (установщик: `target2/release/bundle/nsis/
HayDevBrowser_0.1.0_x64-setup.exe`, 212.5 МБ). Остаток ~3.7 МБ в `target/` (4 каталога
движков) держат системные хендлы — уйдут при перезагрузке. Следующая сборка пойдёт
в `target/` с нуля (~5–8 мин на deps).

---

## Зависимости и порядок

```
Фаза 0 (сборка) ──► Фаза 1 (поиски) ──► Фаза 3 (финиш)
                        │
                        └──► Фаза 2 (остальные gaps) ──► Фаза 3
```

Фазы 1 и 2 можно делать параллельно после Фазы 0; Фаза 3 — только после обеих.

## Риски

- **WebView2 ≠ Chromium**: мульти-webview API Tauri `unstable` — могут всплыть
  расхождения вёрстки/поведения вкладок; тестировать на каждом этапе Фазы 1.
- **Crawler/preview в Rust**: санитизация HTML — брать `ammonia`, не писать свою.
- **MCP-порт 27301**: при переносе сохранить контракт инструментов, чтобы внешние
  агенты не сломались.
