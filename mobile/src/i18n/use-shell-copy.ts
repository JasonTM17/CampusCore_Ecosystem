import { localizedNavLabel, shellMessages } from './shell-messages';
import { useLocale } from './locale-provider';
import type { ScreenName } from '../navigation/routes';

/** Shell copy in the active locale, plus lookups keyed by the registry names. */
export function useShellCopy() {
  const { locale } = useLocale();
  const copy = shellMessages[locale];
  return {
    copy,
    screenTitle: (name: ScreenName) => copy.screens[name],
    navLabel: (label: string) => localizedNavLabel(locale, label),
  };
}
