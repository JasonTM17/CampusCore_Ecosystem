import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, IconChip, ScreenSpacer, StatusPill, UiText } from '../../components/Ui';
import { useLocale } from '../../i18n/locale-provider';
import {
  enrollmentCourseCode,
  enrollmentCourseName,
  lecturerName,
  roomLabel,
  type AcademicEnrollment,
} from './academic-model';
import { SlipRow } from './SlipRow';
import { academicStyles, enrollmentStatusTone, useAcademicCopy } from './academic-ui';
import { isPublishedGrade } from './gpa';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.fieldRow}>
      <UiText variant="bodySmall" tone="muted" style={styles.fieldLabel}>{label}</UiText>
      <UiText variant="bodyMedium" style={styles.fieldValue}>{value}</UiText>
    </View>
  );
}

export interface EnrollmentDetailProps {
  enrollment: AcademicEnrollment;
  onBack: () => void;
  /** Opens the shared drop confirmation; null when the status cannot be dropped. */
  onDrop: (() => void) | null;
}

export function EnrollmentDetail({ enrollment, onBack, onDrop }: EnrollmentDetailProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatDate, formatNumber } = useLocale();
  const section = enrollment.section;
  const published = isPublishedGrade(enrollment);
  const lecturer = lecturerName(section);
  const grade = published && enrollment.finalGrade != null
    ? `${formatNumber(enrollment.finalGrade, { maximumFractionDigits: 2 })}${enrollment.letterGrade ? ` · ${enrollment.letterGrade}` : ''}`
    : copy.noGrade;

  return (
    <View>
      <Button label={copy.back} onPress={onBack} variant="text" style={academicStyles.card} />
      <Card>
        <View style={styles.detailHeader}>
          <IconChip icon="book-open-variant" size={40} />
          <View style={styles.detailCopy}>
            <StatusPill label={enrollmentCourseCode(enrollment)} tone="primary" />
            <UiText accessibilityRole="header" variant="headlineSmall">{enrollmentCourseName(enrollment, locale)}</UiText>
            <StatusPill label={copy.status[enrollment.status] ?? copy.status.UNKNOWN} tone={enrollmentStatusTone(enrollment.status)} />
            {enrollment.gradeStatus === 'APPEALED' ? (
              <StatusPill label={copy.gradeStatus.APPEALED ?? 'APPEALED'} tone="warning" />
            ) : null}
          </View>
        </View>
        <ScreenSpacer size={8} />
        {section?.sectionNumber ? <Field label={copy.sectionLabel} value={section.sectionNumber} /> : null}
        {section?.course?.credits ? <Field label={copy.creditsLabel} value={formatNumber(section.course.credits)} /> : null}
        {lecturer ? <Field label={copy.lecturer} value={lecturer} /> : null}
        {enrollment.enrolledAt ? <Field label={copy.enrolledAt} value={formatDate(enrollment.enrolledAt)} /> : null}
        {enrollment.droppedAt ? <Field label={copy.droppedAt} value={formatDate(enrollment.droppedAt)} /> : null}
        <Field label={copy.finalGrade} value={grade} />
      </Card>
      <ScreenSpacer />
      <Card>
        <UiText accessibilityRole="header" variant="headlineSmall">{copy.meetings}</UiText>
        {(section?.schedules ?? []).length === 0 ? (
          <UiText variant="bodySmall" tone="muted">{copy.noSessions}</UiText>
        ) : (
          (section?.schedules ?? []).map((slot, index) => (
            <View key={slot.id ?? index}>
              {index > 0 ? <Divider /> : null}
              <Field
                label={copy.dayLong[slot.dayOfWeek === 0 ? 1 : slot.dayOfWeek] ?? ''}
                value={`${slot.startTime} – ${slot.endTime} · ${roomLabel(slot) ? `${copy.room} ${roomLabel(slot)}` : copy.roomPending}`}
              />
            </View>
          ))
        )}
      </Card>
      <ScreenSpacer />
      {onDrop ? (
        <Button
          label={copy.dropSection}
          accessibilityLabel={`${copy.dropSection}: ${enrollmentCourseCode(enrollment)}`}
          onPress={onDrop}
          variant="destructive"
          icon="trash-can-outline"
        />
      ) : null}
      <ScreenSpacer />
      {enrollment.status !== 'DROPPED' && enrollment.status !== 'CANCELLED' ? <SlipRow semesterId={enrollment.semesterId} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  fieldLabel: { flex: 1, minWidth: 110 },
  fieldValue: { flex: 2, minWidth: 150 },
  detailHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  detailCopy: { flex: 1, gap: 4, minWidth: 0 },
});
