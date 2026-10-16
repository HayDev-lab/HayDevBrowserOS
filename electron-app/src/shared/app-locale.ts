/**
 * App locale — the single source of truth for UI language across the
 * renderer chrome (React i18n) and the main process (pab:// page builders).
 *
 * The renderer owns the choice (localStorage + I18nProvider) and pushes it
 * to main over the `ui:setLocale` IPC channel; main keeps a module-level
 * current value that the pab:// protocol handler reads when it builds
 * internal pages, so every surface renders in the same language.
 */
export type AppLocale = 'en' | 'ru' | 'hy';

export const APP_LOCALES: readonly AppLocale[] = ['en', 'ru', 'hy'];

/** UI-facing display code shown on the titlebar language pill. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'EN',
  ru: 'RU',
  hy: 'HY',
};

export function parseAppLocale(v: unknown): AppLocale {
  return v === 'ru' || v === 'hy' ? v : 'en';
}

// ---------------------------------------------------------------------------
// Main-process locale holder. In the renderer these are inert (default 'en')
// — the renderer never imports this half; tree-shaking/typing only.
// ---------------------------------------------------------------------------

let currentLocale: AppLocale = 'en';

export function getAppLocale(): AppLocale {
  return currentLocale;
}

export function setAppLocale(locale: AppLocale): void {
  currentLocale = parseAppLocale(locale);
}
