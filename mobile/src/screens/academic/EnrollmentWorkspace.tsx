import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, IconChip, InlineError, ScreenSpacer, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { Dialog, Notice } from '../../components/ui/primitives';
import { IconButton } from '../../components/ui/institutional';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { fillCopy } from '../../i18n/academic-messages';
import { useLocale } from '../../i18n/locale-provider';
import { countForm } from '../../i18n/locale';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileNavigation } from '../../navigation/types';
import { academicApi } from './academic-api';
import {
  defaultTermId,
  enrollmentCourseCode,
  enrollmentCourseName,
  filterEnrollments,
  isDroppableEnrollment,
  lecturerName,
  localizedName,
  roomLabel,
  tabCounts,
  termOptions,
  type AcademicEnrollment,
  type EnrollmentTab,
} from './academic-model';
import { previewEnrollments, previewSemester } from './academic-preview';
import { AcademicShell, SegmentTabs, TermField, academicStyles, enrollmentStatusTone, isPreviewMode, useAcademicCopy, useAcademicQuery } from './academic-ui';
import { EnrollmentDetail } from './EnrollmentDetail';
import { SlipRow } from './SlipRow';
import { useRegistrationActions } from './useRegistrationActions';

/** The enrollments screen has no registration catalog, so the basket stays empty. */
const EMPTY_CATALOG: readonly string[] = [];

/** Confirmation label for a drop, mirroring the web section label. */
function dropSectionLabel(item: AcademicEnrollment): string {
  const code = enrollmentCourseCode(item);
  const number = item.section?.sectionNumber;
  return number && !number.startsWith(code) ? `${code}-${number}` : number || code;
}

export interface EnrollmentWorkspaceProps {
  navigation: MobileNavigation;
  title: 'coursesTitle' | 'enrollmentsTitle';
}

/** Active, past and withdrawn enrollments by term, with a detail view per enrollment. */
/** Two columns once the window leaves the compact class, like the other card lists. */
function gridStyle(windowClass: string, largeText: boolean) {
  return windowClass === 'compact' || largeText
    ? undefined
    : ({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' } as const);
}

export function EnrollmentWorkspace({ navigation, title }: EnrollmentWorkspaceProps) {
  const { window } = useTheme();
  const windowClass = window.class;
  const largeText = window.fontScale >= 1.3;
  const { copy, locale } = useAcademicCopy();
  const { formatDate, formatNumber } = useLocale();
  const preview = isPreviewMode();
  const enrollmentsQuery = useAcademicQuery('academic.enrollments', () => academicApi.enrollments(), copy);
  const semestersQuery = useAcademicQuery('academic.semesters', () => academicApi.semesters(), copy);
  const pull = usePullToRefresh(() => Promise.all([enrollmentsQuery.reload(), semestersQuery.reload()]));
  const [tab, setTab] = useState<EnrollmentTab>('active');
  const [term, setTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<AcademicEnrollment | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actions = useRegistrationActions({
    copy, locale, preview,
    knownOffline: enrollmentsQuery.errorStatus === 0,
    reload: async () => { await Promise.all([enrollmentsQuery.reload(), semestersQuery.reload()]); },
    catalogIds: EMPTY_CATALOG,
  });

  const enrollments = useMemo(() => (preview ? previewEnrollments : enrollmentsQuery.data ?? []), [preview, enrollmentsQuery.data]);
  const semesters = useMemo(() => (preview ? [previewSemester] : semestersQuery.data ?? []), [preview, semestersQuery.data]);
  const options = useMemo(() => termOptions(enrollments, semesters, locale), [enrollments, semesters, locale]);
  const counts = tabCounts(enrollments, term || null);
  const rows = filterEnrollments(enrollments, tab, term || null);
  const selected = selectedId ? enrollments.find((item) => item.id === selectedId) ?? null : null;
  const openDrop = (item: AcademicEnrollment) => {
    setDropTarget(item);
    setConfirmOpen(true);
  };
  const emptyTitle = tab === 'active' ? copy.emptyActive : tab === 'past' ? copy.emptyPast : copy.emptyWithdrawn;
  const headingSemester = term ? semesters.find((entry) => entry.id === term) : undefined;
  const termEnrollments = term ? enrollments.filter((item) => item.semesterId === term) : [];
  const headingCredits = termEnrollments.reduce((sum, item) => sum + (item.section?.course?.credits ?? 0), 0);
  const slipSemesterId = term || defaultTermId(semesters, enrollments) || enrollments[0]?.semesterId || null;

  const loading = !preview && enrollmentsQuery.isLoading;
  const error = preview ? null : enrollmentsQuery.error;
  const warning = preview
    ? null
    : [enrollmentsQuery.warning, semestersQuery.warning].filter(Boolean).join(' ') || null;
  const semestersFailed = !preview && semestersQuery.error !== null;

  return (
    <AcademicShell
      title={copy[title]}
      eyebrow={copy.eyebrow}
      subtitle={copy.enrollmentsDescription}
      loading={loading}
      error={error}
      warning={warning}
      onRetry={() => void enrollmentsQuery.reload()}
      onRefresh={preview ? undefined : pull.onRefresh}
      refreshing={!preview && pull.refreshing}

      list={{ data: selected ? [] : rows, keyExtractor: (item) => `${item.semesterId}:${item.id}`,
        testID: 'course-grid', style: gridStyle(windowClass, largeText),
        numColumns: windowClass === 'compact' || largeText ? 1 : 2,
        columnWrapperStyle: windowClass === 'compact' || largeText ? undefined : styles.columns,
        renderItem: ({ item: item }) => {
              const code = enrollmentCourseCode(item);
              const name = enrollmentCourseName(item, locale);
              const statusLabel = copy.status[item.status] ?? copy.status.UNKNOWN;
              const credits = item.section?.course?.credits ?? 0;
              const creditsLabel = fillCopy(countForm(credits, copy.creditsOne, copy.credits), { n: formatNumber(credits) });
              const sectionLabel = item.section?.sectionNumber ? `${copy.sectionLabel}: ${item.section.sectionNumber}` : '';
              const lecturer = lecturerName(item.section);
              const meetings = (item.section?.schedules ?? []).map((slot) => {
                const day = copy.dayLong[slot.dayOfWeek === 0 ? 1 : slot.dayOfWeek] ?? '';
                const room = roomLabel(slot);
                return `${day} ${slot.startTime}–${slot.endTime}${room ? ` · ${copy.room} ${room}` : ''}`;
              }).join('; ');
              return (
                <Pressable
                  key={`${item.semesterId}-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${code} ${name}, ${statusLabel}, ${creditsLabel}${sectionLabel ? `, ${sectionLabel}` : ''}`}
                  onPress={() => setSelectedId(item.id)}
                  style={{ minHeight: tokens.layout.touchTarget, width: windowClass === 'compact' || largeText ? '100%' : '48.5%' }}
                >
                  <Card style={academicStyles.card}>
                    <View style={styles.courseRow}>
                      <IconChip icon="book-open-variant" size={40} />
                      <View style={styles.courseCopy}>
                        <View style={styles.courseTags}>
                          <StatusPill label={code} tone="primary" />
                          <StatusPill label={statusLabel} tone={enrollmentStatusTone(item.status)} />
                        </View>
                        <UiText variant="headlineSmall">{name}</UiText>
                        <UiText variant="meta" tone="muted">{creditsLabel}</UiText>
                        {item.section?.sectionNumber ? (
                          <UiText variant="meta" tone="muted">{copy.sectionLabel}: {item.section.sectionNumber}</UiText>
                        ) : null}
                        {meetings ? <UiText variant="meta" tone="muted">{meetings}</UiText> : null}
                        {lecturer ? <UiText variant="meta" tone="muted">{copy.lecturer}: {lecturer}</UiText> : null}
                        {item.enrolledAt ? <UiText variant="meta" tone="muted">{copy.enrolledOn} {formatDate(item.enrolledAt)}</UiText> : null}
                      </View>
                    </View>
                    {isDroppableEnrollment(item.status) ? (
                      <IconButton
                        icon="trash-can-outline"
                        accessibilityLabel={`${copy.dropSection}: ${code}`}
                        onPress={() => openDrop(item)}
                        disabled={preview || actions.busy}
                      />
                    ) : null}
                  </Card>
                </Pressable>
              );
            },
        footer: <>{selected ? null : (<>
          <ScreenSpacer />
          <Button label={copy.openRegistration} onPress={() => navigation.navigate('registration')} variant="secondary" />
        </>)}
    </>,
      }}
    >
      {actions.notice ? <View style={academicStyles.card}><Notice message={actions.notice.text} tone={actions.notice.tone} /></View> : null}
      {selected ? (
        <EnrollmentDetail
          enrollment={selected}
          onBack={() => setSelectedId(null)}
          onDrop={isDroppableEnrollment(selected.status) ? () => openDrop(selected) : null}
        />
      ) : (<View>
          <SlipRow semesterId={slipSemesterId} />
          <ScreenSpacer size={8} />
          {semestersFailed ? (
            <View style={academicStyles.card}>
              <InlineError message={semestersQuery.error ?? copy.errorTitle} onRetry={() => void semestersQuery.reload()} retryLabel={copy.retry} />
            </View>
          ) : (
            <TermField options={options} value={term} onChange={setTerm} />
          )}
          <SegmentTabs
            label={copy.tabLabel}
            value={tab}
            onChange={(value) => setTab(value as EnrollmentTab)}
            options={[
              { value: 'active', label: `${copy.tabActive} (${counts.active})` },
              { value: 'past', label: `${copy.tabPast} (${counts.past})` },
              { value: 'withdrawn', label: `${copy.tabWithdrawn} (${counts.withdrawn})` },
            ]}
          />
          <View style={academicStyles.gap} />
          {headingSemester && termEnrollments.length > 0 ? (
            <View style={styles.termHeading}>
              <UiText accessibilityRole="header" variant="label" tone="muted">{localizedName(headingSemester, locale, headingSemester.id)}</UiText>
              <UiText variant="meta" tone="muted">
                {formatNumber(termEnrollments.length)} {termEnrollments.length === 1 ? copy.courseWord : copy.coursesWord} · {formatNumber(headingCredits)} {copy.creditsUnit}
              </UiText>
            </View>
          ) : null}
          {rows.length === 0 ? <StatePanel kind="empty" title={emptyTitle} /> : null}
        </View>)}
      <Dialog
        visible={confirmOpen}
        title={copy.dropTitle}
        description={dropTarget ? fillCopy(copy.dropBody, { section: dropSectionLabel(dropTarget) }) : undefined}
        confirmLabel={copy.dropSection}
        cancelLabel={copy.cancel}
        destructive
        onCancel={() => { setDropTarget(null); setConfirmOpen(false); }}
        onConfirm={() => {
          const target = dropTarget;
          setDropTarget(null);
          setConfirmOpen(false);
          if (target) void actions.drop(target.id);
        }}
      />
    </AcademicShell>
  );
}

const styles = StyleSheet.create({
  columns: { justifyContent: 'space-between' },
  courseRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  courseCopy: { flex: 1, gap: 4, minWidth: 0 },
  courseTags: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  termHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: tokens.spacing.sm },
});
