import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, IconChip, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { SearchBar } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { lecturerApi } from './lecturer-api';
import { courseTitle, filterSections, termOptions, windowOf } from './lecturer-model';
import { OpsShell, isOpsPreview, slotText, useOpsQuery } from './lecturer-ui';
import { useOpsCopy } from './shared/helpers';
import { previewSchedule } from './shared/preview';
import { useOpsStyles } from './shared/styles';

const PAGE_SIZE = 10;

/** Sections by term with search; the endpoint returns the whole teaching load, so rows are windowed on the device. */
export function LecturerScheduleScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const preview = isOpsPreview();
  const query = useOpsQuery('lecturer:schedule', () => lecturerApi.schedule(), copy);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);

  const sections = useMemo(() => (preview ? previewSchedule : query.data ?? []), [preview, query.data]);
  const terms = useMemo(() => termOptions(sections), [sections]);
  const matches = useMemo(() => filterSections(sections, search, term, locale), [sections, search, term, locale]);
  const { rows, hasMore } = windowOf(matches, pages, PAGE_SIZE);

  return (
    <OpsShell
      title={copy.scheduleTitle}
      loading={!preview && query.isLoading}
      error={preview ? null : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
    >
      {sections.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptySchedule} />
      ) : (
        <View>
          {terms.length > 1 ? (
            <ChoiceField
              label={copy.semester}
              display="sheet"
              options={[{ value: '', label: copy.allTerms }, ...terms]}
              value={term}
              onChange={(value) => { setTerm(value); setPages(1); }}
            />
          ) : null}
          <SearchBar
            value={search}
            onChangeText={(value) => { setSearch(value); setPages(1); }}
            placeholder={copy.searchSections}
            accessibilityLabel={copy.searchSections}
            style={styles.searchBar}
          />
          {matches.length === 0 ? <StatePanel kind="empty" title={copy.noMatch} /> : null}
          {rows.map((section) => (
            <Card key={section.sectionId} style={styles.scheduleCard}>
              <View style={styles.scheduleHeader}>
                <View style={styles.topicCopy}>
                  <StatusPill label={section.courseCode ?? section.sectionId} tone="primary" />
                  <UiText accessibilityRole="header" variant="headlineSmall">
                    {courseTitle(section, locale) || copy.untitled}
                  </UiText>
                  {section.sectionNumber ? (
                    <UiText variant="bodySmall" tone="muted">
                      {fillCopy(copy.sectionLine, { n: section.sectionNumber })}
                    </UiText>
                  ) : null}
                </View>
                <StatusPill
                  label={fillCopy(copy.studentsCount, { n: section.enrolledCount ?? 0 })}
                  tone="neutral"
                  icon="account-group-outline"
                />
              </View>
              {(section.schedules ?? []).length === 0 ? (
                <UiText variant="bodySmall" tone="muted">{copy.schedulePending}</UiText>
              ) : (
                (section.schedules ?? []).map((slot, index) => (
                  <View key={slot.id ?? index} style={styles.slotRow}>
                    <IconChip icon="clock-outline" size={32} tone="neutral" />
                    <UiText variant="bodySmall" tone="muted" style={{ flex: 1 }}>
                      {slotText(slot, copy)}
                    </UiText>
                  </View>
                ))
              )}
              <View style={styles.rowBetween}>
                <Button
                  icon="clipboard-check-outline"
                  label={copy.takeAttendance}
                  variant="secondary"
                  onPress={() => navigation.navigate('lecturer.attendance', { sectionId: section.sectionId })}
                  style={styles.topButton}
                />
                <Button
                  icon="file-document-edit-outline"
                  label={copy.openGrades}
                  variant="secondary"
                  onPress={() => navigation.navigate('lecturer.grading', { sectionId: section.sectionId })}
                  style={styles.topButton}
                />
              </View>
            </Card>
          ))}
          {hasMore ? (
            <Button
              label={copy.loadMore}
              variant="secondary"
              onPress={() => setPages((current) => current + 1)}
            />
          ) : null}
        </View>
      )}
    </OpsShell>
  );
}
