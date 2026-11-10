import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Card, DataNotice, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobileLearningAssignment, MobileLearningMaterial, MobileLearningSection } from '../../api/client';
import { tokens } from '../../design/tokens';
import { useTheme } from '../../design/theme';
import { learningMessages } from '../../i18n/learning-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { AssignmentDetail } from '../content/AssignmentDetail';
import { contentApi } from '../content/content-api';
import { joinMeta } from '../content/content-rules';
import { AttachmentRow, ContentChevron, ContentIconChip, ListFrame, StatusChip, useContentCopy } from '../content/content-ui';
import {
  previewAssignments,
  previewLearningSections,
  previewMaterials,
} from '../content/preview-data';
import { useContentQuery } from '../content/use-content-query';
import { useListQuery } from '../content/use-list-query';

/** Student learning: pick a section, read its materials, work on assignments. Enrollment and deadlines are server-owned. */
export function LearningScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime } = useContentCopy();
  const { colors } = useTheme();
  const copy = learningMessages[locale];
  const live = apiClient.mode === 'live';
  const [picked, setPicked] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const sectionsQuery = useContentQuery<MobileLearningSection[]>('content.learning.sections', () => contentApi.learningSections());
  const sections = live ? sectionsQuery.data ?? [] : previewLearningSections(locale);
  const sectionId = picked && sections.some((entry) => entry.sectionId === picked) ? picked : sections[0]?.sectionId ?? null;

  const previewMats = useMemo(() => previewMaterials(locale), [locale]);
  const previewAsgs = useMemo(() => previewAssignments(locale), [locale]);
  const materials = useListQuery<MobileLearningMaterial>({
    key: `content.learning.materials.${sectionId}`,
    fetchAll: () => contentApi.learningMaterials(sectionId as string),
    enabled: sectionId !== null,
    preview: previewMats,
  });
  const assignments = useListQuery<MobileLearningAssignment>({
    key: `content.learning.assignments.${sectionId}`,
    fetchAll: () => contentApi.learningAssignments(sectionId as string),
    enabled: sectionId !== null,
    preview: previewAsgs,
  });

  const selected = assignmentId ? assignments.items.find((item) => item.id === assignmentId) ?? null : null;
  if (selected) {
    return (
      <AssignmentDetail
        assignment={selected}
        onBack={() => setAssignmentId(null)}
        onChanged={() => void assignments.reload()}
      />
    );
  }

  if (live && sectionsQuery.isLoading && !sectionsQuery.data) {
    return <StatePanel kind="loading" title={copy.loading} />;
  }
  if (live && sectionsQuery.error && !sectionsQuery.data) {
    return <StatePanel kind="error" title={copy.errorTitle} description={sectionsQuery.error} actionLabel={copy.retry} onAction={() => void sectionsQuery.reload()} />;
  }
  if (sections.length === 0) {
    return <StatePanel kind="empty" title={copy.emptySections} />;
  }

  const header = (
    <View style={styles.header}>
      <ChoiceField
        label={copy.section}
        value={sectionId}
        onChange={(value) => { setPicked(value); setAssignmentId(null); }}
        options={sections.map((entry) => ({ value: entry.sectionId, label: `${entry.courseCode} · ${entry.sectionNumber} · ${entry.courseName}` }))}
      />
      {live && sectionsQuery.warning ? <DataNotice message={sectionsQuery.warning} /> : null}
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.materials}</UiText>
    </View>
  );

  const assignmentSection = (
    <View style={styles.section}>
      <UiText accessibilityRole="header" variant="headlineSmall">{copy.assignments}</UiText>
      {assignments.error ? (
        <StatePanel kind="error" title={copy.errorTitle} description={assignments.error} actionLabel={copy.retry} onAction={() => void assignments.reload()} />
      ) : null}
      {assignments.loading && assignments.items.length === 0 ? <StatePanel kind="loading" title={copy.loading} /> : null}
      {!assignments.loading && !assignments.error && assignments.items.length === 0 ? <StatePanel kind="empty" title={copy.emptyAssignments} /> : null}
      {assignments.items.map((item) => (
        <Card key={item.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={joinMeta([
              item.title,
              copy.deadline,
              item.deadlineAt ? formatDateTime(item.deadlineAt) : copy.noDeadline,
              copy.statusLabels[item.status] ?? item.status,
              item.mySubmissionStatus ? copy.statusLabels[item.mySubmissionStatus] ?? item.mySubmissionStatus : null,
            ])}
            onPress={() => setAssignmentId(item.id)}
            style={styles.rowMain}
          >
            <ContentIconChip icon="clipboard-text-outline" />
            <View style={styles.rowCopy}>
              <UiText variant="label">{item.title}</UiText>
              <View style={styles.deadline}>
                <MaterialCommunityIcons accessible={false} importantForAccessibility="no" color={colors.textMuted} name="calendar-blank-outline" size={14} />
                <UiText variant="meta" tone="muted">{item.deadlineAt ? formatDateTime(item.deadlineAt) : '—'}</UiText>
              </View>
              <View style={styles.chips}>
                <StatusChip code={item.status} labels={copy.statusLabels} />
                {item.mySubmissionStatus ? <StatusChip code={item.mySubmissionStatus} labels={copy.statusLabels} /> : null}
              </View>
              {item.description ? <UiText variant="bodySmall" tone="muted" numberOfLines={2}>{item.description}</UiText> : null}
              <UiText variant="label" tone="primary">{copy.openAssignment}</UiText>
            </View>
            <ContentChevron />
          </Pressable>
        </Card>
      ))}
    </View>
  );

  return (
    <ListFrame
      title={copy.title}
      description={copy.description}
      icon="book-open-variant"
      list={materials}
      keyOf={(item) => item.id}
      emptyTitle={copy.emptyMaterials}
      errorTitle={copy.errorTitle}
      errorDescription={copy.unavailable}
      header={header}
      footer={assignmentSection}
      renderItem={(item) => (
        <Card>
          <View style={styles.rowMain}>
            <ContentIconChip icon="folder-outline" />
            <View style={styles.rowCopy}>
              <UiText variant="label">{item.title}</UiText>
              {item.description ? <UiText variant="bodySmall" tone="muted">{item.description}</UiText> : null}
              {item.fileName ? (
                <AttachmentRow name={item.fileName} sizeBytes={item.sizeBytes} fetchBytes={(signal) => contentApi.learningDownloadMaterial(item.id, signal)} />
              ) : null}
            </View>
          </View>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.spacing.sm },
  section: { gap: tokens.spacing.sm, paddingTop: tokens.spacing.md },
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  deadline: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
