import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Badge, Button, Card, Notice, ProgressBar, StatePanel, UiText } from '../../components/Ui';
import { Dialog, SearchBar } from '../../components/ui/primitives';
import { fillCopy } from '../../i18n/academic-messages';
import type { MobileScreenProps } from '../../navigation/types';
import { GradeRowCard } from './GradeRowCard';
import { lecturerApi, type SectionGradeSheet } from './lecturer-api';
import { generateGradeCsv, gradeCsvFilename } from './lecturer-csv';
import {
  buildGradeDraft,
  courseTitle,
  dirtyGradeCount,
  gradedPercent,
  localIsoDate,
  windowOf,
  type GradeDraft,
  type ScoreEdit,
} from './lecturer-model';
import { CsvExport, HandoffButton, OpsShell, SectionPicker, isOpsPreview, useOpsQuery } from './lecturer-ui';
import { opsErrorMessage, useOpsCopy } from './shared/helpers';
import { previewGrades, previewGrading } from './shared/preview';
import { useOpsStyles } from './shared/styles';

const PAGE_SIZE = 30;
const NO_PROBLEMS: GradeDraft['problems'] = {};

type Banner = { tone: 'success' | 'error' | 'warning'; message: string } | null;

export function LecturerGradingScreen(_props: MobileScreenProps) {
  const styles = useOpsStyles();
  const { copy, locale } = useOpsCopy();
  const preview = isOpsPreview();
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const sectionsQuery = useOpsQuery('lecturer:grading', () => lecturerApi.gradingSections(), copy);
  const sections = useMemo(() => (preview ? previewGrading : sectionsQuery.data ?? []), [preview, sectionsQuery.data]);

  const [picked, setPicked] = useState(typeof params.sectionId === 'string' ? params.sectionId : '');
  const sectionId = sections.some((section) => section.sectionId === picked) ? picked : sections[0]?.sectionId ?? '';
  const section = sections.find((item) => item.sectionId === sectionId);

  const gradesQuery = useOpsQuery(`lecturer:grades:${sectionId}`, () => lecturerApi.sectionGrades(sectionId), copy, Boolean(sectionId));
  // The hook keeps the previous key's data until the next fetch lands; only rows that carry this section are used.
  const sheet: SectionGradeSheet | undefined = useMemo(() => {
    if (preview) return { sectionId, rows: previewGrades };
    const data = gradesQuery.data;
    return data && data.sectionId === sectionId ? data : undefined;
  }, [preview, gradesQuery.data, sectionId]);
  const rows = useMemo(() => sheet?.rows ?? [], [sheet]);

  const [edits, setEdits] = useState<Record<string, ScoreEdit>>({});
  const [problems, setProblems] = useState<GradeDraft['problems']>(NO_PROBLEMS);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Banner>(null);
  const [search, setSearch] = useState('');
  const [pages, setPages] = useState(1);

  useEffect(() => {
    setEdits({});
    setProblems(NO_PROBLEMS);
    setMessage(null);
    setSearch('');
    setPages(1);
  }, [sectionId]);

  const dirty = dirtyGradeCount(rows, edits);
  const locked = rows.length > 0 && rows.every((row) => row.gradeStatus === 'PUBLISHED' || row.gradeStatus === 'APPEALED');
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) => `${row.studentName ?? ''} ${row.studentCode ?? ''}`.toLowerCase().includes(needle))
    : rows;
  const { rows: shown, hasMore } = windowOf(visible, pages, PAGE_SIZE);

  const enrolled = section?.enrolledCount ?? rows.length;
  const graded = section?.gradedCount ?? rows.filter((row) => row.finalGrade != null).length;
  const status = section?.gradeStatus === 'PUBLISHED' || locked ? 'PUBLISHED' : 'DRAFT';

  const edit = (enrollmentId: string, field: 'processScore' | 'finalExamScore', text: string) => {
    setEdits((current) => ({ ...current, [enrollmentId]: { ...current[enrollmentId], [field]: text } }));
    setMessage(null);
    if (problems[enrollmentId]) {
      setProblems((current) => {
        const { [enrollmentId]: _removed, ...rest } = current;
        return rest;
      });
    }
  };

  const reload = () => { void sectionsQuery.reload(); void gradesQuery.reload(); };

  const saveScores = async () => {
    const draft = buildGradeDraft(rows, edits);
    if (Object.keys(draft.problems).length > 0) {
      setProblems(draft.problems);
      setMessage({ tone: 'error', message: copy.scoresInvalid });
      return;
    }
    if (draft.changes.length === 0) {
      setMessage({ tone: 'warning', message: copy.nothingChanged });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      await lecturerApi.saveGrades(sectionId, draft.changes);
      setEdits({});
      setProblems(NO_PROBLEMS);
      setMessage({ tone: 'success', message: fillCopy(copy.scoresSaved, { n: draft.changes.length }) });
      reload();
    } catch (error) {
      setMessage({ tone: 'error', message: opsErrorMessage(copy, error, copy.saveScoresFailed) });
      if ((error as { status?: number } | null)?.status === 409) reload();
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setConfirming(false);
    setBusy('publish');
    setMessage(null);
    try {
      await lecturerApi.publishGrades(sectionId);
      setMessage({ tone: 'success', message: copy.publishedOk });
      reload();
    } catch (error) {
      setMessage({ tone: 'error', message: opsErrorMessage(copy, error, copy.publishFailed) });
      if ((error as { status?: number } | null)?.status === 409) reload();
    } finally {
      setBusy(null);
    }
  };

  const buildCsv = () =>
    generateGradeCsv({
      sectionNumber: section?.sectionNumber ?? sectionId,
      courseCode: section?.courseCode,
      courseName: section ? courseTitle(section, locale) : undefined,
      students: rows.map((row) => ({
        studentId: row.studentId ?? row.enrollmentId,
        studentCode: row.studentCode ?? '',
        studentName: row.studentName ?? '',
        processScore: row.processScore ?? null,
        finalExamScore: row.finalExamScore ?? null,
        letterGrade: row.letterGrade ?? null,
        gradeStatus: row.gradeStatus ?? null,
      })),
      locale,
    });

  const queryError = preview ? null : sectionsQuery.error ?? gradesQuery.error;
  const loading = !preview && (sectionsQuery.isLoading || (Boolean(sectionId) && !sheet && !queryError));
  const canPublish = !preview && Boolean(section?.canPublish) && dirty === 0 && busy === null;
  const publishHint = dirty > 0 ? copy.publishUnsavedFirst : section && !section.canPublish && status !== 'PUBLISHED' ? copy.publishBlocked : null;

  return (
    <OpsShell
      title={copy.gradingTitle}
      eyebrow={section ? `${section.courseCode ?? ''}` : undefined}
      subtitle={section ? courseTitle(section, locale) : undefined}
      loading={loading}
      error={queryError}
      warning={preview ? null : sectionsQuery.warning ?? gradesQuery.warning}
      onRetry={reload}
    >
      {sections.length === 0 ? (
        <StatePanel kind="empty" title={copy.emptySchedule} />
      ) : (
        <View>
          <SectionPicker sections={sections} value={sectionId} onChange={setPicked} />
          <Card tone="primary" style={styles.gradingHero}>
            <View style={styles.courseHeader}>
              <View style={styles.topicCopy}>
                <UiText variant="bodySmall" tone="muted">{copy.pendingScores}</UiText>
                <UiText variant="display" tone="primary">{Math.max(enrolled - graded, 0)}</UiText>
              </View>
              <Badge label={status === 'PUBLISHED' ? copy.published : copy.draft} tone={status === 'PUBLISHED' ? 'success' : 'warning'} />
            </View>
            <ProgressBar label={copy.gradedProgress} value={gradedPercent(graded, enrolled)} />
          </Card>
          {rows.length === 0 ? (
            <StatePanel kind="empty" title={copy.rosterEmpty} />
          ) : (
            <View>
              <SearchBar
                value={search}
                onChangeText={(value) => { setSearch(value); setPages(1); }}
                placeholder={copy.searchStudents}
                accessibilityLabel={copy.searchStudents}
                style={styles.searchBar}
              />
              {visible.length === 0 ? <StatePanel kind="empty" title={copy.noMatch} /> : null}
              {shown.map((row) => (
                <GradeRowCard
                  key={row.enrollmentId}
                  row={row}
                  edit={edits[row.enrollmentId]}
                  problems={problems[row.enrollmentId]}
                  copy={copy}
                  onEdit={edit}
                  disabled={busy !== null}
                />
              ))}
              {hasMore ? <Button label={copy.loadMore} variant="secondary" onPress={() => setPages((current) => current + 1)} /> : null}
              {message ? <Notice tone={message.tone} message={message.message} /> : null}
              {dirty > 0 ? <UiText variant="bodySmall" tone="muted">{fillCopy(copy.changesCount, { n: dirty })}</UiText> : null}
              <Button
                label={copy.saveScores}
                loading={busy === 'save'}
                disabled={preview || dirty === 0 || busy !== null}
                onPress={() => void saveScores()}
                style={styles.topButton}
              />
              <Button
                label={copy.publishGrades}
                variant="secondary"
                loading={busy === 'publish'}
                disabled={!canPublish || status === 'PUBLISHED'}
                onPress={() => setConfirming(true)}
                style={styles.secondaryButton}
              />
              {publishHint ? <UiText variant="bodySmall" tone="muted">{publishHint}</UiText> : null}
              <CsvExport
                name={gradeCsvFilename(section?.courseCode ?? 'section', section?.sectionNumber ?? sectionId, localIsoDate())}
                build={buildCsv}
                rows={rows.length}
              />
              <UiText variant="bodySmall" tone="muted">{copy.importPrintWeb}</UiText>
              <HandoffButton label={copy.openOnWeb} path={`/dashboard/lecturer/grades/${encodeURIComponent(sectionId)}`} />
            </View>
          )}
        </View>
      )}
      <Dialog
        visible={confirming}
        title={copy.publishTitle}
        description={fillCopy(copy.publishBody, { n: section?.sectionNumber ?? '', count: enrolled })}
        confirmLabel={copy.publishConfirm}
        cancelLabel={copy.publishCancel}
        onConfirm={() => void publish()}
        onCancel={() => setConfirming(false)}
      />
    </OpsShell>
  );
}
