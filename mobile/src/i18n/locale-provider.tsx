import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  DEFAULT_LOCALE,
  formatBytes,
  formatCredits,
  formatDate,
  formatDateTime,
  formatNumber,
  loadLocale,
  parseDateInput,
  saveLocale,
  translate,
} from './locale';
import type { AppLocale, KeyValueStorage, NumberFormatOptions, UiMessageKey } from './locale';

export interface LocaleApi {
  locale: AppLocale;
  /** False until the saved preference has been read. */
  ready: boolean;
  setLocale: (next: AppLocale) => void;
  t: (key: UiMessageKey, params?: Record<string, string | number>) => string;
  formatDate: (value: string | number | Date | null | undefined) => string;
  formatDateTime: (value: string | number | Date | null | undefined) => string;
  formatNumber: (value: number | null | undefined, options?: NumberFormatOptions) => string;
  formatCredits: (value: number | null | undefined) => string;
  formatBytes: (value: number | null | undefined) => string;
  parseDate: (text: string) => string | null;
}

function buildApi(locale: AppLocale, ready: boolean, setLocale: (next: AppLocale) => void): LocaleApi {
  return {
    locale,
    ready,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    formatDate: (value) => formatDate(value, locale),
    formatDateTime: (value) => formatDateTime(value, locale),
    formatNumber: (value, options) => formatNumber(value, locale, options),
    formatCredits: (value) => formatCredits(value, locale),
    formatBytes: (value) => formatBytes(value, locale),
    parseDate: (text) => parseDateInput(text, locale),
  };
}

// Without a provider the app still renders in the default locale.
const fallbackApi = buildApi(DEFAULT_LOCALE, true, () => {});
const LocaleContext = createContext<LocaleApi>(fallbackApi);

/** AsyncStorage is resolved lazily so importing this module never needs the native module. */
function defaultStorage(): KeyValueStorage | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    return (mod.default ?? mod) as KeyValueStorage;
  } catch {
    return undefined;
  }
}

export interface LocaleProviderProps {
  children: ReactNode;
  /** Test/preview hook: skip reading the saved preference. */
  initialLocale?: AppLocale;
  /** Injectable storage; defaults to AsyncStorage. */
  storage?: KeyValueStorage;
}

export function LocaleProvider({ children, initialLocale, storage }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale ?? DEFAULT_LOCALE);
  const [ready, setReady] = useState(initialLocale !== undefined);
  const store = useMemo(() => storage ?? defaultStorage(), [storage]);

  useEffect(() => {
    if (initialLocale !== undefined) return;
    let active = true;
    loadLocale(store).then((saved) => {
      if (!active) return;
      setLocaleState(saved);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [initialLocale, store]);

  const setLocale = useCallback(
    (next: AppLocale) => {
      setLocaleState(next);
      void saveLocale(store, next);
    },
    [store],
  );

  const value = useMemo(() => buildApi(locale, ready, setLocale), [locale, ready, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleApi {
  return useContext(LocaleContext);
}
