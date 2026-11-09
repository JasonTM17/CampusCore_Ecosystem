import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { LecturerScheduleEntry } from '../../api/client';
import { Button, Card, IconChip, SegmentedControl, Sheet, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/choice-field';
import { SearchBar } from '../../components/ui/primitives';
import { useTheme } from '../../design/theme';
import { fillCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileScreenProps } from '../../navigation/types';
import { DAY_ORDER, civilKey, weekDates, weekStartOf } from '../academic/academic-model';
import { WeekStrip } from '../academic/WeekStrip';
import { lecturerApi } from './lecturer-api';
import {
  courseTitle,
  dayNumberOf,
  departmentTitle,
  filterSections,
  normalizeDay,
  termOptions,
  windowOf,
} from './lecturer-model';
import {
  OpsShell,
  isOpsPreview,
  sectionLabel,
  sectionStatusLabel,
  slotText,
  useOpsQuery,
} from './lecturer-ui';
import { useOpsCopy } from './shared/helpers';
import { previewSchedule } from './shared/preview';
import { useOpsStyles } from './shared/styles';

const PAGE_SIZE = 10;

type View_ = 'list' | 'day';

/** Sections by term with search; the endpoint returns the whole teaching load, so rows are windowed on the device. */
export function LecturerScheduleScreen({ navigation }: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const { formatNumber } = useLocale();
  const { window } = useTheme();
  const numColumns = window.class === 'compact' || window.fontScale >= 1.3 ? 1 : 2;
  const preview = isOpsPreview();
  const query = useOpsQuery('lecturer:schedule', () => lecturerApi.schedule(), copy);
  const pull = usePullToRefresh(() => query.reload());
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);
  const [view, setView] = useState<View_>('list');
  const [dayIndex, setDayIndex] = useState(() => Math.max(0, DAY_ORDER.indexOf(dayNumberOf(new Date()))));
  const [detail, setDetail] = useState<LecturerScheduleEntry | null>(null);

  const sections = useMemo(() => (preview ? previewSchedule : query.data ?? []), [preview, query.data]);
  const terms = useMemo(() => termOptions(sections), [sections]);
  const matches = useMemo(() => filterSections(sections, search, term, locale), [sections, search, term, locale]);
  const today = new Date();
  const todayNumber = dayNumberOf(today);
  const days = weekDates(weekStartOf(today));
  const selectedDay = DAY_ORDER[dayIndex] ?? todayNumber;
  const dayMatches = useMemo(() => view !== 'day' ? matches : matches
    .filter((section) => (section.schedules ?? []).some((slot) => normalizeDay(slot.dayOfWeek) === selectedDay))
    .map((section) => ({
      ...section,
      schedules: (section.schedules ?? []).filter((slot) => normalizeDay(slot.dayOfWeek) === selectedDay),
    })), [view, matches, selectedDay]);
  const { rows, hasMore } = windowOf(dayMatches, pages, PAGE_SIZE);

  return (
    <>
      <OpsShell
        title={copy.scheduleTitle}
        eyebrow={copy.scheduleEyebrow}
        subtitle={copy.scheduleDescription}
        loading={!preview && query.isLoading}
        error={preview ? null : query.error}
        warning={preview ? null : query.warning}
        onRetry={() => void query.reload()}
        onRefresh={preview ? undefined : pull.onRefresh}
        refreshing={!preview && pull.refreshing}

        list={{
          data: rows,
          keyExtractor: (item, index) => String(item.sectionId),
          numColumns,
          columnWrapperStyle: numColumns > 1 ? styles.columns : undefined,
          renderItem: ({ item: section }) => (
            <Card key={section.sectionId} style={[styles.scheduleCard, numColumns > 1 ? { width: '48.5%' } : undefined]}>
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
                  label={fillCopy(countForm(section.enrolledCount ?? 0, copy.studentsCountOne, copy.studentsCount), { n: section.enrolledCount ?? 0 })}
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
                    {normalizeDay(slot.dayOfWeek) === todayNumber ? <StatusPill label={copy.todayChip} tone="primary" /> : null}
                  </View>
                ))
              )}
              <View style={styles.rowBetween}>
                <Button
                  icon="clipboard-check-outline"
                  label={copy.takeAttendance}
                  variant="secondary"
                  onPress={() => navigation.navigate('lecturer.attendance', { sectionId: section.sectionId })}
                  style={[styles.topButton, styles.scheduleButton]}
                />
                <Button
                  icon="file-document-edit-outline"
                  label={copy.openGrades}
                  variant="secondary"
                  onPress={() => navigation.navigate('lecturer.grading', { sectionId: section.sectionId })}
                  style={[styles.topButton, styles.scheduleButton]}
                />
                <Button
                  icon="information-outline"
                  label={copy.detailAction}
                  variant="secondary"
                  onPress={() => setDetail(section)}
                  style={[styles.topButton, styles.scheduleButton]}
                />
              </View>
            </Card>
          ),
          footer: <>{sections.length === 0 ? null : (<View>
            {hasMore ? (
              <Button
                label={copy.loadMore}
                variant="secondary"
                onPress={() => setPages((current) => current + 1)}
              />
            ) : null}
          </View>)}
      </>,
        }}
      >
        {sections.length === 0 ? (
          <StatePanel kind="empty" title={copy.emptySchedule} />
        ) : (<View>
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
            <View style={styles.viewToggle}>
              <SegmentedControl
                accessibilityLabel={copy.viewModeLabel}
                options={[{ value: 'list', label: copy.viewList }, { value: 'day', label: copy.viewDay }]}
                value={view}
                onChange={(value) => { setView(value as View_); setPages(1); }}
              />
            </View>
            {view === 'day' ? (
              <View>
                <WeekStrip
                  days={days}
                  selectedIndex={dayIndex}
                  todayKey={civilKey(today)}
                  labels={DAY_ORDER.map((day) => copy.dayLong[day])}
                  todayLabel={copy.todayChip}
                  onSelect={(index) => { setDayIndex(index); setPages(1); }}
                />
                {matches.length > 0 && dayMatches.length === 0 ? <StatePanel kind="empty" title={copy.noTeachingSlot} /> : null}
              </View>
            ) : null}
            {matches.length === 0 ? <StatePanel kind="empty" title={copy.noMatch} /> : null}
            </View>)}</OpsShell>

      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={copy.sectionDetailTitle}
        scroll
      >
        {detail ? (
          <View style={styles.sheetBody}>
            <View style={styles.detailRow}>
              <UiText variant="bodySmall" style={styles.detailLabel}>{copy.detailSectionLabel}</UiText>
              <UiText variant="bodySmall" style={styles.detailValue}>{sectionLabel(detail, copy, locale)}</UiText>
            </View>
            {departmentTitle(detail, locale) ? (
              <View style={styles.detailRow}>
                <UiText variant="bodySmall" style={styles.detailLabel}>{copy.detailDepartmentLabel}</UiText>
                <UiText variant="bodySmall" style={styles.detailValue}>{departmentTitle(detail, locale)}</UiText>
              </View>
            ) : null}
            {detail.credits ? (
              <View style={styles.detailRow}>
                <UiText variant="bodySmall" style={styles.detailLabel}>{copy.detailCreditsLabel}</UiText>
                <UiText variant="bodySmall" style={styles.detailValue}>
                  {fillCopy(copy.creditsValue, { n: formatNumber(detail.credits) })}
                </UiText>
              </View>
            ) : null}
            {detail.enrolledCount !== undefined ? (
              <View style={styles.detailRow}>
                <UiText variant="bodySmall" style={styles.detailLabel}>{copy.detailEnrolledLabel}</UiText>
                <UiText variant="bodySmall" style={styles.detailValue}>
                  {formatNumber(detail.enrolledCount)}{detail.capacity ? `/${formatNumber(detail.capacity)}` : ''} {copy.studentsSuffix}
                </UiText>
              </View>
            ) : null}
            {detail.status ? (
              <View style={styles.detailRow}>
                <UiText variant="bodySmall" style={styles.detailLabel}>{copy.status}</UiText>
                <StatusPill label={sectionStatusLabel(detail.status, copy)} />
              </View>
            ) : null}
            {(detail.schedules ?? []).map((slot, index) => (
              <View key={slot.id ?? index} style={styles.slotRow}>
                <IconChip icon="clock-outline" size={32} tone="neutral" />
                <UiText variant="bodySmall" tone="muted" style={{ flex: 1 }}>{slotText(slot, copy)}</UiText>
                {normalizeDay(slot.dayOfWeek) === todayNumber ? <StatusPill label={copy.todayChip} tone="primary" /> : null}
              </View>
            ))}
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
