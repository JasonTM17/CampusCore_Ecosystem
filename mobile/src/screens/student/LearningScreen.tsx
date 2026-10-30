import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, StatePanel, UiText } from '../../components/Ui';
import { ChoiceField, SegmentedControl, StatusPill } from '../../components/ui/index';
import { apiClient } from '../../api/client';
import type { MobileLearningAssignment, MobileLearningMaterial, MobileLearningSection } from '../../api/client';
import { tokens } from '../../design/tokens';
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

type Tab = 'materials' | 'assignments';

/** Student learning: pick a section, read its materials, work on assignments. Enrollment and deadlines are server-owned. */
export function LearningScreen(_props: MobileScreenProps) {
  const { locale, formatDateTime } = useContentCopy();
  const copy = learningMessages[locale];
  const live = apiClient.mode === 'live';
  const [tab, setTab] = useState<Tab>('assignments');
  const [picked, setPicked] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const sectionsQuery = useContentQuery<MobileLearningSection[]>('content.learning.sections', () => contentApi.learningSections());
  const sections = live ? sectionsQuery.data ?? [] : previewLearningSections;
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
        options={sections.map((entry) => ({ value: entry.sectionId, label: `${entry.courseCode} · ${entry.courseName}` }))}
      />
      <SegmentedControl
        accessibilityLabel={copy.title}
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        options={[{ value: 'assignments', label: copy.assignments }, { value: 'materials', label: copy.materials }]}
      />
    </View>
  );

  return tab === 'assignments' ? (
    <ListFrame
      title={copy.title}
      icon="book-open-variant"
      list={assignments}
      keyOf={(item) => item.id}
      emptyTitle={copy.emptyAssignments}
      header={header}
      renderItem={(item) => (
        <Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={joinMeta([item.title, copy.statusLabels[item.mySubmissionStatus ?? item.status] ?? item.status, item.deadlineAt ? formatDateTime(item.deadlineAt) : copy.noDeadline])}
            onPress={() => setAssignmentId(item.id)}
            style={styles.rowMain}
          >
            <ContentIconChip icon="clipboard-text-outline" />
            <View style={styles.rowCopy}>
              <UiText variant="label">{item.title}</UiText>
              <View style={styles.chips}>
                <StatusPill
                  label={`${copy.deadline}: ${item.deadlineAt ? formatDateTime(item.deadlineAt) : copy.noDeadline}`}
                  tone={item.deadlineAt ? 'warning' : 'neutral'}
                />
                <StatusChip code={item.mySubmissionStatus ?? item.status} labels={copy.statusLabels} />
              </View>
            </View>
            <ContentChevron />
          </Pressable>
        </Card>
      )}
    />
  ) : (
    <ListFrame
      title={copy.title}
      icon="book-open-variant"
      list={materials}
      keyOf={(item) => item.id}
      emptyTitle={copy.emptyMaterials}
      header={header}
      renderItem={(item) => (
        <Card>
          <View style={styles.rowMain}>
            <ContentIconChip icon="folder-outline" />
            <View style={styles.rowCopy}>
              <UiText variant="label">{item.title}</UiText>
              {item.description ? <UiText variant="bodySmall" tone="muted">{item.description}</UiText> : null}
              {item.fileName ? (
                <AttachmentRow name={item.fileName} sizeBytes={item.sizeBytes} fetchBytes={() => contentApi.learningDownloadMaterial(item.id)} />
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
  rowMain: { alignItems: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, minHeight: tokens.layout.touchTarget },
  rowCopy: { flex: 1, gap: tokens.spacing.xs, minWidth: 0 },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
});
