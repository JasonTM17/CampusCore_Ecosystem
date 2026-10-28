import { View } from 'react-native';

import { Badge, Button, Card, Divider, ScreenSpacer, UiText } from '../../components/Ui';
import { useLocale } from '../../i18n/locale-provider';
import {
  enrollmentCourseCode,
  enrollmentCourseName,
  lecturerName,
  roomLabel,
  type AcademicEnrollment,
} from './academic-model';
import { SlipRow } from './SlipRow';
import { academicStyles, useAcademicCopy } from './academic-ui';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={academicStyles.row}>
      <UiText variant="bodySmall" tone="muted">{label}</UiText>
      <UiText variant="bodyMedium">{value}</UiText>
    </View>
  );
}

export interface EnrollmentDetailProps {
  enrollment: AcademicEnrollment;
  onBack: () => void;
}

export function EnrollmentDetail({ enrollment, onBack }: EnrollmentDetailProps) {
  const { copy, locale } = useAcademicCopy();
  const { formatDate } = useLocale();
  const section = enrollment.section;
  const published = enrollment.gradeStatus === 'PUBLISHED';
  const lecturer = lecturerName(section);
  const grade = published && enrollment.finalGrade != null
    ? `${enrollment.finalGrade}${enrollment.letterGrade ? ` · ${enrollment.letterGrade}` : ''}`
    : copy.noGrade;

  return (
    <View>
      <Button label={copy.back} onPress={onBack} variant="text" />
      <Card>
        <UiText variant="meta" tone="primary">{enrollmentCourseCode(enrollment)}</UiText>
        <UiText accessibilityRole="header" variant="headlineSmall">{enrollmentCourseName(enrollment, locale)}</UiText>
        <View style={academicStyles.actions}>
          <Badge label={copy.status[enrollment.status] ?? enrollment.status} tone={enrollment.status === 'COMPLETED' ? 'success' : 'primary'} />
        </View>
        <ScreenSpacer size={8} />
        {section?.sectionNumber ? <Field label={copy.sectionLabel} value={section.sectionNumber} /> : null}
        {section?.course?.credits ? <Field label={copy.creditsLabel} value={String(section.course.credits)} /> : null}
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
                value={[`${slot.startTime} – ${slot.endTime}`, roomLabel(slot) ? `${copy.room} ${roomLabel(slot)}` : ''].filter(Boolean).join(' · ')}
              />
            </View>
          ))
        )}
      </Card>
      <ScreenSpacer />
      {enrollment.status !== 'DROPPED' && enrollment.status !== 'CANCELLED' ? <SlipRow semesterId={enrollment.semesterId} /> : null}
    </View>
  );
}
