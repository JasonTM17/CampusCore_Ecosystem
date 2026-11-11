import { SectionCard } from '../../components/Ui';
import { SegmentedControl } from '../../components/ui/index';
import { useTheme } from '../../design/theme';
import { normalizeThemePreference } from '../../design/theme-preference';
import { useLocale } from '../../i18n/locale-provider';
import { shellMessages } from '../../i18n/shell-messages';

/** Persisted light / dark / system choice (the theme provider saves it). */
export function ThemeSetting() {
  const { preference, setPreference } = useTheme();
  const { locale } = useLocale();
  const { title, options } = shellMessages[locale].theme;
  return (
    <SectionCard title={title} icon="theme-light-dark">
      <SegmentedControl
        accessibilityLabel={title}
        options={[
          { value: 'light', label: options.light },
          { value: 'dark', label: options.dark },
          { value: 'system', label: options.system },
        ]}
        value={preference}
        onChange={(next) => setPreference(normalizeThemePreference(next))}
      />
    </SectionCard>
  );
}
