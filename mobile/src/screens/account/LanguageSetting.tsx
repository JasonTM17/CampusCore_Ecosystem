import { SectionCard } from '../../components/Ui';
import { SegmentedControl } from '../../components/ui/index';
import { useLocale } from '../../i18n/locale-provider';
import type { AppLocale } from '../../i18n/locale';
import { shellMessages } from '../../i18n/shell-messages';

/** Persisted interface-language switch (the provider saves the choice). */
export function LanguageSetting() {
  const { locale, setLocale } = useLocale();
  const title = shellMessages[locale].language;
  const languageOptions = shellMessages[locale].languageOptions;
  return (
    <SectionCard title={title} icon="translate">
      <SegmentedControl
        accessibilityLabel={title}
        options={[
          { value: 'vi', label: languageOptions.vi },
          { value: 'en', label: languageOptions.en },
        ]}
        value={locale}
        onChange={(next) => setLocale(next as AppLocale)}
      />
    </SectionCard>
  );
}
