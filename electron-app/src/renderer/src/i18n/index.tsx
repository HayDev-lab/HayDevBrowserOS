/**
 * i18n — lightweight locale layer for the renderer chrome.
 *
 * Choice persists in localStorage (`pab.lang`) and is pushed to the main
 * process (`platformApi.setLocale`) so internal pab:// pages render in the
 * same language. English is the fallback dictionary; the Dict type makes
 * ru/hy key-complete at compile time.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { parseAppLocale, type AppLocale } from '@shared/app-locale';
import { platformApi } from '../platform';
import { en, type Dict } from './locales/en';
import { ru } from './locales/ru';
import { hy } from './locales/hy';

const DICTS: Record<AppLocale, Dict> = { en, ru, hy };

/** Cycle order for the titlebar language pill: EN → RU → HY → EN. */
const CYCLE: readonly AppLocale[] = ['en', 'ru', 'hy'];

const STORAGE_KEY = 'pab.lang';

function readInitialLocale(): AppLocale {
  try {
    return parseAppLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'en';
  }
}

export interface I18nValue {
  lang: AppLocale;
  setLang: (lang: AppLocale) => void;
  /** Cycle to the next locale (titlebar pill behavior). */
  cycleLang: () => void;
  /** Translate a key, interpolating {vars}. Missing keys fall back to English, then to the key itself. */
  t: (key: keyof Dict, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLocale>(readInitialLocale);

  const changedByUser = useRef(false);
  const applyLocale = useCallback((next: AppLocale) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (e.g. restricted mode) — keep the in-memory choice.
    }
  }, []);

  const setLang = useCallback((next: AppLocale) => {
    changedByUser.current = true;
    applyLocale(next);
    platformApi.setLocale(next);
  }, [applyLocale]);

  const cycleLang = useCallback(() => {
    setLang(CYCLE[(CYCLE.indexOf(lang) + 1) % CYCLE.length]);
  }, [lang, setLang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // The durable value seeds the UI unless the user already made a choice.
  useEffect(() => {
    let cancelled = false;
    void platformApi
      .getLocale()
      .then((persisted) => {
        if (!cancelled && !changedByUser.current) applyLocale(parseAppLocale(persisted));
      })
      .catch(() => {
        // Keep the cached choice when the host is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [applyLocale]);

  const t = useCallback<I18nValue['t']>(
    (key, vars) => {
      let s = DICTS[lang][key] ?? en[key] ?? String(key);
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          s = s.replaceAll(`{${name}}`, String(value));
        }
      }
      return s;
    },
    [lang]
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, cycleLang, t }),
    [lang, setLang, cycleLang, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return value;
}

export { LOCALE_LABELS } from '@shared/app-locale';
export type { AppLocale } from '@shared/app-locale';
export type { Dict } from './locales/en';
