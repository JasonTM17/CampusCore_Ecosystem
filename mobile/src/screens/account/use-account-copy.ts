import { accountMessages, type AccountMessages } from '../../i18n/account-messages';
import { useLocale } from '../../i18n/locale-provider';

/** Account copy for the active app locale (vi by default). */
export function useAccountCopy(): AccountMessages {
  const { locale } = useLocale();
  return accountMessages[locale];
}
