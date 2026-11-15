# Internationalization (i18n)

Patterns for translating UI text and formatting locale-sensitive values in a
React + TypeScript + MUI v7 frontend. Examples use `react-i18next`; if the
project already uses another library (FormatJS/`react-intl`, Lingui, Next.js
built-in routing), keep it and apply the same rules.

---

## Core Rules

1. **No hardcoded user-facing strings** — visible text, `aria-label`, `title`,
   `alt`, placeholders, snackbar messages, and validation errors all come from
   translation keys.
2. **Never concatenate translated fragments** — word order differs between
   languages; interpolate into one message instead.
3. **Plurals through the library, not `count === 1`** — languages have between
   one and six plural forms (CLDR).
4. **Format with `Intl`, not by hand** — dates, numbers, currency, percentages,
   lists, and relative time.
5. **Data stays locale-neutral** — store ISO 8601 UTC timestamps, numbers, and
   currency codes; format only at render time.
6. **Layout survives text expansion and RTL** — translations can run 30–40%
   longer than English, and Arabic/Hebrew flip direction.

---

## Setup

### Initialize once, load namespaces lazily

```typescript
// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';

export const SUPPORTED_LOCALES = ['en', 'vi'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

void i18n
    .use(initReactI18next)
    .use(
        resourcesToBackend(
            (language: string, namespace: string) =>
                import(`./locales/${language}/${namespace}.json`),
        ),
    )
    .init({
        fallbackLng: 'en',
        supportedLngs: SUPPORTED_LOCALES,
        ns: ['common'],
        defaultNS: 'common',
        interpolation: { escapeValue: false }, // React already escapes output
    });

export default i18n;
```

Import `src/i18n` once in the app entry before rendering. `react-i18next`
suspends while a namespace loads, so the existing `SuspenseLoader` boundaries
cover translation loading too — no early-return spinners.

### One namespace per feature

```
src/
  i18n/
    index.ts
    locales/
      en/
        common.json          # Buttons, generic errors, shared labels
        posts.json           # features/posts
      vi/
        common.json
        posts.json
```

Keys describe meaning, not English wording: `posts.empty.title`, not
`noPostsYet`. Renaming copy then never forces a key change.

---

## Translating Components

```typescript
import { useTranslation } from 'react-i18next';
import { Button, Typography } from '@mui/material';

export const PostHeader: React.FC<{ author: string; count: number }> = ({ author, count }) => {
    const { t } = useTranslation('posts');

    return (
        <>
            <Typography variant='h5'>{t('header.title', { author })}</Typography>
            <Typography variant='body2'>{t('header.count', { count })}</Typography>
            <Button aria-label={t('header.newPostLabel')}>{t('header.newPost')}</Button>
        </>
    );
};
```

```json
// locales/en/posts.json
{
    "header": {
        "title": "Posts by {{author}}",
        "count_one": "{{count}} post",
        "count_other": "{{count}} posts",
        "newPost": "New post",
        "newPostLabel": "Create a new post"
    }
}
```

```json
// locales/vi/posts.json — Vietnamese has a single plural form
{
    "header": {
        "title": "Bài viết của {{author}}",
        "count_other": "{{count}} bài viết",
        "newPost": "Bài viết mới",
        "newPostLabel": "Tạo bài viết mới"
    }
}
```

### ❌ Concatenation vs ✅ interpolation

```typescript
// ❌ Breaks in languages that put the name elsewhere
<Typography>{t('welcome') + ' ' + user.name + '!'}</Typography>

// ✅ Translators control word order
<Typography>{t('welcome', { name: user.name })}</Typography>
```

### Markup inside a sentence

```typescript
import { Trans } from 'react-i18next';
import { Link } from '@tanstack/react-router';

// "terms": "I accept the <termsLink>terms of service</termsLink>."
<Trans
    i18nKey='signup.terms'
    components={{ termsLink: <Link to='/terms' /> }}
/>
```

---

## Formatting Values

Use the active language from `i18n.resolvedLanguage` and memoize formatters —
constructing `Intl` objects in every render is measurable in long lists.

```typescript
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function useFormatters() {
    const { i18n } = useTranslation();
    const locale = i18n.resolvedLanguage ?? 'en';

    return useMemo(() => {
        const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
        const number = new Intl.NumberFormat(locale);
        const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        const collator = new Intl.Collator(locale, { sensitivity: 'base' });

        return {
            date: (iso: string) => dateTime.format(new Date(iso)),
            number: (value: number) => number.format(value),
            currency: (amountMinor: number, currency: string, fractionDigits = 2) =>
                new Intl.NumberFormat(locale, { style: 'currency', currency })
                    .format(amountMinor / 10 ** fractionDigits),
            relativeDays: (days: number) => relative.format(days, 'day'),
            compare: collator.compare,
        };
    }, [locale]);
}
```

| Value | Store | Render with |
|-------|-------|-------------|
| Timestamp | ISO 8601 UTC string | `Intl.DateTimeFormat` (pass `timeZone` when the business rule needs one) |
| Money | Integer minor units + ISO 4217 code | `Intl.NumberFormat` `style: 'currency'` (fraction digits vary: VND 0, USD 2) |
| Quantity | Number | `Intl.NumberFormat` |
| Sorted names | Raw strings | `Intl.Collator.compare`, not default `.sort()` |
| "3 days ago" | Timestamp | `Intl.RelativeTimeFormat` |

Never parse a localized display string back into data. Inputs that accept
numbers or dates use typed pickers/fields and keep the raw value in form state.

---

## MUI Integration

```typescript
import { createTheme } from '@mui/material/styles';
import { enUS, viVN } from '@mui/material/locale';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'dayjs/locale/vi';

const muiLocales = { en: enUS, vi: viVN } as const;

export const buildTheme = (locale: AppLocale) =>
    createTheme({ /* app theme options */ }, muiLocales[locale]);

// Date pickers need their adapter locale as well
<LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
    {children}
</LocalizationProvider>
```

MUI X DataGrid ships its own locale text (`@mui/x-data-grid/locales`); pass it
through the theme or the grid's `localeText` so toolbar and pagination labels
match the rest of the page.

---

## Language Switching

```typescript
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuItem, Select } from '@mui/material';
import type { AppLocale } from '@/i18n';

export const LanguageSwitcher: React.FC = () => {
    const { i18n, t } = useTranslation();

    const change = useCallback(async (locale: AppLocale) => {
        await i18n.changeLanguage(locale);
        document.documentElement.lang = locale;
        document.documentElement.dir = i18n.dir(locale);
    }, [i18n]);

    return (
        <Select
            value={i18n.resolvedLanguage}
            onChange={(e) => void change(e.target.value as AppLocale)}
            inputProps={{ 'aria-label': t('language.select') }}
        >
            <MenuItem value='en' lang='en'>English</MenuItem>
            <MenuItem value='vi' lang='vi'>Tiếng Việt</MenuItem>
        </Select>
    );
};
```

- Show each language name in that language, and mark it with `lang`.
- Persist the choice in the user profile when signed in; a cookie or
  `localStorage` is the fallback. Use `navigator.languages` only for the first
  visit.
- Keep `<html lang>` and `<html dir>` in sync — screen readers pick voices from
  `lang`.
- If routes carry the locale (`/vi/posts`), keep it in TanStack Router search or
  path params so links and reloads preserve it.

---

## Right-to-Left (RTL)

```typescript
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';

const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });

// When i18n.dir() === 'rtl': theme direction 'rtl' + the RTL Emotion cache
<CacheProvider value={rtlCache}>
    <ThemeProvider theme={createTheme({ direction: 'rtl' })}>{children}</ThemeProvider>
</CacheProvider>
```

- In `sx`, prefer logical spacing (`marginInlineStart`, `paddingInlineEnd`) over
  `ml`/`pr` when a component must not be flipped by the plugin.
- Mirror directional icons (arrows, back/forward), never logos or media
  controls.

---

## Layout Resilience

- No fixed widths on buttons, tabs, chips, or table headers that hold
  translated text; let them wrap or truncate with a tooltip.
- Test with a pseudo-locale (accented, ~40% longer strings) to catch clipping
  and hardcoded text before real translations arrive.
- Load fonts with full glyph coverage for every supported script, including
  Vietnamese diacritics (Latin Extended subsets).

---

## Errors and Server Messages

- APIs return stable error codes; the frontend maps codes to keys:

  ```typescript
  const message = t(`errors.${code}`, { defaultValue: t('errors.unknown') });
  ```

- Zod/form validation messages are translation keys resolved at render time,
  not English strings baked into schemas.
- Snackbars (`useMuiSnackbar`) receive translated text, never raw server text.

---

## Testing

- Wrap component tests in an `I18nextProvider` with an in-memory instance so
  assertions use real copy, not keys.
- Fail CI on missing keys: compare each locale file's key set with the fallback
  locale (or use the library's extraction/lint tooling).
- Assert formatted output in at least two locales for money and dates.

---

**i18n Checklist:**
- ✅ Every visible string, `aria-label`, and error message comes from a key
- ✅ Plurals via `_one`/`_other` (or ICU), never `count === 1`
- ✅ No string concatenation of translated fragments
- ✅ Dates, numbers, money, lists via `Intl`, memoized per locale
- ✅ MUI theme locale and date-picker `adapterLocale` follow the active language
- ✅ `<html lang>` and `dir` updated on change; choice persisted
- ✅ Layout tested with a long pseudo-locale and, if supported, RTL
- ✅ Missing-key check in CI

**See Also:**
- [styling-guide.md](styling-guide.md) - Theme and `sx` patterns
- [loading-and-error-states.md](loading-and-error-states.md) - Suspense boundaries that also cover namespace loading
- [common-patterns.md](common-patterns.md) - Forms and validation
