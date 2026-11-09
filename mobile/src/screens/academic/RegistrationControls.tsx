import { View } from 'react-native';

import { Button, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { SearchBar } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import type { BrowseQuery, CurriculumFilter, SectionSortMode } from './registration-browse';
import { academicStyles, useAcademicCopy } from './academic-ui';

export interface RegistrationCounts {
  ALL: number;
  MANDATORY: number;
  ELECTIVE: number;
  OUTSIDE: number;
  seats: number;
  noConflict: number;
}

export interface RegistrationControlsProps {
  query: BrowseQuery;
  counts: RegistrationCounts;
  resultCount: number;
  onChange: (next: BrowseQuery) => void;
}

/** Search, curriculum filter, sort and the seat/conflict switches for the section catalog. */
export function RegistrationControls({ query, counts, resultCount, onChange }: RegistrationControlsProps) {
  const { copy } = useAcademicCopy();
  const { formatNumber } = useLocale();
  const withCount = (label: string, count: number) => `${label} (${formatNumber(count)})`;
  return (
    <View>
      <SearchBar
        value={query.search}
        onChangeText={(search) => onChange({ ...query, search })}
        placeholder={copy.searchPlaceholder}
        accessibilityLabel={copy.searchLabel}
        returnKeyType="search"
      />
      <View style={academicStyles.gap} />
      <ChoiceField
        label={copy.relLabel}
        value={query.curriculum}
        onChange={(curriculum) => onChange({ ...query, curriculum: curriculum as CurriculumFilter })}
        display="sheet"
        options={[
          { value: 'ALL', label: withCount(copy.filterAll, counts.ALL) },
          { value: 'MANDATORY', label: withCount(copy.filterMandatory, counts.MANDATORY) },
          { value: 'ELECTIVE', label: withCount(copy.filterElective, counts.ELECTIVE) },
          { value: 'OUTSIDE', label: withCount(copy.filterOutside, counts.OUTSIDE) },
        ]}
      />
      <ChoiceField
        label={copy.sortLabel}
        value={query.sort}
        onChange={(sort) => onChange({ ...query, sort: sort as SectionSortMode })}
        display="sheet"
        options={[
          { value: 'code', label: copy.sortCode },
          { value: 'credits', label: copy.sortCredits },
          { value: 'seats', label: copy.sortSeats },
        ]}
      />
      <View style={academicStyles.actions}>
        <Button
          label={withCount(copy.filterSeats, counts.seats)}
          accessibilityState={{ selected: query.seatsOnly }}
          onPress={() => onChange({ ...query, seatsOnly: !query.seatsOnly })}
          variant="secondary"
        />
        <Button
          label={withCount(copy.filterNoConflict, counts.noConflict)}
          accessibilityState={{ selected: query.noConflictOnly }}
          onPress={() => onChange({ ...query, noConflictOnly: !query.noConflictOnly })}
          variant="secondary"
        />
      </View>
      <UiText variant="label" style={academicStyles.result}>
        {fillCopy(countForm(resultCount, copy.sectionCountSingular, copy.sectionCount), { count: formatNumber(resultCount) })}
      </UiText>
    </View>
  );
}
