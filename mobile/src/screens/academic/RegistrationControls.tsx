import { View } from 'react-native';

import { Button } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { SearchBar } from '../../components/ui/primitives';
import type { BrowseQuery, CurriculumFilter, SectionSortMode } from './registration-browse';
import { academicStyles, useAcademicCopy } from './academic-ui';

export interface RegistrationControlsProps {
  query: BrowseQuery;
  onChange: (next: BrowseQuery) => void;
}

/** Search, curriculum filter, sort and the hide-full switch for the section catalog. */
export function RegistrationControls({ query, onChange }: RegistrationControlsProps) {
  const { copy } = useAcademicCopy();
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
          { value: 'ALL', label: copy.relAll },
          { value: 'MANDATORY', label: copy.relMandatory },
          { value: 'ELECTIVE', label: copy.relElective },
          { value: 'OUTSIDE', label: copy.relOutside },
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
      <Button
        label={query.hideFull ? copy.showFull : copy.hideFull}
        onPress={() => onChange({ ...query, hideFull: !query.hideFull })}
        variant="secondary"
      />
    </View>
  );
}
