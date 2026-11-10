import { useEffect, useRef, useState } from 'react';
import { HAYDEV_VPN_NAME, type HayDevVpnStatus, type WindowsRoutes } from '@shared/ipc-types';
import { useI18n } from '../../i18n';
import { platformApi } from '../../platform';

const copy = {
  en: {
    close: 'Close', country: 'Country', recommended: 'Automatic · recommended', fastest: 'Fastest server',
    connect: 'Connect', disconnect: 'Disconnect VPN', login: 'Sign in to Mozilla', account: 'Mozilla account',
    preparing: 'Preparing VPN…', retry: 'Retry', off: 'Disconnected', ready: 'Connected', blocked: 'Connection interrupted',
    scope: 'The Arman proxy routes only tabs opened here. Other tabs, search, the agent and Windows apps keep their own routes.', first: 'Sign in to your Mozilla account once to connect.',
    switch: 'Disconnect to change country. VPN tabs close when disconnected.', url: 'Site address', open: 'Open VPN tab', exit: 'Exit country',
    unavailable: 'VPN could not start. Retry to prepare the connection automatically.',
    core: 'The VPN component is missing or could not start. Retry or reinstall this browser build.',
    policy: 'The provider is controlling the system network. Turn off its system VPN before connecting here.',
    failed: 'Connection check failed. Check your account or choose another country.',
    location: 'Could not save this country. Refresh the server list and try again.',
    locations: 'Could not load countries. Retry to refresh the list.',
    mismatch: 'The provider reported a different exit country. Disconnect and choose another country.',
    invalid: 'Enter a valid HTTP or HTTPS address.', error: 'Operation failed',
    override: 'Reopen BrowserHayDev normally to use VPN.',
  },
  ru: {
    close: 'Закрыть', country: 'Страна', recommended: 'Автоматически · рекомендованный сервер', fastest: 'Самый быстрый сервер',
    connect: 'Подключить', disconnect: 'Отключить VPN', login: 'Войти в Mozilla', account: 'Аккаунт Mozilla',
    preparing: 'Подготавливаем VPN…', retry: 'Повторить', off: 'Отключено', ready: 'Подключено', blocked: 'Связь прервана',
    scope: 'Прокси Arman действует на открытые здесь вкладки. У остальных вкладок, поиска, агента и приложений Windows свои маршруты.', first: 'Для первого подключения войдите в свой аккаунт Mozilla.',
    switch: 'Чтобы сменить страну, отключите VPN. При отключении VPN-вкладки закроются.', url: 'Адрес сайта', open: 'Открыть VPN-вкладку', exit: 'Страна выхода',
    unavailable: 'Не удалось запустить VPN. Нажмите «Повторить» для автоматической подготовки.',
    core: 'Компонент VPN отсутствует или не запускается. Повторите запуск или переустановите эту сборку браузера.',
    policy: 'Провайдер управляет сетью всего устройства. Отключите его системный VPN перед подключением здесь.',
    failed: 'Соединение не прошло проверку. Проверьте аккаунт или выберите другую страну.',
    location: 'Не удалось сохранить страну. Обновите список серверов и попробуйте снова.',
    locations: 'Не удалось загрузить страны. Нажмите «Повторить», чтобы обновить список.',
    mismatch: 'Провайдер сообщил другую страну выхода. Отключитесь и выберите другую страну.',
    invalid: 'Введите корректный адрес HTTP или HTTPS.', error: 'Не удалось выполнить операцию',
    override: 'Откройте BrowserHayDev обычным способом для работы VPN.',
  },
  hy: {
    close: 'Փակել', country: 'Երկիր', recommended: 'Ավտոմատ · առաջարկվող սերվեր', fastest: 'Ամենաարագ սերվեր',
    connect: 'Միացնել', disconnect: 'Անջատել VPN-ը', login: 'Մուտք գործել Mozilla', account: 'Mozilla հաշիվ',
    preparing: 'VPN-ի պատրաստում…', retry: 'Կրկնել', off: 'Անջատված է', ready: 'Միացված է', blocked: 'Կապն ընդհատվել է',
    scope: 'Arman պրոքսին գործում է այստեղ բացված ներդիրների համար։ Մյուս ներդիրները, որոնումը, գործակալը և Windows-ի ծրագրերն ունեն իրենց երթուղիները։', first: 'Միանալու համար մեկ անգամ մուտք գործեք Mozilla հաշիվ։',
    switch: 'Երկիրը փոխելու համար անջատեք VPN-ը։ VPN ներդիրները կփակվեն։', url: 'Կայքի հասցե', open: 'Բացել VPN ներդիր', exit: 'Ելքի երկիր',
    unavailable: 'VPN-ը չի գործարկվել։ Կրկնեք ավտոմատ պատրաստումը։',
    core: 'VPN բաղադրիչը բացակայում է կամ չի գործարկվում։ Կրկնեք կամ վերատեղադրեք զննարկիչը։',
    policy: 'Մատակարարը կառավարում է սարքի ցանցը։ Նախ անջատեք դրա համակարգային VPN-ը։',
    failed: 'Միացման ստուգումը ձախողվեց։ Ստուգեք հաշիվը կամ ընտրեք այլ երկիր։',
    location: 'Երկիրը չի պահպանվել։ Թարմացրեք ցուցակը և կրկնեք։',
    locations: 'Երկրների ցուցակը չի բեռնվել։ Թարմացնելու համար կրկնեք։',
    mismatch: 'Մատակարարը հայտնել է այլ ելքի երկիր։ Անջատեք և ընտրեք այլ երկիր։',
    invalid: 'Մուտքագրեք վավեր HTTP կամ HTTPS հասցե։', error: 'Գործողությունը ձախողվեց',
    override: 'VPN-ի համար վերաբացեք BrowserHayDev-ը սովորական եղանակով։',
  },
};

const routingCopy = {
  en: {
    tor: 'Tor tabs', torScope: 'Free TCP proxy for tabs opened here. DNS for site addresses goes through Tor. UDP and QUIC are blocked in these tabs.',
    torOpen: 'Open Tor tab', torWait: 'Opening Tor tab…', torOffline: 'The bundled Tor proxy is still starting or unavailable. Try again when Tor is ready.',
    windows: 'VPN for Windows', setup: 'Install the official Proton VPN client, sign in to Proton Free, and enable Advanced kill switch before connecting. Keep split tunneling off.',
    restore: 'To restore normal connectivity, disable Advanced kill switch and disconnect in Proton VPN.',
    download: 'Get Proton VPN Free', guide: 'Kill switch instructions', check: 'Check Windows routes',
    routeScope: 'Local interface lookup for one destination per IP family. Verifying protection requires a traffic and kill switch test.',
    missing: 'No interface found', routeError: 'Could not read the Windows routes.',
  },
  ru: {
    tor: 'Tor-вкладки', torScope: 'Бесплатный TCP-прокси для открытых здесь вкладок. DNS для адресов сайтов проходит через Tor. UDP и QUIC в этих вкладках заблокированы.',
    torOpen: 'Открыть Tor-вкладку', torWait: 'Открываем Tor-вкладку…', torOffline: 'Встроенный Tor запускается или недоступен. Повторите, когда Tor будет готов.',
    windows: 'VPN для Windows', setup: 'Установите официальный Proton VPN, войдите в Proton Free и включите Advanced kill switch перед подключением. Оставьте раздельное туннелирование выключенным.',
    restore: 'Для возврата к обычному подключению выключите Advanced kill switch и отключитесь в Proton VPN.',
    download: 'Скачать Proton VPN Free', guide: 'Инструкция по kill switch', check: 'Проверить маршруты Windows',
    routeScope: 'Локальная проверка интерфейса для одного адреса IPv4 и одного IPv6. Защита подтверждается проверкой трафика и kill switch.',
    missing: 'Интерфейс не найден', routeError: 'Не удалось прочитать маршруты Windows.',
  },
  hy: {
    tor: 'Tor ներդիրներ', torScope: 'Անվճար TCP պրոքսի՝ այստեղ բացված ներդիրների համար։ Կայքերի DNS հարցումներն անցնում են Tor-ով։ Այս ներդիրներում UDP-ն ու QUIC-ն արգելափակված են։',
    torOpen: 'Բացել Tor ներդիր', torWait: 'Բացվում է Tor ներդիրը…', torOffline: 'Ներկառուցված Tor-ը դեռ գործարկվում է կամ հասանելի չէ։ Կրկնեք, երբ Tor-ը պատրաստ լինի։',
    windows: 'VPN Windows-ի համար', setup: 'Տեղադրեք պաշտոնական Proton VPN-ը, մուտք գործեք Proton Free և միանալուց առաջ միացրեք Advanced kill switch-ը։ Split tunneling-ը թողեք անջատված։',
    restore: 'Սովորական կապը վերականգնելու համար Proton VPN-ում անջատեք Advanced kill switch-ը և անջատվեք VPN-ից։',
    download: 'Ներբեռնել Proton VPN Free', guide: 'Kill switch-ի հրահանգներ', check: 'Ստուգել Windows-ի երթուղիները',
    routeScope: 'Մեկ IPv4 և մեկ IPv6 հասցեների ինտերֆեյսի տեղային ստուգում։ Պաշտպանությունը հաստատելու համար ստուգեք տրաֆիկը և kill switch-ը։',
    missing: 'Ինտերֆեյսը չի գտնվել', routeError: 'Չհաջողվեց կարդալ Windows-ի երթուղիները։',
  },
};

const errors: Partial<Record<string, keyof typeof copy.en>> = {
  ARMAN_VPN_ACCOUNT_REQUIRED: 'first', ARMAN_VPN_CORE_MISSING: 'core',
  ARMAN_VPN_CORE_UNAVAILABLE: 'unavailable', ARMAN_VPN_DATA_FOLDER: 'unavailable',
  ARMAN_VPN_ROUTING_POLICY: 'policy', ARMAN_VPN_TUNNEL_CHECK: 'failed',
  ARMAN_VPN_PROXY_OFF: 'failed', ARMAN_VPN_PROXY_CHANGED: 'failed',
  ARMAN_VPN_COUNTRY_MISMATCH: 'mismatch', ARMAN_VPN_LOCATION: 'location',
  ARMAN_VPN_WEBVIEW_OVERRIDE: 'override', ARMAN_VPN_URL: 'invalid',
};

let preparation: Promise<HayDevVpnStatus> | null = null;
function prepare() {
  // React StrictMode and reopening the panel share one in-flight preparation.
  if (!preparation) preparation = platformApi.haydevVpn!.prepare().finally(() => { preparation = null; });
  return preparation;
}

export function HayDevVpnPanel({ onClose, onTabsChanged }: { onClose: () => void; onTabsChanged: () => Promise<void> }) {
  const { lang } = useI18n();
  const text = copy[lang];
  const routing = routingCopy[lang];
  const api = platformApi.haydevVpn!;
  const [status, setStatus] = useState<HayDevVpnStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [errorCode, setErrorCode] = useState('');
  const [url, setUrl] = useState('');
  const [torUrl, setTorUrl] = useState('');
  const [torBusy, setTorBusy] = useState(false);
  const [torError, setTorError] = useState('');
  const [routes, setRoutes] = useState<WindowsRoutes | null>(null);
  const [routeError, setRouteError] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void prepare().then(value => { if (active) setStatus(value); }).catch(error => {
      if (active) setErrorCode(error?.code || 'ARMAN_VPN_CORE_UNAVAILABLE');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; mounted.current = false; };
  }, []);

  useEffect(() => {
    if (busy || !status) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const current = generation.current;
    const poll = async () => {
      try {
        const value = await api.status();
        if (active && current === generation.current) setStatus(previous => ({
          ...value, locationsIssue: previous?.locationsIssue || value.locationsIssue,
        }));
      } catch { /* Keep the last state while a one-off local read retries. */ }
      finally { if (active) timer = setTimeout(() => void poll(), 3000); }
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [api, busy, !!status]);

  async function run(action: () => Promise<HayDevVpnStatus | void>) {
    generation.current += 1;
    setBusy(true);
    setErrorCode('');
    try {
      const value = await action();
      if (mounted.current && value) setStatus(value);
    } catch (error) {
      if (mounted.current) setErrorCode(typeof error === 'object' && error && 'code' in error ? String(error.code) : 'ARMAN_VPN_ERROR');
    } finally { if (mounted.current) setBusy(false); }
  }

  function countryName(code: string, fallback = code) {
    try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || fallback; }
    catch { return fallback; }
  }

  async function openTorTab() {
    setTorBusy(true);
    setTorError('');
    try {
      await api.openTorTab(torUrl.trim());
      await onTabsChanged();
      onClose();
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? error.code : '';
      setTorError(code === 'TOR_TAB_NOT_READY' ? routing.torOffline : code === 'TOR_TAB_URL' ? text.invalid
        : code === 'ARMAN_VPN_WEBVIEW_OVERRIDE' ? text.override : text.error);
    } finally {
      setTorBusy(false);
    }
  }

  async function checkWindowsRoutes() {
    setRouteError(false);
    setRoutes(null);
    try {
      setRoutes(await api.windowsRoutes());
    } catch {
      setRouteError(true);
    }
  }

  function openProtonPage(url: string) {
    return run(async () => {
      await platformApi.browser.openTab({ url, activate: true });
      await onTabsChanged();
      onClose();
    });
  }

  const attached = status?.state === 'ready' || status?.state === 'blocked';
  const needsLogin = status?.issue === 'ARMAN_VPN_ACCOUNT_REQUIRED';
  const issue = errorCode || (needsLogin ? '' : status?.issue) || '';
  const issueKey = errors[issue];
  const selection = status?.selection || '';
  const locations = status?.locations || [];

  return <section className="panel panel--settings panel--vpn" aria-label={HAYDEV_VPN_NAME}>
    <header className="panel__header">
      <h2>{HAYDEV_VPN_NAME}</h2>
      <button type="button" className="panel__close" aria-label={text.close} onClick={onClose}>×</button>
    </header>
    <div className="panel__body ai-settings__body">
      <p>{text.scope}</p>
      <div className="vpn-status" role="status" data-testid="arman-vpn-state" data-state={status?.state}>
        {busy ? text.preparing : status ? text[status.state] : text.off}
      </div>
      <label>{text.country}
        <select value={selection} disabled={busy || attached || !status} onChange={event => void run(() => api.setLocation(event.target.value))}>
          <option value="">{text.recommended}</option>
          <option value="fastest">{text.fastest}</option>
          {selection && selection !== 'fastest' && !locations.some(location => location.code === selection) && <option value={selection}>{countryName(selection)}</option>}
          {locations.map(location => <option key={location.code} value={location.code}>{countryName(location.code, location.name)}</option>)}
        </select>
      </label>
      {attached && <small>{text.switch}</small>}
      {status?.exitCountry && attached && <p>{text.exit}: {countryName(status.exitCountry)}</p>}
      {needsLogin && <p>{text.first}</p>}
      {issue && <p className="vpn-alert" role="alert">{issueKey ? text[issueKey] : text.error}</p>}
      {!busy && (!status || status.locationsIssue) && <>
        {status?.locationsIssue && <p className="vpn-alert" role="alert">{text.locations}</p>}
        <button type="button" className="vpn-button" onClick={() => void run(prepare)}>{text.retry}</button>
      </>}
      {status && !attached && <>
        <button type="button" className="vpn-button vpn-button--primary" disabled={busy}
          onClick={() => void run(needsLogin ? api.openSettings : api.connect)}>{needsLogin ? text.login : text.connect}</button>
        {!needsLogin && <button type="button" className="vpn-button" disabled={busy} onClick={() => void run(api.openSettings)}>{text.account}</button>}
      </>}
      {attached && <>
        <button type="button" className="vpn-button vpn-button--primary" disabled={busy} onClick={() => void run(async () => {
          const next = await api.disconnect(); await onTabsChanged(); return next;
        })}>{text.disconnect}</button>
        <form className="vpn-fields" onSubmit={event => {
          event.preventDefault();
          if (!busy && status.state === 'ready' && url.trim()) void run(async () => { await api.openTab(url.trim()); await onTabsChanged(); });
        }}>
          <label>{text.url}<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" disabled={busy} /></label>
          <button type="submit" className="vpn-button" disabled={busy || status.state !== 'ready' || !url.trim()}>{text.open}</button>
        </form>
      </>}
      <details className="vpn-fields">
        <summary>{routing.tor}</summary>
        <p>{routing.torScope}</p>
        <form className="vpn-fields" onSubmit={event => {
          event.preventDefault();
          if (!torBusy && torUrl.trim()) void openTorTab();
        }}>
          <label>{text.url}<input type="url" value={torUrl} onChange={event => setTorUrl(event.target.value)} placeholder="https://example.com" disabled={torBusy} /></label>
          <button type="submit" className="vpn-button" disabled={torBusy || !torUrl.trim()}>{torBusy ? routing.torWait : routing.torOpen}</button>
        </form>
        {torError && <p className="vpn-alert" role="alert">{torError}</p>}
      </details>
      <details className="vpn-fields">
        <summary>{routing.windows}</summary>
        <p>{routing.setup}</p>
        <p>{routing.restore}</p>
        <div className="vpn-fields">
          <button type="button" className="vpn-button" onClick={() => void openProtonPage('https://protonvpn.com/free-vpn/windows')}>{routing.download}</button>
          <button type="button" className="vpn-button" onClick={() => void openProtonPage('https://protonvpn.com/support/what-is-kill-switch')}>{routing.guide}</button>
          <button type="button" className="vpn-button" onClick={() => void checkWindowsRoutes()}>{routing.check}</button>
        </div>
        <p>{routing.routeScope}</p>
        {routeError && <p className="vpn-alert" role="alert">{routing.routeError}</p>}
        {routes && <ul role="status">
          <li>IPv4 — {routes.ipv4?.name ?? routing.missing}</li>
          <li>IPv6 — {routes.ipv6?.name ?? routing.missing}</li>
        </ul>}
      </details>
    </div>
  </section>;
}
