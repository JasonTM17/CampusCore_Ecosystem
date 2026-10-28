import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, ScreenSpacer, StatePanel, UiText } from '../../components/Ui';
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

function SessionCard({ item, expanded, onToggle }: { item: AgendaItem; expanded: boolean; onToggle: () => void }) {
  const { copy } = useAcademicCopy();
  const summary = `${item.startTime} – ${item.endTime}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.courseCode} ${item.courseName}, ${summary}${item.room ? `, ${item.room}` : ''}`}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={{ minHeight: tokens.layout.touchTarget }}
    >
      <Card style={academicStyles.card}>
        <View style={academicStyles.row}>
          <View style={academicStyles.rowCopy}>
            <UiText variant="label" tone="primary">{summary}</UiText>
            <UiText variant="bodyMedium">{item.courseCode} · {item.courseName}</UiText>
            {item.room ? <UiText variant="bodySmall" tone="muted">{copy.room} {item.room}</UiText> : null}
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
}

export function ScheduleScreen(_props: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatDate } = useLocale();
  const preview = isPreviewMode();
  const enrollmentsQuery = useAcademicQuery('academic.enrollments', () => academicApi.enrollments(), copy);
  const semestersQuery = useAcademicQuery('academic.semesters', () => academicApi.semesters(), copy);
  const [view, setView] = useState<View_>('week');
  const [weekOffset, setWeekOffset] = useState(0);
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
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  return (
    <AcademicShell
      title={copy.scheduleTitle}
      loading={!preview && enrollmentsQuery.isLoading}
      error={preview ? null : enrollmentsQuery.error}
      warning={preview ? null : enrollmentsQuery.warning}
      onRetry={() => void enrollmentsQuery.reload()}
    >
      <TermField options={options} value={termId} onChange={(value) => { setTermChoice(value); setOpenId(null); }} allowAll={false} />
      <SegmentTabs
        label={copy.viewLabel}
        value={view}
        onChange={(value) => setView(value as View_)}
        options={[{ value: 'week', label: copy.viewWeek }, { value: 'term', label: copy.viewTerm }]}
      />
      <ScreenSpacer />
      {agenda.length === 0 ? <StatePanel kind="empty" title={copy.emptySchedule} /> : null}
      {view === 'week' ? (
        <View>
          <View style={academicStyles.row}>
            <Button accessibilityLabel={copy.prevWeek} label="‹" onPress={() => setWeekOffset((value) => value - 1)} variant="text" />
            <UiText variant="label" accessibilityLiveRegion="polite">{weekLabel}</UiText>
            <Button accessibilityLabel={copy.nextWeek} label="›" onPress={() => setWeekOffset((value) => value + 1)} variant="text" />
          </View>
          {days.map((date, index) => {
            const items = agendaForDate(agenda, date, semester);
            return (
              <View key={civilKey(date)} testID={`day-${civilKey(date)}`}>
                <UiText accessibilityRole="header" variant="label" tone={civilKey(date) === civilKey(today) ? 'primary' : 'muted'}>
                  {copy.dayShort[index]} · {formatDate(civilKey(date))}
                </UiText>
                {items.length === 0 ? <UiText variant="bodySmall" tone="muted">{copy.noSessions}</UiText> : null}
                {items.map((item) => <SessionCard key={item.id} item={item} expanded={openId === item.id} onToggle={() => toggle(item.id)} />)}
              </View>
            );
          })}
        </View>
      ) : (
        <View>
          {DAY_ORDER.map((dow, index) => {
            const items = agenda.filter((item) => item.dayOfWeek === dow);
            if (items.length === 0) return null;
            return (
              <View key={dow}>
                <UiText accessibilityRole="header" variant="label" tone="muted">{copy.dayLong[dow] ?? copy.dayShort[index]}</UiText>
                {items.map((item) => <SessionCard key={item.id} item={item} expanded={openId === item.id} onToggle={() => toggle(item.id)} />)}
              </View>
            );
          })}
        </View>
      )}
      <ScreenSpacer />
      <ScheduleExport enrollments={termEnrollments} semester={semester} />
    </AcademicShell>
  );
}
