import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, FilterChip, ScreenSpacer, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { useLocale } from '../../i18n/locale-provider';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi } from '../academic/academic-api';
import {
  DAY_ORDER,
  agendaForDate,
  buildAgenda,
  civilKey,
  defaultTermId,
  termOptions,
  weekDates,
  weekStartOf,
  type AgendaItem,
} from '../academic/academic-model';
import { previewEnrollments, previewSemester } from '../academic/academic-preview';
import { ScheduleExport } from '../academic/ScheduleExport';
import { AcademicShell, SegmentTabs, TermField, academicStyles, isPreviewMode, useAcademicCopy, useAcademicQuery } from '../academic/academic-ui';

type View_ = 'week' | 'term';

const SessionCard = memo(function SessionCard({ item, expanded, onToggle }: { item: AgendaItem; expanded: boolean; onToggle: (id: string) => void }) {
  const { copy } = useAcademicCopy();
  const { colors } = useTheme();
  const summary = `${item.startTime} – ${item.endTime}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.courseCode} ${item.courseName}, ${summary}${item.room ? `, ${item.room}` : ''}`}
      accessibilityState={{ expanded }}
      onPress={() => onToggle(item.id)}
      style={{ minHeight: tokens.layout.touchTarget }}
    >
      <Card style={academicStyles.card}>
        <View style={styles.sessionRow}>
          <View style={[styles.timeRail, { borderRightColor: colors.outlineVariant }]}>
            <UiText variant="label" tone="primary">{item.startTime}</UiText>
            <View style={[styles.timeRule, { backgroundColor: colors.outlineVariant }]} />
            <UiText variant="meta" tone="muted">{item.endTime}</UiText>
          </View>
          <View style={styles.sessionCopy}>
            <View style={styles.courseLine}>
              <StatusPill label={item.courseCode} tone="primary" />
              <UiText variant="bodyMedium" style={styles.courseName}>{item.courseName}</UiText>
            </View>
            {item.room ? (
              <View style={styles.roomLine}>
                <MaterialCommunityIcons accessible={false} importantForAccessibility="no" name="map-marker-outline" size={16} color={colors.textMuted} />
                <UiText variant="bodySmall" tone="muted">{copy.room} {item.room}</UiText>
              </View>
            ) : null}
          </View>
        </View>
        {expanded ? (
          <View style={academicStyles.actions}>
            {item.sectionNumber ? <UiText variant="bodySmall">{copy.sectionLabel}: {item.sectionNumber}</UiText> : null}
            {item.lecturer ? <UiText variant="bodySmall">{copy.lecturer}: {item.lecturer}</UiText> : null}
            {item.credits > 0 ? <UiText variant="bodySmall">{fillCopy(copy.credits, { n: item.credits })}</UiText> : null}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
});

type ScheduleRow = { kind: 'session'; item: AgendaItem } | { kind: 'heading'; day: number; label: string };

export const ScheduleScreen = memo(function ScheduleScreen(_props: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { colors } = useTheme();
  const { formatDate } = useLocale();
  const preview = isPreviewMode();
  const enrollmentsQuery = useAcademicQuery('academic.enrollments', () => academicApi.enrollments(), copy);
  const semestersQuery = useAcademicQuery('academic.semesters', () => academicApi.semesters(), copy);
  const [view, setView] = useState<View_>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => (new Date().getDay() + 6) % 7);
  const [termChoice, setTermChoice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const enrollments = useMemo(() => (preview ? previewEnrollments : enrollmentsQuery.data ?? []), [preview, enrollmentsQuery.data]);
  const semesters = useMemo(() => (preview ? [previewSemester] : semestersQuery.data ?? []), [preview, semestersQuery.data]);
  const options = useMemo(() => termOptions(enrollments, semesters, locale), [enrollments, semesters, locale]);
  const termId = termChoice ?? defaultTermId(semesters, enrollments) ?? '';
  const semester = semesters.find((entry) => entry.id === termId);
  const termEnrollments = useMemo(
    () => enrollments.filter((item) => item.semesterId === termId),
    [enrollments, termId],
  );
  const agenda = useMemo(() => buildAgenda(termEnrollments, locale), [termEnrollments, locale]);

  const today = new Date();
  const start = weekStartOf(today, weekOffset);
  const days = weekDates(start);
  const weekLabel = `${formatDate(civilKey(days[0]))} – ${formatDate(civilKey(days[6]))}`;
  const toggle = useCallback((id: string) => setOpenId((current) => (current === id ? null : id)), []);
  const selectedItems = agendaForDate(agenda, days[selectedDayIndex], semester);
  const scheduleRows: ScheduleRow[] = view === 'week'
    ? selectedItems.map((item) => ({ kind: 'session', item }))
    : DAY_ORDER.flatMap((day, index): ScheduleRow[] => {
      const items = agenda.filter((item) => item.dayOfWeek === day);
      return items.length ? [{ kind: 'heading', day, label: copy.dayLong[day] ?? copy.dayShort[index] },
        ...items.map((item): ScheduleRow => ({ kind: 'session', item }))] : [];
    });

  return (
    <AcademicShell
      title={copy.scheduleTitle}
      loading={!preview && enrollmentsQuery.isLoading}
      error={preview ? null : enrollmentsQuery.error}
      warning={preview ? null : enrollmentsQuery.warning}
      onRetry={() => void enrollmentsQuery.reload()}
      list={{ data: scheduleRows,
        keyExtractor: (row) => row.kind === 'heading' ? `day:${row.day}` : row.item.id,
        renderItem: ({ item: row }) => row.kind === 'session'
          ? <SessionCard item={row.item} expanded={openId === row.item.id} onToggle={toggle} />
          : <View style={styles.termDay}><UiText accessibilityRole="header" variant="label" tone="muted" style={styles.dayHeading}>{row.label}</UiText></View>,
        footer: <><ScreenSpacer /><ScheduleExport enrollments={termEnrollments} semester={semester} /></>,
      }}
    >
      <TermField options={options} value={termId} onChange={(value) => { setTermChoice(value); setOpenId(null); }} allowAll={false} />
      <SegmentTabs
        label={copy.viewLabel}
        value={view}
        onChange={(value) => setView(value as View_)}
        options={[{ value: 'week', label: copy.viewWeek }, { value: 'term', label: copy.viewTerm }]}
      />
      <ScreenSpacer />
      {agenda.length === 0 && view === 'term' ? <StatePanel kind="empty" title={copy.emptySchedule} /> : null}
      {view === 'week' ? (
        <View>
          <View style={academicStyles.row}>
            <Button accessibilityLabel={copy.prevWeek} label="‹" onPress={() => setWeekOffset((value) => value - 1)} variant="text" />
            <UiText variant="label" accessibilityLiveRegion="polite">{weekLabel}</UiText>
            <Button accessibilityLabel={copy.nextWeek} label="›" onPress={() => setWeekOffset((value) => value + 1)} variant="text" />
          </View>
          <View style={styles.dayStrip}>
            {days.map((date, index) => (
              <View key={civilKey(date)} testID={`day-${civilKey(date)}`} style={styles.dayChipWrap}>
                <FilterChip
                  label={copy.dayShort[index]}
                  count={date.getDate()}
                  selected={index === selectedDayIndex}
                  onPress={() => { setSelectedDayIndex(index); setOpenId(null); }}
                />
              </View>
            ))}
          </View>
          {(() => {
            const date = days[selectedDayIndex];
            const items = agendaForDate(agenda, date, semester);
            return (
              <View style={styles.dayContent}>
                <UiText accessibilityRole="header" variant="label" tone={civilKey(date) === civilKey(today) ? 'primary' : 'muted'} style={styles.dayHeading}>
                  {copy.dayShort[selectedDayIndex]} · {formatDate(civilKey(date))}
                </UiText>
                {items.length === 0 ? (
                  <Card tone="low" style={styles.emptyDay}>
                    <MaterialCommunityIcons accessible={false} importantForAccessibility="no" name="calendar-blank-outline" size={20} color={colors.textMuted} />
                    <UiText variant="bodySmall" tone="muted" style={styles.emptyDayText}>{copy.noSessions}</UiText>
                  </Card>
                ) : null}
              </View>
            );
          })()}
        </View>
      ) : null}
    </AcademicShell>
  );
});

const styles = StyleSheet.create({
  termDay: { marginTop: tokens.spacing.md },
  sessionRow: { alignItems: 'stretch', flexDirection: 'row', gap: tokens.spacing.md },
  timeRail: { alignItems: 'center', borderRightWidth: 1, justifyContent: 'center', minWidth: 64, paddingRight: tokens.spacing.sm },
  timeRule: { height: tokens.spacing.md, marginVertical: tokens.spacing.xs, width: 1 },
  sessionCopy: { flex: 1, gap: tokens.spacing.sm, minWidth: 0 },
  courseLine: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  courseName: { flex: 1, minWidth: 120 },
  roomLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs },
  dayStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.xs, marginTop: tokens.spacing.sm },
  dayChipWrap: { flexGrow: 1, minWidth: 40 },
  dayContent: { marginTop: tokens.spacing.md },
  dayHeading: { marginBottom: tokens.spacing.sm },
  emptyDay: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  emptyDayText: { flex: 1 },
});
