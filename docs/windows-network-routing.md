# Маршрутизация HayDev Browser OS в Windows

| Режим | Маршрут | Покрытие |
| --- | --- | --- |
| Обычные вкладки и оболочка | Маршрут Windows по умолчанию | При активном Proton VPN используется системная маршрутизация |
| Приватная вкладка | Отдельный профиль WebView2 и сохранённая настройка маршрута | Для обязательного Tor выберите строгий режим профиля |
| DarkWeb | Tor через локальный SOCKS | Поиск VormWeb, просмотр .onion, превью и загрузки в карантин. Для .onion-вкладок разрешены сетевые обращения к onion-сайтам, JavaScript, WebRTC и QUIC отключены |
| Proton VPN | Официальный клиент Windows с Advanced kill switch и выключенным split tunneling | Маршрутизацию и блокировку выполняет клиент Proton VPN. Панель браузера показывает выбранные Windows интерфейсы |

В разделе **DarkWeb** можно ввести запрос VormWeb или адрес .onion. При открытии раздела встроенный Tor запускается по запросу. Поисковый запрос отправляется на HTTPS-сайт VormWeb через Tor. Результат открывается в отдельной вкладке WebView2 через Tor. При потере маршрута соединение блокируется. Прямого запасного маршрута нет. Встроенный Tor использует обычный маршрут Windows для связи со своими узлами. [VormWeb](https://vormweb.de/en/), [onion-сервисы Tor Project](https://onion.torproject.org/)

Панель **Proton VPN** открывает официальные инструкции и проверяет маршруты IPv4 и IPv6 без сетевого запроса. Подключение, вход в аккаунт и настройка Advanced kill switch выполняются в клиенте Proton VPN. Встроенный Tor для DarkWeb доступен с Proton Free. Сервис Proton Tor over VPN входит в платные планы. [Proton VPN Free](https://protonvpn.com/free-vpn/windows), [Tor over VPN](https://protonvpn.com/support/tor-vpn), [Advanced kill switch](https://protonvpn.com/support/what-is-kill-switch)

## Рассмотренные варианты

| Вариант | Бесплатный выход, права и ограничения | Исходники и распространение |
| --- | --- | --- |
| Proton VPN Free | Аккаунт Proton Free, Windows 10/11, установка драйвера с повышением прав. Бесплатный трафик без лимита объёма по условиям Proton, одно устройство одновременно, ограниченный выбор бесплатных серверов. Advanced kill switch входит в Free. IPv6 включается отдельно и зависит от сервера. IP-туннель может маршрутизировать TCP и UDP. P2P-серверы и проброс портов относятся к платным планам | Клиент GPL-3.0. Учётные данные остаются в Proton, официальный клиент и драйвер устанавливаются отдельно. [Windows Free](https://protonvpn.com/free-vpn/windows), [планы](https://protonvpn.com/support/proton-vpn-plans), [приватность](https://protonvpn.com/privacy-policy), [условия](https://proton.me/legal/terms), [исходники](https://github.com/ProtonVPN/win-app) |
| WireGuard for Windows / Wintun и tun2socks | Виртуальный интерфейс требует установки с повышением прав. Для выхода нужен собственный сервер или конфигурация провайдера. WireGuard включает WFP-блокировку с одним peer и AllowedIPs /0. Запуск до готовности и выход требуют отдельной приёмки | Клиент WireGuard для Windows доступен под MIT. Драйвер и зависимости имеют условия своих поставок. tun2socks использует GPL-3.0. Компоненты не входят в установщик. [WireGuard for Windows](https://github.com/WireGuard/wireguard-windows), [правила Windows](https://git.zx2c4.com/wireguard-windows/about/docs/netquirk.md), [Wintun](https://www.wintun.net/), [tun2socks](https://github.com/xjasonlyu/tun2socks) |
| HTTP CONNECT / SOCKS5 | Нужен доверенный выход. Свободная лицензия клиента не предоставляет сервер. HTTP CONNECT передаёт TCP. WebView2 использует SOCKS5 для URL-загрузок с удалённым DNS. Системное покрытие зависит от драйвера и правил фильтрации | Браузер использует поддержку WebView2 и локальный SOCKS-ретранслятор. Публичные прокси не используются. [Chromium SOCKS](https://new.chromium.org/developers/design-documents/network-stack/socks-proxy/) |
| Tor Expert Bundle | Общедоступная сеть без аккаунта и драйвера. Передаёт TCP-потоки и разрешает DNS для проксируемых соединений. Прямого UDP-транспорта нет. Доступность и пропускная способность зависят от сети и выходов | Tor распространяется по BSD-3-Clause. Версия и SHA-256 зафиксированы в runtime lock. [Исходники](https://gitlab.torproject.org/tpo/core/tor), [Expert Bundle](https://www.torproject.org/download/tor/), [проверка DNS](https://support.torproject.org/little-t-tor/troubleshooting/check-for-leaks/) |
| Cloudflare WARP | Бесплатный потребительский режим Traffic and DNS с MASQUE. Постоянная блокировка до загрузки и после выхода требует самостоятельной приёмки | Официальная поставка Cloudflare. Исходники и право включения всего клиента в наш установщик не подтверждены. [Режимы WARP](https://developers.cloudflare.com/warp-client/warp-modes/) |

## Приёмка системного режима

1. На выделенном Windows-хосте установить официальный Proton VPN и войти в тестовый аккаунт Free. Сохранить активные маршруты IPv4/IPv6 и DNS интерфейсов до теста.
2. Включить Advanced kill switch, выключить split tunneling, подключиться и проверить IPv6 отдельно. Действия выполняются в официальном клиенте. [Инструкция Proton](https://protonvpn.com/support/what-is-kill-switch), [IPv6](https://protonvpn.com/support/prevent-ipv6-vpn-leaks)
3. В панели Proton VPN нажать **Проверить маршруты Windows**. IP Helper показывает интерфейсы для 1.1.1.1 и 2606:4700:4700::1111 без отправки пакетов. Подтвердить маршрутизацию DNS, TCP и UDP захватом на физическом и туннельном интерфейсах.
4. Проверить IP, DNS A/AAAA, WebRTC/STUN, QUIC, WebSocket и загрузки. Повторить запросы из Rust, SearXNG и независимого приложения Windows. Проверить отключение, аварийную потерю связи, повторное соединение, смену сети, сон, перезапуск и выход.
5. В захвате учесть транспорт туннеля, loopback-соединения и служебные кадры физического интерфейса. Состав исключений берётся из наблюдаемых правил клиента и пакетов.
6. Выключить Advanced kill switch, отключить Proton VPN и сверить исходные маршруты и DNS. Проверить соединение браузера и независимого приложения.

До выполнения этих проверок системный режим остаётся внешней настройкой с неподтверждённым покрытием. Выбор интерфейса по таблице маршрутов показывает только результат локального поиска маршрута.
