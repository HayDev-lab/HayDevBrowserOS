import { useState } from 'react';
import { PROTON_VPN_NAME, type WindowsRoutes } from '@shared/ipc-types';
import { useI18n } from '../../i18n';
import { platformApi } from '../../platform';

const copy = {
  en: {
    close: 'Close',
    setup: 'Connect in the official Proton VPN client for Windows. Proton Free requires a Proton account.',
    protection: 'Enable Advanced kill switch and keep split tunneling off to block internet traffic outside the VPN.',
    restore: 'To return to your usual Windows connection, turn off Advanced kill switch and disconnect in Proton VPN.',
    download: 'Get Proton VPN Free',
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
    download: 'Скачать Proton VPN Free',
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
    download: 'Ներբեռնել Proton VPN Free',
    guide: 'Kill switch-ի հրահանգներ',
    check: 'Ստուգել Windows-ի երթուղիները',
    checking: 'Windows-ի երթուղիների ստուգում…',
    routeScope: 'Ստուգումը ցույց է տալիս Windows-ի ընտրած ցանցային միջերեսները։ Կապի և kill switch-ի կարգավիճակը ցուցադրվում է Proton VPN-ում։',
    missing: 'Երթուղի չկա',
    error: 'Չհաջողվեց կատարել գործողությունը։',
  },
} as const;

export function ProtonVpnPanel({ onClose, onTabsChanged }: {
  onClose: () => void;
  onTabsChanged: () => Promise<void>;
}) {
  const { lang } = useI18n();
  const text = copy[lang];
  const [routes, setRoutes] = useState<WindowsRoutes | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function checkRoutes() {
    if (!platformApi.windowsRoutes) return;
    setBusy(true);
    setFailed(false);
    setRoutes(null);
    try {
      setRoutes(await platformApi.windowsRoutes());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function openProtonPage(url: string) {
    setFailed(false);
    try {
      await platformApi.browser.openTab({ url, activate: true });
      await onTabsChanged();
      onClose();
    } catch {
      setFailed(true);
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
          <button type="button" className="vpn-button vpn-button--primary"
            onClick={() => void openProtonPage('https://protonvpn.com/free-vpn/windows')}>{text.download}</button>
          <button type="button" className="vpn-button"
            onClick={() => void openProtonPage('https://protonvpn.com/support/what-is-kill-switch')}>{text.guide}</button>
          <button type="button" className="vpn-button" disabled={busy} onClick={() => void checkRoutes()}>
            {busy ? text.checking : text.check}
          </button>
        </div>
        {failed && <p className="vpn-alert" role="alert">{text.error}</p>}
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
