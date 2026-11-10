import { groupedRows } from '../../components/perf/grouped-rows';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, Card, HeroCard, IconChip, InlineError, ScreenSpacer, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { Dialog, Notice } from '../../components/ui/primitives';
import { useTheme } from '../../design/theme';
import { tokens } from '../../design/tokens';
import { fillCopy, type AcademicCopy } from '../../i18n/academic-messages';
import { countForm } from '../../i18n/locale';
import { useLocale } from '../../i18n/locale-provider';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type CreditLimitApplication, type RegistrationWorkspace } from '../academic/academic-api';
import { isActiveEnrollment, isDroppableEnrollment, localizedName } from '../academic/academic-model';
import { previewEnrollments, previewSections } from '../academic/academic-preview';
import { CreditLimitCard } from '../academic/CreditLimitCard';
import {
  browseSections,
  canSelect,
  matchesSectionSearch,
  normalizeDayOfWeek,
  seatTier,
  sectionAvailability,
  type BrowseQuery,
  type BrowseSection,
  type SeatTier,
  type SectionAvailability,
  type SectionMeeting,
} from '../academic/registration-browse';
import { RegistrationControls } from '../academic/RegistrationControls';
import { SlipRow } from '../academic/SlipRow';
import { AcademicShell, academicErrorMessage, academicStyles, isPreviewMode, openRoute, useAcademicCopy, useAcademicQuery } from '../academic/academic-ui';
import { useRegistrationActions } from '../academic/useRegistrationActions';

const PAGE_SIZE = 20;

interface SectionView {
  id: string;
  code: string;
  name: string;
  number: string;
  label: string;
  credits: number;
  seats: string;
  tier: SeatTier;
  availability: SectionAvailability;
  meetings: string;
  hasSchedule: boolean;
  outside: boolean;
  duplicate: boolean;
  blockedReason?: string;
  failure?: string;
  selected: boolean;
  enrollmentId: string | null;
}

const previewRound = {
  id: 'preview-round',
  semesterId: 'preview-term',
  name: 'Đợt đăng ký học kỳ 1',
  kind: 'REGISTRATION',
  status: 'OPEN',
  windowStart: '2026-08-01T00:00:00Z',
  windowEnd: '2026-12-31T00:00:00Z',
};

const previewWorkspace: RegistrationWorkspace = {
  sections: previewSections,
  enrollments: previewEnrollments,
  roundOpen: true,
  round: previewRound,
  eligibility: null,
  application: null,
  closedReason: null,
};

const availabilityTone = (value: SectionAvailability) => (value === 'open' ? 'success' : value === 'enrolled' ? 'primary' : 'warning');
const seatTone = (tier: SeatTier) => (tier === 'open' ? 'success' : tier === 'low' ? 'warning' : 'neutral');
const dayIndex = (dayOfWeek: number): number => (normalizeDayOfWeek(dayOfWeek) + 5) % 7;
/** The web confirmation label: a section number already carrying the course prefix is not prefixed twice. */
const sectionLabel = (section: BrowseSection): string =>
  section.sectionNumber && !section.sectionNumber.startsWith(section.courseCode)
    ? `${section.courseCode}-${section.sectionNumber}`
    : section.sectionNumber || section.courseCode;

interface RoundCountdownProps {
  windowEnd: number;
  copy: AcademicCopy;
  formatCount: (value: number) => string;
}

/** The live clock ticks inside this leaf so the section list never re-renders every second. */
function RoundCountdown({ windowEnd, copy, formatCount }: RoundCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remainingMs = windowEnd - now;
  if (remainingMs <= 0) return <StatusPill label={copy.roundClosedBadge} tone="neutral" />;
  const days = Math.floor(remainingMs / 86_400_000);
  const clock = [Math.floor(remainingMs / 3_600_000) % 24, Math.floor(remainingMs / 60_000) % 60, Math.floor(remainingMs / 1000) % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
  return (
    <StatusPill
      label={`${copy.roundCountdownPrefix}: ${days > 0 ? `${fillCopy(copy.roundCountdownDays, { days: formatCount(days) })} ` : ''}${clock}`}
      tone="primary"
    />
  );
}

export function RegistrationScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const { colors } = useTheme();
  const { formatDate, formatNumber: formatCount } = useLocale();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.registration', () => academicApi.registrationWorkspace(), copy);
  const pull = usePullToRefresh(() => query.reload());
  const workspace = preview ? previewWorkspace : query.data;
  const [browse, setBrowse] = useState<BrowseQuery>({ search: '', curriculum: 'ALL', seatsOnly: false, noConflictOnly: false, sort: 'code' });
  const [visibleGroups, setVisibleGroups] = useState(PAGE_SIZE);
  const [collapsedCourses, setCollapsedCourses] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<SectionView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localApplication, setLocalApplication] = useState<CreditLimitApplication | null>(null);

  const sections = useMemo(() => workspace?.sections ?? [], [workspace]);
  const catalogIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const actions = useRegistrationActions({
    copy, locale, preview, knownOffline: query.errorStatus === 0, reload: query.reload, catalogIds,
    roundOpen: workspace?.roundOpen,
  });

  const round = workspace?.round ?? null;
  const roundId = round?.id ?? null;
  useEffect(() => { setLocalApplication(null); }, [roundId]);
  const application = localApplication ?? workspace?.application ?? null;

  const roundSemesterId = round?.semesterId ?? workspace?.eligibility?.semesterId;
  const enrolledMeetings = useMemo<SectionMeeting[]>(
    () => (workspace?.enrollments ?? [])
      .filter((item) => (!roundSemesterId || item.semesterId === roundSemesterId) && isActiveEnrollment(item.status))
      .flatMap((item) => item.section?.schedules ?? []),
    [workspace, roundSemesterId],
  );
  const enrolledCourseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of workspace?.enrollments ?? []) {
      if (!isActiveEnrollment(item.status)) continue;
      if (roundSemesterId && item.semesterId !== roundSemesterId) continue;
      const courseId = item.section?.courseId ?? item.section?.course?.id;
      if (courseId) ids.add(courseId);
    }
    return ids;
  }, [workspace?.enrollments, roundSemesterId]);

  const groups = useMemo(() => browseSections(sections, browse), [sections, browse]);
  const cohortIneligible = workspace?.closedReason === 'COHORT_INELIGIBLE'
    || workspace?.eligibility?.eligible === false
    || (workspace?.eligibilityError as { code?: string } | null)?.code === 'COHORT_INELIGIBLE';
  const roundOpen = (workspace?.roundOpen ?? false) && !cohortIneligible;

  const toView = useCallback((section: BrowseSection): SectionView => {
    // The basket joins the checks: a second section must fit beside the picks.
    const others = sections.filter((item) => item.id !== section.id && actions.basket.selected.includes(item.id));
    const availability = sectionAvailability(section, {
      roundOpen,
      enrolledMeetings: others.length === 0 ? enrolledMeetings : [...enrolledMeetings, ...others.flatMap((item) => item.schedules ?? [])],
      enrolledCourseIds,
      creditsRemaining: typeof workspace?.eligibility?.creditsRemaining === 'number'
        ? workspace.eligibility.creditsRemaining - others.reduce((sum, item) => sum + (item.credits ?? 0), 0)
        : workspace?.eligibility?.creditsRemaining,
    });
    const failure = actions.basket.failures[section.id];
    const enrollment = (workspace?.enrollments ?? []).find((item) => item.sectionId === section.id && isDroppableEnrollment(item.status));
    const tier = seatTier(section);
    const blockedReason = availability === 'closed' ? copy.sectionClosed
      : availability === 'creditLimit'
        ? fillCopy(copy.creditLimitExceeded, {
          limit: typeof workspace?.eligibility?.creditLimit === 'number' ? formatCount(workspace.eligibility.creditLimit) : copy.creditLimitUnavailable,
        })
        : availability === 'full' ? copy.full
          : availability === 'conflict' ? copy.scheduleConflictTooltip
            : availability === 'duplicate' ? copy.duplicateCourseTooltip
              : undefined;
    const schedules = section.schedules ?? [];
    return {
      id: section.id,
      code: section.courseCode,
      name: localizedName({ name: section.courseName, nameEn: section.courseNameEn, nameVi: section.courseNameVi }, locale) || section.courseName,
      number: section.sectionNumber,
      label: sectionLabel(section),
      credits: section.credits ?? 0,
      seats: tier === 'full' ? copy.full : fillCopy(countForm(section.remainingSeats, copy.seatsLeftOne, copy.seatsLeft), { n: formatCount(section.remainingSeats) }),
      tier,
      availability,
      meetings: schedules.map((slot) => {
        const lecturer = slot.lecturer ? ` · ${fillCopy(copy.scheduleChipLecturer, { name: slot.lecturer })}` : '';
        const room = slot.room ? ` · ${copy.room} ${slot.room}` : '';
        return `${copy.dayShort[dayIndex(slot.dayOfWeek)] ?? ''} ${slot.startTime}–${slot.endTime}${room}${lecturer}`;
      }).join('; '),
      hasSchedule: schedules.length > 0,
      outside: section.curriculumRelevance === 'OUTSIDE',
      duplicate: Boolean(section.courseId && enrolledCourseIds.has(section.courseId)),
      blockedReason,
      failure: failure ? copy.errors[failure.messageKey] ?? copy.errors.generic : undefined,
      selected: actions.basket.selected.includes(section.id),
      enrollmentId: enrollment?.id ?? null,
    };
  }, [sections, actions.basket.selected, actions.basket.failures, enrolledMeetings, enrolledCourseIds, workspace?.eligibility, workspace?.enrollments, roundOpen, locale, copy, formatCount]);
  const sectionViews = useMemo(
    () => new Map(sections.map((section) => [section.id, toView(section)] as const)),
    [sections, toView],
  );

  const searchedSections = useMemo(() => sections.filter((section) => matchesSectionSearch(section, browse.search)), [sections, browse.search]);
  const counts = useMemo(() => ({
    ALL: searchedSections.length,
    MANDATORY: searchedSections.filter((section) => section.curriculumRelevance === 'MANDATORY').length,
    ELECTIVE: searchedSections.filter((section) => section.curriculumRelevance === 'ELECTIVE').length,
    OUTSIDE: searchedSections.filter((section) => section.curriculumRelevance === 'OUTSIDE').length,
    seats: searchedSections.filter((section) => section.remainingSeats > 0).length,
    noConflict: searchedSections.filter((section) => !section.scheduleConflict).length,
  }), [searchedSections]);

  const selectedSections = useMemo(() => sections.filter((section) => actions.basket.selected.includes(section.id)), [sections, actions.basket.selected]);
  const confirmDescription = useMemo(() => {
    const lines = selectedSections.map((section) => fillCopy(copy.confirmRegisterMessage, { section: sectionLabel(section) }));
    const warnings: string[] = [];
    if (selectedSections.some((section) => section.curriculumRelevance === 'OUTSIDE')) warnings.push(copy.outsideWarningBanner);
    if (selectedSections.some((section) => (section.schedules ?? []).length === 0)) warnings.push(copy.scheduleNoneWarning);
    if (warnings.length > 0) lines.push(warnings.join(' '));
    return lines.join('\n\n');
  }, [selectedSections, copy]);

  const eligibility = workspace?.eligibility;
  const selectedCount = actions.basket.selected.length;
  const resultCount = groups.reduce((sum, group) => sum + group.sections.length, 0);
  const slipSemesterId = round?.semesterId ?? eligibility?.semesterId ?? null;
  const windowEnd = round?.windowEnd ? new Date(round.windowEnd).getTime() : 0;
  const remainingMs = windowEnd - Date.now();
  const roundClosed = Boolean(round) && remainingMs <= 0;
  const showCountdown = remainingMs > 0 && remainingMs <= 7 * 86_400_000;

  const toggleCourse = (courseKey: string) => {
    setCollapsedCourses((current) => {
      const next = new Set(current);
      if (next.has(courseKey)) next.delete(courseKey);
      else next.add(courseKey);
      return next;
    });
  };

  return (
    <AcademicShell
      title={copy.registrationTitle}
      eyebrow={copy.eyebrow}
      subtitle={copy.registrationDescription}
      loading={!preview && query.isLoading}
      error={preview ? null : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
      onRefresh={preview ? undefined : pull.onRefresh}
      refreshing={!preview && pull.refreshing}

      list={{ data: groupedRows(groups.slice(0, visibleGroups), (group) => group.courseKey, (group) => (collapsedCourses.has(group.courseKey) ? [] : group.sections), (item) => item.id), keyExtractor: (entry) => entry.key,
        renderItem: ({ item: entry }) => { const group = entry.group;
if (entry.kind === "header") { const openSeats = group.sections.reduce((sum, section) => sum + section.remainingSeats, 0);
  const name = localizedName({ name: group.courseName, nameEn: group.courseNameEn, nameVi: group.courseNameVi }, locale) || group.courseName;
  return <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${group.courseCode} ${name}`}
            accessibilityState={{ expanded: !collapsedCourses.has(group.courseKey) }}
            onPress={() => toggleCourse(group.courseKey)}
            style={styles.courseHeading}
          >
            <MaterialCommunityIcons
              accessible={false}
              importantForAccessibility="no"
              name="chevron-down"
              size={20}
              color={colors.textMuted}
              style={collapsedCourses.has(group.courseKey) ? styles.collapsedChevron : undefined}
            />
            <IconChip icon="book-open-variant" size={32} />
            <View style={styles.courseHeadingCopy}>
              <UiText accessibilityRole="header" variant="label" tone="primary">
                {group.courseCode} — {name}
              </UiText>
              <UiText variant="meta" tone="muted">
                {formatCount(group.credits)} {copy.creditsUnit} · {fillCopy(countForm(group.sections.length, copy.groupSectionCountOne, copy.groupSectionCount), { count: formatCount(group.sections.length) })}
              </UiText>
            </View>
            <StatusPill
              label={openSeats > 0 ? fillCopy(countForm(openSeats, copy.seatsOpenOne, copy.seatsOpen), { count: formatCount(openSeats) }) : copy.full}
              tone={openSeats > 0 ? 'success' : 'neutral'}
            />
          </Pressable>
          </>;
}
const raw = entry.item;
            const section = sectionViews.get(raw.id)!;

return (
              <Card key={section.id} style={academicStyles.card}>
                <View style={styles.sectionTop}>
                  <IconChip icon="book-open-outline" size={32} tone="neutral" />
                  <View style={styles.sectionCopy}>
                    <UiText variant="bodyMedium">{fillCopy(copy.section, { n: section.number })}</UiText>
                    {section.hasSchedule
                      ? <UiText variant="bodySmall" tone="muted">{section.meetings}</UiText>
                      : <UiText variant="bodySmall" tone="muted">{copy.scheduleNone}</UiText>}
                    {section.outside || (section.duplicate && !section.enrollmentId) ? (
                      <View style={styles.badges}>
                        {section.duplicate && !section.enrollmentId ? <StatusPill label={copy.duplicateCourseBadge} tone="warning" /> : null}
                        {section.outside ? <StatusPill label={copy.outsideBadge} tone="warning" /> : null}
                      </View>
                    ) : null}
                  </View>
                  <StatusPill label={section.seats} tone={seatTone(section.tier)} />
                </View>
                <View style={academicStyles.actions}>
                  <StatusPill label={copy.availability[section.availability]} tone={availabilityTone(section.availability)} />
                  {section.failure ? <UiText accessibilityRole="alert" variant="bodySmall" tone="error">{section.failure}</UiText> : null}
                  {section.enrollmentId ? (
                    <Button label={copy.dropSection} accessibilityLabel={`${copy.dropSection}: ${section.code}`} onPress={() => setDropTarget(section)} variant="secondary" disabled={preview || actions.busy} />
                  ) : canSelect(section.availability) || section.selected ? (
                    <Button
                      label={section.selected ? copy.unselect : copy.select}
                      accessibilityLabel={`${section.selected ? copy.unselect : copy.select}: ${section.code} ${fillCopy(copy.section, { n: section.number })}`}
                      onPress={() => actions.dispatch({ type: 'toggle', sectionId: section.id })}
                      variant={section.selected ? 'primary' : 'secondary'}
                      disabled={preview || actions.busy}
                    />
                  ) : null}
                  {section.blockedReason && !section.selected && !section.enrollmentId ? (
                    <UiText variant="bodySmall" tone="muted">{section.blockedReason}</UiText>
                  ) : null}
                </View>
              </Card>
            ); },
        footer: <>
      {groups.length > visibleGroups ? <Button label={copy.loadMore} onPress={() => setVisibleGroups((count) => count + PAGE_SIZE)} variant="secondary" /> : null}
      <ScreenSpacer />
      <Button label={copy.viewEnrollments} onPress={() => openRoute(navigation, 'enrollments')} variant="secondary" />
      <ScreenSpacer />
      <SlipRow semesterId={slipSemesterId} />
      <Dialog
        visible={dropTarget !== null}
        title={copy.dropTitle}
        description={dropTarget ? fillCopy(copy.dropBody, { section: dropTarget.label }) : undefined}
        confirmLabel={copy.dropSection}
        cancelLabel={copy.cancel}
        destructive
        onCancel={() => setDropTarget(null)}
        onConfirm={() => {
          const target = dropTarget;
          setDropTarget(null);
          if (target?.enrollmentId) void actions.drop(target.enrollmentId);
        }}
      />
      <Dialog
        visible={confirmOpen}
        title={copy.confirmRegister}
        description={confirmDescription}
        confirmLabel={copy.register}
        cancelLabel={copy.cancel}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void actions.registerSelected();
        }}
      />
    </>,
      }}
    >
      {actions.notice ? <View style={academicStyles.card}><Notice message={actions.notice.text} tone={actions.notice.tone} /></View> : null}
      {round ? (
        <Card style={academicStyles.card}>
          <View style={styles.roundRow}>
            <IconChip icon="calendar-clock" size={36} />
            <View style={styles.roundCopy}>
              <UiText accessibilityRole="header" variant="label">{round.name}</UiText>
              <UiText variant="bodySmall" tone="muted">
                {fillCopy(copy.roundWindowHint, { start: formatDate(round.windowStart), end: formatDate(round.windowEnd) })}
              </UiText>
            </View>
            {roundClosed ? (
              <StatusPill label={copy.roundClosedBadge} tone="neutral" />
            ) : showCountdown ? (
              <RoundCountdown windowEnd={windowEnd} copy={copy} formatCount={formatCount} />
            ) : null}
          </View>
        </Card>
      ) : null}
      <HeroCard
        icon="clipboard-list-outline"
        title={fillCopy(copy.basketTitle, { n: selectedCount })}
        detail={eligibility?.creditLimit != null
          ? fillCopy(copy.creditsUsed, { used: eligibility.creditsUsed ?? 0, limit: eligibility.creditLimit })
          : undefined}
      >
        <View style={styles.heroActions}>
          {roundOpen ? <StatusPill label={copy.availability.open} tone="success" /> : null}
          {selectedCount > 0 && roundOpen ? (
            <Button label={copy.registerSelected} onPress={() => setConfirmOpen(true)} loading={actions.busy} disabled={preview} />
          ) : null}
        </View>
        {selectedCount > 0 && Object.keys(actions.basket.failures).length > 0 ? (
          <UiText variant="bodySmall" tone="muted" style={styles.keptSelection}>{copy.selectionKept}</UiText>
        ) : null}
      </HeroCard>
      <ScreenSpacer />
      {roundOpen && roundId ? (
        <CreditLimitCard
          roundId={roundId}
          eligibility={eligibility ?? null}
          application={application}
          onSubmitted={setLocalApplication}
        />
      ) : null}
      {workspace?.eligibilityError && !cohortIneligible ? (
        <View style={academicStyles.card}>
          <InlineError message={academicErrorMessage(copy, workspace.eligibilityError, copy.generic)} onRetry={() => void query.reload()} retryLabel={copy.retry} />
        </View>
      ) : null}
      {!roundOpen ? (
        <View style={academicStyles.card}>
          <StatePanel
            kind="empty"
            title={cohortIneligible ? copy.roundCohortIneligible : copy.roundClosed}
            description={cohortIneligible ? copy.cohortIneligibleDescription : copy.roundClosedDescription}
          />
        </View>
      ) : null}
      {roundOpen ? (
        <>
          <RegistrationControls query={browse} counts={counts} resultCount={resultCount} onChange={(next) => { setBrowse(next); setVisibleGroups(PAGE_SIZE); }} />
          <ScreenSpacer />
        </>
      ) : null}
      {roundOpen && groups.length === 0 ? <StatePanel kind="empty" title={copy.noSections} description={copy.noSectionsDescription} /> : null}
      </AcademicShell>
  );
}

const styles = StyleSheet.create({
  heroActions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  keptSelection: { marginTop: 8 },
  courseHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8, minHeight: tokens.layout.touchTarget },
  courseHeadingCopy: { flex: 1, minWidth: 150 },
  collapsedChevron: { transform: [{ rotate: '-90deg' }] },
  sectionTop: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionCopy: { flex: 1, gap: 4, minWidth: 150 },
  badges: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  roundRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roundCopy: { flex: 1, gap: 4, minWidth: 150 },
});
