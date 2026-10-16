/**
 * Dark Web Search page (pab://darkweb) — pure template builder.
 *
 * The page is served by the main process and talks ONLY to the same-origin
 * mini-API (darkweb-pab-api.ts) — it can never reach the network directly.
 * Visual language matches pab://search (deep-space theme + matrix rain).
 *
 * SECURITY:
 *   - Every external value (titles, snippets, URLs, statuses) is inserted
 *     via textContent — never HTML interpolation.
 *   - Preview renders the sanitized fragment inside an iframe with
 *     sandbox="" (scripts fully disabled) — defence in depth on top of the
 *     main-process sanitizer.
 *   - "Open" navigates to pab://darkweb/open?url=… which asks the MAIN
 *     process to open an isolated Tor tab; the page itself never loads
 *     onion content.
 *
 * `logoDataUrl` (optional) is the brand hero image as a `data:image/*`
 * URL injected by scripts/build-internal-pages.mjs from a repo asset — a
 * build-time constant, never user input, so direct interpolation is safe.
 *
 * `opts.lang` (optional, default 'en') picks the UI language ('en' | 'ru' |
 * 'hy') for every user-visible string; all copy flows through tr(), so the
 * 'en' output stays byte-identical to the pre-i18n page. The same
 * dictionary is embedded into the page script as window.__PAB_STRINGS__
 * (`</` escaped as `<\/`) for client-side rendered labels.
 *
 * PURE — no Electron imports.
 */
import { MATRIX_RAIN_CANVAS, buildMatrixRainScript } from '../../pure/matrix-rain';
import { parseAppLocale, type AppLocale } from '../../../../shared/app-locale';

export interface DarkWebPageOptions {
  /** UI language for the page chrome. Defaults to 'en'. */
  lang?: AppLocale;
}

const STRINGS: Record<AppLocale, Record<string, string>> = {
  en: {
    'page.title': 'Dark Web Search',
    'brand.tagline': 'Dark Web Search · Tor',
    'tor.checking': 'Tor: checking…',
    'tor.online': 'ONLINE',
    'tor.starting': 'STARTING…',
    'tor.offline': 'OFFLINE',
    'tor.checked': 'checked {t}',
    'tor.statusUnavailable': 'Tor: status unavailable',
    'dw.title': 'Dark Web Search',
    'dw.disabled': 'disabled',
    'search.placeholder': 'Search the dark web…',
    'search.ariaLabel': 'Dark web search query',
    'search.button': 'Search',
    'providers.label': 'Providers:',
    'filter.label': 'Filter',
    'filter.all': 'All',
    'filter.reachable': 'Reachable',
    'filter.recent': 'Recently checked',
    'sort.label': 'Sort',
    'sort.relevance': 'Relevance',
    'sort.availability': 'Availability',
    'sort.recent': 'Recent',
    'state.IDLE': 'IDLE',
    'state.SEARCHING': 'SEARCHING',
    'state.PARTIAL_RESULTS': 'PARTIAL_RESULTS',
    'state.DONE': 'DONE',
    'state.ERROR': 'ERROR',
    'state.CANCELLED': 'CANCELLED',
    'state.GONE': 'GONE',
    'stop': 'STOP',
    'empty.initial': 'Search is metadata-only — nothing opens until you click Open.',
    'empty.noResults': 'No results.',
    'empty.searching': 'Searching…',
    'panel.crawl': 'Crawl jobs',
    'crawl.none': 'No crawl jobs.',
    'crawl.stats': 'depth {d} · pages {p}/{m} · docs {n}',
    'crawl.dup': '(+{n} dup)',
    'crawl.refused': 'Crawl refused: {e}',
    'panel.downloads': 'Quarantined downloads',
    'downloads.none': 'No downloads waiting. Onion downloads are quarantined and never auto-run.',
    'dl.unknownType': 'unknown type',
    'dl.bytes': '{n} bytes',
    'dl.danger': 'EXECUTABLE/ARCHIVE — extra caution',
    'dl.saveAs': 'Save as…',
    'dl.discard': 'Discard',
    'panel.history': 'Search history &amp; local index',
    'history.clear': 'Clear Dark Web search history',
    'history.none': 'No search history.',
    'index.placeholder': 'Search local index…',
    'index.search': 'Search index',
    'index.clear': 'Clear local index',
    'index.noMatches': 'No matches in the local index.',
    'index.indexed': 'indexed {t}',
    'panel.settings': 'Settings → Dark Web',
    'settings.enable': 'Enable Dark Web Search',
    'settings.socksHost': 'Tor SOCKS host',
    'settings.port': 'port',
    'settings.spawn': 'Start bundled/installed tor if offline',
    'settings.timeout': 'Search timeout (ms)',
    'settings.resultLimit': 'Result limit',
    'settings.crawlDepth': 'Crawl depth',
    'settings.crawlPages': 'Crawl pages',
    'settings.checkAvail': 'Check onion availability through Tor after search',
    'settings.storeHistory': 'Store search history',
    'settings.storeIndex': 'Store local index',
    'settings.save': 'Save settings',
    'settings.saved': 'Saved.',
    'settings.saveFailed': 'Save failed.',
    'settings.safety': 'JavaScript is always OFF in onion tabs. Downloads are quarantined and never executed.',
    'preview.title': 'Preview',
    'preview.close': 'Close',
    'preview.note': 'Sanitized HTML, scripts disabled (sandboxed). This is a cached copy rendered by the app — links stay inert.',
    'preview.unavailable': 'Preview unavailable.',
    'preview.unavailableWith': 'Preview unavailable: {e}',
    'time.sAgo': '{n}s ago',
    'time.minAgo': '{n} min ago',
    'time.hAgo': '{n} h ago',
    'time.dAgo': '{n} d ago',
    'health.label': 'Health: {h}',
    'unit.ms': 'ms',
    'unit.s': 's',
    'error.prefix': 'Error: {m}',
    'search.failed': 'Search request failed.',
    'prov.results': '{n} results',
    'card.sources': 'Sources: {p}',
    'card.reachable': 'Reachable: {v}',
    'card.yes': 'Yes',
    'card.no': 'No',
    'card.unknown': 'Unknown',
    'card.checked': 'Checked: {t}',
    'card.lastSeen': 'Last seen: {t}',
    'act.open': 'Open',
    'act.preview': 'Preview',
    'act.copyUrl': 'Copy URL',
    'act.crawl': 'Crawl',
    'act.addIndex': 'Add to index',
  },
  ru: {
    'page.title': 'Поиск в даркнете',
    'brand.tagline': 'Поиск в даркнете · Tor',
    'tor.checking': 'Tor: проверка…',
    'tor.online': 'ДОСТУПЕН',
    'tor.starting': 'ЗАПУСК…',
    'tor.offline': 'НЕДОСТУПЕН',
    'tor.checked': 'проверено {t}',
    'tor.statusUnavailable': 'Tor: статус недоступен',
    'dw.title': 'Поиск в даркнете',
    'dw.disabled': 'отключено',
    'search.placeholder': 'Искать в даркнете…',
    'search.ariaLabel': 'Поисковый запрос (даркнет)',
    'search.button': 'Поиск',
    'providers.label': 'Провайдеры:',
    'filter.label': 'Фильтр',
    'filter.all': 'Все',
    'filter.reachable': 'Доступные',
    'filter.recent': 'Недавно проверенные',
    'sort.label': 'Сортировка',
    'sort.relevance': 'Релевантность',
    'sort.availability': 'Доступность',
    'sort.recent': 'Недавние',
    'state.IDLE': 'ОЖИДАНИЕ',
    'state.SEARCHING': 'ПОИСК',
    'state.PARTIAL_RESULTS': 'ЧАСТИЧНЫЕ РЕЗУЛЬТАТЫ',
    'state.DONE': 'ГОТОВО',
    'state.ERROR': 'ОШИБКА',
    'state.CANCELLED': 'ОТМЕНЕНО',
    'state.GONE': 'НЕ НАЙДЕНО',
    'stop': 'СТОП',
    'empty.initial': 'Поиск работает только с метаданными — ничего не откроется, пока вы не нажмёте «Открыть».',
    'empty.noResults': 'Нет результатов.',
    'empty.searching': 'Поиск…',
    'panel.crawl': 'Задачи обхода',
    'crawl.none': 'Задач обхода нет.',
    'crawl.stats': 'глубина {d} · страниц {p}/{m} · документов {n}',
    'crawl.dup': '(+{n} дубл.)',
    'crawl.refused': 'Обход отклонён: {e}',
    'panel.downloads': 'Загрузки в карантине',
    'downloads.none': 'Ожидающих загрузок нет. Загрузки из onion-сайтов помещаются в карантин и никогда не запускаются автоматически.',
    'dl.unknownType': 'неизвестный тип',
    'dl.bytes': '{n} байт',
    'dl.danger': 'ИСПОЛНЯЕМЫЙ/АРХИВ — повышенная осторожность',
    'dl.saveAs': 'Сохранить как…',
    'dl.discard': 'Удалить',
    'panel.history': 'История поиска и локальный индекс',
    'history.clear': 'Очистить историю поиска в даркнете',
    'history.none': 'История поиска пуста.',
    'index.placeholder': 'Поиск по локальному индексу…',
    'index.search': 'Искать в индексе',
    'index.clear': 'Очистить локальный индекс',
    'index.noMatches': 'В локальном индексе нет совпадений.',
    'index.indexed': 'проиндексировано {t}',
    'panel.settings': 'Настройки → Даркнет',
    'settings.enable': 'Включить поиск в даркнете',
    'settings.socksHost': 'Хост Tor SOCKS',
    'settings.port': 'порт',
    'settings.spawn': 'Запускать комплектный/установленный tor, если он недоступен',
    'settings.timeout': 'Тайм-аут поиска (мс)',
    'settings.resultLimit': 'Лимит результатов',
    'settings.crawlDepth': 'Глубина обхода',
    'settings.crawlPages': 'Страниц обхода',
    'settings.checkAvail': 'Проверять доступность onion-сайтов через Tor после поиска',
    'settings.storeHistory': 'Сохранять историю поиска',
    'settings.storeIndex': 'Сохранять локальный индекс',
    'settings.save': 'Сохранить настройки',
    'settings.saved': 'Сохранено.',
    'settings.saveFailed': 'Не удалось сохранить.',
    'settings.safety': 'В onion-вкладках JavaScript всегда отключён. Загрузки помещаются в карантин и никогда не выполняются.',
    'preview.title': 'Предпросмотр',
    'preview.close': 'Закрыть',
    'preview.note': 'Очищенный HTML, скрипты отключены (песочница). Это кешированная копия, отображаемая приложением, — ссылки остаются неактивными.',
    'preview.unavailable': 'Предпросмотр недоступен.',
    'preview.unavailableWith': 'Предпросмотр недоступен: {e}',
    'time.sAgo': '{n} с назад',
    'time.minAgo': '{n} мин назад',
    'time.hAgo': '{n} ч назад',
    'time.dAgo': '{n} д назад',
    'health.label': 'Состояние: {h}',
    'unit.ms': 'мс',
    'unit.s': 'с',
    'error.prefix': 'Ошибка: {m}',
    'search.failed': 'Не удалось выполнить запрос поиска.',
    'prov.results': '{n} рез.',
    'card.sources': 'Источники: {p}',
    'card.reachable': 'Доступен: {v}',
    'card.yes': 'Да',
    'card.no': 'Нет',
    'card.unknown': 'Неизвестно',
    'card.checked': 'Проверено: {t}',
    'card.lastSeen': 'Был(а) недавно: {t}',
    'act.open': 'Открыть',
    'act.preview': 'Предпросмотр',
    'act.copyUrl': 'Копировать URL',
    'act.crawl': 'Обход',
    'act.addIndex': 'Добавить в индекс',
  },
  hy: {
    'page.title': 'Որոնում Dark Web-ում',
    'brand.tagline': 'Որոնում Dark Web-ում · Tor',
    'tor.checking': 'Tor՝ ստուգում…',
    'tor.online': 'ՀԱՍԱՆԵԼԻ',
    'tor.starting': 'ՄԵԿՆԱՐԿՈՒՄ…',
    'tor.offline': 'ԱՆՀԱՍԱՆԵԼԻ',
    'tor.checked': 'ստուգված՝ {t}',
    'tor.statusUnavailable': 'Tor՝ կարգավիճակը հասանելի չէ',
    'dw.title': 'Որոնում Dark Web-ում',
    'dw.disabled': 'անջատված',
    'search.placeholder': 'Որոնել dark web-ում…',
    'search.ariaLabel': 'Որոնման հարցում՝ Dark Web',
    'search.button': 'Որոնում',
    'providers.label': 'Պրովայդերներ՝',
    'filter.label': 'Ֆիլտր',
    'filter.all': 'Բոլորը',
    'filter.reachable': 'Հասանելի',
    'filter.recent': 'Վերջերս ստուգված',
    'sort.label': 'Դասավորել',
    'sort.relevance': 'Արդիականություն',
    'sort.availability': 'Հասանելիություն',
    'sort.recent': 'Վերջիններ',
    'state.IDLE': 'ՍՊԱՍՈՒՄ',
    'state.SEARCHING': 'ՈՐՈՆՈՒՄ',
    'state.PARTIAL_RESULTS': 'ՄԱՍՆԱԿԻ ԱՐԴՅՈՒՆՔՆԵՐ',
    'state.DONE': 'ՊԱՏՐԱՍՏ Է',
    'state.ERROR': 'ՍԽԱԼ',
    'state.CANCELLED': 'ՉԵՂԱՐԿՎԱԾ',
    'state.GONE': 'ՉԿԱ',
    'stop': 'ԿԱՆԳՆԵՑՆԵԼ',
    'empty.initial': 'Որոնումը միայն մետատվյալներով է աշխատում՝ ոչինչ չի բացվի, մինչև սեղմեք «Բացել»։',
    'empty.noResults': 'Արդյունք չկա։',
    'empty.searching': 'Որոնում…',
    'panel.crawl': 'Հավաքագրման առաջադրանքներ',
    'crawl.none': 'Հավաքագրման առաջադրանքներ չկան։',
    'crawl.stats': 'խորություն {d} · էջեր {p}/{m} · փաստաթղթեր {n}',
    'crawl.dup': '(+{n} կրկ.)',
    'crawl.refused': 'Հավաքագրումը մերժվեց՝ {e}',
    'panel.downloads': 'Կարանտինում գտնվող ներբեռնումներ',
    'downloads.none': 'Սպասող ներբեռնումներ չկան։ Onion ներբեռնումները կարանտինացվում են և երբեք ինքնաբերաբար չեն գործարկվում։',
    'dl.unknownType': 'անհայտ տեսակ',
    'dl.bytes': '{n} բայթ',
    'dl.danger': 'ԳՈՐԾԱՐԿԵԼԻ/ԱՐԽԻՎ՝ լրացուցիչ զգուշություն',
    'dl.saveAs': 'Պահպանել որպես…',
    'dl.discard': 'Հեռացնել',
    'panel.history': 'Որոնման պատմություն և տեղային ինդեքս',
    'history.clear': 'Մաքրել Dark Web-ի որոնման պատմությունը',
    'history.none': 'Որոնման պատմություն չկա։',
    'index.placeholder': 'Որոնում տեղային ինդեքսում…',
    'index.search': 'Որոնել ինդեքսում',
    'index.clear': 'Մաքրել տեղային ինդեքսը',
    'index.noMatches': 'Տեղային ինդեքսում համընկնումներ չկան։',
    'index.indexed': 'ինդեքսավորված՝ {t}',
    'panel.settings': 'Կարգավորումներ → Dark Web',
    'settings.enable': 'Միացնել Dark Web որոնումը',
    'settings.socksHost': 'Tor SOCKS հոսթ',
    'settings.port': 'պորտ',
    'settings.spawn': 'Գործարկել ներառված/տեղադրված tor-ը, եթե այն անհասանելի է',
    'settings.timeout': 'Որոնման սպասման ժամանակ (մվ)',
    'settings.resultLimit': 'Արդյունքների սահման',
    'settings.crawlDepth': 'Հավաքագրման խորություն',
    'settings.crawlPages': 'Հավաքագրվող էջեր',
    'settings.checkAvail': 'Որոնումից հետո ստուգել onion կայքերի հասանելիությունը Tor-ով',
    'settings.storeHistory': 'Պահել որոնման պատմությունը',
    'settings.storeIndex': 'Պահել տեղային ինդեքսը',
    'settings.save': 'Պահպանել կարգավորումները',
    'settings.saved': 'Պահպանվեց։',
    'settings.saveFailed': 'Չհաջողվեց պահպանել։',
    'settings.safety': 'Onion ներդիրներում JavaScript-ը միշտ անջատված է։ Ներբեռնումները կարանտինացվում են և երբեք չեն կատարվում։',
    'preview.title': 'Նախադիտում',
    'preview.close': 'Փակել',
    'preview.note': 'Մաքրված HTML, սկրիպտներն անջատված են (ավազատուփ)։ Սա հավելվածի ցուցադրած պահված պատճենն է՝ հղումները ոչ ակտիվ են։',
    'preview.unavailable': 'Նախադիտումը հասանելի չէ։',
    'preview.unavailableWith': 'Նախադիտումը հասանելի չէ՝ {e}',
    'time.sAgo': '{n} վրց առաջ',
    'time.minAgo': '{n} րոպե առաջ',
    'time.hAgo': '{n} ժ առաջ',
    'time.dAgo': '{n} օր առաջ',
    'health.label': 'Վիճակ՝ {h}',
    'unit.ms': 'մվ',
    'unit.s': 'վ',
    'error.prefix': 'Սխալ՝ {m}',
    'search.failed': 'Որոնման հարցումը ձախողվեց։',
    'prov.results': '{n} արդյունք',
    'card.sources': 'Աղբյուրներ՝ {p}',
    'card.reachable': 'Հասանելի է՝ {v}',
    'card.yes': 'Այո',
    'card.no': 'Ոչ',
    'card.unknown': 'Անհայտ',
    'card.checked': 'Ստուգված՝ {t}',
    'card.lastSeen': 'Վերջին այց՝ {t}',
    'act.open': 'Բացել',
    'act.preview': 'Նախադիտում',
    'act.copyUrl': 'Պատճենել URL-ը',
    'act.crawl': 'Հավաքագրում',
    'act.addIndex': 'Ավելացնել ինդեքսում',
  },
};

function tr(lang: AppLocale, key: string, vars?: Record<string, string | number>): string {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Dictionary payload embedded into the page script (`</` escaped). */
const PAB_STRINGS_JSON = JSON.stringify(STRINGS).replace(/<\//g, '<\\/');

export function buildDarkWebPageHtml(logoDataUrl?: string, opts?: DarkWebPageOptions): string {
  const lang: AppLocale = parseAppLocale(opts?.lang);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${tr(lang, 'page.title')}</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background:
      radial-gradient(ellipse 60% 30% at 50% 0%, rgba(160,64,255,0.06) 0%, transparent 60%),
      #02040a;
    color: #eef5ff;
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    display: flex; flex-direction: column;
    padding: 20px clamp(20px, 5vw, 80px) 0;
  }
  body > *:not(#matrix-rain) { position: relative; z-index: 1; }
  .head { text-align: center; padding: 4px 0 14px; }
  .brand-logo {
    display: block; margin: 0 auto 12px;
    max-height: clamp(140px, 24vh, 210px); max-width: min(86vw, 440px); height: auto;
    filter: drop-shadow(0 10px 30px rgba(140,60,255,0.35)) drop-shadow(0 0 18px rgba(176,107,255,0.22));
  }
  .brand { font-size: 12px; letter-spacing: 0.34em; text-transform: uppercase; color: #c98bff; font-weight: 600; margin-bottom: 12px; }
  .statusline { display: flex; justify-content: center; gap: 10px; align-items: center; font-size: 12px; color: #a9bdd9; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(150,170,210,0.45); }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7a94; }
  .pill.tor-ready .dot { background: #35d07f; box-shadow: 0 0 8px rgba(53,208,127,0.8); }
  .pill.tor-offline .dot { background: #ff4d6d; box-shadow: 0 0 8px rgba(255,77,109,0.6); }
  .pill.tor-starting .dot { background: #ffb84d; animation: pulse 1.2s ease-in-out infinite; }
  .searchbar { display: flex; gap: 8px; width: min(720px, 92vw); margin: 14px auto 0; }
  .searchbar input {
    flex: 1; height: 44px; padding: 0 18px;
    background: rgba(8,14,28,0.72);
    border: 1px solid rgba(90,60,140,0.55); border-radius: 999px;
    color: #eef5ff; font-size: 15px; outline: none;
    transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
  }
  .searchbar input:focus { border-color: rgba(176,107,255,0.6); box-shadow: 0 0 22px rgba(176,107,255,0.18); }
  .searchbar input::placeholder { color: #8aa3c7; }
  .searchbar button {
    height: 44px; padding: 0 22px; border-radius: 999px; cursor: pointer;
    border: 1px solid rgba(176,107,255,0.5); background: rgba(176,107,255,0.14);
    color: #e6d5ff; font-size: 14px;
  }
  .searchbar button:disabled { opacity: 0.45; cursor: default; }
  .controls { width: min(720px, 92vw); margin: 10px auto 0; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; color: #bccbe8; }
  .controls label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; }
  .controls select { background: rgba(8,14,28,0.8); color: #cfe0ff; border: 1px solid rgba(90,60,140,0.4); border-radius: 8px; padding: 3px 6px; font-size: 12px; }
  .providerstrip { width: min(720px, 92vw); margin: 10px auto 0; display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; min-height: 20px; }
  .prov { padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(150,170,210,0.4); color: #bccbe8; }
  .prov.ok { border-color: rgba(53,208,127,0.5); color: #8eeebc; }
  .prov.err, .prov.timeout, .prov.no_tor { border-color: rgba(255,77,109,0.5); color: #ffa8bb; }
  .prov.pending { border-color: rgba(255,184,77,0.5); color: #ffd28f; }
  .statebar { width: min(720px, 92vw); margin: 12px auto 0; display: none; justify-content: space-between; align-items: center; font-size: 12px; color: #a9bdd9; }
  .statebar .st { display: inline-flex; gap: 8px; align-items: center; }
  .statebar .dot { width: 7px; height: 7px; border-radius: 50%; background: #b06bff; animation: pulse 1.2s ease-in-out infinite; }
  .statebar button { background: none; border: 1px solid rgba(255,77,109,0.5); color: #ff9fb2; border-radius: 8px; padding: 3px 12px; cursor: pointer; font-size: 12px; }
  .results { flex: 1; overflow-y: auto; width: min(720px, 92vw); margin: 14px auto 0; padding-bottom: 40px; display: flex; flex-direction: column; gap: 12px; }
  .card { background: rgba(8,14,28,0.72); border: 1px solid rgba(90,60,140,0.35); border-radius: 12px; padding: 14px 18px; }
  .card .t { font-size: 16px; font-weight: 600; color: #ecdcff; }
  .card .t a { color: #ecdcff; text-decoration: none; }
  .card .t a:hover { color: #c98bff; text-decoration: underline; }
  .card .s { font-size: 13px; line-height: 1.6; color: #d5dfee; margin-top: 5px; white-space: pre-wrap; word-break: break-word; }
  .card .u { font-size: 11px; color: #96a9c9; margin-top: 6px; word-break: break-all; }
  .card .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 7px; font-size: 11px; color: #b3c4e2; align-items: center; }
  .card .meta .r-yes { color: #8eeebc; } .card .meta .r-no { color: #ffa8bb; } .card .meta .r-unknown { color: #b3c4e2; }
  .card .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
  .card .acts button, .card .acts a {
    font-size: 11px; padding: 4px 12px; border-radius: 999px; cursor: pointer; text-decoration: none;
    border: 1px solid rgba(150,175,215,0.45); background: none; color: #bcd6ff; display: inline-block;
  }
  .card .acts a:hover, .card .acts button:hover { border-color: rgba(176,107,255,0.6); color: #ecdcff; }
  .empty { text-align: center; color: #a9bdd9; font-size: 13px; padding: 30px 0; }
  .error { color: #ff9fb2; font-size: 13px; text-align: center; padding: 16px 0; }
  details.panel { width: min(720px, 92vw); margin: 8px auto 0; border: 1px solid rgba(90,60,140,0.3); border-radius: 12px; background: rgba(8,14,28,0.5); }
  details.panel > summary { cursor: pointer; padding: 10px 16px; font-size: 12px; color: #bccbe8; letter-spacing: 0.06em; }
  details.panel > .inner { padding: 4px 16px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: #bccbe8; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .row input[type=text], .row input[type=number] {
    background: rgba(2,4,10,0.8); border: 1px solid rgba(90,60,140,0.4); color: #cfe0ff;
    border-radius: 8px; padding: 4px 8px; font-size: 12px;
  }
  .row input[type=number] { width: 90px; }
  .row button { background: none; border: 1px solid rgba(150,175,215,0.5); color: #bcd6ff; border-radius: 8px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
  .row button.danger { border-color: rgba(255,77,109,0.5); color: #ff9fb2; }
  .jobline, .dl-line, .hline { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-top: 1px solid rgba(90,60,140,0.2); padding-top: 6px; word-break: break-all; }
  .jobline .st-running { color: #ffd28f; } .jobline .st-done { color: #7fe0ae; } .jobline .st-cancelled, .jobline .st-error { color: #ff9fb2; }
  #preview-overlay { position: fixed; inset: 0; background: rgba(2,4,10,0.82); display: none; z-index: 50; align-items: center; justify-content: center; }
  #preview-box { width: min(860px, 94vw); height: 84vh; background: #060a14; border: 1px solid rgba(176,107,255,0.4); border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; }
  #preview-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; font-size: 13px; color: #ecdcff; gap: 10px; }
  #preview-head button { background: none; border: 1px solid rgba(150,175,215,0.5); color: #bcd6ff; border-radius: 8px; padding: 3px 12px; cursor: pointer; }
  #preview-frame { flex: 1; border: 0; background: #fff; }
  #preview-note { font-size: 11px; color: #bccbe8; padding: 6px 16px; }
  @keyframes pulse { 0%,100% { opacity: .3 } 50% { opacity: 1 } }
</style>
</head>
<body>
  ${MATRIX_RAIN_CANVAS}
  <div class="head">
    ${logoDataUrl ? `<img class="brand-logo" src="${logoDataUrl}" alt="HayDev Browser — DarkWebSearch logo">` : ''}
    <div class="brand">${tr(lang, 'brand.tagline')}</div>
    <div class="statusline">
      <span class="pill" id="tor-pill"><span class="dot"></span><span id="tor-label">${tr(lang, 'tor.checking')}</span></span>
      <span class="pill" id="dw-pill"><span id="dw-label">${tr(lang, 'dw.title')}</span></span>
    </div>
  </div>
  <form class="searchbar" id="form">
    <input id="input" placeholder="${tr(lang, 'search.placeholder')}" autocomplete="off" spellcheck="false" aria-label="${tr(lang, 'search.ariaLabel')}">
    <button type="submit" id="go">${tr(lang, 'search.button')}</button>
  </form>
  <div class="controls">
    <span>${tr(lang, 'providers.label')}</span>
    <span id="prov-checks" class="row"></span>
    <span style="flex:1"></span>
    <label>${tr(lang, 'filter.label')} <select id="filter"><option value="all">${tr(lang, 'filter.all')}</option><option value="reachable">${tr(lang, 'filter.reachable')}</option><option value="recent">${tr(lang, 'filter.recent')}</option></select></label>
    <label>${tr(lang, 'sort.label')} <select id="sort"><option value="score">${tr(lang, 'sort.relevance')}</option><option value="avail">${tr(lang, 'sort.availability')}</option><option value="recent">${tr(lang, 'sort.recent')}</option></select></label>
  </div>
  <div class="providerstrip" id="provstrip"></div>
  <div class="statebar" id="statebar">
    <span class="st"><span class="dot"></span><span id="state-label">${tr(lang, 'state.IDLE')}</span></span>
    <button type="button" id="stop">${tr(lang, 'stop')}</button>
  </div>
  <div class="results" id="results" aria-live="polite"><div class="empty">${tr(lang, 'empty.initial')}</div></div>

  <details class="panel" id="crawl-panel">
    <summary>${tr(lang, 'panel.crawl')}</summary>
    <div class="inner" id="crawl-list"><span>${tr(lang, 'crawl.none')}</span></div>
  </details>
  <details class="panel" id="downloads-panel">
    <summary>${tr(lang, 'panel.downloads')}</summary>
    <div class="inner" id="downloads-list"><span>${tr(lang, 'downloads.none')}</span></div>
  </details>
  <details class="panel" id="history-panel">
    <summary>${tr(lang, 'panel.history')}</summary>
    <div class="inner">
      <div class="row" id="history-list"></div>
      <div class="row"><button type="button" class="danger" id="clear-history">${tr(lang, 'history.clear')}</button></div>
      <div class="row">
        <input type="text" id="idx-q" placeholder="${tr(lang, 'index.placeholder')}" style="flex:1;min-width:220px">
        <button type="button" id="idx-go">${tr(lang, 'index.search')}</button>
      </div>
      <div class="row" id="idx-out"></div>
      <div class="row">
        <button type="button" class="danger" id="clear-index">${tr(lang, 'index.clear')}</button>
      </div>
    </div>
  </details>
  <details class="panel" id="settings-panel">
    <summary>${tr(lang, 'panel.settings')}</summary>
    <div class="inner">
      <div class="row"><label><input type="checkbox" id="set-enabled"> ${tr(lang, 'settings.enable')}</label></div>
      <div class="row">${tr(lang, 'settings.socksHost')} <input type="text" id="set-host" size="14"> ${tr(lang, 'settings.port')} <input type="number" id="set-port" min="1" max="65535"> <label><input type="checkbox" id="set-spawn"> ${tr(lang, 'settings.spawn')}</label></div>
      <div class="row">${tr(lang, 'settings.timeout')} <input type="number" id="set-sto" min="3000" max="120000"> · ${tr(lang, 'settings.resultLimit')} <input type="number" id="set-max" min="1" max="200"> · ${tr(lang, 'settings.crawlDepth')} <input type="number" id="set-depth" min="1" max="5"> · ${tr(lang, 'settings.crawlPages')} <input type="number" id="set-pages" min="1" max="200"></div>
      <div class="row"><label><input type="checkbox" id="set-avail"> ${tr(lang, 'settings.checkAvail')}</label></div>
      <div class="row"><label><input type="checkbox" id="set-hist"> ${tr(lang, 'settings.storeHistory')}</label> <label><input type="checkbox" id="set-idx"> ${tr(lang, 'settings.storeIndex')}</label></div>
      <div class="row"><button type="button" id="set-save">${tr(lang, 'settings.save')}</button><span id="set-msg"></span></div>
      <div class="row" style="color:#a9bdd9">${tr(lang, 'settings.safety')}</div>
    </div>
  </details>

  <div id="preview-overlay">
    <div id="preview-box">
      <div id="preview-head"><span id="preview-title">${tr(lang, 'preview.title')}</span><button type="button" id="preview-close">${tr(lang, 'preview.close')}</button></div>
      <div id="preview-note">${tr(lang, 'preview.note')}</div>
      <iframe id="preview-frame" sandbox=""></iframe>
    </div>
  </div>

<script>
  window.__PAB_LANG__ = ${JSON.stringify(lang)};
  window.__PAB_STRINGS__ = ${PAB_STRINGS_JSON};
(function () {
  'use strict';
  var LANG = window.__PAB_LANG__ || 'en';
  var DICTS = window.__PAB_STRINGS__ || {};
  function tr(key, vars) {
    var d = DICTS[LANG] || DICTS.en || {};
    var s = d[key] != null ? d[key] : ((DICTS.en && DICTS.en[key] != null) ? DICTS.en[key] : key);
    if (vars) for (var k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }
  var STATE_TEXT = {
    IDLE: tr('state.IDLE'), SEARCHING: tr('state.SEARCHING'), PARTIAL_RESULTS: tr('state.PARTIAL_RESULTS'),
    DONE: tr('state.DONE'), ERROR: tr('state.ERROR'), CANCELLED: tr('state.CANCELLED'), GONE: tr('state.GONE')
  };
  function stateText(s) { return STATE_TEXT[s] || s; }
  var $ = function (id) { return document.getElementById(id); };
  var form = $('form'), input = $('input'), go = $('go'), stop = $('stop');
  var results = $('results'), provstrip = $('provstrip'), statebar = $('statebar'), stateLabel = $('state-label');
  var currentSearchId = null, pollTimer = null, statusTimer = null, crawlTimer = null;
  var lastResults = [];
  var torReady = false;

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }
  function api(path, opts) {
    return fetch('/api/' + path, opts).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }
  function relTime(ts) {
    if (!ts) return '—';
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return tr('time.sAgo', { n: Math.round(s) });
    if (s < 3600) return tr('time.minAgo', { n: Math.round(s / 60) });
    if (s < 86400) return tr('time.hAgo', { n: Math.round(s / 3600) });
    return tr('time.dAgo', { n: Math.round(s / 86400) });
  }

  // ---- Tor status -------------------------------------------------------
  function refreshStatus() {
    api('status').then(function (r) {
      var t = r.body.tor || {};
      torReady = t.state === 'READY';
      var pill = $('tor-pill');
      pill.className = 'pill ' + (torReady ? 'tor-ready' : (t.state === 'STARTING' ? 'tor-starting' : 'tor-offline'));
      var label = 'Tor: ' + (t.state === 'READY' ? tr('tor.online') : t.state === 'STARTING' ? tr('tor.starting') : tr('tor.offline'));
      if (t.socksHost) label += ' · ' + t.socksHost + ':' + t.socksPort;
      if (torReady && t.latencyMs != null) label += ' · ' + t.latencyMs + ' ' + tr('unit.ms');
      if (t.lastCheckAt) label += ' · ' + tr('tor.checked', { t: relTime(t.lastCheckAt) });
      $('tor-label').textContent = label;
      $('tor-pill').title = t.detail || '';
      if (!$('dw-label').textContent.match(/·/)) {
        $('dw-label').textContent = tr('dw.title') + (r.body.enabled ? '' : ' · ' + tr('dw.disabled'));
      }
      renderProviderChecks(r.body.providers || []);
    }).catch(function () {
      $('tor-label').textContent = tr('tor.statusUnavailable');
    });
  }

  // ---- provider checkboxes ---------------------------------------------
  var providerEls = {};
  function renderProviderChecks(providers) {
    var box = $('prov-checks');
    box.textContent = '';
    providers.forEach(function (p) {
      var label = el('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = p.enabled;
      cb.disabled = !p.enabled && p.health === 'OFFLINE';
      label.appendChild(cb);
      label.appendChild(document.createTextNode(p.name + (p.requiresTor ? ' (Tor)' : '')));
      label.title = tr('health.label', { h: p.health }) + (p.lastLatencyMs != null ? ' · ' + p.lastLatencyMs + ' ' + tr('unit.ms') : '');
      box.appendChild(label);
      providerEls[p.id] = cb;
    });
  }

  // ---- search -----------------------------------------------------------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q || currentSearchId) return;
    var providers = Object.keys(providerEls).filter(function (id) { return providerEls[id].checked; });
    api('search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, providers: providers })
    }).then(function (r) {
      if (r.body.error) { showError(r.body.error); return; }
      currentSearchId = r.body.searchId;
      lastResults = [];
      renderProgress(r.body);
      renderResults(r.body);
      pollTimer = setInterval(function () { pollSearch(currentSearchId); }, 700);
    }).catch(function () { showError(tr('search.failed')); });
    input.value = '';
  });

  function pollSearch(id) {
    api('search/' + id).then(function (r) {
      if (r.body.error === 'NOT_FOUND') { stopPolling('GONE'); return; }
      renderProgress(r.body);
      renderResults(r.body);
      if (r.body.state === 'DONE' || r.body.state === 'ERROR' || r.body.state === 'CANCELLED') {
        stopPolling(r.body.state);
      }
    }).catch(function () { stopPolling('ERROR'); });
  }
  function stopPolling(state) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    currentSearchId = null;
    stateLabel.textContent = state ? stateText(state) : tr('state.IDLE');
    statebar.style.display = 'none';
    go.disabled = false;
    refreshStatus();
  }
  stop.addEventListener('click', function () {
    if (currentSearchId) api('search/' + currentSearchId + '/cancel', { method: 'POST' });
  });

  function showError(msg) {
    results.textContent = '';
    results.appendChild(el('div', 'error', tr('error.prefix', { m: msg })));
    stopPolling('ERROR');
  }

  function renderProgress(resp) {
    provstrip.textContent = '';
    Object.keys(resp.providers || {}).forEach(function (id) {
      var p = resp.providers[id];
      var cls = p.status === 'ok' ? 'ok' : (p.status === 'disabled' ? '' : p.status);
      var text = id + ' · ' + p.status + (p.status === 'ok' ? ' · ' + tr('prov.results', { n: p.resultCount }) + ' · ' + p.durationMs + ' ' + tr('unit.ms') : (p.errorCode ? ' · ' + p.errorCode : ''));
      provstrip.appendChild(el('span', 'prov ' + cls, text));
    });
    go.disabled = resp.state === 'SEARCHING' || resp.state === 'PARTIAL_RESULTS';
    statebar.style.display = go.disabled ? 'flex' : 'none';
    stateLabel.textContent = stateText(resp.state) + (resp.durationMs ? ' · ' + Math.round(resp.durationMs / 100) / 10 + tr('unit.s') : '');
  }

  // ---- result cards -------------------------------------------------------
  function filtered() {
    var f = $('filter').value, s = $('sort').value;
    var list = lastResults.slice();
    if (f === 'reachable') list = list.filter(function (r) { return r.reachable === 'yes'; });
    if (f === 'recent') list = list.filter(function (r) { return r.checkedAt != null; });
    if (s === 'avail') list.sort(function (a, b) { return (b.reachable === 'yes') - (a.reachable === 'yes') || b.score - a.score; });
    else if (s === 'recent') list.sort(function (a, b) { return (b.checkedAt || 0) - (a.checkedAt || 0); });
    else list.sort(function (a, b) { return b.score - a.score; });
    return list;
  }

  function renderResults(resp) {
    lastResults = resp.results || [];
    var list = filtered();
    results.textContent = '';
    if (list.length === 0) {
      results.appendChild(el('div', 'empty',
        resp.state === 'DONE' && lastResults.length === 0 ? tr('empty.noResults') : (go.disabled ? tr('empty.searching') : tr('empty.noResults'))));
      return;
    }
    list.forEach(function (r) { results.appendChild(card(r)); });
  }

  function card(r) {
    var c = el('div', 'card');
    var t = el('div', 't');
    var openLink = document.createElement('a');
    openLink.href = '/open?url=' + encodeURIComponent(r.url);
    openLink.textContent = r.title || r.url;
    t.appendChild(openLink);
    c.appendChild(t);
    if (r.snippet) c.appendChild(el('div', 's', r.snippet));
    c.appendChild(el('div', 'u', r.url));
    var meta = el('div', 'meta');
    meta.appendChild(el('span', null, tr('card.sources', { p: r.providers.join(' · ') })));
    var reach = el('span', 'r-' + r.reachable,
      tr('card.reachable', { v: r.reachable === 'yes' ? tr('card.yes') : r.reachable === 'no' ? tr('card.no') : tr('card.unknown') }));
    meta.appendChild(reach);
    meta.appendChild(el('span', null, tr('card.checked', { t: r.checkedAt ? relTime(r.checkedAt) : '—' })));
    if (r.lastSeen) meta.appendChild(el('span', null, tr('card.lastSeen', { t: relTime(r.lastSeen) })));
    c.appendChild(meta);

    var acts = el('div', 'acts');
    var mk = function (label, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    acts.appendChild(Object.assign(document.createElement('a'), { href: '/open?url=' + encodeURIComponent(r.url), textContent: tr('act.open') }));
    acts.appendChild(mk(tr('act.preview'), function () { preview(r.url); }));
    acts.appendChild(mk(tr('act.copyUrl'), function () { navigator.clipboard.writeText(r.url).catch(function () {}); }));
    acts.appendChild(mk(tr('act.crawl'), function () { crawl(r.url, 1, 25); }));
    acts.appendChild(mk(tr('act.addIndex'), function () {
      api('index/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: r.url }) });
    }));
    c.appendChild(acts);
    return c;
  }

  // ---- preview ------------------------------------------------------------
  function preview(url) {
    api('preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url }) })
      .then(function (r) {
        if (r.body.error) { window.alert(tr('preview.unavailableWith', { e: r.body.error })); return; }
        $('preview-title').textContent = r.body.title || url;
        $('preview-frame').srcdoc = '<body style="font-family:system-ui;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.6">' + r.body.html + '</body>';
        $('preview-overlay').style.display = 'flex';
      }).catch(function () { window.alert(tr('preview.unavailable')); });
  }
  $('preview-close').addEventListener('click', function () {
    $('preview-overlay').style.display = 'none';
    $('preview-frame').srcdoc = '';
  });

  // ---- crawl ---------------------------------------------------------------
  function crawl(url, depth, pages) {
    api('crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url, maxDepth: depth, maxPages: pages }) })
      .then(function (r) {
        if (r.body.error) { window.alert(tr('crawl.refused', { e: r.body.error })); return; }
        refreshCrawls();
        $('crawl-panel').open = true;
      });
  }
  function refreshCrawls() {
    api('crawls').then(function (r) {
      var box = $('crawl-list');
      var jobs = r.body || [];
      box.textContent = '';
      if (!jobs.length) { box.appendChild(el('span', null, tr('crawl.none'))); return; }
      var anyRunning = false;
      jobs.slice().reverse().forEach(function (j) {
        anyRunning = anyRunning || j.state === 'RUNNING' || j.state === 'QUEUED' || j.state === 'STOPPING';
        var line = el('div', 'jobline');
        line.appendChild(el('span', 'st-' + j.state.toLowerCase(), j.state));
        line.appendChild(el('span', null, j.seedUrl));
        line.appendChild(el('span', null, tr('crawl.stats', { d: j.maxDepth, p: j.pagesFetched, m: j.maxPages, n: j.docsAdded }) + (j.docsDuplicate ? tr('crawl.dup', { n: j.docsDuplicate }) : '')));
        if (j.state === 'RUNNING' || j.state === 'QUEUED' || j.state === 'STOPPING') {
          var b = document.createElement('button');
          b.type = 'button'; b.textContent = tr('stop'); b.className = 'danger';
          b.addEventListener('click', function () { api('crawl/' + j.jobId + '/cancel', { method: 'POST' }).then(refreshCrawls); });
          line.appendChild(b);
        }
        box.appendChild(line);
      });
      if (crawlTimer) { clearInterval(crawlTimer); crawlTimer = null; }
      if (anyRunning) crawlTimer = setInterval(refreshCrawls, 2000);
    });
  }

  // ---- downloads -------------------------------------------------------------
  function refreshDownloads() {
    api('downloads').then(function (r) {
      var box = $('downloads-list');
      var items = r.body.downloads || [];
      box.textContent = '';
      if (!items.length) { box.appendChild(el('span', null, tr('downloads.none'))); return; }
      items.forEach(function (d) {
        var line = el('div', 'dl-line');
        line.appendChild(el('strong', null, d.filename));
        line.appendChild(el('span', null, (d.mimeType || tr('dl.unknownType')) + ' · ' + tr('dl.bytes', { n: d.sizeBytes })));
        line.appendChild(el('span', null, d.sourceUrl));
        if (d.dangerous) line.appendChild(el('span', 'st-error', tr('dl.danger')));
        line.appendChild(el('span', null, d.state));
        if (d.state === 'QUARANTINED') {
          var save = document.createElement('button');
          save.type = 'button'; save.textContent = tr('dl.saveAs');
          save.addEventListener('click', function () { api('downloads/' + d.id + '/save', { method: 'POST' }).then(refreshDownloads); });
          var discard = document.createElement('button');
          discard.type = 'button'; discard.textContent = tr('dl.discard'); discard.className = 'danger';
          discard.addEventListener('click', function () { api('downloads/' + d.id + '/discard', { method: 'POST' }).then(refreshDownloads); });
          line.appendChild(save); line.appendChild(discard);
        }
        box.appendChild(line);
      });
    });
  }

  // ---- history + local index ---------------------------------------------------
  function refreshHistory() {
    api('history').then(function (r) {
      var box = $('history-list');
      box.textContent = '';
      var entries = r.body.entries || [];
      if (!entries.length) { box.appendChild(el('span', null, tr('history.none'))); return; }
      entries.slice(0, 12).forEach(function (h) {
        var line = el('span', 'hline', h.query + ' — ' + new Date(h.at).toLocaleString());
        box.appendChild(line);
      });
    });
  }
  $('clear-history').addEventListener('click', function () {
    api('history/clear', { method: 'POST' }).then(refreshHistory);
  });
  $('idx-go').addEventListener('click', function () {
    var q = $('idx-q').value.trim();
    var out = $('idx-out');
    out.textContent = '';
    if (!q) return;
    api('index/search?q=' + encodeURIComponent(q)).then(function (r) {
      var hits = r.body.hits || [];
      if (!hits.length) { out.appendChild(el('span', null, tr('index.noMatches'))); return; }
      hits.forEach(function (h) {
        var line = el('div', 'jobline');
        line.appendChild(el('strong', null, h.title));
        line.appendChild(el('span', null, h.url));
        line.appendChild(el('span', null, tr('index.indexed', { t: relTime(h.fetchedAt) })));
        out.appendChild(line);
      });
    });
  });
  $('clear-index').addEventListener('click', function () {
    api('index/clear', { method: 'POST' }).then(function () { $('idx-out').textContent = ''; });
  });

  // ---- settings -------------------------------------------------------------
  function loadSettings() {
    api('settings').then(function (r) {
      var c = r.body;
      $('set-enabled').checked = !!c.enabled;
      $('set-host').value = (c.tor && c.tor.socksHost) || '127.0.0.1';
      $('set-port').value = (c.tor && c.tor.socksPort) || 9050;
      $('set-spawn').checked = !!(c.tor && c.tor.spawnIfAvailable);
      $('set-sto').value = c.search && c.search.globalTimeoutMs;
      $('set-max').value = c.search && c.search.maxResults;
      $('set-depth').value = c.crawler && c.crawler.maxDepth;
      $('set-pages').value = c.crawler && c.crawler.maxPages;
      $('set-avail').checked = !!(c.search && c.search.availability && c.search.availability.enabled);
      $('set-hist').checked = !!c.storeSearchHistory;
      $('set-idx').checked = !!c.storeLocalIndex;
    });
  }
  $('set-save').addEventListener('click', function () {
    var patch = {
      enabled: $('set-enabled').checked,
      storeSearchHistory: $('set-hist').checked,
      storeLocalIndex: $('set-idx').checked,
      tor: { socksHost: $('set-host').value.trim(), socksPort: Number($('set-port').value), spawnIfAvailable: $('set-spawn').checked },
      search: { globalTimeoutMs: Number($('set-sto').value), maxResults: Number($('set-max').value), availability: undefined },
      crawler: { maxDepth: Number($('set-depth').value), maxPages: Number($('set-pages').value) }
    };
    patch.search.availability = { enabled: $('set-avail').checked };
    api('settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
      .then(function () { $('set-msg').textContent = tr('settings.saved'); refreshStatus(); })
      .catch(function () { $('set-msg').textContent = tr('settings.saveFailed'); });
  });

  // ---- boot -------------------------------------------------------------------
  $('filter').addEventListener('change', function () { renderResults({ state: go.disabled ? 'SEARCHING' : 'DONE', results: lastResults }); });
  $('sort').addEventListener('change', function () { renderResults({ state: go.disabled ? 'SEARCHING' : 'DONE', results: lastResults }); });
  refreshStatus();
  refreshCrawls();
  refreshDownloads();
  refreshHistory();
  loadSettings();
  statusTimer = setInterval(refreshStatus, 8000);
  // Engine routing from the Matrix New Tab: pab://darkweb?q=… auto-runs
  // the query through the real Tor-gated search pipeline above.
  try {
    var initialQuery = new URLSearchParams(window.location.search).get('q');
    if (initialQuery && initialQuery.trim()) {
      input.value = initialQuery.trim();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  } catch (e) { /* malformed query string — ignore */ }
})();
</script>
<script>
  ${buildMatrixRainScript()}
</script>
</body>
</html>`;
}
