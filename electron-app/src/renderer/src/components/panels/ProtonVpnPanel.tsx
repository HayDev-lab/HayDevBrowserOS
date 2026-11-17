import { useEffect, useState } from 'react';
import { PROTON_VPN_NAME, type WindowsRoutes } from '@shared/ipc-types';
import { useI18n } from '../../i18n';
import { platformApi } from '../../platform';

const copy = {
  en: {
    close: 'Close',
    setup: 'Connect in the official Proton VPN client for Windows. Proton Free requires a Proton account.',
    protection: 'Enable Advanced kill switch and keep split tunneling off to block internet traffic outside the VPN.',
    restore: 'To return to your usual Windows connection, turn off Advanced kill switch and disconnect in Proton VPN.',
    download: 'Official download',
    install: 'Install Proton VPN Free',
    open: 'Open Proton VPN',
    checkingClient: 'Checking for Proton VPN…',
    installing: 'Downloading and installing Proton VPN…',
    opening: 'Opening Proton VPN…',
    installed: 'Proton VPN is installed. Open it to sign in and connect.',
    cancelled: 'Windows cancelled Proton VPN setup. Select Install to try again.',
    restartRequired: 'Restart Windows to finish Proton VPN setup.',
    downloadFailed: 'Could not download the official client. Check your connection and try again.',
    unverified: 'Windows could not verify the Proton VPN file. Use the official download to reinstall it.',
    setupFailed: 'Proton VPN setup did not complete. Try again or use the official download.',
    busy: 'Proton VPN setup is already running. Wait for it to finish.',
    guide: 'Kill switch instructions',
    check: 'Check Windows routes',
    checking: 'Checking Windows routes…',
    routeScope: 'The route check shows the selected Windows interfaces. Connection and kill switch status are shown in Proton VPN.',
    missing: 'No selected route',
    error: 'Could not complete the action.',
  },
  ru: {
    close: 'Закрыть',
    setup: 'Подключитесь в официальном клиенте Proton VPN для Windows. Для Proton Free нужна учётная запись Proton.',
    protection: 'Включите Advanced kill switch и оставьте раздельное туннелирование выключенным, чтобы блокировать интернет-трафик вне VPN.',
    restore: 'Для возврата к обычному подключению выключите Advanced kill switch и отключитесь в Proton VPN.',
    download: 'Официальная загрузка',
    install: 'Установить Proton VPN Free',
    open: 'Открыть Proton VPN',
    checkingClient: 'Проверяем, установлен ли Proton VPN…',
    installing: 'Скачиваем и устанавливаем Proton VPN…',
    opening: 'Открываем Proton VPN…',
    installed: 'Proton VPN установлен. Откройте его, чтобы войти и подключиться.',
    cancelled: 'Windows отменила установку Proton VPN. Нажмите «Установить», чтобы повторить попытку.',
    restartRequired: 'Перезапустите Windows, чтобы завершить установку Proton VPN.',
    downloadFailed: 'Не удалось скачать официальный клиент. Проверьте соединение и повторите попытку.',
    unverified: 'Windows не удалось проверить файл Proton VPN. Переустановите клиент с официального сайта.',
    setupFailed: 'Установка Proton VPN прервалась. Повторите попытку или скачайте клиент с официального сайта.',
    busy: 'Установка Proton VPN уже запущена. Дождитесь её завершения.',
    guide: 'Инструкция по kill switch',
    check: 'Проверить маршруты Windows',
    checking: 'Проверяем маршруты Windows…',
    routeScope: 'Проверка показывает выбранные Windows сетевые интерфейсы. Статус подключения и kill switch отображается в Proton VPN.',
    missing: 'Маршрут отсутствует',
    error: 'Не удалось выполнить действие.',
  },
  hy: {
    close: 'Փակել',
    setup: 'Միացեք Windows-ի պաշտոնական Proton VPN հավելվածում։ Proton Free-ի համար անհրաժեշտ է Proton հաշիվ։',
    protection: 'Միացրեք Advanced kill switch-ը և Split tunneling-ը թողեք անջատված՝ VPN-ից դուրս ինտերնետ տրաֆիկը արգելափակելու համար։',
    restore: 'Սովորական կապին վերադառնալու համար անջատեք Advanced kill switch-ը և անջատվեք Proton VPN-ում։',
    download: 'Պաշտոնական ներբեռնում',
    install: 'Տեղադրել Proton VPN Free',
    open: 'Բացել Proton VPN-ը',
    checkingClient: 'Ստուգում ենք՝ տեղադրված է արդյոք Proton VPN-ը…',
    installing: 'Ներբեռնում և տեղադրում ենք Proton VPN-ը…',
    opening: 'Բացում ենք Proton VPN-ը…',
    installed: 'Proton VPN-ը տեղադրված է։ Բացեք այն՝ մուտք գործելու և միանալու համար։',
    cancelled: 'Windows-ը չեղարկեց Proton VPN-ի տեղադրումը։ Կրկին փորձելու համար սեղմեք «Տեղադրել»։',
    restartRequired: 'Վերագործարկեք Windows-ը՝ Proton VPN-ի տեղադրումն ավարտելու համար։',
    downloadFailed: 'Չհաջողվեց ներբեռնել պաշտոնական հավելվածը։ Ստուգեք կապը և կրկին փորձեք։',
    unverified: 'Windows-ը չկարողացավ ստուգել Proton VPN-ի ֆայլը։ Վերատեղադրեք այն պաշտոնական կայքից։',
    setupFailed: 'Proton VPN-ի տեղադրումը չավարտվեց։ Կրկին փորձեք կամ ներբեռնեք պաշտոնական կայքից։',
    busy: 'Proton VPN-ն արդեն տեղադրվում է։ Սպասեք տեղադրման ավարտին։',
    guide: 'Kill switch-ի հրահանգներ',
    check: 'Ստուգել Windows-ի երթուղիները',
    checking: 'Windows-ի երթուղիների ստուգում…',
    routeScope: 'Ստուգումը ցույց է տալիս Windows-ի ընտրած ցանցային միջերեսները։ Կապի և kill switch-ի կարգավիճակը ցուցադրվում է Proton VPN-ում։',
    missing: 'Երթուղի չկա',
    error: 'Չհաջողվեց կատարել գործողությունը։',
  },
} as const;

const SETUP_ERRORS = {
  PROTON_VPN_CANCELLED: 'cancelled',
  PROTON_VPN_RESTART_REQUIRED: 'restartRequired',
  PROTON_VPN_DOWNLOAD_FAILED: 'downloadFailed',
  PROTON_VPN_UNVERIFIED: 'unverified',
  PROTON_VPN_SETUP_FAILED: 'setupFailed',
  PROTON_VPN_BUSY: 'busy',
} as const;

function errorMessage(error: unknown, fallback: 'error' | 'setupFailed'): keyof typeof copy.en {
  const code = (error as { code?: string } | null)?.code;
  if (code && Object.hasOwn(SETUP_ERRORS, code)) return SETUP_ERRORS[code as keyof typeof SETUP_ERRORS];
  return fallback;
}

export function ProtonVpnPanel({ onClose, onTabsChanged }: {
  onClose: () => void;
  onTabsChanged: () => Promise<void>;
}) {
  const { lang } = useI18n();
  const text = copy[lang];
  const [routes, setRoutes] = useState<WindowsRoutes | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<keyof typeof text | null>(null);
  const client = platformApi.protonVpn;
  const [installed, setInstalled] = useState(false);
  const [action, setAction] = useState<'checkingClient' | 'installing' | 'opening' | null>(
    client ? 'checkingClient' : null,
  );

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.installed().then(value => {
      if (active) setInstalled(value);
    }).catch(error => {
      if (active) setAlert(errorMessage(error, 'error'));
    }).finally(() => {
      if (active) setAction(null);
    });
    return () => { active = false; };
  }, [client]);

  async function useClient() {
    if (!client || action) return;
    setAlert(null);
    setAction(installed ? 'opening' : 'installing');
    try {
      if (installed) {
        await client.open();
      } else {
        await client.install();
        setInstalled(true);
      }
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'PROTON_VPN_MISSING') setInstalled(false);
      setAlert(errorMessage(error, installed ? 'error' : 'setupFailed'));
    } finally {
      setAction(null);
    }
  }

  async function checkRoutes() {
    if (!platformApi.windowsRoutes) return;
    setBusy(true);
    setAlert(null);
    setRoutes(null);
    try {
      setRoutes(await platformApi.windowsRoutes());
    } catch {
      setAlert('error');
    } finally {
      setBusy(false);
    }
  }

  async function openProtonPage(url: string) {
    setAlert(null);
    try {
      await platformApi.browser.openTab({ url, activate: true });
      await onTabsChanged();
      onClose();
    } catch {
      setAlert('error');
    }
  }

  return (
    <section className="panel panel--settings panel--vpn" aria-label={PROTON_VPN_NAME}>
      <header className="panel__header">
        <h2>{PROTON_VPN_NAME}</h2>
        <button type="button" className="panel__close" aria-label={text.close} onClick={onClose}>×</button>
      </header>
      <div className="panel__body ai-settings__body">
        <p>{text.setup}</p>
        <p>{text.protection}</p>
        <div className="vpn-fields">
          {client && <button type="button" className="vpn-button vpn-button--primary" disabled={action !== null}
            onClick={() => void useClient()}>
            {action ? text[action] : installed ? text.open : text.install}
          </button>}
          {(!client || !installed) && <button type="button" className="vpn-button"
            onClick={() => void openProtonPage('https://protonvpn.com/download-windows')}>{text.download}</button>}
          <button type="button" className="vpn-button"
            onClick={() => void openProtonPage('https://protonvpn.com/support/what-is-kill-switch')}>{text.guide}</button>
          <button type="button" className="vpn-button" disabled={busy} onClick={() => void checkRoutes()}>
            {busy ? text.checking : text.check}
          </button>
        </div>
        {alert && <p className="vpn-alert" role="alert">{text[alert]}</p>}
        {!alert && action === null && installed && <p role="status">{text.installed}</p>}
        {routes && <div role="status">
          <p>{text.routeScope}</p>
          <ul>
            <li>IPv4 — {routes.ipv4?.name ?? text.missing}</li>
            <li>IPv6 — {routes.ipv6?.name ?? text.missing}</li>
          </ul>
        </div>}
        <small>{text.restore}</small>
      </div>
    </section>
  );
}
