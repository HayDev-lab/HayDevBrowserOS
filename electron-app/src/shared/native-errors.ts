import type { AppLocale } from './app-locale';
import { attachmentErrorMessage } from './attachment-errors';

/** Keep diagnostic codes, never arbitrary native paths, provider bodies or secrets. */
export function nativeErrorCode(error: unknown): string {
  if (error === 'max_steps_reached') return 'AGENT_STEP_LIMIT';
  const item = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const text = item ? `${String(item.code ?? '')} ${String(item.message ?? '')}` : String(error ?? '');
  return text.match(/(?:VAULT|STORE|DOCUMENT|ATTACHMENT|EGRESS|TAB|WEBVIEW|AGENT|CONTROL|RESEARCH|MEDIA|ONION|TOR|LLM|AI)_[A-Z_]+/)?.[0] ?? 'OPERATION_FAILED';
}
const messages: Record<string, readonly [string, string, string]> = {
  OPERATION_FAILED: ['The operation failed. Please try again.', 'Не удалось выполнить действие. Повторите попытку.', 'Գործողությունը չհաջողվեց։ Փորձեք կրկին։'],
  AGENT_STEP_LIMIT: [
    'The agent reached its step limit. Try a smaller task.',
    'Агент достиг лимита шагов. Разбейте задачу на части и попробуйте снова.',
    'Գործակալը հասել է քայլերի սահմանաչափին։ Բաժանեք առաջադրանքը փոքր մասերի և փորձեք կրկին։',
  ],
  VAULT_DOMAIN_MISMATCH: ['This credential belongs to another site.', 'Эта запись предназначена для другого сайта.', 'Այս տվյալները նախատեսված են այլ կայքի համար։'],
  VAULT_DOMAIN_AMBIGUOUS: ['Save this credential with the exact site address before filling.', 'Перед заполнением сохраните запись с точным адресом сайта.', 'Լրացնելուց առաջ պահպանեք տվյալները կայքի ճշգրիտ հասցեով։'],
  VAULT_DOCUMENT_CHANGED: ['The page changed. Check the site and try filling again.', 'Страница изменилась. Проверьте сайт и повторите заполнение.', 'Էջը փոխվել է։ Ստուգեք կայքը և կրկին փորձեք լրացնել։'],
  VAULT_NO_LOGIN_FIELDS: ['No login fields were found on this page.', 'На странице не найдены поля входа.', 'Այս էջում մուտքի դաշտեր չեն գտնվել։'],
  STORE_CORRUPT: ['The local store is damaged. The original file was preserved.', 'Локальное хранилище повреждено. Исходный файл сохранён.', 'Տեղային պահոցը վնասված է։ Սկզբնական ֆայլը պահպանվել է։'],
  EGRESS_UNAVAILABLE: ['The required network route is unavailable.', 'Требуемый сетевой маршрут недоступен.', 'Պահանջվող ցանցային երթուղին հասանելի չէ։'],
  TOR_WEBVIEW_OVERRIDE: ['WebView2 overrides prevent opening an onion tab.', 'Переопределённые параметры WebView2 мешают открыть onion-вкладку.', 'WebView2-ի վերասահմանված կարգավորումները խանգարում են բացել onion ներդիրը։'],
  RESEARCH_PROXY_UNSUPPORTED: ['Research fetching is unavailable for this proxy route.', 'Получение источников Research недоступно для этого прокси-маршрута.', 'Research աղբյուրների ստացումը հասանելի չէ այս պրոքսի երթուղու համար։'],
  AI_PROVIDER_NOT_CONFIGURED: ['Choose a provider in AI settings.', 'Выберите провайдера в настройках ИИ.', 'Ընտրեք մատակարար ԱԲ կարգավորումներում։'],
  AI_AGENT_RUNNING: ['Stop the agent before changing AI settings.', 'Остановите агента, чтобы изменить настройки ИИ.', 'ԱԲ կարգավորումները փոխելուց առաջ կանգնեցրեք գործակալին։'],
  AI_INVALID_KEY: ['Check the API key and try again.', 'Проверьте API-ключ и повторите попытку.', 'Ստուգեք API բանալին և փորձեք կրկին։'],
  AI_INVALID_MODEL: ['Check the model ID and try again.', 'Проверьте идентификатор модели и повторите попытку.', 'Ստուգեք մոդելի նույնացուցիչը և փորձեք կրկին։'],
  LLM_FREE_RATE_LIMIT: ['The Free LLM limit was reached. Try again later.', 'Лимит Free LLM исчерпан. Повторите попытку позже.', 'Free LLM-ի սահմանաչափը սպառվել է։ Փորձեք ավելի ուշ։'],
  LLM_EGRESS_UNAVAILABLE: ['The model provider is unavailable over the selected agent route.', 'Провайдер модели недоступен через выбранный маршрут агента.', 'Մոդելի մատակարարը հասանելի չէ գործակալի ընտրված երթուղով։'],
  LLM_TRANSPORT: ['The model provider could not be reached.', 'Не удалось связаться с провайдером модели.', 'Չհաջողվեց կապվել մոդելի մատակարարի հետ։'],
};
export function nativeErrorMessage(error: unknown, lang: AppLocale): string {
  const code = nativeErrorCode(error), index = lang === 'ru' ? 1 : lang === 'hy' ? 2 : 0;
  const key = code.includes('CORRUPT') ? 'STORE_CORRUPT' : code;
  return messages[key]?.[index] ?? attachmentErrorMessage(code, lang, `${messages.OPERATION_FAILED[index]} (${code})`);
}
