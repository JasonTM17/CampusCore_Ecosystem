import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, HeroCard, IconChip, ScreenSpacer, StatePanel, StatusPill, UiText } from '../../components/Ui';
import { Dialog, Notice } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { academicApi, type RegistrationWorkspace } from '../academic/academic-api';
import { isActiveEnrollment, isDroppableEnrollment } from '../academic/academic-model';
import { previewEnrollments, previewSections } from '../academic/academic-preview';
import {
  browseSections,
  canSelect,
  seatTier,
  sectionAvailability,
  type BrowseQuery,
  type BrowseSection,
  type SectionAvailability,
  type SectionMeeting,
} from '../academic/registration-browse';
import { RegistrationControls } from '../academic/RegistrationControls';
import { AcademicShell, academicStyles, isPreviewMode, openRoute, useAcademicCopy, useAcademicQuery } from '../academic/academic-ui';
import { useRegistrationActions } from '../academic/useRegistrationActions';

const PAGE_SIZE = 20;

interface SectionView {
  id: string;
  code: string;
  name: string;
  number: string;
  credits: number;
  seats: string;
  availability: SectionAvailability;
  meetings: string;
  failure?: string;
  selected: boolean;
  enrollmentId: string | null;
}

const previewWorkspace: RegistrationWorkspace = { sections: previewSections, enrollments: previewEnrollments, roundOpen: true, eligibility: null, closedReason: null };

const availabilityTone = (value: SectionAvailability) => (value === 'open' ? 'success' : value === 'enrolled' ? 'primary' : 'warning');

export function RegistrationScreen({ navigation }: MobileScreenProps) {
  const { copy, locale } = useAcademicCopy();
  const preview = isPreviewMode();
  const query = useAcademicQuery('academic.registration', () => academicApi.registrationWorkspace(), copy);
  const workspace = preview ? previewWorkspace : query.data;
  const [browse, setBrowse] = useState<BrowseQuery>({ search: '', curriculum: 'ALL', hideFull: false, sort: 'code' });
  const [visibleGroups, setVisibleGroups] = useState(PAGE_SIZE);
  const [dropTarget, setDropTarget] = useState<SectionView | null>(null);

  const sections = useMemo(() => workspace?.sections ?? [], [workspace]);
  const catalogIds = useMemo(() => sections.map((section) => section.id), [sections]);
  const actions = useRegistrationActions({
    copy, locale, preview, knownOffline: query.errorStatus === 0, reload: query.reload, catalogIds,
  });

  const enrolledMeetings = useMemo<SectionMeeting[]>(
    () => (workspace?.enrollments ?? [])
      .filter((item) => isActiveEnrollment(item.status))
      .flatMap((item) => item.section?.schedules ?? []),
    [workspace],
  );
  const groups = useMemo(() => browseSections(sections, browse), [sections, browse]);
  const roundOpen = workspace?.roundOpen ?? false;

  const toView = (section: BrowseSection): SectionView => {
    const availability = sectionAvailability(section, { roundOpen, enrolledMeetings, creditsRemaining: workspace?.eligibility?.creditsRemaining });
    const failure = actions.basket.failures[section.id];
    const enrollment = (workspace?.enrollments ?? []).find((item) => item.sectionId === section.id && isDroppableEnrollment(item.status));
    return {
      id: section.id,
      code: section.courseCode,
      name: section.courseName,
      number: section.sectionNumber,
      credits: section.credits ?? 0,
      seats: seatTier(section) === 'full' ? copy.seatsFull : fillCopy(copy.seatsLeft, { n: section.remainingSeats }),
      availability,
      meetings: (section.schedules ?? []).map((slot) => `${copy.dayLong[slot.dayOfWeek === 0 ? 1 : slot.dayOfWeek] ?? ''} ${slot.startTime}–${slot.endTime}${slot.room ? ` · ${slot.room}` : ''}`).join('; '),
      failure: failure ? copy.errors[failure.messageKey] ?? copy.errors.generic : undefined,
      selected: actions.basket.selected.includes(section.id),
      enrollmentId: enrollment?.id ?? null,
    };
  };

  const eligibility = workspace?.eligibility;
  const selectedCount = actions.basket.selected.length;

  return (
    <AcademicShell
      title={copy.registrationTitle}
      loading={!preview && query.isLoading}
      error={preview ? null : query.error}
      warning={preview ? null : query.warning}
      onRetry={() => void query.reload()}
    >
      {actions.notice ? <Notice message={actions.notice.text} tone={actions.notice.tone} /> : null}
      <HeroCard
        icon="clipboard-list-outline"
        eyebrow={copy.registrationTitle}
        title={fillCopy(copy.basketTitle, { n: selectedCount })}
        detail={eligibility?.creditLimit != null
          ? fillCopy(copy.creditsUsed, { used: eligibility.creditsUsed ?? 0, limit: eligibility.creditLimit })
          : undefined}
      >
        <View style={styles.heroActions}>
          {roundOpen ? <StatusPill label={copy.availability.open} tone="success" /> : null}
          {selectedCount > 0 ? (
            <Button label={copy.registerSelected} onPress={() => void actions.registerSelected()} loading={actions.busy} disabled={preview} />
          ) : null}
        </View>
        {selectedCount > 0 && Object.keys(actions.basket.failures).length > 0 ? (
          <UiText variant="bodySmall" tone="muted" style={styles.keptSelection}>{copy.selectionKept}</UiText>
        ) : null}
      </HeroCard>
      {!roundOpen ? <StatePanel kind="empty" title={copy.roundClosed} /> : null}
      <RegistrationControls query={browse} onChange={(next) => { setBrowse(next); setVisibleGroups(PAGE_SIZE); }} />
      <ScreenSpacer />
      {roundOpen && groups.length === 0 ? <StatePanel kind="empty" title={copy.noSections} /> : null}
      {groups.slice(0, visibleGroups).map((group) => (
        <View key={group.courseKey}>
          <View style={styles.courseHeading}>
            <IconChip icon="book-open-variant" size={32} />
            <UiText accessibilityRole="header" variant="label" tone="primary" style={styles.courseHeadingText}>
              {group.courseCode} · {group.courseName} · {fillCopy(copy.credits, { n: group.credits })}
            </UiText>
          </View>
          {group.sections.map((raw) => {
            const section = toView(raw);
            return (
              <Card key={section.id} style={academicStyles.card}>
                <View style={styles.sectionTop}>
                  <IconChip icon="book-open-outline" size={32} tone="neutral" />
                  <View style={styles.sectionCopy}>
                    <UiText variant="bodyMedium">{fillCopy(copy.section, { n: section.number })}</UiText>
                    {section.meetings ? <UiText variant="bodySmall" tone="muted">{section.meetings}</UiText> : null}
                  </View>
                  <StatusPill label={section.seats} tone={section.seats === copy.seatsFull ? 'warning' : 'success'} />
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
                </View>
              </Card>
            );
          })}
        </View>
      ))}
      {groups.length > visibleGroups ? <Button label={copy.loadMore} onPress={() => setVisibleGroups((count) => count + PAGE_SIZE)} variant="secondary" /> : null}
      <ScreenSpacer />
      <Button label={copy.viewEnrollments} onPress={() => openRoute(navigation, 'enrollments')} variant="secondary" />
      <Dialog
        visible={dropTarget !== null}
        title={copy.dropTitle}
        description={dropTarget ? fillCopy(copy.dropBody, { name: `${dropTarget.code} ${dropTarget.name}` }) : undefined}
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
    </AcademicShell>
  );
}

const styles = StyleSheet.create({
  heroActions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  keptSelection: { marginTop: 8 },
  courseHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 8 },
  courseHeadingText: { flex: 1, minWidth: 0 },
  sectionTop: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionCopy: { flex: 1, gap: 4, minWidth: 150 },
});
