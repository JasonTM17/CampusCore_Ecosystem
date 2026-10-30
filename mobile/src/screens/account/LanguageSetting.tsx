import { SectionCard } from '../../components/Ui';
import { SegmentedControl } from '../../components/ui/index';
import { useLocale } from '../../i18n/locale-provider';
import type { AppLocale } from '../../i18n/locale';
import { shellMessages } from '../../i18n/shell-messages';

// Language names stay in their own language so the choice is findable from either locale.
const OPTIONS = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
];

/** Persisted interface-language switch (the provider saves the choice). */
export function LanguageSetting() {
  const { locale, setLocale } = useLocale();
  const title = shellMessages[locale].language;
  return (
    <SectionCard title={title} icon="translate">
      <SegmentedControl
        accessibilityLabel={title}
        options={OPTIONS}
        value={locale}
        onChange={(next) => setLocale(next as AppLocale)}
      />
    </SectionCard>
  );
}
